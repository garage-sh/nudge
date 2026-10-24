import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  captures,
  corrigerVerdict,
  projets,
  retours,
  supprimerRetours,
  verdicts,
  type Db,
} from '@nudge/database';
import {
  LIMITES_DASHBOARD,
  schemaFiltresRetours,
  type ApiErrorBody,
  type CorrectionVerdict,
  type PageRetours,
  type RetourDetailVu,
  type RetourResumeVu,
  type TypeCapture,
  type VerdictVu,
} from '@nudge/shared';
import type { StockageCaptures } from '@nudge/stockage';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DB, STOCKAGE_CAPTURES } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';
import { COLONNES_DESTINATION_ENVOI, toEnvoiVu } from './envoi-vu.js';

type FiltresRetours = z.output<typeof schemaFiltresRetours>;

/**
 * Position d'un Retour dans la boîte de réception : son instant de création à la
 * microseconde (une `Date` JS s'arrête à la milliseconde et ferait sauter des Retours)
 * et son id, qui départage les Retours créés au même instant.
 */
interface Position {
  readonly instant: string;
  readonly id: string;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const encodeCurseur = (position: Position): string =>
  Buffer.from(JSON.stringify([position.instant, position.id])).toString('base64url');

function decodeCurseur(curseur: string): Position {
  try {
    const valeur: unknown = JSON.parse(Buffer.from(curseur, 'base64url').toString('utf8'));
    if (Array.isArray(valeur) && valeur.length === 2) {
      const [instant, id] = valeur as unknown[];
      if (
        typeof instant === 'string' &&
        INSTANT.test(instant) &&
        typeof id === 'string' &&
        isUuid(id)
      ) {
        return { instant, id };
      }
    }
  } catch {
    // Rendu en 400 ci-dessous.
  }
  const refus: ApiErrorBody = {
    erreur: 'requete_invalide',
    details: [{ chemin: 'curseur', message: 'Curseur invalide' }],
  };
  throw new BadRequestException(refus);
}

/** Retours de tous les Projets, tels qu'un Membre les lit (pas de rôles en v1). */
@Injectable()
export class RetoursService {
  private readonly logger = new Logger(RetoursService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STOCKAGE_CAPTURES) private readonly stockage: StockageCaptures,
  ) {}

  /** Une page de la boîte de réception, du plus récent au plus ancien. */
  async list(filtres: FiltresRetours): Promise<PageRetours> {
    const conditions: SQL[] = [];
    if (filtres.projet) conditions.push(eq(retours.projetId, filtres.projet));
    if (filtres.etat) conditions.push(eq(retours.etat, filtres.etat));
    if (filtres.source) conditions.push(eq(retours.source, filtres.source));
    if (filtres.type) conditions.push(eq(verdicts.typeRetenu, filtres.type));
    if (filtres.gravite) conditions.push(eq(verdicts.gravite, filtres.gravite));
    if (filtres.incertain !== undefined) {
      conditions.push(eq(verdicts.incertain, filtres.incertain));
    }
    if (filtres.curseur) {
      const apres = decodeCurseur(filtres.curseur);
      conditions.push(
        sql`(${retours.createdAt}, ${retours.id}) < (${apres.instant}::timestamptz, ${apres.id}::uuid)`,
      );
    }

    const lignes = await this.db
      .select({
        id: retours.id,
        projetId: projets.id,
        projetNom: projets.nom,
        etat: retours.etat,
        source: retours.source,
        apercu: sql<string>`left(${retours.texte}, ${sql.raw(String(LIMITES_DASHBOARD.apercuRetour))})`,
        typeDeclare: retours.typeDeclare,
        createdAt: retours.createdAt,
        instant: sql<string>`to_char(${retours.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        verdictId: verdicts.id,
        typeRetenu: verdicts.typeRetenu,
        gravite: verdicts.gravite,
        indesirable: verdicts.indesirable,
        manipulation: verdicts.manipulation,
        incertain: verdicts.incertain,
      })
      .from(retours)
      .innerJoin(projets, eq(projets.id, retours.projetId))
      .leftJoin(verdicts, eq(verdicts.retourId, retours.id))
      .where(and(...conditions))
      .orderBy(desc(retours.createdAt), desc(retours.id))
      // Une ligne de plus dit s'il existe une page suivante.
      .limit(filtres.limite + 1);

    const page = lignes.slice(0, filtres.limite);
    const derniere = page.at(-1);
    return {
      retours: page.map((ligne): RetourResumeVu => ({
        id: ligne.id,
        projet: { id: ligne.projetId, nom: ligne.projetNom },
        etat: ligne.etat,
        source: ligne.source,
        apercu: ligne.apercu,
        typeDeclare: ligne.typeDeclare,
        // Sans Verdict, la jointure à gauche rend ses colonnes nulles : `verdictId` en décide.
        verdict: ligne.verdictId ? toVerdictVu(ligne as VerdictColonnes) : null,
        createdAt: ligne.createdAt.toISOString(),
      })),
      suivant:
        lignes.length > filtres.limite && derniere
          ? encodeCurseur({ instant: derniere.instant, id: derniere.id })
          : null,
    };
  }

  /** Le détail d'un Retour : texte, Auteur, contexte, Verdict et Envois (du plus ancien au plus récent). */
  async read(id: string): Promise<RetourDetailVu> {
    if (!isUuid(id)) throw retourIntrouvable();
    const retour = await this.db.query.retours.findFirst({
      where: eq(retours.id, id),
      with: {
        projet: { columns: { id: true, nom: true } },
        capture: { columns: { contentType: true, octets: true } },
        verdict: true,
        envois: {
          with: { destination: { columns: COLONNES_DESTINATION_ENVOI } },
          orderBy: (envois, { asc }) => [asc(envois.createdAt), asc(envois.id)],
        },
      },
    });
    if (!retour) throw retourIntrouvable();
    return {
      id: retour.id,
      projet: retour.projet,
      etat: retour.etat,
      source: retour.source,
      texte: retour.texte,
      typeDeclare: retour.typeDeclare,
      auteur:
        retour.auteur && retour.confianceAuteur
          ? {
              id: retour.auteur.id ?? null,
              email: retour.auteur.email ?? null,
              nom: retour.auteur.nom ?? null,
              confiance: retour.confianceAuteur,
            }
          : null,
      contexte: retour.contexte,
      capture: retour.capture ?? null,
      verdict: retour.verdict ? toVerdictVu(retour.verdict) : null,
      envois: retour.envois.map(toEnvoiVu),
      createdAt: retour.createdAt.toISOString(),
    };
  }

  /**
   * L'image de la Capture d'un Retour, lue dans le stockage ; 404 `capture_introuvable`
   * si le Retour n'en a pas (ou si le stockage ne l'a plus).
   */
  async lireCapture(id: string): Promise<{ contentType: TypeCapture; contenu: Uint8Array }> {
    if (!isUuid(id)) throw retourIntrouvable();
    const [capture] = await this.db
      .select({ cle: captures.cle, contentType: captures.contentType })
      .from(captures)
      .where(eq(captures.retourId, id));
    const contenu = capture ? await this.stockage.lire(capture.cle) : null;
    if (!capture || !contenu) {
      throw new NotFoundException({ erreur: 'capture_introuvable' } satisfies ApiErrorBody);
    }
    return { contentType: capture.contentType, contenu };
  }

  /**
   * Efface un Retour et sa Capture (demande d'effacement). 404 s'il n'existe pas ;
   * 503 `stockage_indisponible` si l'image n'a pas pu être effacée : le Retour est
   * alors gardé, et la suppression peut être retentée.
   */
  async supprimer(id: string): Promise<void> {
    if (!isUuid(id)) throw retourIntrouvable();
    const { supprimes, echecs } = await supprimerRetours(this.db, [id], (cle) =>
      this.stockage.supprimer(cle),
    );
    const [echec] = echecs;
    if (echec) {
      this.logger.error(`Capture du Retour ${id} non effacée : Retour gardé`, echec.erreur);
      throw new ServiceUnavailableException({
        erreur: 'stockage_indisponible',
      } satisfies ApiErrorBody);
    }
    if (supprimes.length === 0) throw retourIntrouvable();
  }

  /**
   * Corrige le Verdict d'un Retour et rend le Retour à jour. Les Destinations déjà
   * servies ne voient rien : seul le rejeu d'un Envoi propage la correction.
   */
  async corriger(id: string, correction: CorrectionVerdict): Promise<RetourDetailVu> {
    if (!isUuid(id)) throw retourIntrouvable();
    if (!(await corrigerVerdict(this.db, id, correction))) {
      const [existe] = await this.db
        .select({ id: retours.id })
        .from(retours)
        .where(eq(retours.id, id));
      throw existe ? retourNonTrie() : retourIntrouvable();
    }
    return this.read(id);
  }
}

/** Un Retour sans Verdict n'a rien à corriger : il attend son Triage. */
const retourNonTrie = () =>
  new ConflictException({ erreur: 'retour_non_trie' } satisfies ApiErrorBody);

export const retourIntrouvable = () =>
  new NotFoundException({ erreur: 'retour_introuvable' } satisfies ApiErrorBody);

type VerdictColonnes = Pick<typeof verdicts.$inferSelect, keyof VerdictVu>;

const toVerdictVu = (verdict: VerdictColonnes): VerdictVu => ({
  typeRetenu: verdict.typeRetenu,
  gravite: verdict.gravite,
  indesirable: verdict.indesirable,
  manipulation: verdict.manipulation,
  incertain: verdict.incertain,
});

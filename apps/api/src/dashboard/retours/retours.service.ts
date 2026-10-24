import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { corrigerVerdict, projets, retours, verdicts, type Db } from '@nudge/database';
import {
  LIMITES_DASHBOARD,
  schemaFiltresRetours,
  type ApiErrorBody,
  type CorrectionVerdict,
  type PageRetours,
  type RetourDetailVu,
  type RetourResumeVu,
  type VerdictVu,
} from '@nudge/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DB } from '../../infra/tokens.js';
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
  constructor(@Inject(DB) private readonly db: Db) {}

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
      verdict: retour.verdict ? toVerdictVu(retour.verdict) : null,
      envois: retour.envois.map(toEnvoiVu),
      createdAt: retour.createdAt.toISOString(),
    };
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

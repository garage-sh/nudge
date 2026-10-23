import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DestinationAdapterResolver,
  DispatchJob,
  EnvoiASortir,
  ResultatEnvoi,
} from '@nudge/core';
import { envois, toDestinationConfiguree, type Db } from '@nudge/database';
import { and, eq, sql } from 'drizzle-orm';
import { DB, DESTINATION_ADAPTER_RESOLVER } from './tokens.js';

/** Échec transitoire : le job est relancé par BullMQ (backoff exponentiel). */
export class EchecTransitoire extends Error {
  override readonly name = 'EchecTransitoire';
}

@Injectable()
export class DispatchProcessor {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
  ) {}

  async handle({ envoiId }: DispatchJob): Promise<void> {
    const envoi = await this.db.query.envois.findFirst({
      where: eq(envois.id, envoiId),
      with: {
        destination: true,
        retour: { with: { projet: true, verdict: true } },
      },
    });
    if (!envoi || envoi.statut !== 'en_attente') return;
    const { destination, retour } = envoi;
    if (!retour.verdict) {
      this.logger.error(`Envoi ${envoiId} sans Verdict, ignoré`);
      return;
    }

    const aSortir: EnvoiASortir = {
      envoiId,
      projet: { id: retour.projet.id, nom: retour.projet.nom },
      retour: {
        id: retour.id,
        texte: retour.texte,
        source: retour.source,
        typeRetenu: retour.verdict.typeRetenu,
        gravite: retour.verdict.gravite,
        incertain: retour.verdict.incertain,
        auteur:
          retour.auteur && retour.confianceAuteur
            ? { ...retour.auteur, confiance: retour.confianceAuteur }
            : null,
        contexte: retour.contexte,
        recuLe: retour.createdAt,
      },
    };

    const resultat = await this.send(toDestinationConfiguree(destination), aSortir);
    const enAttente = and(eq(envois.id, envoiId), eq(envois.statut, 'en_attente'));
    const tentatives = sql`${envois.tentatives} + 1`;

    if (resultat.statut === 'livre') {
      await this.db
        .update(envois)
        .set({
          statut: 'livre',
          lienExterne: resultat.lienExterne,
          tentatives,
          derniereErreur: null,
        })
        .where(enAttente);
      return;
    }
    if (resultat.classe === 'transient') {
      await this.db
        .update(envois)
        .set({ tentatives, derniereErreur: resultat.message })
        .where(enAttente);
      throw new EchecTransitoire(resultat.message);
    }
    // auth / permanent : la Suspension et les alertes relèvent de #8.
    await this.db
      .update(envois)
      .set({
        statut: 'echec',
        tentatives,
        derniereErreur: `${resultat.classe}: ${resultat.message}`,
      })
      .where(enAttente);
  }

  /** Une exception de l'adaptateur (réseau, bug) est traitée comme un échec transitoire. */
  private async send(
    destination: ReturnType<typeof toDestinationConfiguree>,
    envoi: EnvoiASortir,
  ): Promise<ResultatEnvoi> {
    try {
      return await this.resolveDestinationAdapter(destination).send(envoi);
    } catch (erreur) {
      return {
        statut: 'echec',
        classe: 'transient',
        message: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
  }
}

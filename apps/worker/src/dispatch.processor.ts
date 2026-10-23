import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EnvoiASortir, JobDispatch, ResoudreAdaptateur } from '@nudge/core';
import { envois, type Db } from '@nudge/database';
import { and, eq, sql } from 'drizzle-orm';
import { DB, RESOUDRE_ADAPTATEUR } from './jetons.js';

/** Échec transitoire : le job est relancé par BullMQ (backoff exponentiel). */
export class EchecTransitoire extends Error {
  override readonly name = 'EchecTransitoire';
}

@Injectable()
export class DispatchProcessor {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RESOUDRE_ADAPTATEUR) private readonly resoudreAdaptateur: ResoudreAdaptateur,
  ) {}

  async traiter({ envoiId }: JobDispatch): Promise<void> {
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
        recuLe: retour.creeLe,
      },
    };

    const adaptateur = this.resoudreAdaptateur({
      id: destination.id,
      projetId: destination.projetId,
      nom: destination.nom,
      type: destination.type,
      config: destination.config,
    });
    const resultat = await adaptateur.send(aSortir);
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
}

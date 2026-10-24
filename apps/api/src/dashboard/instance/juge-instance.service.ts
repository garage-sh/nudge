import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Chiffreur } from '@nudge/core';
import {
  CONTEXTE_CLE_JUGE,
  enregistrerJugeInstance,
  lireJugeInstance,
  type Db,
  type JugeEnregistre,
} from '@nudge/database';
import {
  exigeCleApi,
  type ApiErrorBody,
  type JugeInstanceVu,
  type schemaJugeInstance,
} from '@nudge/shared';
import type { z } from 'zod';
import { CHIFFREUR, DB } from '../../infra/tokens.js';

type ChoixJuge = z.output<typeof schemaJugeInstance>;

const vu = (juge: JugeEnregistre): JugeInstanceVu => ({
  fournisseur: juge.fournisseur,
  modele: juge.modele,
  urlBase: juge.urlBase,
  cleConfiguree: juge.cleChiffree !== null,
});

/** Le Juge de l'Instance : sa clé API n'existe en clair que le temps de la chiffrer. */
@Injectable()
export class JugeInstanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CHIFFREUR) private readonly chiffreur: Chiffreur,
  ) {}

  async lire(): Promise<JugeInstanceVu> {
    return vu(await lireJugeInstance(this.db));
  }

  async choisir(choix: ChoixJuge): Promise<JugeInstanceVu> {
    const actuel = await lireJugeInstance(this.db);
    const juge: JugeEnregistre = choix.fournisseur
      ? {
          fournisseur: choix.fournisseur,
          modele: choix.modele ?? null,
          urlBase: choix.urlBase ?? null,
          cleChiffree: this.cleApres(choix, actuel),
        }
      : { fournisseur: null, modele: null, urlBase: null, cleChiffree: null };

    if (juge.fournisseur && exigeCleApi(juge.fournisseur) && !juge.cleChiffree) {
      const refus: ApiErrorBody = {
        erreur: 'requete_invalide',
        details: [
          { chemin: 'cleApi', message: `Clé API requise pour le Juge ${juge.fournisseur}` },
        ],
      };
      throw new BadRequestException(refus);
    }
    await enregistrerJugeInstance(this.db, juge);
    return vu(juge);
  }

  /**
   * Une clé fournie est chiffrée ; `null` l'efface ; absente, la clé enregistrée est
   * gardée tant que le fournisseur ne change pas (elle ne vaut que chez lui).
   */
  private cleApres(choix: ChoixJuge, actuel: JugeEnregistre): string | null {
    if (choix.cleApi !== undefined) {
      return choix.cleApi === null
        ? null
        : this.chiffreur.chiffrer(choix.cleApi, CONTEXTE_CLE_JUGE);
    }
    return choix.fournisseur === actuel.fournisseur ? actuel.cleChiffree : null;
  }
}

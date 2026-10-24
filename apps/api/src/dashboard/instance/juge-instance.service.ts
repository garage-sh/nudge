import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { SecretCipher } from '@nudge/core';
import {
  AUCUN_JUGE,
  JUGE_KEY_CONTEXT,
  readJugeInstance,
  writeJugeInstance,
  type Db,
  type JugeEnregistre,
} from '@nudge/database';
import {
  exigeCleApi,
  type ApiErrorBody,
  type JugeInstanceVu,
  type schemaChoixJuge,
} from '@nudge/shared';
import type { z } from 'zod';
import { DB, SECRET_CIPHER } from '../../infra/tokens.js';

type ChoixJuge = z.output<typeof schemaChoixJuge>;

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
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {}

  async lire(): Promise<JugeInstanceVu> {
    return vu(await readJugeInstance(this.db));
  }

  async choisir(choix: ChoixJuge): Promise<JugeInstanceVu> {
    const actuel = await readJugeInstance(this.db);
    const juge: JugeEnregistre = choix.fournisseur
      ? {
          fournisseur: choix.fournisseur,
          modele: choix.modele ?? null,
          urlBase: choix.urlBase ?? null,
          cleChiffree: this.cleApres(choix, actuel),
        }
      : AUCUN_JUGE;

    if (juge.fournisseur && exigeCleApi(juge.fournisseur) && !juge.cleChiffree) {
      const refus: ApiErrorBody = {
        erreur: 'requete_invalide',
        details: [
          { chemin: 'cleApi', message: `Clé API requise pour le Juge ${juge.fournisseur}` },
        ],
      };
      throw new BadRequestException(refus);
    }
    await writeJugeInstance(this.db, juge);
    return vu(juge);
  }

  /**
   * Une clé fournie est chiffrée ; `null` l'efface. Absente, la clé enregistrée n'est
   * gardée que pour le même fournisseur à la même adresse : elle ne doit jamais partir
   * vers un hôte qu'on vient de changer.
   */
  private cleApres(choix: ChoixJuge, actuel: JugeEnregistre): string | null {
    if (choix.cleApi !== undefined) {
      return choix.cleApi === null ? null : this.cipher.encrypt(choix.cleApi, JUGE_KEY_CONTEXT);
    }
    const memeServeur =
      choix.fournisseur === actuel.fournisseur && (choix.urlBase ?? null) === actuel.urlBase;
    return memeServeur ? actuel.cleChiffree : null;
  }
}

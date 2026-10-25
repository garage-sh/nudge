import { Inject, Injectable } from '@nestjs/common';
import type { SecretCipher } from '@nudge/core';
import { JUGE_KEY_CONTEXT, readJugeInstance, type Db } from '@nudge/database';
import { createJuge, type ConfigJuge, type Juge } from '@nudge/judge';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS, SECRET_CIPHER } from './tokens.js';

/**
 * Le Juge du Triage. Sans Juge fixé par les options (tests), c'est celui que l'Instance
 * a choisi, relu en base à chaque Triage : un changement fait dans le dashboard vaut
 * pour le Retour suivant, sans redémarrer le worker. À défaut, celui des variables
 * `NUDGE_JUDGE_*` ; à défaut encore, aucun (mode dégradé).
 */
@Injectable()
export class JugeResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {}

  /** Lève si la clé enregistrée ne se déchiffre plus (clé d'Instance changée) : le Triage est retenté. */
  async courant(): Promise<Juge | null> {
    if (this.options.juge !== undefined) return this.options.juge;
    const config = (await this.configInstance()) ?? this.options.jugeParDefaut ?? null;
    return config ? createJuge(config) : null;
  }

  private async configInstance(): Promise<ConfigJuge | null> {
    const juge = await readJugeInstance(this.db);
    if (!juge.fournisseur) return null;
    return {
      fournisseur: juge.fournisseur,
      modele: juge.modele,
      urlBase: juge.urlBase,
      cleApi: juge.cleChiffree ? this.cipher.decrypt(juge.cleChiffree, JUGE_KEY_CONTEXT) : null,
    };
  }
}

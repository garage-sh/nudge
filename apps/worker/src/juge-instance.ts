import { Inject, Injectable } from '@nestjs/common';
import { chiffreurDepuisCle, type Chiffreur } from '@nudge/core';
import { lireConfigJuge, type Db } from '@nudge/database';
import { creerJuge, type Juge } from '@nudge/judge';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS } from './tokens.js';

/**
 * Le Juge du Triage. Sans Juge fixé par les options (tests), c'est celui que l'Instance
 * a choisi, relu en base à chaque Triage : un changement fait dans le dashboard vaut
 * pour le Retour suivant, sans redémarrer le worker. À défaut, celui des variables
 * `NUDGE_JUDGE_*` ; à défaut encore, aucun (mode dégradé).
 */
@Injectable()
export class JugeInstance {
  private readonly chiffreur: Chiffreur;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {
    this.chiffreur = chiffreurDepuisCle(options.cleChiffrement);
  }

  /** Lève si la clé enregistrée ne se déchiffre plus (clé d'Instance changée) : le Triage est retenté. */
  async courant(): Promise<Juge | null> {
    if (this.options.juge !== undefined) return this.options.juge;
    const config =
      (await lireConfigJuge(this.db, this.chiffreur)) ?? this.options.jugeParDefaut ?? null;
    return config ? creerJuge(config) : null;
  }
}

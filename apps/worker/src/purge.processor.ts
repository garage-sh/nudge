import { Inject, Injectable, Logger } from '@nestjs/common';
import { readRetentionInstance, retours, supprimerRetours, type Db } from '@nudge/database';
import { and, asc, lt, notInArray } from 'drizzle-orm';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS } from './tokens.js';

/** Retours effacés par lot : une purge enchaîne les lots jusqu'à épuisement. */
const LOT = 100;

const JOUR_MS = 24 * 60 * 60_000;

/**
 * Purge de rétention : efface les Retours plus anciens que la durée de rétention de
 * l'Instance, avec leurs Captures. Sans durée (par défaut), rien n'est purgé. La
 * durée est relue à chaque passage : la changer au dashboard suffit.
 */
@Injectable()
export class PurgeProcessor {
  private readonly logger = new Logger(PurgeProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async handle(): Promise<void> {
    const jours = await readRetentionInstance(this.db);
    if (jours === null) return;
    const avant = new Date(Date.now() - jours * JOUR_MS);
    let total = 0;
    // Retours gardés pendant ce passage (Capture non effacée) : les lots suivants les
    // sautent, pour qu'une Capture qui résiste ne bloque pas la purge des autres.
    const gardes: string[] = [];
    for (;;) {
      const lot = await this.db
        .select({ id: retours.id })
        .from(retours)
        .where(
          and(
            lt(retours.createdAt, avant),
            gardes.length > 0 ? notInArray(retours.id, gardes) : undefined,
          ),
        )
        .orderBy(asc(retours.createdAt))
        .limit(LOT);
      const { supprimes, echecs } = await supprimerRetours(
        this.db,
        lot.map(({ id }) => id),
        (cle) => this.options.stockageCaptures.supprimer(cle),
      );
      total += supprimes.length;
      for (const { retourId, erreur } of echecs) {
        this.logger.error(`Capture du Retour ${retourId} non effacée : purge retentée`, erreur);
        gardes.push(retourId);
      }
      // Lot incomplet : plus rien d'expiré ce passage ; le suivant retentera les gardés.
      if (lot.length < LOT) break;
    }
    if (total > 0) this.logger.log(`Rétention de ${jours} j : ${total} Retour(s) purgé(s)`);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { readRetentionInstance, writeRetentionInstance, type Db } from '@nudge/database';
import type { RetentionVu } from '@nudge/shared';
import { DB } from '../../infra/tokens.js';

/**
 * Durée de rétention des Retours de l'Instance. La purge planifiée du worker la relit
 * à chaque passage : la changer ici suffit.
 */
@Injectable()
export class RetentionInstanceService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async lire(): Promise<RetentionVu> {
    return { jours: await readRetentionInstance(this.db) };
  }

  async changer({ jours }: RetentionVu): Promise<RetentionVu> {
    await writeRetentionInstance(this.db, jours);
    return { jours };
  }
}

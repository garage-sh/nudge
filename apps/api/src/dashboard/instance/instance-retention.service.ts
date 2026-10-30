import { Inject, Injectable } from '@nestjs/common';
import { readInstanceRetention, writeInstanceRetention, type Db } from '@nudge/database';
import type { RetentionView } from '@nudge/shared';
import { DB } from '../../infra/tokens.js';

/**
 * Retention period of the Instance's Feedbacks and Incidents. The worker's scheduled purge reads it
 * again on every run: changing it here is enough.
 */
@Injectable()
export class InstanceRetentionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async read(): Promise<RetentionView> {
    return { days: await readInstanceRetention(this.db) };
  }

  async change({ days }: RetentionView): Promise<RetentionView> {
    await writeInstanceRetention(this.db, days);
    return { days };
  }
}

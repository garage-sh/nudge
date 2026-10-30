import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildIncidentLevelState,
  dispatchJobId,
  INCIDENT_LEVEL_INSTRUCTIONS,
  incidentLevelQuestions,
  queueDeliveries,
  type DispatchJob,
  type IncidentLevelJob,
} from '@nudge/core';
import {
  readIncidentAwaitingLevel,
  settleIncidentLevel,
  type Db,
  type IncidentAwaitingLevel,
} from '@nudge/database';
import { JudgeTransientError } from '@nudge/judge';
import { LEVELS, type Level } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { JudgeResolver } from './judge-resolver.js';
import { DEFAULT_INCIDENTS, type WorkerOptions } from './options.js';
import { withTimeout } from './timeout.js';
import { DB, DISPATCH_QUEUE_TOKEN, OPTIONS } from './tokens.js';

/**
 * Settles the Level of an Incident opened without a declared one, then runs its
 * Dispatch `opened`. The Judge is asked one Choice among the Levels, and is waited for
 * only until the bound (`IncidentOptions.judgeWaitMs`, counted from the opening): past
 * it, with no Judge, or when the Judge fails, the Project's default Level the Incident
 * opened with applies. A Judge error never retries: a production alert is never held
 * for it. A replayed job finds the Level settled and does nothing.
 */
@Injectable()
export class IncidentLevelProcessor {
  private readonly logger = new Logger(IncidentLevelProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly judgeResolver: JudgeResolver,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async handle({ incidentId }: IncidentLevelJob): Promise<void> {
    const incident = await readIncidentAwaitingLevel(this.db, incidentId);
    if (!incident) return;
    const level = await this.assess(incident);
    const created = await settleIncidentLevel(this.db, incidentId, level);
    const pending = (created ?? []).filter((delivery) => delivery.status === 'pending');
    // After the commit; if the queueing fails, the sweep of pending Deliveries sends them.
    try {
      await queueDeliveries(this.dispatchQueue, pending, dispatchJobId);
    } catch (error) {
      this.logger.error(
        `Incident ${incidentId} dispatched but its Deliveries not queued, the sweep will send them: ${String(error)}`,
      );
    }
  }

  /** The Judge's Level, or `null` when the default one applies. */
  private async assess(incident: IncidentAwaitingLevel): Promise<Level | null> {
    const { judgeWaitMs } = this.options.incidents ?? DEFAULT_INCIDENTS;
    const remainingMs = incident.firstSeenAt.getTime() + judgeWaitMs - Date.now();
    if (remainingMs <= 0) return null;
    try {
      const judge = await this.judgeResolver.current();
      if (!judge) return null;
      const answers = await withTimeout(
        remainingMs,
        () => new JudgeTransientError(`Judge gave no Level within ${judgeWaitMs} ms`),
        (signal) =>
          judge.judge(
            {
              instructions: INCIDENT_LEVEL_INSTRUCTIONS,
              state: buildIncidentLevelState(incident.firstReport, incident.projectDescription),
              questions: incidentLevelQuestions,
            },
            { signal },
          ),
      );
      const level = answers.level.choice;
      if (!LEVELS.includes(level)) throw new Error(`Judge answered an unknown Level "${level}"`);
      return level;
    } catch (error) {
      this.logger.warn(
        `Incident ${incident.id}: the Judge gave no Level, the default one applies: ${String(error)}`,
      );
      return null;
    }
  }
}

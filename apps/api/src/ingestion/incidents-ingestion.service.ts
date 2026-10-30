import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  alertJobId,
  closingJobId,
  deriveFingerprint,
  dispatchJobId,
  INCIDENT_LEVEL_JOB,
  incidentLevelJobId,
  queueDeliveries,
  type AlertJob,
  type DispatchJob,
  type IncidentLevelJob,
} from '@nudge/core';
import {
  closeIncident,
  createMissingIncidentDeliveries,
  recordOccurrence,
  type CreatedDelivery,
  type OpeningCap,
  type RecordedOccurrence,
  type Db,
  type Project,
} from '@nudge/database';
import {
  DEFAULT_OPENING_CAP,
  OPENING_CAP_WINDOW_MS,
  type IncidentReport,
  type ReceivedIncident,
  type ValidatedIncident,
} from '@nudge/shared';
import type { Queue } from 'bullmq';
import {
  ALERTS_QUEUE_TOKEN,
  DB,
  DISPATCH_QUEUE_TOKEN,
  INCIDENT_LEVEL_QUEUE_TOKEN,
  OPENING_CAP,
} from '../infra/tokens.js';

/**
 * The Instance's Opening cap: how many Incidents a Project without a cap of its own may
 * open per window and still dispatch. The window is one minute; tests shorten it.
 */
export type OpeningCapOptions = OpeningCap;

/** 20 Incidents per minute (`NUDGE_INCIDENT_OPENING_CAP` sets another number). */
export const DEFAULT_OPENING_CAP_OPTIONS: OpeningCapOptions = {
  limit: DEFAULT_OPENING_CAP,
  windowMs: OPENING_CAP_WINDOW_MS,
};

/**
 * The Dispatch moment an Occurrence that is not `resolved` starts: `opened` for one that
 * opened its Incident, `raised` for one that raised it, none while the Incident awaits
 * its Level (the worker runs its opening).
 */
function dispatchMomentOf(recorded: RecordedOccurrence): 'opened' | 'raised' | null {
  if (recorded.awaitingLevel || recorded.held) return null;
  if (recorded.opened) return 'opened';
  return recorded.raised ? 'raised' : null;
}

/** A `resolved` Occurrence that matched no Open Incident: nothing was recorded. */
const NOTHING_TO_RESOLVE: ReceivedIncident = { id: null, state: null, opened: false };

/**
 * Records an Occurrence: it opens an Incident or is absorbed by the Open one it matches.
 * An Incident that opens with a declared Level is dispatched (`opened`), and so is one
 * whose Level the Occurrence raises (`raised`, to the Destinations the higher Level newly
 * reaches); a `resolved` Occurrence closes the Incident it is absorbed by (`closed`), and
 * opens none. All in the same transaction as the Occurrence.
 *
 * An Incident that opens without a declared Level is not dispatched here: the worker asks
 * the Judge for its Level, within a bounded wait, then runs its Dispatch `opened`. The
 * response never waits for the Judge. Until then, a raise dispatches nothing: the
 * opening goes out at the Level the Incident has by then.
 *
 * An Incident opened past its Project's Opening cap is Held: recorded, never dispatched
 * (neither opened nor raised) until a Member Redispatches it. The opening that starts a
 * storm alerts the Members, once.
 */
@Injectable()
export class IncidentsIngestionService {
  private readonly logger = new Logger(IncidentsIngestionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(INCIDENT_LEVEL_QUEUE_TOKEN)
    private readonly incidentLevelQueue: Queue<IncidentLevelJob>,
    @Inject(ALERTS_QUEUE_TOKEN) private readonly alertsQueue: Queue<AlertJob>,
    @Inject(OPENING_CAP) private readonly openingCap: OpeningCapOptions,
  ) {}

  /**
   * Once committed, the Occurrence is received: if the queueing of its Deliveries fails,
   * the sweep of the Deliveries left pending sends them; if the queueing of its Level's
   * assessment fails, the sweep of the Incidents left awaiting their Level runs it.
   */
  async receive(project: Project, occurrence: ValidatedIncident): Promise<ReceivedIncident> {
    const report: IncidentReport = {
      title: occurrence.title,
      message: occurrence.message ?? null,
      level: occurrence.level ?? null,
      environment: occurrence.environment ?? null,
      fingerprint: occurrence.fingerprint ?? null,
      context: occurrence.context ?? {},
      quietPeriod: occurrence.quietPeriod ?? null,
      resolved: occurrence.resolved ?? false,
      receivedAt: new Date().toISOString(),
    };
    const { received, created, jobId, awaitsAssessment, startedStormId } =
      await this.db.transaction(async (tx) => {
        const recorded = await recordOccurrence(tx, {
          projectId: project.id,
          fingerprint:
            report.fingerprint ?? deriveFingerprint(project.id, report.title, report.environment),
          level: report.level ?? project.defaultLevel,
          report,
          openingCap: {
            limit: project.openingCap ?? this.openingCap.limit,
            windowMs: this.openingCap.windowMs,
          },
        });
        if (!recorded) {
          return {
            received: NOTHING_TO_RESOLVE,
            created: [],
            jobId: dispatchJobId,
            awaitsAssessment: false,
            startedStormId: null,
          };
        }
        const awaitsAssessment = recorded.opened && recorded.awaitingLevel;
        const { startedStormId } = recorded;
        if (report.resolved) {
          return {
            received: { id: recorded.id, state: 'closed' as const, opened: recorded.opened },
            created: (await closeIncident(tx, recorded.id, 'resolved')) ?? [],
            jobId: closingJobId,
            awaitsAssessment,
            startedStormId,
          };
        }
        const moment = dispatchMomentOf(recorded);
        return {
          received: { id: recorded.id, state: 'open' as const, opened: recorded.opened },
          created: moment ? await createMissingIncidentDeliveries(tx, recorded.id, moment) : [],
          jobId: dispatchJobId,
          awaitsAssessment,
          startedStormId,
        };
      });
    if (startedStormId) await this.alertStorm(startedStormId);
    if (awaitsAssessment && received.id) await this.assessLevel(received.id);
    await this.queue(received.id, created, jobId);
    return received;
  }

  /** The storm stands once committed: its alert, if not queued, is lost (logged). */
  private async alertStorm(stormId: string): Promise<void> {
    const job: AlertJob = { event: 'incident_storm', stormId };
    try {
      await this.alertsQueue.add(job.event, job, { jobId: alertJobId(job) });
    } catch (error) {
      this.logger.error(
        `Incident storm ${stormId} started but its Member alert not queued: ${String(error)}`,
      );
    }
  }

  private async assessLevel(incidentId: string): Promise<void> {
    try {
      await this.incidentLevelQueue.add(
        INCIDENT_LEVEL_JOB,
        { incidentId },
        { jobId: incidentLevelJobId(incidentId) },
      );
    } catch (error) {
      this.logger.error(
        `Incident ${incidentId} recorded but its Level's assessment not queued, the sweep will run it: ${String(error)}`,
      );
    }
  }

  /** `jobId`: the first job of a new Delivery, or the closing job of an opening's. */
  private async queue(
    incidentId: string | null,
    created: readonly CreatedDelivery[],
    jobId: (deliveryId: string) => string,
  ): Promise<void> {
    const pending = created.filter((delivery) => delivery.status === 'pending');
    try {
      await queueDeliveries(this.dispatchQueue, pending, jobId);
    } catch (error) {
      this.logger.error(
        `Incident ${incidentId} recorded but its Deliveries not queued, the sweep will send them: ${String(error)}`,
      );
    }
  }
}

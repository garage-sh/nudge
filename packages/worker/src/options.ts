import type { LogLevel } from '@nestjs/common';
import type {
  FailureClass,
  DestinationAdapterResolver,
  RetryPolicy,
  TriageThresholds,
} from '@nudge/core';
import { DEFAULT_QUIET_PERIOD_MS, OPENING_CAP_WINDOW_MS } from '@nudge/shared';
import type { JudgeConfig, Judge } from '@nudge/judge';
import type { CaptureStorage } from '@nudge/storage';

export interface WorkerOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** BullMQ key prefix, the same as the api's. */
  readonly queuePrefix?: string;
  /** Retry of the dispatch jobs; tests shorten it. */
  readonly retryPolicy?: RetryPolicy;
  /** Instance key (`NUDGE_ENCRYPTION_KEY`, 32 bytes in base64): decrypts the Judge key. */
  readonly encryptionKey: string;
  /**
   * Fixed Judge, which bypasses the Instance's (tests); `null`: degraded mode.
   * Absent: the Judge chosen for the Instance, failing that `defaultJudge`.
   */
  readonly judge?: Judge | null;
  /** Judge from the `NUDGE_JUDGE_*` variables, when the Instance has not chosen one. */
  readonly defaultJudge?: JudgeConfig | null;
  /**
   * HTTP client of the Judge chosen in the dashboard, whose base URL a Member typed:
   * `guardedFetch` of `NUDGE_OUTBOUND_ALLOWED_HOSTS` (`apps/api/src/main.ts`); only public
   * addresses by default. The `NUDGE_JUDGE_*` Judge, set by the Self-hoster, is not guarded.
   */
  readonly outboundFetch?: typeof globalThis.fetch;
  /** Time after which a Judge request is abandoned and retried (30 s by default). */
  readonly judgeTimeoutMs?: number;
  /** Thresholds of the Verdict policy; `DEFAULT_TRIAGE_THRESHOLDS` by default. */
  readonly triageThresholds?: TriageThresholds;
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
  /** Capture storage (`@nudge/storage`), the same as the api's. */
  readonly captureStorage: CaptureStorage;
  /** Public URL of the dashboard (`NUDGE_DASHBOARD_URL`): "view the Feedback" link of Deliveries (D12). */
  readonly dashboardUrl?: string | null;
  /**
   * Sweeps of the Feedbacks left Received (D18) and of the Deliveries left pending (D26);
   * 5 min delay, every minute, by default.
   */
  readonly sweep?: SweepOptions;
  /** Period of the retention purge; `DEFAULT_PURGE` by default. */
  readonly purge?: PurgeOptions;
  /** Sweep of the orphaned Captures; `DEFAULT_CAPTURE_SWEEP` by default. */
  readonly captureSweep?: CaptureSweepOptions;
  /**
   * Instance default Quiet period and its sweep, and how long an Incident's Dispatch
   * waits for the Judge; `DEFAULT_INCIDENTS` by default.
   */
  readonly incidents?: IncidentOptions;
  /** Jobs each worker runs at the same time, per queue; `DEFAULT_CONCURRENCY` by default. */
  readonly concurrency?: ConcurrencyOptions;
  /** Suspension threshold, cooldown and probe period; `DEFAULT_SUSPENSION` by default. */
  readonly suspension?: SuspensionOptions;
  /**
   * Observer of every transition of a Destination to Suspended, called by
   * `ON_SUSPENSION` after the Member alert is queued (tests).
   */
  readonly onSuspension?: OnSuspension;
  readonly logger?: false | LogLevel[];
}

/** Time a Judge request gets before being abandoned: exceeding it is transient, retried. */
export const DEFAULT_JUDGE_TIMEOUT_MS = 30_000;

export interface SweepOptions {
  /**
   * Age beyond which a Feedback still Received goes back to Triage, and a pending
   * Delivery without a job (since its last update) goes back to dispatch.
   */
  readonly delayMs: number;
  /** Period of the sweep. */
  readonly intervalMs: number;
}

export const DEFAULT_SWEEP: SweepOptions = { delayMs: 5 * 60_000, intervalMs: 60_000 };

/**
 * Longest wait between two re-Triages of the same Feedback by the sweep: the wait starts
 * at the sweep delay and doubles every time, up to this bound.
 */
export const MAX_TRIAGE_SWEEP_BACKOFF_MS = 60 * 60_000;

export interface CaptureSweepOptions {
  /**
   * Age under which an object of the storage is left alone: the api writes the image
   * before its database row, and an interrupted write may still be in progress.
   */
  readonly graceMs: number;
  /** Period of the sweep. */
  readonly intervalMs: number;
}

/** Once an hour, objects older than an hour. */
export const DEFAULT_CAPTURE_SWEEP: CaptureSweepOptions = {
  graceMs: 60 * 60_000,
  intervalMs: 60 * 60_000,
};

/**
 * How Open Incidents close on their own (the Instance default Quiet period and its
 * sweep), and how long the Dispatch of an Incident without a declared Level waits for the
 * Judge.
 */
export interface IncidentOptions {
  /**
   * The Instance default Quiet period: how long an Incident stays Open without a new
   * Occurrence when neither its last Occurrence nor its Project sets one.
   */
  readonly quietPeriodMs: number;
  /**
   * Period of the sweep that closes the Open Incidents silent past their Quiet period,
   * and queues again the Level assessments that were lost.
   */
  readonly sweepIntervalMs: number;
  /**
   * How long after an Incident opened without a declared Level its Dispatch waits for
   * the Judge's Level; past it, the Project's default Level applies.
   */
  readonly judgeWaitMs: number;
  /**
   * The window the Opening cap counts a Project's openings in (one minute; tests shorten
   * it, like the api's): a storm ends once a whole window goes by without a Held Incident.
   */
  readonly openingWindowMs?: number;
}

/**
 * One hour of silence closes an Incident; the sweep runs every minute; the Judge gets
 * ten seconds to assess a Level; the Opening cap counts the openings of the last minute.
 */
export const DEFAULT_INCIDENTS: Required<IncidentOptions> = {
  quietPeriodMs: DEFAULT_QUIET_PERIOD_MS,
  sweepIntervalMs: 60_000,
  judgeWaitMs: 10_000,
  openingWindowMs: OPENING_CAP_WINDOW_MS,
};

/** The Incident options in effect: `WorkerOptions.incidents`, else `DEFAULT_INCIDENTS`. */
export function incidentOptionsOf(options: WorkerOptions): Required<IncidentOptions> {
  const incidents = options.incidents ?? DEFAULT_INCIDENTS;
  return {
    ...incidents,
    openingWindowMs: incidents.openingWindowMs ?? DEFAULT_INCIDENTS.openingWindowMs,
  };
}

export interface ConcurrencyOptions {
  /** Triage jobs at the same time: as many Judge requests in flight. */
  readonly triage: number;
  /** Dispatch jobs at the same time: a slow Destination only holds one of them. */
  readonly dispatch: number;
  /**
   * Level assessments of Incidents at the same time: as many Judge requests in flight,
   * each one waiting at most `IncidentOptions.judgeWaitMs`.
   */
  readonly incidentLevel: number;
}

export const DEFAULT_CONCURRENCY: ConcurrencyOptions = {
  triage: 2,
  dispatch: 10,
  incidentLevel: 10,
};

export interface PurgeOptions {
  /**
   * Period of the purge of Feedbacks older than the Instance retention period (read
   * again from the database on every run).
   */
  readonly intervalMs: number;
}

/** One purge per hour: the retention period is counted in days. */
export const DEFAULT_PURGE: PurgeOptions = { intervalMs: 60 * 60_000 };

export interface SuspensionOptions {
  /** Consecutive transient failures from which (inclusive) the Destination is Suspended. */
  readonly failureThreshold: number;
  /** Delay between the Suspension (or an unanswered probe) and the next probe. */
  readonly cooldownMs: number;
  /** Period of the task that probes the Suspended Destinations whose cooldown has elapsed. */
  readonly probeIntervalMs: number;
}

/** Values taken from alliances-pa: 5 failures, 5 min cooldown, a probe every minute. */
export const DEFAULT_SUSPENSION: SuspensionOptions = {
  failureThreshold: 5,
  cooldownMs: 5 * 60_000,
  probeIntervalMs: 60_000,
};

/** The transition of a Destination to Suspended, as the database records it. */
export interface Suspension {
  readonly destinationId: string;
  readonly projectId: string;
  readonly name: string;
  /** `transient`: consecutive failure threshold reached; `auth`: credentials refused. */
  readonly failureClass: Exclude<FailureClass, 'permanent'>;
  readonly message: string;
  readonly suspendedAt: Date;
}

/**
 * Hook on every transition to Suspended: called once per transition, after its
 * database commit (never for a Destination already Suspended). At most once: a worker
 * stop between the commit and the call loses it, the database state remains the
 * reference. An error thrown here is logged without undoing the Suspension.
 */
export type OnSuspension = (suspension: Suspension) => void | Promise<void>;

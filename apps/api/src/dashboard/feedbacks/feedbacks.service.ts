import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  captures,
  correctVerdict,
  projects,
  feedbacks,
  deleteFeedbacks,
  verdicts,
  type Db,
} from '@nudge/database';
import {
  DASHBOARD_LIMITS,
  feedbackFiltersSchema,
  type ApiErrorBody,
  type VerdictCorrection,
  type FeedbackPage,
  type FeedbackDetailView,
  type FeedbackSummaryView,
  type CaptureType,
  type VerdictView,
} from '@nudge/shared';
import type { CaptureStorage } from '@nudge/storage';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DB, CAPTURE_STORAGE } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';
import { DELIVERY_DESTINATION_COLUMNS, toDeliveryView } from './delivery-view.js';

type FeedbackFilters = z.output<typeof feedbackFiltersSchema>;

/**
 * Position of a Feedback in the inbox: its creation instant to the microsecond (a JS
 * `Date` stops at the millisecond and would skip Feedbacks) and its id, which breaks
 * ties between Feedbacks created at the same instant.
 */
interface Position {
  readonly instant: string;
  readonly id: string;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** An existing instant (no 13th month): Postgres would refuse it with a 500, not a 400. */
const isInstant = (value: string): boolean => {
  if (!INSTANT.test(value)) return false;
  const milliseconds = `${value.slice(0, 23)}Z`;
  const date = new Date(milliseconds);
  return !Number.isNaN(date.getTime()) && date.toISOString() === milliseconds;
};

const encodeCursor = (position: Position): string =>
  Buffer.from(JSON.stringify([position.instant, position.id])).toString('base64url');

function decodeCursor(cursor: string): Position {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 2) {
      const [instant, id] = value as unknown[];
      if (
        typeof instant === 'string' &&
        isInstant(instant) &&
        typeof id === 'string' &&
        isUuid(id)
      ) {
        return { instant, id };
      }
    }
  } catch {
    // Returned as a 400 below.
  }
  const refusal: ApiErrorBody = {
    error: 'invalid_request',
    details: [{ path: 'cursor', message: 'Invalid cursor' }],
  };
  throw new BadRequestException(refusal);
}

/** Feedbacks of all Projects, as a Member reads them (no roles in v1). */
@Injectable()
export class FeedbacksService {
  private readonly logger = new Logger(FeedbacksService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CAPTURE_STORAGE) private readonly storage: CaptureStorage,
  ) {}

  /** A page of the inbox, newest to oldest. */
  async list(filters: FeedbackFilters): Promise<FeedbackPage> {
    const conditions: SQL[] = [];
    if (filters.project) conditions.push(eq(feedbacks.projectId, filters.project));
    if (filters.state) conditions.push(eq(feedbacks.state, filters.state));
    if (filters.source) conditions.push(eq(feedbacks.source, filters.source));
    if (filters.type) conditions.push(eq(verdicts.resolvedType, filters.type));
    if (filters.severity) conditions.push(eq(verdicts.severity, filters.severity));
    if (filters.uncertain !== undefined) {
      conditions.push(eq(verdicts.uncertain, filters.uncertain));
    }
    if (filters.cursor) {
      const after = decodeCursor(filters.cursor);
      conditions.push(
        sql`(${feedbacks.createdAt}, ${feedbacks.id}) < (${after.instant}::timestamptz, ${after.id}::uuid)`,
      );
    }

    const rows = await this.db
      .select({
        id: feedbacks.id,
        projectId: projects.id,
        projectName: projects.name,
        state: feedbacks.state,
        source: feedbacks.source,
        preview: sql<string>`left(${feedbacks.text}, ${sql.raw(String(DASHBOARD_LIMITS.feedbackPreview))})`,
        declaredType: feedbacks.declaredType,
        createdAt: feedbacks.createdAt,
        instant: sql<string>`to_char(${feedbacks.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        verdictId: verdicts.id,
        resolvedType: verdicts.resolvedType,
        severity: verdicts.severity,
        junk: verdicts.junk,
        manipulation: verdicts.manipulation,
        uncertain: verdicts.uncertain,
      })
      .from(feedbacks)
      .innerJoin(projects, eq(projects.id, feedbacks.projectId))
      .leftJoin(verdicts, eq(verdicts.feedbackId, feedbacks.id))
      .where(and(...conditions))
      .orderBy(desc(feedbacks.createdAt), desc(feedbacks.id))
      // One extra row tells whether a next page exists.
      .limit(filters.limit + 1);

    const page = rows.slice(0, filters.limit);
    const last = page.at(-1);
    return {
      feedbacks: page.map((row): FeedbackSummaryView => ({
        id: row.id,
        project: { id: row.projectId, name: row.projectName },
        state: row.state,
        source: row.source,
        preview: row.preview,
        declaredType: row.declaredType,
        // Without a Verdict, the left join returns null columns: `verdictId` decides.
        verdict: row.verdictId ? toVerdictView(row as VerdictColumns) : null,
        createdAt: row.createdAt.toISOString(),
      })),
      next:
        rows.length > filters.limit && last
          ? encodeCursor({ instant: last.instant, id: last.id })
          : null,
    };
  }

  /** A Feedback's detail: text, Author, context, Verdict and Deliveries (oldest to newest). */
  async read(id: string): Promise<FeedbackDetailView> {
    if (!isUuid(id)) throw feedbackNotFound();
    const feedback = await this.db.query.feedbacks.findFirst({
      where: eq(feedbacks.id, id),
      with: {
        project: { columns: { id: true, name: true } },
        capture: { columns: { contentType: true, bytes: true } },
        verdict: true,
        deliveries: {
          with: { destination: { columns: DELIVERY_DESTINATION_COLUMNS } },
          orderBy: (deliveries, { asc }) => [asc(deliveries.createdAt), asc(deliveries.id)],
        },
      },
    });
    if (!feedback) throw feedbackNotFound();
    return {
      id: feedback.id,
      project: feedback.project,
      state: feedback.state,
      source: feedback.source,
      text: feedback.text,
      declaredType: feedback.declaredType,
      author:
        feedback.author && feedback.authorTrust
          ? {
              id: feedback.author.id ?? null,
              email: feedback.author.email ?? null,
              name: feedback.author.name ?? null,
              trust: feedback.authorTrust,
            }
          : null,
      context: feedback.context,
      capture: feedback.capture ?? null,
      verdict: feedback.verdict ? toVerdictView(feedback.verdict) : null,
      deliveries: feedback.deliveries.map(toDeliveryView),
      createdAt: feedback.createdAt.toISOString(),
    };
  }

  /**
   * A Feedback's Capture image, read from storage; 404 `capture_not_found` if the
   * Feedback has none (or if the storage no longer has it).
   */
  async readCapture(id: string): Promise<{ contentType: CaptureType; content: Uint8Array }> {
    if (!isUuid(id)) throw feedbackNotFound();
    const [capture] = await this.db
      .select({ key: captures.key, contentType: captures.contentType })
      .from(captures)
      .where(eq(captures.feedbackId, id));
    const content = capture ? await this.storage.read(capture.key) : null;
    if (!capture || !content) {
      throw new NotFoundException({ error: 'capture_not_found' } satisfies ApiErrorBody);
    }
    return { contentType: capture.contentType, content };
  }

  /**
   * Deletes a Feedback and its Capture (deletion request). 404 if it does not exist;
   * 503 `storage_unavailable` if the image could not be deleted: the Feedback is then
   * kept, and the deletion can be retried.
   */
  async delete(id: string): Promise<void> {
    if (!isUuid(id)) throw feedbackNotFound();
    const { deleted, failures } = await deleteFeedbacks(this.db, [id], (key) =>
      this.storage.delete(key),
    );
    const [failure] = failures;
    if (failure) {
      this.logger.error(`Capture of Feedback ${id} not deleted: Feedback kept`, failure.error);
      throw new ServiceUnavailableException({
        error: 'storage_unavailable',
      } satisfies ApiErrorBody);
    }
    if (deleted.length === 0) throw feedbackNotFound();
  }

  /**
   * Corrects a Feedback's Verdict and returns the updated Feedback. The Destinations
   * already served see nothing: only the replay of a Delivery propagates the correction.
   */
  async correct(id: string, correction: VerdictCorrection): Promise<FeedbackDetailView> {
    if (!isUuid(id)) throw feedbackNotFound();
    if (!(await correctVerdict(this.db, id, correction))) {
      const [exists] = await this.db
        .select({ id: feedbacks.id })
        .from(feedbacks)
        .where(eq(feedbacks.id, id));
      throw exists ? feedbackNotTriaged() : feedbackNotFound();
    }
    return this.read(id);
  }
}

/** A Feedback without a Verdict has nothing to correct: it awaits its Triage. */
const feedbackNotTriaged = () =>
  new ConflictException({ error: 'feedback_not_triaged' } satisfies ApiErrorBody);

export const feedbackNotFound = () =>
  new NotFoundException({ error: 'feedback_not_found' } satisfies ApiErrorBody);

type VerdictColumns = Pick<typeof verdicts.$inferSelect, keyof VerdictView>;

const toVerdictView = (verdict: VerdictColumns): VerdictView => ({
  resolvedType: verdict.resolvedType,
  severity: verdict.severity,
  junk: verdict.junk,
  manipulation: verdict.manipulation,
  uncertain: verdict.uncertain,
});

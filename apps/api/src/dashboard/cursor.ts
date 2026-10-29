import { BadRequestException } from '@nestjs/common';
import type { ApiErrorBody } from '@nudge/shared';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { isUuid } from '../validation.js';

/**
 * Position of a row in a list ordered newest first (the inbox, a Project's Incidents):
 * its creation instant to the microsecond (a JS `Date` stops at the millisecond and
 * would skip rows) and its id, which breaks ties between rows created at the same
 * instant.
 */
export interface Position {
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

/** A timestamp column read to the microsecond, as a `Position` carries it. */
export const instantColumn = (column: AnyColumn): SQL<string> =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The rows after `position` in a list ordered by (`instant`, `id`) descending. */
export const after = (instant: AnyColumn, id: AnyColumn, position: Position): SQL =>
  sql`(${instant}, ${id}) < (${position.instant}::timestamptz, ${position.id}::uuid)`;

export const encodeCursor = (position: Position): string =>
  Buffer.from(JSON.stringify([position.instant, position.id])).toString('base64url');

/** The position a cursor carries; 400 `invalid_request` for any other value. */
export function decodeCursor(cursor: string): Position {
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

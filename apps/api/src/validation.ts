import { BadRequestException } from '@nestjs/common';
import type { ApiErrorBody } from '@nudge/shared';
import type { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed row id: any other designates nothing (404), without a database query. */
export const isUuid = (value: string): boolean => UUID.test(value);

/**
 * Validates a request body; a refusal returns 400 with a stable code
 * (`invalid_request` by default) and the detail of the refused fields.
 */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
  error = 'invalid_request',
): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const refusal: ApiErrorBody = {
    error,
    details: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
  throw new BadRequestException(refusal);
}

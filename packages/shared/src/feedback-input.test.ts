import { describe, expect, it } from 'vitest';
import { captureInputSchema } from './feedback-input.js';

describe('Capture input', () => {
  it.each(['A', 'A===', 'AB=C'])(
    'refuses data that is not decodable base64 (%s) as an issue, never by throwing',
    (data) => {
      const result = captureInputSchema.safeParse({ contentType: 'image/png', data });

      expect(result.success).toBe(false);
      expect(result.error?.issues.every((issue) => issue.path[0] === 'data')).toBe(true);
    },
  );
});

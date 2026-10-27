import { describe, expect, it } from 'vitest';
import { publicApiDocument } from './openapi.js';

describe('Public API document', () => {
  // The committed file is what agents and integrators read: `vitest -u` regenerates it.
  it('matches docs/api/openapi.json', async () => {
    await expect(`${JSON.stringify(publicApiDocument(), null, 2)}\n`).toMatchFileSnapshot(
      '../../../docs/api/openapi.json',
    );
  });
});

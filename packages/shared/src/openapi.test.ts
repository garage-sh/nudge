import { describe, expect, it } from 'vitest';
import { publicApiDocument } from './openapi.js';

describe('Public API document', () => {
  // The committed file is what agents and integrators read: `vitest -u` regenerates it.
  it('matches docs/api/openapi.json', async () => {
    await expect(`${JSON.stringify(publicApiDocument(), null, 2)}\n`).toMatchFileSnapshot(
      '../../../docs/api/openapi.json',
    );
  });

  it('publishes the Incident endpoint, secret key only, with its refusals', () => {
    const operation = publicApiDocument().paths['/v1/incidents']?.post;

    expect(operation).toMatchObject({
      operationId: 'postIncident',
      requestBody: {
        content: {
          'application/json': {
            schema: { required: ['title'], additionalProperties: false },
          },
        },
      },
    });
    const schema = operation?.requestBody.content['application/json'].schema as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties.level?.enum).toEqual(['info', 'warning', 'error', 'critical']);
    expect(Object.keys(schema.properties)).toEqual([
      'title',
      'message',
      'level',
      'environment',
      'fingerprint',
      'context',
    ]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(['202', '400', '401', '403', '429']);
    expect(JSON.stringify(operation?.responses['403'])).toContain('secret_key_required');
    expect(JSON.stringify(operation?.responses['400'])).toContain('invalid_incident');
  });
});

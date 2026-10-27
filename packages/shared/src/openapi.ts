import { z } from 'zod';
import { feedbackInputSchema } from './feedback-input.js';

const errorBody = (codes: readonly string[]) => ({
  type: 'object',
  properties: {
    error: { type: 'string', enum: codes },
    details: {
      type: 'array',
      description: 'The refused fields, for `invalid_feedback`.',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, message: { type: 'string' } },
        required: ['path', 'message'],
      },
    },
  },
  required: ['error'],
});

const refusal = (description: string, codes: readonly string[], retryAfter = false) => ({
  description,
  ...(retryAfter && {
    headers: {
      'Retry-After': {
        description: 'Seconds to wait before retrying.',
        schema: { type: 'integer' },
      },
    },
  }),
  content: { 'application/json': { schema: errorBody(codes) } },
});

/**
 * OpenAPI description of the public ingestion API, the contract the Widget, the SDK and
 * any other caller post Feedback against. Only this surface is described: the dashboard
 * API is not a public contract.
 */
export function publicApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'nudge public API',
      version: 'v1',
      description:
        'Posts a Feedback to a Project of a nudge Instance. The server URL is the Instance’s own.',
    },
    servers: [{ url: 'https://nudge.example.com' }],
    paths: {
      '/v1/feedbacks': {
        post: {
          operationId: 'postFeedback',
          summary: 'Post a Feedback',
          description:
            'With the public key (`nk_pub_…`), the call must come from one of the Project’s ' +
            'Allowed origins and the Author is declared. With the secret key (`nk_sec_…`), ' +
            'from a server only, the Author is attested.',
          security: [{ projectKey: [] }],
          requestBody: {
            required: true,
            content: {
              // Output side: control characters are stripped before the bounds apply,
              // so the bounds and formats live on the output of each pipe.
              'application/json': { schema: z.toJSONSchema(feedbackInputSchema, { io: 'output' }) },
            },
          },
          responses: {
            '202': {
              description: 'The Feedback is stored and awaits its Triage.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      state: { type: 'string', const: 'received' },
                    },
                    required: ['id', 'state'],
                  },
                },
              },
            },
            '400': refusal('The body is malformed.', ['invalid_feedback']),
            '401': refusal('The key is missing or rejected.', ['missing_key', 'invalid_key']),
            '403': refusal('The origin is not allowed for this Project.', ['origin_refused']),
            '429': refusal(
              'Too many Feedbacks (public key) or too many rejected secret keys (from this IP).',
              ['too_many_feedbacks', 'too_many_attempts'],
              true,
            ),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        projectKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'The Project’s public key (Widget) or secret key (server).',
        },
      },
    },
  };
}

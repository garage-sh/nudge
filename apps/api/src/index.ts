import 'reflect-metadata';

export { createApi, type ApiOptions, type TrustProxy } from './api.js';
export { deriveSetupToken } from './dashboard/auth/setup-token.js';
export { DEFAULT_WIDGET_LIMITS, type WidgetLimits } from './ingestion/widget-access.js';
export { DEFAULT_OPENING_CAP_OPTIONS } from './ingestion/incidents-ingestion.service.js';

import {
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { DashboardModule, type DashboardOptions } from './dashboard/dashboard.module.js';
import { InfraModule, type InfraOptions } from './infra/infra.module.js';
import {
  WidgetAccess,
  WIDGET_LIMITS,
  DEFAULT_WIDGET_LIMITS,
  type WidgetLimits,
} from './ingestion/widget-access.js';
import { ProjectKeyGuard } from './ingestion/project-key.guard.js';
import { CorsIngestionMiddleware } from './ingestion/cors-ingestion.middleware.js';
import { IngestionController } from './ingestion/ingestion.controller.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { IncidentsIngestionController } from './ingestion/incidents-ingestion.controller.js';
import { IncidentsIngestionService } from './ingestion/incidents-ingestion.service.js';
import { SecretKeyGuard } from './ingestion/secret-key.guard.js';
import { SecretKeys } from './ingestion/secret-keys.js';
import {
  DEFAULT_OPENING_CAP_OPTIONS,
  type OpeningCapOptions,
} from './ingestion/incidents-ingestion.service.js';
import { OPENING_CAP } from './infra/tokens.js';

export interface IngestionOptions {
  /** Rate limit of the Widget path; `DEFAULT_WIDGET_LIMITS` otherwise. */
  readonly widgetLimits?: WidgetLimits;
  /** The Instance's Opening cap of the Incidents; `DEFAULT_OPENING_CAP_OPTIONS` otherwise. */
  readonly openingCap?: OpeningCapOptions;
}

@Module({})
export class ApiModule implements NestModule {
  static forRoot(options: InfraOptions & DashboardOptions & IngestionOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [InfraModule.forRoot(options), DashboardModule.forRoot(options)],
      controllers: [IngestionController, IncidentsIngestionController],
      providers: [
        { provide: WIDGET_LIMITS, useValue: options.widgetLimits ?? DEFAULT_WIDGET_LIMITS },
        { provide: OPENING_CAP, useValue: options.openingCap ?? DEFAULT_OPENING_CAP_OPTIONS },
        WidgetAccess,
        IngestionService,
        IncidentsIngestionService,
        SecretKeys,
        ProjectKeyGuard,
        SecretKeyGuard,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // All methods: the OPTIONS preflight has no route of its own.
    consumer
      .apply(CorsIngestionMiddleware)
      .forRoutes({ path: 'v1/feedbacks', method: RequestMethod.ALL });
  }
}

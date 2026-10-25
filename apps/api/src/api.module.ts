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

export interface IngestionOptions {
  /** Rate limit of the Widget path; `DEFAULT_WIDGET_LIMITS` otherwise. */
  readonly widgetLimits?: WidgetLimits;
}

@Module({})
export class ApiModule implements NestModule {
  static forRoot(options: InfraOptions & DashboardOptions & IngestionOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [InfraModule.forRoot(options), DashboardModule.forRoot(options)],
      controllers: [IngestionController],
      providers: [
        { provide: WIDGET_LIMITS, useValue: options.widgetLimits ?? DEFAULT_WIDGET_LIMITS },
        WidgetAccess,
        IngestionService,
        ProjectKeyGuard,
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

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
  AccesWidget,
  LIMITES_WIDGET,
  LIMITES_WIDGET_PAR_DEFAUT,
  type LimitesWidget,
} from './ingestion/acces-widget.js';
import { CleProjetGuard } from './ingestion/cle-projet.guard.js';
import { CorsIngestionMiddleware } from './ingestion/cors-ingestion.middleware.js';
import { IngestionController } from './ingestion/ingestion.controller.js';
import { IngestionService } from './ingestion/ingestion.service.js';

export interface IngestionOptions {
  /** Rate limit de la voie Widget ; `LIMITES_WIDGET_PAR_DEFAUT` sinon. */
  readonly limitesWidget?: LimitesWidget;
}

@Module({})
export class ApiModule implements NestModule {
  static forRoot(options: InfraOptions & DashboardOptions & IngestionOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [InfraModule.forRoot(options), DashboardModule.forRoot(options)],
      controllers: [IngestionController],
      providers: [
        { provide: LIMITES_WIDGET, useValue: options.limitesWidget ?? LIMITES_WIDGET_PAR_DEFAUT },
        AccesWidget,
        IngestionService,
        CleProjetGuard,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Toutes les méthodes : le preflight OPTIONS n'a pas de route à lui.
    consumer
      .apply(CorsIngestionMiddleware)
      .forRoutes({ path: 'v1/retours', method: RequestMethod.ALL });
  }
}

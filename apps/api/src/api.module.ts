import { Module, type DynamicModule } from '@nestjs/common';
import { DashboardModule, type DashboardOptions } from './dashboard/dashboard.module.js';
import { InfraModule, type InfraOptions } from './infra/infra.module.js';
import { IngestionController } from './ingestion/ingestion.controller.js';
import { CleSecreteGuard } from './ingestion/cle-secrete.guard.js';
import { IngestionService } from './ingestion/ingestion.service.js';

@Module({})
export class ApiModule {
  static forRoot(options: InfraOptions & DashboardOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [InfraModule.forRoot(options), DashboardModule.forRoot(options)],
      controllers: [IngestionController],
      providers: [IngestionService, CleSecreteGuard],
    };
  }
}

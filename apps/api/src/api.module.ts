import { Module, type DynamicModule } from '@nestjs/common';
import { InfraModule, type InfraOptions } from './infra/infra.module.js';
import { IngestionController } from './ingestion/ingestion.controller.js';
import { CleSecreteGuard } from './ingestion/cle-secrete.guard.js';
import { IngestionService } from './ingestion/ingestion.service.js';

@Module({})
export class ApiModule {
  static forRoot(options: InfraOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [InfraModule.forRoot(options)],
      controllers: [IngestionController],
      providers: [IngestionService, CleSecreteGuard],
    };
  }
}

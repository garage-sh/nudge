import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AlertsView } from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { AlertsService } from './alerts.service.js';

/** Dashboard badges: what awaits a Member. */
@Controller('api/alerts')
@UseGuards(SessionGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  read(): Promise<AlertsView> {
    return this.alerts.read();
  }
}

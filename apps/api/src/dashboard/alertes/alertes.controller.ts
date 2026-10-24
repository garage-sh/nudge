import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AlertesVu } from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { AlertesService } from './alertes.service.js';

/** Badges du dashboard : ce qui attend un Membre. */
@Controller('api/alertes')
@UseGuards(SessionGuard)
export class AlertesController {
  constructor(private readonly alertes: AlertesService) {}

  @Get()
  lire(): Promise<AlertesVu> {
    return this.alertes.lire();
  }
}

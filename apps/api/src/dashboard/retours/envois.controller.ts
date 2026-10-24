import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { EnvoiVu } from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { EnvoisService } from './envois.service.js';

@Controller('api/envois')
@UseGuards(SessionGuard)
export class EnvoisController {
  constructor(private readonly envois: EnvoisService) {}

  /**
   * Rejoue un Envoi livré ou en échec : 202 avec l'Envoi remis en attente, 409
   * `envoi_non_rejouable` (avec son statut) s'il est en attente ou retenu.
   */
  @Post(':id/rejeu')
  @HttpCode(202)
  rejouer(@Param('id') id: string): Promise<EnvoiVu> {
    return this.envois.rejouer(id);
  }
}

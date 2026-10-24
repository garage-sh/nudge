import { Controller, Get, UseGuards } from '@nestjs/common';
import type { MembreListeVu } from '@nudge/shared';
import { MembresService } from './membres.service.js';
import { SessionGuard } from './session.guard.js';

/** Les Membres de l'Instance : tous les Membres les voient tous (pas de rôles en v1). */
@Controller('api/membres')
@UseGuards(SessionGuard)
export class MembresController {
  constructor(private readonly membres: MembresService) {}

  @Get()
  lister(): Promise<MembreListeVu[]> {
    return this.membres.lister();
  }
}

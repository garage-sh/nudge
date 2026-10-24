import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  schemaModificationDestination,
  schemaNouvelleDestination,
  type DestinationAvecSecretsGeneres,
  type DestinationVu,
  type ResultatTestDestination,
} from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { DestinationsService } from './destinations.service.js';

@Controller('api')
@UseGuards(SessionGuard)
export class DestinationsController {
  constructor(private readonly destinations: DestinationsService) {}

  @Get('projets/:projetId/destinations')
  lister(@Param('projetId') projetId: string): Promise<DestinationVu[]> {
    return this.destinations.lister(projetId);
  }

  /** 201 avec les secrets générés par l'Instance (secret de signature), lisibles cette seule fois. */
  @Post('projets/:projetId/destinations')
  creer(
    @Param('projetId') projetId: string,
    @Body() corps: unknown,
  ): Promise<DestinationAvecSecretsGeneres> {
    return this.destinations.creer(projetId, parseBody(schemaNouvelleDestination, corps));
  }

  @Get('destinations/:id')
  lire(@Param('id') id: string): Promise<DestinationVu> {
    return this.destinations.lire(id);
  }

  @Patch('destinations/:id')
  modifier(@Param('id') id: string, @Body() corps: unknown): Promise<DestinationVu> {
    return this.destinations.modifier(id, parseBody(schemaModificationDestination, corps));
  }

  @Delete('destinations/:id')
  @HttpCode(204)
  supprimer(@Param('id') id: string): Promise<void> {
    return this.destinations.supprimer(id);
  }

  @Post('destinations/:id/secrets-generes')
  regenererSecretsGeneres(@Param('id') id: string): Promise<DestinationAvecSecretsGeneres> {
    return this.destinations.regenererSecretsGeneres(id);
  }

  /** Envoie un Retour d'exemple ; 200 avec le résultat, livré ou en échec. */
  @Post('destinations/:id/test')
  @HttpCode(200)
  tester(@Param('id') id: string): Promise<ResultatTestDestination> {
    return this.destinations.tester(id);
  }
}

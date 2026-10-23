import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { schemaRetourEntrant } from '@nudge/shared';
import { parseBody } from '../validation.js';
import { CleSecreteGuard, type AuthenticatedRequest } from './cle-secrete.guard.js';
import { IngestionService } from './ingestion.service.js';

@Controller('v1/retours')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /** Voie serveur : clé secrète du Projet, Source `api`. */
  @Post()
  @HttpCode(202)
  @UseGuards(CleSecreteGuard)
  async poster(@Req() requete: AuthenticatedRequest, @Body() corps: unknown) {
    const retour = parseBody(schemaRetourEntrant, corps, 'retour_invalide');
    return this.ingestion.receive(requete.projet.id, 'api', retour);
  }
}

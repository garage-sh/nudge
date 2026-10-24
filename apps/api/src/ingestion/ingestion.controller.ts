import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { schemaRetourEntrant } from '@nudge/shared';
import { parseBody } from '../validation.js';
import { CleProjetGuard, type AuthenticatedRequest } from './cle-projet.guard.js';
import { IngestionService } from './ingestion.service.js';

@Controller('v1/retours')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /** Les deux voies : clé publique (Source `widget`) ou clé secrète (Source `api`). */
  @Post()
  @HttpCode(202)
  @UseGuards(CleProjetGuard)
  async poster(@Req() requete: AuthenticatedRequest, @Body() corps: unknown) {
    const retour = parseBody(schemaRetourEntrant, corps, 'retour_invalide');
    return this.ingestion.receive(requete.projet.id, requete.source, retour);
  }
}

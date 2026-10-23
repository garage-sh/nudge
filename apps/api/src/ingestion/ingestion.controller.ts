import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { schemaRetourEntrant } from '@nudge/shared';
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
    const resultat = schemaRetourEntrant.safeParse(corps);
    if (!resultat.success) {
      throw new BadRequestException({
        erreur: 'retour_invalide',
        details: resultat.error.issues.map((issue) => ({
          chemin: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return this.ingestion.receive(requete.projet.id, 'api', resultat.data);
  }
}

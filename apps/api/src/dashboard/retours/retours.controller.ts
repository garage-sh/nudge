import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  schemaCorrectionVerdict,
  schemaFiltresRetours,
  schemaRevue,
  type ApiErrorBody,
  type EtatRetour,
  type PageRetours,
  type RetourDetailVu,
} from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { RetoursService } from './retours.service.js';
import { RevueService } from './revue.service.js';

/** Boîte de réception : les Retours de tous les Projets, et ce qu'un Membre en fait. */
@Controller('api/retours')
@UseGuards(SessionGuard)
export class RetoursController {
  constructor(
    private readonly retours: RetoursService,
    private readonly revue: RevueService,
  ) {}

  /** Filtres : `projet`, `type`, `gravite`, `etat`, `source`, `incertain` ; pagination : `curseur`, `limite`. */
  @Get()
  lister(@Query() requete: unknown): Promise<PageRetours> {
    return this.retours.list(parseBody(schemaFiltresRetours, requete));
  }

  @Get(':id')
  lire(@Param('id') id: string): Promise<RetourDetailVu> {
    return this.retours.read(id);
  }

  /**
   * Valider ou rejeter un Retour En revue, réhabiliter un Retour Écarté comme
   * Indésirable : 200 avec le Retour à jour, 409 `transition_refusee` (avec son état
   * courant) s'il n'est pas, ou plus, dans l'état de départ de l'action.
   */
  @Post(':id/revue')
  @HttpCode(200)
  async revoir(@Param('id') id: string, @Body() corps: unknown): Promise<RetourDetailVu> {
    const { action } = parseBody(schemaRevue, corps);
    const resultat = await this.revue.revoir(id, action);
    if (resultat.statut === 'introuvable') {
      throw new NotFoundException({ erreur: 'retour_introuvable' } satisfies ApiErrorBody);
    }
    if (resultat.statut === 'refuse') {
      throw new ConflictException({
        erreur: 'transition_refusee',
        etat: resultat.etat,
      } satisfies ApiErrorBody & { etat: EtatRetour });
    }
    return this.retours.read(id);
  }

  /** Corrige le Type retenu et / ou la Gravité ; 409 `retour_non_trie` sans Verdict. */
  @Patch(':id/verdict')
  corriger(@Param('id') id: string, @Body() corps: unknown): Promise<RetourDetailVu> {
    return this.retours.corriger(id, parseBody(schemaCorrectionVerdict, corps));
  }
}

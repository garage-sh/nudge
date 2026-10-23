import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { schemaFiltresRetours, type PageRetours, type RetourDetailVu } from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { RetoursService } from './retours.service.js';

/** Boîte de réception : les Retours de tous les Projets. */
@Controller('api/retours')
@UseGuards(SessionGuard)
export class RetoursController {
  constructor(private readonly retours: RetoursService) {}

  /** Filtres : `projet`, `type`, `gravite`, `etat`, `source`, `incertain` ; pagination : `curseur`, `limite`. */
  @Get()
  lister(@Query() requete: unknown): Promise<PageRetours> {
    return this.retours.list(parseBody(schemaFiltresRetours, requete));
  }

  @Get(':id')
  lire(@Param('id') id: string): Promise<RetourDetailVu> {
    return this.retours.read(id);
  }
}

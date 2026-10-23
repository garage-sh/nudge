import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  schemaModificationProjet,
  schemaNouveauProjet,
  type ProjetAvecCleSecrete,
  type ProjetVu,
} from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { ProjetsService } from './projets.service.js';

@Controller('api/projets')
@UseGuards(SessionGuard)
export class ProjetsController {
  constructor(private readonly projets: ProjetsService) {}

  @Get()
  lister(): Promise<ProjetVu[]> {
    return this.projets.list();
  }

  /** 201 avec la clé secrète, lisible cette seule fois. */
  @Post()
  creer(@Body() corps: unknown): Promise<ProjetAvecCleSecrete> {
    return this.projets.create(parseBody(schemaNouveauProjet, corps));
  }

  @Get(':id')
  lire(@Param('id') id: string): Promise<ProjetVu> {
    return this.projets.read(id);
  }

  /** Nom, Description du Projet, origines autorisées. */
  @Patch(':id')
  modifier(@Param('id') id: string, @Body() corps: unknown): Promise<ProjetVu> {
    return this.projets.update(id, parseBody(schemaModificationProjet, corps));
  }

  @Post(':id/cle-publique')
  regenererClePublique(@Param('id') id: string): Promise<ProjetVu> {
    return this.projets.regenerateClePublique(id);
  }

  @Post(':id/cle-secrete')
  regenererCleSecrete(@Param('id') id: string): Promise<ProjetAvecCleSecrete> {
    return this.projets.regenerateCleSecrete(id);
  }
}

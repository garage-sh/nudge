import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { schemaJugeInstance, type JugeInstanceVu } from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { JugeInstanceService } from './juge-instance.service.js';

/** Paramètres de l'Instance (D6). Les paramètres à venir (alerte, rétention) s'ajoutent ici. */
@Controller('api/instance')
@UseGuards(SessionGuard)
export class InstanceController {
  constructor(private readonly juge: JugeInstanceService) {}

  @Get('juge')
  lireJuge(): Promise<JugeInstanceVu> {
    return this.juge.lire();
  }

  /** Remplace le choix du Juge ; la clé API n'est jamais rendue. */
  @Put('juge')
  choisirJuge(@Body() corps: unknown): Promise<JugeInstanceVu> {
    return this.juge.choisir(parseBody(schemaJugeInstance, corps));
  }
}

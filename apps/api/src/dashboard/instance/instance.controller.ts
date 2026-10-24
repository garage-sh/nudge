import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { readRetentionInstance, writeRetentionInstance, type Db } from '@nudge/database';
import {
  schemaChoixJuge,
  schemaDestinationAlerte,
  schemaRetention,
  type RetentionVu,
  type DestinationAlerteAvecSecretsGeneres,
  type DestinationAlerteVu,
  type JugeInstanceVu,
  type ResultatTestDestination,
} from '@nudge/shared';
import { DB } from '../../infra/tokens.js';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { DestinationAlerteService } from './destination-alerte.service.js';
import { JugeInstanceService } from './juge-instance.service.js';

/** Paramètres de l'Instance (D6) : Juge, Destination d'alerte, durée de rétention. */
@Controller('api/instance')
@UseGuards(SessionGuard)
export class InstanceController {
  constructor(
    private readonly juge: JugeInstanceService,
    private readonly alerte: DestinationAlerteService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('juge')
  lireJuge(): Promise<JugeInstanceVu> {
    return this.juge.lire();
  }

  /** Remplace le choix du Juge ; la clé API n'est jamais rendue. */
  @Put('juge')
  choisirJuge(@Body() corps: unknown): Promise<JugeInstanceVu> {
    return this.juge.choisir(parseBody(schemaChoixJuge, corps));
  }

  /** `destination: null` : pas de Destination d'alerte. */
  @Get('alerte')
  async lireAlerte(): Promise<{ destination: DestinationAlerteVu | null }> {
    return { destination: await this.alerte.lire() };
  }

  /** Enregistre la Destination d'alerte ; les secrets générés sont rendus cette seule fois. */
  @Put('alerte')
  configurerAlerte(@Body() corps: unknown): Promise<DestinationAlerteAvecSecretsGeneres> {
    return this.alerte.configurer(parseBody(schemaDestinationAlerte, corps));
  }

  @Delete('alerte')
  @HttpCode(204)
  retirerAlerte(): Promise<void> {
    return this.alerte.retirer();
  }

  /** Envoie une alerte d'exemple ; 200 avec le résultat, livré ou en échec. */
  @Post('alerte/test')
  @HttpCode(200)
  testerAlerte(): Promise<ResultatTestDestination> {
    return this.alerte.tester();
  }

  /** `jours: null` : rétention illimitée (par défaut). */
  @Get('retention')
  async lireRetention(): Promise<RetentionVu> {
    return { jours: await readRetentionInstance(this.db) };
  }

  /** La purge planifiée du worker relit la durée à chaque passage. */
  @Put('retention')
  async changerRetention(@Body() corps: unknown): Promise<RetentionVu> {
    const { jours } = parseBody(schemaRetention, corps);
    await writeRetentionInstance(this.db, jours);
    return { jours };
  }
}

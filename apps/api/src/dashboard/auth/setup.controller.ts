import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { schemaNouveauMembre, type EtatSetup, type SessionVue } from '@nudge/shared';
import type { Response } from 'express';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { parseBody } from '../../validation.js';
import { MembresService } from './membres.service.js';
import { SessionsService } from './sessions.service.js';

/** Premier lancement : le premier Membre crée son compte, puis le setup se ferme. */
@Controller('api/setup')
export class SetupController {
  constructor(
    private readonly membres: MembresService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  async etat(): Promise<EtatSetup> {
    return { requis: await this.membres.setupRequired() };
  }

  /** 201 et session ouverte ; 409 `setup_termine` dès qu'un Membre existe. */
  @Post()
  @UseGuards(AuthThrottleGuard)
  async setup(
    @Body() corps: unknown,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<SessionVue> {
    const { email, motDePasse } = parseBody(schemaNouveauMembre, corps);
    const membre = await this.membres.setup(email, motDePasse);
    await this.sessions.start(reponse, membre);
    return { membre };
  }
}

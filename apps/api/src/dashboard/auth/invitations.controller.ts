import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import {
  schemaNouveauMembre,
  type InvitationCreee,
  type InvitationVue,
  type MembreVu,
  type SessionVue,
} from '@nudge/shared';
import type { Response } from 'express';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { parseBody } from '../../validation.js';
import { InvitationsService } from './invitations.service.js';
import { MembreCourant, SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

@Controller('api/invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionsService,
  ) {}

  /** Un Membre génère un lien d'invitation ; le jeton n'est lisible qu'ici. */
  @Post()
  @UseGuards(SessionGuard)
  creer(@MembreCourant() membre: MembreVu): Promise<InvitationCreee> {
    return this.invitations.create(membre);
  }

  /** Publique : la page d'invitation vérifie le lien avant d'afficher le formulaire. */
  @Get(':jeton')
  lire(@Param('jeton') jeton: string): Promise<InvitationVue> {
    return this.invitations.read(jeton);
  }

  /** Publique : la personne invitée crée son compte et repart connectée. */
  @Post(':jeton/acceptation')
  @UseGuards(AuthThrottleGuard)
  async accepter(
    @Param('jeton') jeton: string,
    @Body() corps: unknown,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<SessionVue> {
    const { email, motDePasse } = parseBody(schemaNouveauMembre, corps);
    const membre = await this.invitations.accept(jeton, email, motDePasse);
    await this.sessions.start(reponse, membre);
    return { membre };
  }
}

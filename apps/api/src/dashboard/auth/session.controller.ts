import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { schemaConnexion, type MembreVu, type SessionVue } from '@nudge/shared';
import type { Request, Response } from 'express';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { parseBody } from '../../validation.js';
import { MembresService } from './membres.service.js';
import { MembreCourant, SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

/** Connexion (POST), Membre connecté (GET), déconnexion (DELETE). */
@Controller('api/session')
export class SessionController {
  constructor(
    private readonly membres: MembresService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  courante(@MembreCourant() membre: MembreVu): SessionVue {
    return { membre };
  }

  /** 401 `identifiants_invalides` sans dire si c'est l'email ou le mot de passe. */
  @Post()
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  async connecter(
    @Body() corps: unknown,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<SessionVue> {
    const { email, motDePasse } = parseBody(schemaConnexion, corps);
    const membre = await this.membres.authenticate(email, motDePasse);
    if (!membre) throw new UnauthorizedException({ erreur: 'identifiants_invalides' });
    await this.sessions.start(reponse, membre);
    return { membre };
  }

  /** Révoque la session en base et efface le cookie ; idempotent. */
  @Delete()
  @HttpCode(204)
  async deconnecter(
    @Req() requete: Request,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<void> {
    await this.sessions.end(requete, reponse);
  }
}

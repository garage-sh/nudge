import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { schemaConnexion, type MembreVu, type SessionVue } from '@nudge/shared';
import type { Request, Response } from 'express';
import { SESSION_COOKIE_OPTIONS } from '../../infra/tokens.js';
import { parseBody } from '../validation.js';
import { MembresService } from './membres.service.js';
import {
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
  type SessionCookieOptions,
} from './session-cookie.js';
import { MembreCourant, SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

/** Connexion (POST), Membre connecté (GET), déconnexion (DELETE). */
@Controller('api/session')
export class SessionController {
  constructor(
    private readonly membres: MembresService,
    private readonly sessions: SessionsService,
    @Inject(SESSION_COOKIE_OPTIONS) private readonly cookie: SessionCookieOptions,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  courante(@MembreCourant() membre: MembreVu): SessionVue {
    return { membre };
  }

  /** 401 `identifiants_invalides` sans dire si c'est l'email ou le mot de passe. */
  @Post()
  @HttpCode(200)
  async connecter(
    @Body() corps: unknown,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<SessionVue> {
    const { email, motDePasse } = parseBody(schemaConnexion, corps);
    const membre = await this.membres.authenticate(email, motDePasse);
    if (!membre) throw new UnauthorizedException({ erreur: 'identifiants_invalides' });
    writeSessionCookie(reponse, await this.sessions.open(membre.id), this.cookie);
    return { membre };
  }

  /** Révoque la session en base et efface le cookie ; idempotent. */
  @Delete()
  @HttpCode(204)
  async deconnecter(
    @Req() requete: Request,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<void> {
    const jeton = readSessionCookie(requete);
    if (jeton) await this.sessions.close(jeton);
    clearSessionCookie(reponse, this.cookie);
  }
}

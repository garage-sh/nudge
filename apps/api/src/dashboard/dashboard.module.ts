import { Module, type DynamicModule } from '@nestjs/common';
import { SESSION_COOKIE_OPTIONS } from '../infra/tokens.js';
import { InvitationsController } from './auth/invitations.controller.js';
import { InvitationsService } from './auth/invitations.service.js';
import { MembresService } from './auth/membres.service.js';
import type { SessionCookieOptions } from './auth/session-cookie.js';
import { SessionController } from './auth/session.controller.js';
import { SessionGuard } from './auth/session.guard.js';
import { SessionsService } from './auth/sessions.service.js';
import { SetupController } from './auth/setup.controller.js';
import { ProjetsController } from './projets/projets.controller.js';
import { ProjetsService } from './projets/projets.service.js';

export interface DashboardOptions {
  readonly sessionCookie: SessionCookieOptions;
}

/**
 * API du dashboard, sous `/api/…`, authentifiée par session de Membre.
 * Un écran qui a besoin d'un endpoint ajoute ici son contrôleur, gardé par `SessionGuard`.
 */
@Module({})
export class DashboardModule {
  static forRoot(options: DashboardOptions): DynamicModule {
    return {
      module: DashboardModule,
      controllers: [SetupController, SessionController, InvitationsController, ProjetsController],
      providers: [
        { provide: SESSION_COOKIE_OPTIONS, useValue: options.sessionCookie },
        MembresService,
        SessionsService,
        InvitationsService,
        ProjetsService,
        SessionGuard,
      ],
    };
  }
}

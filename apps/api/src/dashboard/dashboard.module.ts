import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { SESSION_COOKIE_OPTIONS } from '../infra/tokens.js';
import { AuthThrottleGuard } from './auth/auth-throttle.guard.js';
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
import { RetoursController } from './retours/retours.controller.js';
import { RetoursService } from './retours/retours.service.js';
import { RevueService } from './retours/revue.service.js';
import { ClientHeaderMiddleware } from './client-header.middleware.js';

export interface DashboardOptions {
  readonly sessionCookie: SessionCookieOptions;
}

/** Contrôleurs de l'API du dashboard : tous passent par `ClientHeaderMiddleware`. */
const CONTROLLERS = [
  SetupController,
  SessionController,
  InvitationsController,
  ProjetsController,
  RetoursController,
];

/**
 * API du dashboard, sous `/api/…`, authentifiée par session de Membre.
 * Un écran qui a besoin d'un endpoint ajoute son contrôleur à `CONTROLLERS`, gardé
 * par `SessionGuard`, et ses services aux `providers`.
 */
@Module({})
export class DashboardModule implements NestModule {
  static forRoot(options: DashboardOptions): DynamicModule {
    return {
      module: DashboardModule,
      controllers: CONTROLLERS,
      providers: [
        { provide: SESSION_COOKIE_OPTIONS, useValue: options.sessionCookie },
        MembresService,
        SessionsService,
        InvitationsService,
        ProjetsService,
        RetoursService,
        RevueService,
        SessionGuard,
        AuthThrottleGuard,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClientHeaderMiddleware).forRoutes(...CONTROLLERS);
  }
}

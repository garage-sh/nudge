import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import type { DestinationAdapterResolver } from '@nudge/core';
import { DESTINATION_ADAPTER_RESOLVER, SESSION_COOKIE_OPTIONS } from '../infra/tokens.js';
import { AlertesController } from './alertes/alertes.controller.js';
import { AlertesService } from './alertes/alertes.service.js';
import { AuthThrottleGuard } from './auth/auth-throttle.guard.js';
import { InvitationsController } from './auth/invitations.controller.js';
import { InvitationsService } from './auth/invitations.service.js';
import { MembresService } from './auth/membres.service.js';
import type { SessionCookieOptions } from './auth/session-cookie.js';
import { SessionController } from './auth/session.controller.js';
import { SessionGuard } from './auth/session.guard.js';
import { SessionsService } from './auth/sessions.service.js';
import { SetupController } from './auth/setup.controller.js';
import { DestinationsController } from './destinations/destinations.controller.js';
import { DestinationsService } from './destinations/destinations.service.js';
import { DestinationAlerteService } from './instance/destination-alerte.service.js';
import { InstanceController } from './instance/instance.controller.js';
import { JugeInstanceService } from './instance/juge-instance.service.js';
import { RetentionInstanceService } from './instance/retention-instance.service.js';
import { ProjetsController } from './projets/projets.controller.js';
import { ProjetsService } from './projets/projets.service.js';
import { EnvoisController } from './retours/envois.controller.js';
import { EnvoisService } from './retours/envois.service.js';
import { RetoursController } from './retours/retours.controller.js';
import { RetoursService } from './retours/retours.service.js';
import { RevueService } from './retours/revue.service.js';
import { ClientHeaderMiddleware } from './client-header.middleware.js';

export interface DashboardOptions {
  readonly sessionCookie: SessionCookieOptions;
  /** Adaptateurs de Destination, pour l'envoi d'essai du bouton « tester ». */
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
}

/** Contrôleurs de l'API du dashboard : tous passent par `ClientHeaderMiddleware`. */
const CONTROLLERS = [
  SetupController,
  SessionController,
  InvitationsController,
  ProjetsController,
  RetoursController,
  EnvoisController,
  InstanceController,
  DestinationsController,
  AlertesController,
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
        { provide: DESTINATION_ADAPTER_RESOLVER, useValue: options.resolveDestinationAdapter },
        MembresService,
        SessionsService,
        InvitationsService,
        ProjetsService,
        RetoursService,
        RevueService,
        EnvoisService,
        JugeInstanceService,
        RetentionInstanceService,
        DestinationAlerteService,
        AlertesService,
        DestinationsService,
        SessionGuard,
        AuthThrottleGuard,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClientHeaderMiddleware).forRoutes(...CONTROLLERS);
  }
}

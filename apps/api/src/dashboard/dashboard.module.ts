import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import type { DestinationAdapterResolver } from '@nudge/core';
import { DESTINATION_ADAPTER_RESOLVER, SESSION_COOKIE_OPTIONS } from '../infra/tokens.js';
import { AlertsController } from './alerts/alerts.controller.js';
import { AlertsService } from './alerts/alerts.service.js';
import { AccountController } from './auth/account.controller.js';
import { AuthThrottleGuard } from './auth/auth-throttle.guard.js';
import { InvitationsController } from './auth/invitations.controller.js';
import { InvitationsService } from './auth/invitations.service.js';
import { MembersController } from './auth/members.controller.js';
import { MembersService } from './auth/members.service.js';
import type { SessionCookieOptions } from './auth/session-cookie.js';
import { SessionController } from './auth/session.controller.js';
import { SessionGuard } from './auth/session.guard.js';
import { SessionsService } from './auth/sessions.service.js';
import { SetupController } from './auth/setup.controller.js';
import {
  SETUP_TOKEN_CONFIG,
  SetupTokenService,
  type SetupTokenConfig,
} from './auth/setup-token.js';
import { DestinationsController } from './destinations/destinations.controller.js';
import { DestinationsService } from './destinations/destinations.service.js';
import { AlertDestinationService } from './instance/alert-destination.service.js';
import { InstanceController } from './instance/instance.controller.js';
import { InstanceJudgeService } from './instance/instance-judge.service.js';
import { InstanceRetentionService } from './instance/instance-retention.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectsService } from './projects/projects.service.js';
import { DeliveriesController } from './feedbacks/deliveries.controller.js';
import { DeliveriesService } from './feedbacks/deliveries.service.js';
import { FeedbacksController } from './feedbacks/feedbacks.controller.js';
import { FeedbacksService } from './feedbacks/feedbacks.service.js';
import { RedispatchService } from './feedbacks/redispatch.service.js';
import { ReviewService } from './feedbacks/review.service.js';
import { ClientHeaderMiddleware } from './client-header.middleware.js';

export interface DashboardOptions {
  readonly sessionCookie: SessionCookieOptions;
  /** The token that `POST /api/setup` requires. */
  readonly setupToken: SetupTokenConfig;
  /** Destination adapters, for the test delivery of the "test" button. */
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
}

/** Controllers of the dashboard API: all go through `ClientHeaderMiddleware`. */
const CONTROLLERS = [
  SetupController,
  SessionController,
  InvitationsController,
  MembersController,
  AccountController,
  ProjectsController,
  FeedbacksController,
  DeliveriesController,
  InstanceController,
  DestinationsController,
  AlertsController,
];

/**
 * Dashboard API, under `/api/…`, authenticated by Member session.
 * A screen that needs an endpoint adds its controller to `CONTROLLERS`, guarded by
 * `SessionGuard`, and its services to the `providers`.
 */
@Module({})
export class DashboardModule implements NestModule {
  static forRoot(options: DashboardOptions): DynamicModule {
    return {
      module: DashboardModule,
      controllers: CONTROLLERS,
      providers: [
        { provide: SESSION_COOKIE_OPTIONS, useValue: options.sessionCookie },
        { provide: SETUP_TOKEN_CONFIG, useValue: options.setupToken },
        { provide: DESTINATION_ADAPTER_RESOLVER, useValue: options.resolveDestinationAdapter },
        MembersService,
        SessionsService,
        SetupTokenService,
        InvitationsService,
        ProjectsService,
        FeedbacksService,
        ReviewService,
        RedispatchService,
        DeliveriesService,
        InstanceJudgeService,
        InstanceRetentionService,
        AlertDestinationService,
        AlertsService,
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

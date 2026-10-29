import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  incidentEnvironmentsSchema,
  incidentFiltersSchema,
  type ApiErrorBody,
  type IncidentDetailView,
  type IncidentPage,
  type IncidentRedispatchView,
  type IncidentState,
} from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { RedispatchService } from '../feedbacks/redispatch.service.js';
import { parseBody } from '../../validation.js';
import { incidentNotFound, IncidentsService } from './incidents.service.js';

/** A Project's Incidents, and the Redispatch of an Open one. */
@Controller('api/incidents')
@UseGuards(SessionGuard)
export class IncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly redispatches: RedispatchService,
  ) {}

  /** Filters: `project` (required), `state`, `level`, `environment`; pagination: `cursor`, `limit`. */
  @Get()
  list(@Query() query: unknown): Promise<IncidentPage> {
    return this.incidents.list(parseBody(incidentFiltersSchema, query));
  }

  /** Declared before `:id`, which would otherwise shadow it. */
  @Get('environments')
  environments(@Query() query: unknown): Promise<string[]> {
    return this.incidents.environments(parseBody(incidentEnvironmentsSchema, query).project);
  }

  @Get(':id')
  read(@Param('id') id: string): Promise<IncidentDetailView> {
    return this.incidents.read(id);
  }

  /**
   * Creates, at the Incident's current Level, the missing Deliveries to the Destinations
   * whose Incident Filter accepts it: 200 with the number of Deliveries created and the
   * updated Incident, 409 `incident_not_redispatchable` (with its state) if it is Closed.
   */
  @Post(':id/redispatch')
  @HttpCode(200)
  async redispatch(@Param('id') id: string): Promise<IncidentRedispatchView> {
    const result = await this.redispatches.redispatchIncident(id);
    if (result.status === 'not_found') throw incidentNotFound();
    if (result.status === 'refused') {
      throw new ConflictException({
        error: 'incident_not_redispatchable',
        state: result.state,
      } satisfies ApiErrorBody & { state: IncidentState });
    }
    return { deliveriesCreated: result.deliveries.length, incident: await this.incidents.read(id) };
  }
}

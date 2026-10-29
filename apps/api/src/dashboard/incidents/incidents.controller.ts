import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  incidentEnvironmentsSchema,
  incidentFiltersSchema,
  type IncidentDetailView,
  type IncidentPage,
} from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { IncidentsService } from './incidents.service.js';

/** A Project's Incidents, read-only for now. */
@Controller('api/incidents')
@UseGuards(SessionGuard)
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

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
}

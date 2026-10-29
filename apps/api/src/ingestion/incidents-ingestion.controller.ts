import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { incidentInputSchema, type ReceivedIncident } from '@nudge/shared';
import { parseBody } from '../validation.js';
import { IncidentsIngestionService } from './incidents-ingestion.service.js';
import { SecretKeyGuard, type SecretKeyRequest } from './secret-key.guard.js';

/** Occurrences reported by an application's server, with the Project's secret key only. */
@Controller('v1/incidents')
export class IncidentsIngestionController {
  constructor(private readonly incidents: IncidentsIngestionService) {}

  @Post()
  @HttpCode(202)
  @UseGuards(SecretKeyGuard)
  post(@Req() request: SecretKeyRequest, @Body() body: unknown): Promise<ReceivedIncident> {
    const occurrence = parseBody(incidentInputSchema, body, 'invalid_incident');
    return this.incidents.receive(request.project, occurrence);
  }
}

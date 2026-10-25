import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { feedbackInputSchema } from '@nudge/shared';
import { parseBody } from '../validation.js';
import { ProjectKeyGuard, type AuthenticatedRequest } from './project-key.guard.js';
import { IngestionService } from './ingestion.service.js';

@Controller('v1/feedbacks')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /** Both paths: public key (Source `widget`) or secret key (Source `api`). */
  @Post()
  @HttpCode(202)
  @UseGuards(ProjectKeyGuard)
  async post(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const feedback = parseBody(feedbackInputSchema, body, 'invalid_feedback');
    return this.ingestion.receive(request.project.id, request.source, feedback);
  }
}

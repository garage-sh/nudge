import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  captureFileName,
  verdictCorrectionSchema,
  feedbackFiltersSchema,
  reviewSchema,
  type ApiErrorBody,
  type FeedbackState,
  type FeedbackPage,
  type RedispatchView,
  type FeedbackDetailView,
} from '@nudge/shared';
import type { Response } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { feedbackNotFound, FeedbacksService } from './feedbacks.service.js';
import { RedispatchService } from './redispatch.service.js';
import { ReviewService } from './review.service.js';

/** Inbox: the Feedbacks of all Projects, and what a Member does with them. */
@Controller('api/feedbacks')
@UseGuards(SessionGuard)
export class FeedbacksController {
  constructor(
    private readonly feedbacks: FeedbacksService,
    private readonly reviews: ReviewService,
    private readonly redispatches: RedispatchService,
  ) {}

  /** Filters: `project`, `type`, `severity`, `state`, `source`, `uncertain`; pagination: `cursor`, `limit`. */
  @Get()
  list(@Query() query: unknown): Promise<FeedbackPage> {
    return this.feedbacks.list(parseBody(feedbackFiltersSchema, query));
  }

  @Get(':id')
  read(@Param('id') id: string): Promise<FeedbackDetailView> {
    return this.feedbacks.read(id);
  }

  /** Deletes the Feedback and its Capture: 204, 404 `feedback_not_found`, 503 `storage_unavailable`. */
  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string): Promise<void> {
    return this.feedbacks.delete(id);
  }

  /**
   * The Capture image, for the dashboard's `<img>` tag. It comes from the Author: the
   * browser must never interpret it as anything but the announced image (`nosniff`,
   * closed CSP if it is opened on its own).
   */
  @Get(':id/capture')
  async capture(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { contentType, content } = await this.feedbacks.readCapture(id);
    response.set({
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=3600',
    });
    return new StreamableFile(content, {
      type: contentType,
      length: content.length,
      disposition: `inline; filename="${captureFileName(id, contentType)}"`,
    });
  }

  /**
   * Approve or reject a Feedback In review, reinstate a Feedback Discarded as Junk: 200
   * with the updated Feedback, 409 `transition_refused` (with its current state) if it is
   * not, or no longer, in the action's starting state.
   */
  @Post(':id/review')
  @HttpCode(200)
  async review(@Param('id') id: string, @Body() body: unknown): Promise<FeedbackDetailView> {
    const { action } = parseBody(reviewSchema, body);
    const result = await this.reviews.review(id, action);
    if (result.status === 'not_found') throw feedbackNotFound();
    if (result.status === 'refused') {
      throw new ConflictException({
        error: 'transition_refused',
        state: result.state,
      } satisfies ApiErrorBody & { state: FeedbackState });
    }
    return this.feedbacks.read(id);
  }

  /**
   * Creates, per the current Verdict, the missing Deliveries to the Destinations whose
   * Filter accepts the Feedback (D22): 200 with the number of Deliveries created and the
   * updated Feedback, 409 `feedback_not_redispatchable` (with its state) if it is neither
   * Triaged nor Dispatched.
   */
  @Post(':id/redispatch')
  @HttpCode(200)
  async redispatch(@Param('id') id: string): Promise<RedispatchView> {
    const result = await this.redispatches.redispatch(id);
    if (result.status === 'not_found') throw feedbackNotFound();
    if (result.status === 'refused') {
      throw new ConflictException({
        error: 'feedback_not_redispatchable',
        state: result.state,
      } satisfies ApiErrorBody & { state: FeedbackState });
    }
    return { deliveriesCreated: result.deliveries.length, feedback: await this.feedbacks.read(id) };
  }

  /** Corrects the Resolved type and / or the Severity; 409 `feedback_not_triaged` without a Verdict. */
  @Patch(':id/verdict')
  correct(@Param('id') id: string, @Body() body: unknown): Promise<FeedbackDetailView> {
    return this.feedbacks.correct(id, parseBody(verdictCorrectionSchema, body));
  }
}

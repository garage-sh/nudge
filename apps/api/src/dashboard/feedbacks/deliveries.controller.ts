import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { DeliveryView } from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { DeliveriesService } from './deliveries.service.js';

@Controller('api/deliveries')
@UseGuards(SessionGuard)
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /**
   * Replays a failed Delivery, or a delivered Feedback Delivery: 202 with the Delivery
   * back to pending, 409 `delivery_not_replayable` (with its status) if it is pending,
   * held, or a delivered Incident Delivery.
   */
  @Post(':id/replay')
  @HttpCode(202)
  replay(@Param('id') id: string): Promise<DeliveryView> {
    return this.deliveries.replay(id);
  }
}

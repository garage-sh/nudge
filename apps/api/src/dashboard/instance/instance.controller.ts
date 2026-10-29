import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import {
  judgeChoiceSchema,
  alertDestinationSchema,
  retentionSchema,
  smtpSettingsSchema,
  type InstanceSmtpView,
  type MemberView,
  type RetentionView,
  type AlertDestinationWithGeneratedSecrets,
  type AlertDestinationView,
  type InstanceJudgeView,
  type DestinationTestResult,
} from '@nudge/shared';
import { CurrentMember, SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { AlertDestinationService } from './alert-destination.service.js';
import { InstanceJudgeService } from './instance-judge.service.js';
import { InstanceRetentionService } from './instance-retention.service.js';
import { InstanceSmtpService } from './instance-smtp.service.js';

/** Instance settings (D6): Judge, SMTP server, Alert destination, retention period. */
@Controller('api/instance')
@UseGuards(SessionGuard)
export class InstanceController {
  constructor(
    private readonly judge: InstanceJudgeService,
    private readonly alertDestination: AlertDestinationService,
    private readonly retention: InstanceRetentionService,
    private readonly smtp: InstanceSmtpService,
  ) {}

  /** `smtp: null`: no SMTP server, the email Destinations cannot send. */
  @Get('smtp')
  async readSmtp(): Promise<{ smtp: InstanceSmtpView | null }> {
    return { smtp: await this.smtp.read() };
  }

  /** Replaces the SMTP server; the password is never returned. */
  @Put('smtp')
  configureSmtp(@Body() body: unknown): Promise<InstanceSmtpView> {
    return this.smtp.configure(parseBody(smtpSettingsSchema, body));
  }

  @Delete('smtp')
  @HttpCode(204)
  removeSmtp(): Promise<void> {
    return this.smtp.remove();
  }

  /** Sends a test email to the signed-in Member; 200 with the result, delivered or failed. */
  @Post('smtp/test')
  @HttpCode(200)
  testSmtp(@CurrentMember() member: MemberView): Promise<DestinationTestResult> {
    return this.smtp.test(member.email);
  }

  @Get('judge')
  readJudge(): Promise<InstanceJudgeView> {
    return this.judge.read();
  }

  /** Replaces the Judge choice; the API key is never returned. */
  @Put('judge')
  chooseJudge(@Body() body: unknown): Promise<InstanceJudgeView> {
    return this.judge.choose(parseBody(judgeChoiceSchema, body));
  }

  /** `destination: null`: no Alert destination. */
  @Get('alert-destination')
  async readAlertDestination(): Promise<{ destination: AlertDestinationView | null }> {
    return { destination: await this.alertDestination.read() };
  }

  /** Stores the Alert destination; the generated secrets are returned this one time. */
  @Put('alert-destination')
  configureAlertDestination(@Body() body: unknown): Promise<AlertDestinationWithGeneratedSecrets> {
    return this.alertDestination.configure(parseBody(alertDestinationSchema, body));
  }

  @Delete('alert-destination')
  @HttpCode(204)
  removeAlertDestination(): Promise<void> {
    return this.alertDestination.remove();
  }

  /** Sends a sample alert; 200 with the result, delivered or failed. */
  @Post('alert-destination/test')
  @HttpCode(200)
  testAlertDestination(): Promise<DestinationTestResult> {
    return this.alertDestination.test();
  }

  /** `days: null`: unlimited retention (the default). */
  @Get('retention')
  readRetention(): Promise<RetentionView> {
    return this.retention.read();
  }

  /** The worker's scheduled purge reads the period again on every run. */
  @Put('retention')
  changeRetention(@Body() body: unknown): Promise<RetentionView> {
    return this.retention.change(parseBody(retentionSchema, body));
  }
}

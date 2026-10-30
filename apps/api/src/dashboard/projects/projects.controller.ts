import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  projectUpdateSchema,
  newProjectSchema,
  type ProjectActivityView,
  type ProjectWithSecretKey,
  type ProjectView,
} from '@nudge/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { parseBody } from '../../validation.js';
import { ProjectsService } from './projects.service.js';

@Controller('api/projects')
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(): Promise<ProjectView[]> {
    return this.projects.list();
  }

  /** Declared before `:id`, which would otherwise shadow it. */
  @Get('activity')
  activity(): Promise<ProjectActivityView[]> {
    return this.projects.activity();
  }

  /** 201 with the secret key, readable this one time. */
  @Post()
  create(@Body() body: unknown): Promise<ProjectWithSecretKey> {
    return this.projects.create(parseBody(newProjectSchema, body));
  }

  @Get(':id')
  read(@Param('id') id: string): Promise<ProjectView> {
    return this.projects.read(id);
  }

  /** Name, Project description, allowed origins, default Level. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown): Promise<ProjectView> {
    return this.projects.update(id, parseBody(projectUpdateSchema, body));
  }

  @Post(':id/public-key')
  regeneratePublicKey(@Param('id') id: string): Promise<ProjectView> {
    return this.projects.regeneratePublicKey(id);
  }

  @Post(':id/secret-key')
  regenerateSecretKey(@Param('id') id: string): Promise<ProjectWithSecretKey> {
    return this.projects.regenerateSecretKey(id);
  }
}

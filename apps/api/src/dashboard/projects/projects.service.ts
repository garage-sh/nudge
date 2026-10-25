import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { generateSecretKey, generatePublicKey, hashSecretKey } from '@nudge/core';
import {
  createProject,
  destinations,
  projects,
  feedbacks,
  type Db,
  type Project,
} from '@nudge/database';
import type { ProjectActivityView, ProjectWithSecretKey, ProjectView } from '@nudge/shared';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';

/** A Project as a Member sees it: never the hash of the secret key. */
export const toProjectView = (project: Project): ProjectView => ({
  id: project.id,
  name: project.name,
  description: project.description,
  publicKey: project.publicKey,
  allowedOrigins: project.allowedOrigins,
  createdAt: project.createdAt.toISOString(),
});

export interface ProjectFields {
  readonly name?: string;
  readonly description?: string | null;
  readonly allowedOrigins?: readonly string[];
}

/** Projects of the Instance: every Member sees them all (no roles in v1). */
@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(): Promise<ProjectView[]> {
    const rows = await this.db.select().from(projects).orderBy(asc(projects.createdAt));
    return rows.map(toProjectView);
  }

  /**
   * The activity of each Project, in one query: Feedbacks of the last seven days and In
   * review, Destinations and Suspended ones. Every Project is there, even without activity.
   */
  activity(): Promise<ProjectActivityView[]> {
    const total = (query: SQL) => sql<number>`(${query})::int`;
    return this.db
      .select({
        projectId: projects.id,
        feedbacksThisWeek: total(
          sql`select count(*) from ${feedbacks} where ${feedbacks.projectId} = ${projects.id} and ${feedbacks.createdAt} > now() - interval '7 days'`,
        ),
        feedbacksInReview: total(
          sql`select count(*) from ${feedbacks} where ${feedbacks.projectId} = ${projects.id} and ${feedbacks.state} = 'in_review'`,
        ),
        destinations: total(
          sql`select count(*) from ${destinations} where ${destinations.projectId} = ${projects.id}`,
        ),
        suspendedDestinations: total(
          sql`select count(*) from ${destinations} where ${destinations.projectId} = ${projects.id} and ${destinations.state} = 'suspended'`,
        ),
      })
      .from(projects)
      .orderBy(asc(projects.createdAt));
  }

  async read(id: string): Promise<ProjectView> {
    if (!isUuid(id)) throw projectNotFound();
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) throw projectNotFound();
    return toProjectView(project);
  }

  async create(fields: ProjectFields & { name: string }): Promise<ProjectWithSecretKey> {
    const { project, secretKey } = await createProject(this.db, fields);
    return { project: toProjectView(project), secretKey };
  }

  async update(id: string, fields: ProjectFields): Promise<ProjectView> {
    const { allowedOrigins, ...rest } = fields;
    return this.updateColumns(id, {
      ...rest,
      ...(allowedOrigins ? { allowedOrigins: [...allowedOrigins] } : {}),
    });
  }

  /** New public key: the old one no longer exists anywhere, so it is revoked. */
  regeneratePublicKey(id: string): Promise<ProjectView> {
    return this.updateColumns(id, { publicKey: generatePublicKey() });
  }

  /** New secret key, readable only once; the old hash is replaced. */
  async regenerateSecretKey(id: string): Promise<ProjectWithSecretKey> {
    const secretKey = generateSecretKey();
    const project = await this.updateColumns(id, { secretKeyHash: hashSecretKey(secretKey) });
    return { project, secretKey };
  }

  private async updateColumns(
    id: string,
    values: Partial<typeof projects.$inferInsert>,
  ): Promise<ProjectView> {
    if (!isUuid(id)) throw projectNotFound();
    // An empty PATCH still touches `updated_at`: drizzle refuses a SET without a column.
    const [project] = await this.db
      .update(projects)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!project) throw projectNotFound();
    return toProjectView(project);
  }
}

const projectNotFound = () => new NotFoundException({ error: 'project_not_found' });

import { hashSecretKey, generateProjectKeys } from '@nudge/core';
import type { Db } from './client.js';
import { projects } from './schema.js';

export type Project = typeof projects.$inferSelect;

/** Creates a Project and returns its keys; the secret key is readable only here. */
export async function createProject(
  db: Db,
  data: { name: string; description?: string | null; allowedOrigins?: readonly string[] },
): Promise<{ project: Project; publicKey: string; secretKey: string }> {
  const { publicKey, secretKey } = generateProjectKeys();
  const [project] = await db
    .insert(projects)
    .values({
      name: data.name,
      description: data.description ?? null,
      allowedOrigins: [...(data.allowedOrigins ?? [])],
      publicKey: publicKey,
      secretKeyHash: hashSecretKey(secretKey),
    })
    .returning();
  if (!project) throw new Error('Project not created');
  return { project, publicKey, secretKey };
}

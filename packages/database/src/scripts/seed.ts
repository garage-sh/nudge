import { connectDb } from '../client.js';
import { createProject } from '../projects.js';

/** Development seed: a Project and its keys (the secret key is shown only here). */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const { db, close } = connectDb(url);
  try {
    const { project, publicKey, secretKey } = await createProject(db, {
      name: 'Demo project',
    });
    console.log(`Project "${project.name}" (${project.id})`);
    console.log(`  public key: ${publicKey}`);
    console.log(`  secret key: ${secretKey}`);
  } finally {
    await close();
  }
}

void main();

import { migrer } from '../migrer.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  await migrer(url);
  console.log('Migrations appliquées.');
}

void main();

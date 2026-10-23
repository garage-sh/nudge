import { connectDb } from '../client.js';
import { createProjet } from '../projets.js';

/** Seed de développement : un Projet et ses clés (la clé secrète ne s'affiche qu'ici). */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  const { db, close } = connectDb(url);
  try {
    const { projet, clePublique, cleSecrete } = await createProjet(db, {
      nom: 'Projet de démonstration',
    });
    console.log(`Projet « ${projet.nom} » (${projet.id})`);
    console.log(`  clé publique : ${clePublique}`);
    console.log(`  clé secrète  : ${cleSecrete}`);
  } finally {
    await close();
  }
}

void main();

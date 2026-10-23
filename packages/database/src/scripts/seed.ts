import { connecterDb } from '../client.js';
import { creerProjet } from '../projets.js';

/** Seed de développement : un Projet et ses clés (la clé secrète ne s'affiche qu'ici). */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquante');
  const { db, fermer } = connecterDb(url);
  try {
    const { projet, clePublique, cleSecrete } = await creerProjet(db, {
      nom: 'Projet de démonstration',
    });
    console.log(`Projet « ${projet.nom} » (${projet.id})`);
    console.log(`  clé publique : ${clePublique}`);
    console.log(`  clé secrète  : ${cleSecrete}`);
  } finally {
    await fermer();
  }
}

void main();

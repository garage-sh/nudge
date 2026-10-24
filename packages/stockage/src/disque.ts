import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { verifierCle, type StockageCaptures } from './port.js';

/**
 * Captures sur un disque local (par défaut) : un fichier par clé sous `dossier`.
 * L'api et le worker doivent voir le même dossier (volume partagé en conteneurs).
 * L'écriture passe par un fichier temporaire renommé : une lecture concurrente ne
 * voit jamais une Capture à moitié écrite.
 */
export function stockageDisque(dossier: string): StockageCaptures {
  const racine = resolve(dossier);
  const chemin = (cle: string) => join(racine, verifierCle(cle));

  return {
    async enregistrer(cle, contenu) {
      const cible = chemin(cle);
      await mkdir(dirname(cible), { recursive: true });
      const temporaire = `${cible}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaire, contenu);
        await rename(temporaire, cible);
      } catch (erreur) {
        await rm(temporaire, { force: true });
        throw erreur;
      }
    },
    async lire(cle) {
      try {
        return new Uint8Array(await readFile(chemin(cle)));
      } catch (erreur) {
        if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw erreur;
      }
    },
    async supprimer(cle) {
      await rm(chemin(cle), { force: true });
    },
  };
}

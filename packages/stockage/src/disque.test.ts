import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stockageDisque } from './disque.js';
import type { StockageCaptures } from './port.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('Stockage des Captures sur disque local', () => {
  let dossier: string;
  let stockage: StockageCaptures;

  beforeEach(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'nudge-captures-'));
    stockage = stockageDisque(join(dossier, 'captures'));
  });
  afterEach(() => rm(dossier, { recursive: true, force: true }));

  it('relit ce qu’il a enregistré, octet pour octet', async () => {
    await stockage.enregistrer('retours/8f1c.png', PNG, 'image/png');

    expect(await stockage.lire('retours/8f1c.png')).toEqual(PNG);
  });

  it('rend null pour une Capture absente', async () => {
    expect(await stockage.lire('absente.png')).toBeNull();
  });

  it('supprime une Capture, et ne lève pas si elle n’existe plus', async () => {
    await stockage.enregistrer('a-supprimer.png', PNG, 'image/png');

    await stockage.supprimer('a-supprimer.png');
    await stockage.supprimer('a-supprimer.png');

    expect(await stockage.lire('a-supprimer.png')).toBeNull();
  });

  it('ne laisse aucun fichier temporaire derrière une écriture', async () => {
    await stockage.enregistrer('une.png', PNG, 'image/png');

    expect(await readdir(join(dossier, 'captures'))).toEqual(['une.png']);
  });

  it.each(['../evasion.png', '/absolue.png', 'a/../../b.png', 'nul\u0000.png', '', 'a//b.png'])(
    'refuse la clé « %s », qui sortirait du dossier',
    async (cle) => {
      await expect(stockage.enregistrer(cle, PNG, 'image/png')).rejects.toThrow(/clé/i);
      await expect(stockage.lire(cle)).rejects.toThrow(/clé/i);
    },
  );
});

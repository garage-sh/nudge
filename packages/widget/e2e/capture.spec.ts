import type { Page } from '@playwright/test';
import { expect, test, type ApiFactice } from './hote.js';

/**
 * La page de l'hôte : une zone sensible marquée `data-nudge-mask` (rouge), une autre
 * dans le Shadow DOM d'un composant de l'hôte, une zone témoin (verte) et une zone
 * rayée noir et blanc que l'Auteur floutera.
 */
const PAGE = {
  head: `<style>
  body { margin: 0; background: #ffffff; }
  .bloc { position: absolute; width: 200px; height: 100px; }
</style>`,
  body: `
<div class="bloc" data-nudge-mask style="left: 40px; top: 40px; background: rgb(255, 0, 0); color: #fff">
  IBAN FR76 3000 6000 0112 3456 7890 189
</div>
<div class="bloc" style="left: 300px; top: 40px; background: rgb(0, 128, 0)"></div>
<carte-client style="position: absolute; left: 560px; top: 40px; display: block"></carte-client>
<div id="rayures" style="position: absolute; left: 40px; top: 200px; width: 320px; height: 160px;
  background: repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px)"></div>
<script>
  customElements.define('carte-client', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<div data-nudge-mask style="width: 200px; height: 100px; background: rgb(255, 0, 0)">4970 1012 3456 7890</div>';
    }
  });
</script>`,
};

const MASQUE = { rouge: 0x1f, vert: 0x23, bleu: 0x28 };

interface Zone {
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
}

interface StatsZone {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Pixels franchement rouges : la zone sensible. */
  readonly rouges: number;
}

interface CaptureRecue {
  readonly contentType: string;
  readonly data: string;
}

const captureRecue = (api: ApiFactice, index = 0) =>
  (api.requetes[index]?.corps as { capture?: CaptureRecue }).capture;

/** Décode l'image reçue dans le navigateur et rend ses dimensions et les stats des zones. */
async function analyser(page: Page, capture: CaptureRecue, zones: readonly Zone[]) {
  return page.evaluate(
    async ({ capture, zones }) => {
      const image = new Image();
      image.src = `data:${capture.contentType};base64,${capture.data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const contexte = canvas.getContext('2d')!;
      contexte.drawImage(image, 0, 0);
      const stats = zones.map(({ x, y, largeur, hauteur }) => {
        const { data } = contexte.getImageData(x, y, largeur, hauteur);
        const min = [255, 255, 255];
        const max = [0, 0, 0];
        let rouges = 0;
        for (let i = 0; i < data.length; i += 4) {
          for (let canal = 0; canal < 3; canal += 1) {
            min[canal] = Math.min(min[canal]!, data[i + canal]!);
            max[canal] = Math.max(max[canal]!, data[i + canal]!);
          }
          if (data[i]! > 200 && data[i + 1]! < 80 && data[i + 2]! < 80) rouges += 1;
        }
        return { min, max, rouges };
      });
      return { largeur: image.naturalWidth, hauteur: image.naturalHeight, stats };
    },
    { capture, zones },
  ) as unknown as Promise<{ largeur: number; hauteur: number; stats: StatsZone[] }>;
}

const uniforme = ([r, v, b]: readonly [number, number, number]) => [r, v, b];

async function ouvrirEtJoindre(page: Page) {
  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await page.getByLabel('Votre message').fill('Le total ne se met pas à jour');
  await page.getByLabel('Joindre une capture de la page').check();
  await expect(page.getByRole('img', { name: 'Aperçu de la capture' })).toBeVisible();
}

test('sans l’accord de l’Auteur, aucune Capture n’est prise ni envoyée', async ({
  page,
  hote,
  api,
}) => {
  await hote.ouvrir(PAGE);

  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await expect(page.getByLabel('Joindre une capture de la page')).not.toBeChecked();
  await expect(page.getByRole('img', { name: 'Aperçu de la capture' })).toBeHidden();
  await page.getByLabel('Votre message').fill('Sans capture');
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toBeVisible();
  expect(api.requetes[0]?.corps).not.toHaveProperty('capture');
});

test('avec son accord, montre un aperçu puis joint la Capture de la page visible', async ({
  page,
  hote,
  api,
}) => {
  await hote.ouvrir(PAGE);

  await ouvrirEtJoindre(page);
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toBeVisible();
  const capture = captureRecue(api)!;
  expect(capture.contentType).toBe('image/png');
  const { largeur, hauteur, stats } = await analyser(page, capture, [
    { x: 300, y: 40, largeur: 200, hauteur: 100 },
    // Là où le panneau du Widget était ouvert : le Widget n'est pas sur sa propre Capture.
    { x: 1280 - 200, y: 720 - 160, largeur: 120, hauteur: 80 },
  ]);
  expect({ largeur, hauteur }).toEqual({ largeur: 1280, hauteur: 720 });
  expect(uniforme(stats[0]!.min)).toEqual([0, 128, 0]);
  expect(uniforme(stats[0]!.max)).toEqual([0, 128, 0]);
  expect(uniforme(stats[1]!.min)).toEqual([255, 255, 255]);
});

test('masque toujours les éléments data-nudge-mask, jusque dans un Shadow DOM', async ({
  page,
  hote,
  api,
}) => {
  await hote.ouvrir(PAGE);

  await ouvrirEtJoindre(page);
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toBeVisible();
  const { stats } = await analyser(page, captureRecue(api)!, [
    { x: 40, y: 40, largeur: 200, hauteur: 100 },
    { x: 560, y: 40, largeur: 200, hauteur: 100 },
    { x: 0, y: 0, largeur: 1280, hauteur: 720 },
  ]);
  const masque = [MASQUE.rouge, MASQUE.vert, MASQUE.bleu];
  expect(uniforme(stats[0]!.min)).toEqual(masque);
  expect(uniforme(stats[0]!.max)).toEqual(masque);
  expect(uniforme(stats[1]!.min)).toEqual(masque);
  expect(uniforme(stats[1]!.max)).toEqual(masque);
  // Pas un pixel des zones sensibles ne déborde du masque.
  expect(stats[2]!.rouges).toBe(0);
});

test('floute la zone que l’Auteur trace sur l’aperçu, et peut retirer ses flous', async ({
  page,
  hote,
  api,
}) => {
  await hote.ouvrir(PAGE);
  await ouvrirEtJoindre(page);
  const apercu = page.getByRole('img', { name: 'Aperçu de la capture' });
  const boite = (await apercu.boundingBox())!;
  const echelle = boite.width / 1280;
  const versApercu = (x: number, y: number) =>
    [boite.x + x * echelle, boite.y + y * echelle] as const;
  const rayures = { x: 40, y: 200, largeur: 320, hauteur: 160 };
  const coeur = { x: 72, y: 232, largeur: 256, hauteur: 96 };

  // Rayures nettes avant le floutage : du noir et du blanc purs.
  await page.mouse.move(...versApercu(rayures.x, rayures.y));
  await page.mouse.down();
  await page.mouse.move(...versApercu(rayures.x + 160, rayures.y + 80), { steps: 4 });
  await page.mouse.move(...versApercu(rayures.x + rayures.largeur, rayures.y + rayures.hauteur), {
    steps: 4,
  });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toBeVisible();
  const floutee = await analyser(page, captureRecue(api, 0)!, [
    coeur,
    { x: 300, y: 40, largeur: 200, hauteur: 100 },
  ]);
  // Le cœur de la zone tracée ne garde ni noir ni blanc : les rayures sont fondues en gris.
  for (const canal of [0, 1, 2]) {
    expect(floutee.stats[0]!.min[canal]).toBeGreaterThan(60);
    expect(floutee.stats[0]!.max[canal]).toBeLessThan(195);
  }
  // Le reste de la page est intact.
  expect(uniforme(floutee.stats[1]!.min)).toEqual([0, 128, 0]);

  // Second Retour : l'Auteur trace un flou, puis le retire.
  await page.getByRole('button', { name: 'Fermer' }).click();
  await ouvrirEtJoindre(page);
  await page.mouse.move(...versApercu(rayures.x, rayures.y));
  await page.mouse.down();
  await page.mouse.move(...versApercu(rayures.x + rayures.largeur, rayures.y + rayures.hauteur), {
    steps: 4,
  });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Retirer les flous' }).click();
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toBeVisible();
  const nette = await analyser(page, captureRecue(api, 1)!, [coeur]);
  expect(uniforme(nette.stats[0]!.min)).toEqual([0, 0, 0]);
  expect(uniforme(nette.stats[0]!.max)).toEqual([255, 255, 255]);
});

test('l’Auteur peut retirer la Capture avant l’envoi', async ({ page, hote, api }) => {
  await hote.ouvrir(PAGE);

  await ouvrirEtJoindre(page);
  await page.getByLabel('Joindre une capture de la page').uncheck();
  await expect(page.getByRole('img', { name: 'Aperçu de la capture' })).toBeHidden();
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toBeVisible();
  expect(api.requetes[0]?.corps).not.toHaveProperty('capture');
});

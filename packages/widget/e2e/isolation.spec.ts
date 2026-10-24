import type { Locator, Page } from '@playwright/test';
import { expect, test } from './hote.js';

const PROPRIETES = [
  'display',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'letter-spacing',
  'padding-top',
  'border-top-left-radius',
  'width',
] as const;

const style = (element: Locator) =>
  element.evaluate(
    (el, proprietes) =>
      Object.fromEntries(proprietes.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])),
    [...PROPRIETES],
  );

/** Le bouton du Widget, puis le champ et l'étiquette du message, formulaire ouvert. */
async function styleDuWidget(page: Page) {
  const lanceur = page.getByRole('button', { name: 'Laisser un retour' });
  const avant = await style(lanceur);
  await lanceur.click();
  return {
    lanceur: avant,
    message: await style(page.getByLabel('Votre message')),
    etiquette: await style(page.getByText('Votre message')),
  };
}

/** Une application aux styles agressifs : globaux, `!important`, taille de police racine. */
const CSS_HOSTILE = `<style>
  html { font-size: 40px; }
  * {
    color: red !important;
    font-family: 'Comic Sans MS', cursive !important;
    letter-spacing: 6px !important;
  }
  button { display: none !important; background: yellow !important; padding: 40px !important; }
  textarea, label { display: none !important; width: 10px !important; }
  .lanceur, .panneau, .envoyer { border-radius: 0 !important; background: black !important; }
</style>`;

test('le CSS de l’application ne déforme pas le Widget', async ({ page, hote }) => {
  await hote.ouvrir();
  const neutre = await styleDuWidget(page);

  await hote.ouvrir({ head: CSS_HOSTILE });

  await expect(page.getByRole('button', { name: 'Laisser un retour' })).toBeVisible();
  expect(await styleDuWidget(page)).toEqual(neutre);
});

/** Des éléments de l'application qui portent les mêmes balises et classes que le Widget. */
const PAGE_HOTE = `<h2 class="entete">Boutique</h2>
<form class="panneau"><label for="q">Recherche</label><input id="q" type="search"></form>
<button class="lanceur" type="button">Acheter</button>
<p class="erreur">Stock épuisé</p>`;

test('le CSS du Widget ne touche pas l’application', async ({ page, hote }) => {
  const styleDeLaPage = async () => ({
    titre: await style(page.getByRole('heading', { name: 'Boutique' })),
    formulaire: await style(page.locator('form.panneau')),
    etiquette: await style(page.getByText('Recherche')),
    champ: await style(page.getByRole('searchbox')),
    bouton: await style(page.getByRole('button', { name: 'Acheter' })),
    erreur: await style(page.getByText('Stock épuisé')),
  });
  await hote.ouvrir({ body: PAGE_HOTE, integration: '' });
  const sansWidget = await styleDeLaPage();

  await hote.ouvrir({ body: PAGE_HOTE });

  await expect(page.getByRole('button', { name: 'Laisser un retour' })).toBeVisible();
  expect(await styleDeLaPage()).toEqual(sansWidget);
});

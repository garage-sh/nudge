import { expect, test } from './hote.js';

test.beforeEach(async ({ page, hote }) => {
  await hote.ouvrir();
  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await page.getByLabel('Votre message').fill('La page se fige');
});

test('dit que le réseau a échoué, garde la saisie et permet de réessayer', async ({
  page,
  api,
}) => {
  api.couperLeReseau();

  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Envoi impossible : vérifiez votre connexion, puis réessayez.',
  );
  await expect(page.getByLabel('Votre message')).toHaveValue('La page se fige');

  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toHaveText('Merci ! Votre retour a bien été envoyé.');
  await expect(page.getByRole('alert')).toBeHidden();
  expect(api.requetes.map((requete) => requete.corps)).toMatchObject([
    { texte: 'La page se fige' },
    { texte: 'La page se fige' },
  ]);
});

test('dit quand réessayer après une limite de débit', async ({ page, api }) => {
  api.repondre(
    429,
    { erreur: 'trop_de_retours' },
    { 'retry-after': '120', 'access-control-expose-headers': 'Retry-After' },
  );

  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Trop de retours envoyés en peu de temps. Réessayez dans 2 minutes.',
  );
  await expect(page.getByLabel('Votre message')).toHaveValue('La page se fige');
});

test('dit que le formulaire est mal configuré si l’Instance refuse l’origine', async ({
  page,
  api,
}) => {
  api.repondre(403, { erreur: 'origine_refusee' });

  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Le formulaire de retour est mal configuré : votre retour n’a pas pu être envoyé.',
  );
});

test('dit que le service est indisponible sur une erreur de l’Instance', async ({ page, api }) => {
  api.repondre(503, { erreur: 'indisponible' });

  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Le service de retours est momentanément indisponible. Réessayez plus tard.',
  );
});

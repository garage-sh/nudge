import { API, CDN, CLE, ORIGINE_HOTE, expect, test } from './hote.js';

test('envoie un Retour en texte libre avec le contexte de la page', async ({ page, hote, api }) => {
  await hote.ouvrir({ chemin: '/panier?etape=2' });

  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await page.getByLabel('Votre message').fill('Le panier se vide tout seul');
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toHaveText('Merci ! Votre retour a bien été envoyé.');
  expect(api.requetes).toEqual([
    {
      autorisation: `Bearer ${CLE}`,
      origine: ORIGINE_HOTE,
      corps: {
        texte: 'Le panier se vide tout seul',
        contexte: {
          url: `${ORIGINE_HOTE}/panier?etape=2`,
          userAgent: expect.stringContaining('Mozilla/5.0'),
          viewport: { largeur: 1280, hauteur: 720 },
        },
      },
    },
  ]);
});

test('envoie le Type et l’email choisis par l’Auteur', async ({ page, hote, api }) => {
  await hote.ouvrir();

  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await page.getByLabel('Votre message').fill('Un mode sombre serait bienvenu');
  await page.getByLabel('Type (facultatif)').selectOption({ label: 'Suggestion' });
  await page.getByLabel('Email (facultatif)').fill('ada@exemple.test');
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toHaveText('Merci ! Votre retour a bien été envoyé.');
  expect(api.requetes[0]?.corps).toMatchObject({
    texte: 'Un mode sombre serait bienvenu',
    type: 'suggestion',
    auteur: { email: 'ada@exemple.test' },
  });
});

test('n’envoie rien tant que le message est vide', async ({ page, hote, api }) => {
  await hote.ouvrir();

  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await page.getByLabel('Votre message').fill('   ');
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByLabel('Votre message')).toHaveJSProperty(
    'validationMessage',
    'Écrivez votre message avant d’envoyer.',
  );
  expect(api.requetes).toEqual([]);
});

test('joint l’identité et les métadonnées passées par l’hôte', async ({ page, hote, api }) => {
  await hote.ouvrir({
    integration: `<script src="${CDN}/nudge-widget.js"></script>
<script>
  Nudge.monterWidget({
    cle: '${CLE}',
    api: '${API}',
    auteur: { id: 'u-42', email: 'ada@exemple.test', nom: 'Ada' },
    metadonnees: { version: '2.3.1', beta: true },
  });
</script>`,
  });

  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await page.getByLabel('Votre message').fill('Bonjour');
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toBeVisible();
  expect(api.requetes[0]?.corps).toMatchObject({
    auteur: { id: 'u-42', email: 'ada@exemple.test', nom: 'Ada' },
    contexte: { metadonnees: { version: '2.3.1', beta: true } },
  });
});

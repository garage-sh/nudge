import { API, CDN, CLE, expect, test } from './hote.js';

test('le build ESM (npm) monte le Widget et envoie un Retour', async ({ page, hote, api }) => {
  await hote.ouvrir({
    integration: `<script type="module">
  import { monterWidget } from '${CDN}/index.js';
  monterWidget({ cle: '${CLE}', api: '${API}', metadonnees: { build: 'esm' } });
</script>`,
  });

  await page.getByRole('button', { name: 'Laisser un retour' }).click();
  await page.getByLabel('Votre message').fill('Depuis le module');
  await page.getByRole('button', { name: 'Envoyer' }).click();

  await expect(page.getByRole('status')).toHaveText('Merci ! Votre retour a bien été envoyé.');
  expect(api.requetes[0]).toMatchObject({
    autorisation: `Bearer ${CLE}`,
    corps: { texte: 'Depuis le module', contexte: { metadonnees: { build: 'esm' } } },
  });
});

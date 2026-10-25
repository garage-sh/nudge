import { fr } from '../src/locales/fr.js';
import { API, CDN, PUBLIC_KEY, expect, test } from './host.js';

test('speaks French on a French page, rate limit message included', async ({ page, host, api }) => {
  await host.open({ lang: 'fr' });
  api.respond(
    429,
    { error: 'too_many_feedbacks' },
    { 'retry-after': '60', 'access-control-expose-headers': 'Retry-After' },
  );

  await page.getByRole('button', { name: fr.launcher }).click();
  await page.getByLabel(fr.text).fill('Hello');
  await page.getByLabel(fr.type).selectOption({ label: fr.feedbackTypes.opinion });
  await page.getByRole('button', { name: fr.submit, exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText(fr.rateLimited(1));
  expect(api.requests[0]?.body).toMatchObject({ type: 'opinion' });
});

test.describe('in a French browser', () => {
  test.use({ locale: 'fr-FR' });

  test('speaks French when the page declares no language', async ({ page, host }) => {
    await host.open({ lang: null });

    await expect(page.getByRole('button', { name: fr.launcher })).toBeVisible();
  });

  test('a page in English wins over the browser', async ({ page, host }) => {
    await host.open();

    await expect(page.getByRole('button', { name: 'Send feedback' })).toBeVisible();
  });
});

test('the locale the host requests wins over the page language', async ({ page, host }) => {
  await host.open({
    integration: `<script src="${CDN}/nudge-widget.js" data-public-key="${PUBLIC_KEY}" data-api="${API}" data-locale="fr"></script>`,
  });
  await expect(page.getByRole('button', { name: fr.launcher })).toBeVisible();

  await host.open({
    lang: 'fr',
    integration: `<script src="${CDN}/nudge-widget.js"></script>
<script>Nudge.mountWidget({ publicKey: '${PUBLIC_KEY}', api: '${API}', locale: 'en' });</script>`,
  });
  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeVisible();
});

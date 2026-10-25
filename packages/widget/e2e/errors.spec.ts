import type { Page } from '@playwright/test';
import { expect, test } from './host.js';

test.beforeEach(async ({ page, host }) => {
  await host.open();
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('The page freezes');
});

const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true }).click();

test('says the network failed, keeps the input and allows a retry', async ({ page, api }) => {
  api.cutNetwork();

  await send(page);

  await expect(page.getByRole('alert')).toHaveText(
    'Could not send: check your connection, then try again.',
  );
  await expect(page.getByLabel('Your message')).toHaveValue('The page freezes');

  await send(page);

  await expect(page.getByRole('status')).toHaveText('Thank you! Your feedback has been sent.');
  await expect(page.getByRole('alert')).toBeHidden();
  expect(api.requests.map((request) => request.body)).toMatchObject([
    { text: 'The page freezes' },
    { text: 'The page freezes' },
  ]);
});

test('says when to retry after a rate limit', async ({ page, api }) => {
  api.respond(
    429,
    { error: 'too_many_feedbacks' },
    { 'retry-after': '120', 'access-control-expose-headers': 'Retry-After' },
  );

  await send(page);

  await expect(page.getByRole('alert')).toHaveText(
    'Too much feedback sent in a short time. Try again in 2 minutes.',
  );
  await expect(page.getByLabel('Your message')).toHaveValue('The page freezes');
});

test('says the form is misconfigured if the Instance refuses the origin', async ({ page, api }) => {
  api.respond(403, { error: 'origin_refused' });

  await send(page);

  await expect(page.getByRole('alert')).toHaveText(
    'The feedback form is misconfigured: your feedback could not be sent.',
  );
});

test('says the service is unavailable on an Instance error', async ({ page, api }) => {
  api.respond(503, { error: 'unavailable' });

  await send(page);

  await expect(page.getByRole('alert')).toHaveText(
    'The feedback service is temporarily unavailable. Try again later.',
  );
});

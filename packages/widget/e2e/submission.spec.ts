import { API, CDN, HOST_ORIGIN, PUBLIC_KEY, expect, test } from './host.js';

test('sends free-text Feedback with the page context', async ({ page, host, api }) => {
  await host.open({ path: '/cart?step=2' });

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('The cart empties itself');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('Thank you! Your feedback has been sent.');
  expect(api.requests).toEqual([
    {
      authorization: `Bearer ${PUBLIC_KEY}`,
      origin: HOST_ORIGIN,
      body: {
        text: 'The cart empties itself',
        context: {
          url: `${HOST_ORIGIN}/cart?step=2`,
          userAgent: expect.stringContaining('Mozilla/5.0'),
          viewport: { width: 1280, height: 720 },
        },
      },
    },
  ]);
});

test('sends the Type and email the Author chose', async ({ page, host, api }) => {
  await host.open();

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('A dark mode would be welcome');
  await page.getByLabel('Type (optional)').selectOption({ label: 'Suggestion' });
  await page.getByLabel('Email (optional)').fill('ada@example.test');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('Thank you! Your feedback has been sent.');
  expect(api.requests[0]?.body).toMatchObject({
    text: 'A dark mode would be welcome',
    type: 'suggestion',
    author: { email: 'ada@example.test' },
  });
});

test('sends nothing while the message is empty', async ({ page, host, api }) => {
  await host.open();

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('   ');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByLabel('Your message')).toHaveJSProperty(
    'validationMessage',
    'Write your message before sending.',
  );
  expect(api.requests).toEqual([]);
});

test('attaches the identity and metadata passed by the host', async ({ page, host, api }) => {
  await host.open({
    integration: `<script src="${CDN}/nudge-widget.js"></script>
<script>
  Nudge.mountWidget({
    publicKey: '${PUBLIC_KEY}',
    api: '${API}',
    author: { id: 'u-42', email: 'ada@example.test', name: 'Ada' },
    metadata: { version: '2.3.1', beta: true },
  });
</script>`,
  });

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toBeVisible();
  expect(api.requests[0]?.body).toMatchObject({
    author: { id: 'u-42', email: 'ada@example.test', name: 'Ada' },
    context: { metadata: { version: '2.3.1', beta: true } },
  });
});

import { API, CDN, PUBLIC_KEY, expect, test } from './host.js';

test('the ESM build (npm) mounts the Widget and sends Feedback', async ({ page, host, api }) => {
  await host.open({
    integration: `<script type="module">
  import { mountWidget } from '${CDN}/index.js';
  mountWidget({ publicKey: '${PUBLIC_KEY}', api: '${API}', metadata: { build: 'esm' } });
</script>`,
  });

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('From the module');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('Thank you! Your feedback has been sent.');
  expect(api.requests[0]).toMatchObject({
    authorization: `Bearer ${PUBLIC_KEY}`,
    body: { text: 'From the module', context: { metadata: { build: 'esm' } } },
  });
});

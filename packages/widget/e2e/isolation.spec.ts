import type { Locator, Page } from '@playwright/test';
import { expect, test } from './host.js';

const PROPERTIES = [
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
    (el, properties) =>
      Object.fromEntries(properties.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])),
    [...PROPERTIES],
  );

/** The Widget's button, then the message field and its label, with the form open. */
async function widgetStyle(page: Page) {
  const launcher = page.getByRole('button', { name: 'Send feedback' });
  const before = await style(launcher);
  await launcher.click();
  return {
    launcher: before,
    message: await style(page.getByLabel('Your message')),
    label: await style(page.getByText('Your message')),
  };
}

/** An app with aggressive styles: global, `!important`, root font size. */
const HOSTILE_CSS = `<style>
  html { font-size: 40px; }
  * {
    color: red !important;
    font-family: 'Comic Sans MS', cursive !important;
    letter-spacing: 6px !important;
  }
  button { display: none !important; background: yellow !important; padding: 40px !important; }
  textarea, label { display: none !important; width: 10px !important; }
  .launcher, .panel, .submit { border-radius: 0 !important; background: black !important; }
</style>`;

test("the app's CSS does not distort the Widget", async ({ page, host }) => {
  await host.open();
  const neutral = await widgetStyle(page);

  await host.open({ head: HOSTILE_CSS });

  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeVisible();
  expect(await widgetStyle(page)).toEqual(neutral);
});

/** App elements that use the same tags and classes as the Widget. */
const HOST_PAGE = `<h2 class="header">Shop</h2>
<form class="panel"><label for="q">Search</label><input id="q" type="search"></form>
<button class="launcher" type="button">Buy</button>
<p class="error">Out of stock</p>`;

test("the Widget's CSS does not touch the app", async ({ page, host }) => {
  const pageStyle = async () => ({
    title: await style(page.getByRole('heading', { name: 'Shop' })),
    form: await style(page.locator('form.panel')),
    label: await style(page.getByText('Search')),
    field: await style(page.getByRole('searchbox')),
    button: await style(page.getByRole('button', { name: 'Buy' })),
    error: await style(page.getByText('Out of stock')),
  });
  await host.open({ body: HOST_PAGE, integration: '' });
  const withoutWidget = await pageStyle();

  await host.open({ body: HOST_PAGE });

  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeVisible();
  expect(await pageStyle()).toEqual(withoutWidget);
});

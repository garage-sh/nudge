import type { Page } from '@playwright/test';
import { expect, test, type FakeApi } from './host.js';

const OTHER_ORIGIN = 'https://other.example';

/**
 * The host page: a sensitive area marked `data-nudge-mask` (red), another one inside
 * the Shadow DOM of a host component, a control area (green) and a black-and-white
 * striped area the Author will blur.
 */
const PAGE = {
  head: `<style>
  body { margin: 0; background: #ffffff; }
  .block { position: absolute; width: 200px; height: 100px; }
</style>`,
  body: `
<div class="block" data-nudge-mask style="left: 40px; top: 40px; background: rgb(255, 0, 0); color: #fff">
  IBAN FR76 3000 6000 0112 3456 7890 189
</div>
<div class="block" style="left: 300px; top: 40px; background: rgb(0, 128, 0)"></div>
<customer-card style="position: absolute; left: 560px; top: 40px; display: block"></customer-card>
<div id="stripes" style="position: absolute; left: 40px; top: 200px; width: 320px; height: 160px;
  background: repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px)"></div>
<script>
  customElements.define('customer-card', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<div data-nudge-mask style="width: 200px; height: 100px; background: rgb(255, 0, 0)">4970 1012 3456 7890</div>';
    }
  });
</script>`,
};

const MASK = { red: 0x1f, green: 0x23, blue: 0x28 };

interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface AreaStats {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Clearly red pixels: the sensitive area. */
  readonly reds: number;
}

interface ReceivedCapture {
  readonly contentType: string;
  readonly data: string;
}

const receivedCapture = (api: FakeApi, index = 0) =>
  (api.requests[index]?.body as { capture?: ReceivedCapture }).capture;

/** Decodes the received image in the browser and returns its size and the areas' stats. */
async function analyze(page: Page, capture: ReceivedCapture, areas: readonly Area[]) {
  return page.evaluate(
    async ({ capture, areas }) => {
      const image = new Image();
      image.src = `data:${capture.contentType};base64,${capture.data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const stats = areas.map(({ x, y, width, height }) => {
        const { data } = context.getImageData(x, y, width, height);
        const min = [255, 255, 255];
        const max = [0, 0, 0];
        let reds = 0;
        for (let i = 0; i < data.length; i += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            min[channel] = Math.min(min[channel]!, data[i + channel]!);
            max[channel] = Math.max(max[channel]!, data[i + channel]!);
          }
          if (data[i]! > 200 && data[i + 1]! < 80 && data[i + 2]! < 80) reds += 1;
        }
        return { min, max, reds };
      });
      return { width: image.naturalWidth, height: image.naturalHeight, stats };
    },
    { capture, areas },
  ) as unknown as Promise<{ width: number; height: number; stats: AreaStats[] }>;
}

const rgb = ([r, g, b]: readonly [number, number, number]) => [r, g, b];

const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true }).click();

async function openAndAttach(page: Page) {
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('The total does not update');
  await page.getByLabel('Attach a screenshot of the page').check();
  await expect(page.getByRole('img', { name: 'Screenshot preview' })).toBeVisible();
}

test("without the Author's consent, no Capture is taken or sent", async ({ page, host, api }) => {
  await host.open(PAGE);

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByLabel('Attach a screenshot of the page')).not.toBeChecked();
  await expect(page.getByRole('img', { name: 'Screenshot preview' })).toBeHidden();
  await page.getByLabel('Your message').fill('No screenshot');
  await send(page);

  await expect(page.getByRole('status')).toBeVisible();
  expect(api.requests[0]?.body).not.toHaveProperty('capture');
});

test('with consent, shows a preview then attaches the Capture of the visible page', async ({
  page,
  host,
  api,
}) => {
  await host.open(PAGE);

  await openAndAttach(page);
  await send(page);

  await expect(page.getByRole('status')).toBeVisible();
  const capture = receivedCapture(api)!;
  expect(capture.contentType).toBe('image/png');
  const { width, height, stats } = await analyze(page, capture, [
    { x: 300, y: 40, width: 200, height: 100 },
    // Where the Widget's panel was open: the Widget is not on its own Capture.
    { x: 1280 - 200, y: 720 - 160, width: 120, height: 80 },
  ]);
  expect({ width, height }).toEqual({ width: 1280, height: 720 });
  expect(rgb(stats[0]!.min)).toEqual([0, 128, 0]);
  expect(rgb(stats[0]!.max)).toEqual([0, 128, 0]);
  expect(rgb(stats[1]!.min)).toEqual([255, 255, 255]);
});

test('always masks data-nudge-mask elements, even inside a Shadow DOM', async ({
  page,
  host,
  api,
}) => {
  await host.open(PAGE);

  await openAndAttach(page);
  await send(page);

  await expect(page.getByRole('status')).toBeVisible();
  const { stats } = await analyze(page, receivedCapture(api)!, [
    { x: 40, y: 40, width: 200, height: 100 },
    { x: 560, y: 40, width: 200, height: 100 },
    { x: 0, y: 0, width: 1280, height: 720 },
  ]);
  const mask = [MASK.red, MASK.green, MASK.blue];
  expect(rgb(stats[0]!.min)).toEqual(mask);
  expect(rgb(stats[0]!.max)).toEqual(mask);
  expect(rgb(stats[1]!.min)).toEqual(mask);
  expect(rgb(stats[1]!.max)).toEqual(mask);
  // Not a single pixel of the sensitive areas spills past the mask.
  expect(stats[2]!.reds).toBe(0);
});

/**
 * A host page with framed content: a same-origin frame (`srcdoc`, with a border and a
 * padding) holding a masked element (red) next to plain content (green), and a frame
 * from another site whose content the Widget cannot inspect (red).
 */
const FRAMED_PAGE = {
  head: `<style>
  body { margin: 0; background: #ffffff; }
  iframe { position: absolute; width: 400px; height: 200px; border: 0; }
</style>`,
  body: `
<iframe id="same-origin" style="left: 40px; top: 40px; border: 8px solid rgb(0, 0, 255); padding: 12px" srcdoc="<body style='margin: 0; background: #fff'>
  <p data-nudge-mask style='position: absolute; left: 20px; top: 20px; width: 200px; height: 100px; margin: 0;
    background: rgb(255, 0, 0); color: rgb(255, 0, 0); font-size: 40px'>SECRET-1234</p>
  <div style='position: absolute; left: 240px; top: 20px; width: 100px; height: 100px; background: rgb(0, 128, 0)'></div>
</body>"></iframe>
<iframe id="cross-origin" style="left: 500px; top: 40px" src="${OTHER_ORIGIN}/embed"></iframe>`,
};

test('masks data-nudge-mask elements inside a same-origin frame, and covers frames it cannot inspect', async ({
  page,
  host,
  api,
}) => {
  await page.route(`${OTHER_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<body style="margin: 0; background: rgb(255, 0, 0)">Account 4970 1012</body>',
    }),
  );
  await host.open(FRAMED_PAGE);
  await expect(page.frameLocator('#same-origin').getByText('SECRET-1234')).toBeAttached();
  await expect(page.frameLocator('#cross-origin').getByText('Account 4970 1012')).toBeAttached();

  await openAndAttach(page);
  await send(page);

  await expect(page.getByRole('status')).toBeVisible();
  const { stats } = await analyze(page, receivedCapture(api)!, [
    // The masked element, in the frame whose content starts at (60, 60) (border, padding).
    { x: 80, y: 80, width: 200, height: 100 },
    // The frame's unmasked content stays in the Capture. The render loses the frame's
    // padding, so only the core of the green block is checked.
    { x: 310, y: 90, width: 60, height: 60 },
    // The frame from another site.
    { x: 500, y: 40, width: 400, height: 200 },
    { x: 0, y: 0, width: 1280, height: 720 },
  ]);
  const mask = [MASK.red, MASK.green, MASK.blue];
  expect(rgb(stats[0]!.min)).toEqual(mask);
  expect(rgb(stats[0]!.max)).toEqual(mask);
  expect(rgb(stats[1]!.min)).toEqual([0, 128, 0]);
  expect(rgb(stats[1]!.max)).toEqual([0, 128, 0]);
  expect(rgb(stats[2]!.min)).toEqual(mask);
  expect(rgb(stats[2]!.max)).toEqual(mask);
  expect(stats[3]!.reds).toBe(0);
});

test('blurs the area the Author draws on the preview, and can remove the blurs', async ({
  page,
  host,
  api,
}) => {
  await host.open(PAGE);
  await openAndAttach(page);
  const preview = page.getByRole('img', { name: 'Screenshot preview' });
  const box = (await preview.boundingBox())!;
  const scale = box.width / 1280;
  const toPreview = (x: number, y: number) => [box.x + x * scale, box.y + y * scale] as const;
  const stripes = { x: 40, y: 200, width: 320, height: 160 };
  const core = { x: 72, y: 232, width: 256, height: 96 };

  // Sharp stripes before blurring: pure black and white.
  await page.mouse.move(...toPreview(stripes.x, stripes.y));
  await page.mouse.down();
  await page.mouse.move(...toPreview(stripes.x + 160, stripes.y + 80), { steps: 4 });
  await page.mouse.move(...toPreview(stripes.x + stripes.width, stripes.y + stripes.height), {
    steps: 4,
  });
  await page.mouse.up();
  await send(page);

  await expect(page.getByRole('status')).toBeVisible();
  const blurred = await analyze(page, receivedCapture(api, 0)!, [
    core,
    { x: 300, y: 40, width: 200, height: 100 },
  ]);
  // The core of the drawn area keeps neither black nor white: the stripes melt into grey.
  for (const channel of [0, 1, 2]) {
    expect(blurred.stats[0]!.min[channel]).toBeGreaterThan(60);
    expect(blurred.stats[0]!.max[channel]).toBeLessThan(195);
  }
  // The rest of the page is intact.
  expect(rgb(blurred.stats[1]!.min)).toEqual([0, 128, 0]);

  // Second Feedback: the Author draws a blur, then removes it.
  await page.getByRole('button', { name: 'Close' }).click();
  await openAndAttach(page);
  await page.mouse.move(...toPreview(stripes.x, stripes.y));
  await page.mouse.down();
  await page.mouse.move(...toPreview(stripes.x + stripes.width, stripes.y + stripes.height), {
    steps: 4,
  });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Remove blurs' }).click();
  await send(page);

  await expect(page.getByRole('status')).toBeVisible();
  const sharp = await analyze(page, receivedCapture(api, 1)!, [core]);
  expect(rgb(sharp.stats[0]!.min)).toEqual([0, 0, 0]);
  expect(rgb(sharp.stats[0]!.max)).toEqual([255, 255, 255]);
});

test('the Author can remove the Capture before sending', async ({ page, host, api }) => {
  await host.open(PAGE);

  await openAndAttach(page);
  await page.getByLabel('Attach a screenshot of the page').uncheck();
  await expect(page.getByRole('img', { name: 'Screenshot preview' })).toBeHidden();
  await send(page);

  await expect(page.getByRole('status')).toBeVisible();
  expect(api.requests[0]?.body).not.toHaveProperty('capture');
});

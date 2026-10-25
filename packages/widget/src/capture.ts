import { toCanvas } from 'html-to-image';
import { CAPTURE_MAX_BYTES, type CaptureType } from './domain.js';

/** Attribute by which the host marks an element always masked in Captures. */
export const MASK_ATTRIBUTE = 'data-nudge-mask';

/** Opaque color that covers masked elements. */
export const MASK_COLOR = '#1f2328';

/** Side of the blur blocks, in Capture pixels. */
const BLUR_BLOCK = 16;

/** An area of the Capture, in Capture pixels. */
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The page's masked elements, open Shadow DOMs included. */
function maskedElements(root: Document | ShadowRoot = document): Element[] {
  const found = [...root.querySelectorAll(`[${MASK_ATTRIBUTE}]`)];
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) found.push(...maskedElements(element.shadowRoot));
  }
  return found;
}

/** A node's parent, crossing a Shadow DOM boundary. */
const parentOf = (node: Node): Node | null =>
  node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;

/** Elements whose content does not go through child nodes (value, media…). */
const REPLACED = new Set([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'IMG',
  'VIDEO',
  'CANVAS',
  'IFRAME',
  'SVG',
]);

/**
 * Captures the visible part of the page, in the browser, without the `excluded` Widget.
 * `data-nudge-mask` elements never leave it in the clear: their content is not copied
 * into the render, and their box is covered with an opaque fill.
 */
export async function capturePage(excluded: Element): Promise<HTMLCanvasElement> {
  const masked = maskedElements();
  const maskedSet = new Set<Node>(masked);
  // Boxes measured before the render, in the window's frame (= the Capture's).
  const boxes = masked.map((element) => element.getBoundingClientRect());
  const insideMask = (node: Node): boolean => {
    for (let parent = parentOf(node); parent; parent = parentOf(parent)) {
      if (maskedSet.has(parent)) return true;
    }
    return false;
  };
  const width = window.innerWidth;
  const height = window.innerHeight;
  const root = document.documentElement;
  const background = getComputedStyle(document.body).backgroundColor;

  const canvas = await toCanvas(root, {
    width,
    height,
    pixelRatio: 1,
    backgroundColor:
      background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent'
        ? background
        : '#ffffff',
    // The scrolled window: the Capture shows what the Author sees.
    style: {
      transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
      transformOrigin: '0 0',
    },
    filter: (node: Node) =>
      node !== excluded &&
      !insideMask(node) &&
      !(maskedSet.has(node) && REPLACED.has((node as Element).tagName?.toUpperCase())),
    // An unreadable image from another site: a transparent pixel rather than a failure.
    imagePlaceholder:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  });

  const context = canvas.getContext('2d')!;
  context.fillStyle = MASK_COLOR;
  for (const box of boxes) {
    context.fillRect(
      Math.floor(box.left),
      Math.floor(box.top),
      Math.ceil(box.right) - Math.floor(box.left),
      Math.ceil(box.bottom) - Math.floor(box.top),
    );
  }
  return canvas;
}

/**
 * Blurs an area of the Capture into blocks of average color: detail (text, faces)
 * does not survive it, unlike a light Gaussian blur.
 */
export function blurArea(canvas: HTMLCanvasElement, area: Rectangle): void {
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const width = Math.min(canvas.width, Math.ceil(area.x + area.width)) - x;
  const height = Math.min(canvas.height, Math.ceil(area.y + area.height)) - y;
  if (width <= 0 || height <= 0) return;
  const context = canvas.getContext('2d')!;
  const image = context.getImageData(x, y, width, height);
  const { data } = image;
  for (let blockY = 0; blockY < height; blockY += BLUR_BLOCK) {
    for (let blockX = 0; blockX < width; blockX += BLUR_BLOCK) {
      const endX = Math.min(blockX + BLUR_BLOCK, width);
      const endY = Math.min(blockY + BLUR_BLOCK, height);
      const sum = [0, 0, 0, 0];
      for (let py = blockY; py < endY; py += 1) {
        for (let px = blockX; px < endX; px += 1) {
          const i = (py * width + px) * 4;
          for (let channel = 0; channel < 4; channel += 1) sum[channel]! += data[i + channel]!;
        }
      }
      const count = (endX - blockX) * (endY - blockY);
      const average = sum.map((value) => Math.round(value / count));
      for (let py = blockY; py < endY; py += 1) {
        for (let px = blockX; px < endX; px += 1) {
          const i = (py * width + px) * 4;
          for (let channel = 0; channel < 4; channel += 1) data[i + channel] = average[channel]!;
        }
      }
    }
  }
  context.putImageData(image, x, y);
}

export interface EncodedCapture {
  readonly contentType: CaptureType;
  /** The image, base64-encoded. */
  readonly data: string;
}

const encode = (canvas: HTMLCanvasElement, type: CaptureType, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unreadable capture'));
    reader.readAsDataURL(blob);
  });

/**
 * The image to send: PNG (sharp for an interface), or ever coarser JPEG if the PNG
 * exceeds the size the Instance accepts; `null` if nothing fits.
 */
export async function encodeCapture(canvas: HTMLCanvasElement): Promise<EncodedCapture | null> {
  const attempts: [CaptureType, number?][] = [
    ['image/png'],
    ['image/jpeg', 0.85],
    ['image/jpeg', 0.6],
  ];
  for (const [contentType, quality] of attempts) {
    const blob = await encode(canvas, contentType, quality);
    if (blob && blob.type === contentType && blob.size <= CAPTURE_MAX_BYTES) {
      return { contentType, data: await toBase64(blob) };
    }
  }
  return null;
}

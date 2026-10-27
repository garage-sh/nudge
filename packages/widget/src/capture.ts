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

/**
 * Where a document's viewport sits in the Capture: its offset, and the area it can
 * paint (a frame's content box, itself clipped by the frames around it).
 */
interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly clip: Rectangle;
  /** A frame's document, which the render lays out less faithfully than the page. */
  readonly framed: boolean;
}

/** What the Capture must not show in the clear. */
interface Masks {
  /** Elements whose content is not copied into the render (their box still is). */
  readonly emptied: Element[];
  /**
   * Elements left out of the render whole. The render does not place a frame's content
   * exactly where the page shows it (a frame's padding is lost, for one), so the fill
   * cannot be trusted to cover a masked element's box there: it is not rendered at all.
   */
  readonly removed: Element[];
  /** Areas covered with the opaque fill, in the Capture's frame. */
  readonly areas: Rectangle[];
}

const intersect = (a: Rectangle, b: Rectangle): Rectangle => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
};

/** An element's box in the Capture's frame, clipped to the viewport it paints in. */
function boxIn(viewport: Viewport, element: Element): Rectangle {
  const box = element.getBoundingClientRect();
  return intersect(
    { x: viewport.x + box.left, y: viewport.y + box.top, width: box.width, height: box.height },
    viewport.clip,
  );
}

/** The document a frame shows, if the page may read it (same origin, not sandboxed). */
function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument?.body ? frame.contentDocument : null;
  } catch {
    return null;
  }
}

/** The viewport of a frame's document: its content box, inside the border and padding. */
function frameViewport(viewport: Viewport, frame: HTMLIFrameElement): Viewport {
  const box = frame.getBoundingClientRect();
  const style = frame.ownerDocument.defaultView!.getComputedStyle(frame);
  const x = viewport.x + box.left + frame.clientLeft + parseFloat(style.paddingLeft);
  const y = viewport.y + box.top + frame.clientTop + parseFloat(style.paddingTop);
  return {
    x,
    y,
    clip: intersect({ x, y, width: frame.clientWidth, height: frame.clientHeight }, viewport.clip),
    framed: true,
  };
}

/**
 * The page's masks: the `data-nudge-mask` elements, open Shadow DOMs and same-origin
 * frames included, and the frames whose content cannot be inspected (another site, a
 * sandbox), covered whole since nothing tells what they show.
 */
function collectMasks(
  root: Document | ShadowRoot,
  viewport: Viewport,
  masks: Masks = { emptied: [], removed: [], areas: [] },
): Masks {
  for (const element of root.querySelectorAll(`[${MASK_ATTRIBUTE}]`)) {
    (viewport.framed ? masks.removed : masks.emptied).push(element);
    masks.areas.push(boxIn(viewport, element));
  }
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) collectMasks(element.shadowRoot, viewport, masks);
    // A masked frame is already covered whole.
    if (element.tagName.toUpperCase() !== 'IFRAME' || element.hasAttribute(MASK_ATTRIBUTE)) {
      continue;
    }
    const frame = element as HTMLIFrameElement;
    const content = frameDocument(frame);
    if (content) {
      collectMasks(content, frameViewport(viewport, frame), masks);
    } else {
      masks.removed.push(frame);
      masks.areas.push(boxIn(viewport, frame));
    }
  }
  return masks;
}

/**
 * A node's parent, crossing a Shadow DOM boundary and a frame's. Checked by node type
 * rather than `instanceof`: a frame's nodes come from another realm.
 */
function parentOf(node: Node): Node | null {
  if (node.nodeType === Node.DOCUMENT_NODE) {
    try {
      return (node as Document).defaultView?.frameElement ?? null;
    } catch {
      return null;
    }
  }
  const parent = node.parentNode;
  return parent?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in parent
    ? (parent as ShadowRoot).host
    : parent;
}

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
 * `data-nudge-mask` elements never leave it in the clear, nor do frames whose content
 * cannot be inspected: their content is not copied into the render (inside a frame,
 * nothing of them is), and their box is covered with an opaque fill.
 */
export async function capturePage(excluded: Element): Promise<HTMLCanvasElement> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // Masks measured before the render, in the window's frame (= the Capture's).
  const masks = collectMasks(document, {
    x: 0,
    y: 0,
    clip: { x: 0, y: 0, width, height },
    framed: false,
  });
  const emptied = new Set<Node>(masks.emptied);
  const removed = new Set<Node>(masks.removed);
  const insideMask = (node: Node): boolean => {
    for (let parent = parentOf(node); parent; parent = parentOf(parent)) {
      if (emptied.has(parent) || removed.has(parent)) return true;
    }
    return false;
  };
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
      !removed.has(node) &&
      !insideMask(node) &&
      !(emptied.has(node) && REPLACED.has((node as Element).tagName?.toUpperCase())),
    // An unreadable image from another site: a transparent pixel rather than a failure.
    imagePlaceholder:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  });

  const context = canvas.getContext('2d')!;
  context.fillStyle = MASK_COLOR;
  for (const area of masks.areas) {
    if (area.width <= 0 || area.height <= 0) continue;
    context.fillRect(
      Math.floor(area.x),
      Math.floor(area.y),
      Math.ceil(area.x + area.width) - Math.floor(area.x),
      Math.ceil(area.y + area.height) - Math.floor(area.y),
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

import type { FeedbackType } from '@nudge/shared';
import { blurArea, capturePage, encodeCapture, type Rectangle } from './capture.js';
import { LIMITS } from './domain.js';
import { en } from './locales/en.js';
import { LOCALES, resolveLocale, type Locale, type Messages } from './locales/index.js';
import type { DeclaredAuthor, Metadata, WidgetOptions } from './options.js';
import { STYLES } from './styles.js';
import { postFeedback } from './submission.js';

/** The element's name: `<nudge-widget public-key="nk_pub_…" api="https://nudge.example">`. */
export const ELEMENT_NAME = 'nudge-widget';

/** The keys of the plain texts, which the layout points to with `data-text` and `data-label`. */
type TextKey = { [K in keyof Messages]: Messages[K] extends string ? K : never }[keyof Messages];

const FEEDBACK_TYPES = Object.keys(en.feedbackTypes) as FeedbackType[];

// The texts are filled in by `#localize`, in the Widget's language.
const LAYOUT = `
<div class="root">
  <section class="panel" role="dialog" aria-labelledby="title" hidden>
    <div class="header">
      <h2 id="title" data-text="title"></h2>
      <button type="button" class="close" data-label="close">×</button>
    </div>
    <form novalidate>
      <label for="text" data-text="text"></label>
      <textarea id="text" name="text" rows="5" maxlength="${LIMITS.text}"></textarea>
      <label for="type" data-text="type"></label>
      <select id="type" name="type">
        <option value="" data-text="typeUnspecified"></option>
        ${FEEDBACK_TYPES.map((type) => `<option value="${type}"></option>`).join('')}
      </select>
      <label for="email" data-text="email"></label>
      <input id="email" name="email" type="email" autocomplete="email" maxlength="${LIMITS.email}">
      <label class="option"><input type="checkbox" name="capture"><span data-text="attachCapture"></span></label>
      <p class="capture-status" data-text="captureInProgress" hidden></p>
      <div class="preview" hidden>
        <p class="help" data-text="captureHelp"></p>
        <div class="frame">
          <canvas role="img" data-label="capturePreview"></canvas>
          <div class="selection" hidden></div>
        </div>
        <button type="button" class="clear-blurs" data-text="clearBlurs"></button>
      </div>
      <p class="error" role="alert" hidden></p>
      <button type="submit" class="submit" data-text="submit"></button>
    </form>
    <p class="confirmation" role="status" hidden></p>
  </section>
  <button type="button" class="launcher" aria-expanded="false" data-text="launcher"></button>
</div>`;

// Outside a browser (server rendering of a React app), the class stays importable.
const HtmlElement = (
  typeof HTMLElement === 'undefined' ? class {} : HTMLElement
) as typeof HTMLElement;

const PROPERTIES = ['publicKey', 'api', 'author', 'metadata', 'locale'] as const;

/**
 * The Widget: an always-reachable button that opens a Feedback form, all inside a
 * Shadow DOM. Attributes `public-key`, `api` and `locale`; properties `author` and
 * `metadata` for the identity and context the host provides.
 */
export class NudgeWidget extends HtmlElement {
  static readonly observedAttributes = ['locale'];

  #author: DeclaredAuthor | undefined;
  #metadata: Metadata | undefined;
  readonly #root: ShadowRoot;
  /**
   * The Capture the Author chose to attach: the original masked image, which
   * "Remove blurs" restores in the preview (which carries the drawn blurs).
   */
  #capture: ImageData | null = null;
  /** The Capture being taken; sending waits for it. */
  #captureInProgress: Promise<void> | null = null;
  /** The starting corner of the rectangle the Author draws on the preview, in Capture pixels. */
  #drag: { x: number; y: number } | null = null;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLES}</style>${LAYOUT}`;
    this.#el('.launcher').addEventListener('click', () => this.#toggle());
    this.#el('.close').addEventListener('click', () => this.#close());
    this.#el('.panel').addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') this.#close();
    });
    this.#el<HTMLTextAreaElement>('textarea').addEventListener('input', (event) =>
      (event.target as HTMLTextAreaElement).setCustomValidity(''),
    );
    this.#el<HTMLInputElement>('input[name="capture"]').addEventListener('change', (event) => {
      if ((event.target as HTMLInputElement).checked) {
        this.#captureInProgress = this.#takeCapture();
      } else {
        this.#removeCapture();
      }
    });
    this.#wireBlurring();
    this.#el('form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#submit();
    });
    // A property set before the element was defined would shadow the accessor.
    for (const property of PROPERTIES) {
      if (Object.hasOwn(this, property)) {
        const value: unknown = this[property];
        delete this[property];
        Object.assign(this, { [property]: value });
      }
    }
    this.#localize();
  }

  connectedCallback(): void {
    // The page's language is known once the element is in it.
    this.#localize();
  }

  attributeChangedCallback(): void {
    this.#localize();
  }

  get publicKey(): string {
    return this.getAttribute('public-key') ?? '';
  }
  set publicKey(value: string) {
    this.setAttribute('public-key', value);
  }

  get api(): string {
    return this.getAttribute('api') ?? '';
  }
  set api(value: string) {
    this.setAttribute('api', value);
  }

  /** The language the Widget speaks: the requested one, else the detected one. */
  get locale(): Locale {
    return resolveLocale(this.getAttribute('locale'));
  }
  set locale(value: Locale | undefined) {
    if (value) this.setAttribute('locale', value);
    else this.removeAttribute('locale');
  }

  get author(): DeclaredAuthor | undefined {
    return this.#author;
  }
  set author(value: DeclaredAuthor | undefined) {
    this.#author = value;
  }

  get metadata(): Metadata | undefined {
    return this.#metadata;
  }
  set metadata(value: Metadata | undefined) {
    this.#metadata = value;
  }

  /** Sets the key, the Instance, the language, the identity and the host metadata at once. */
  configure(options: WidgetOptions): void {
    this.publicKey = options.publicKey;
    this.api = options.api;
    this.locale = options.locale;
    this.#author = options.author;
    this.#metadata = options.metadata;
  }

  #el<E extends HTMLElement = HTMLElement>(selector: string): E {
    const element = this.#root.querySelector<E>(selector);
    if (!element) throw new Error(`nudge widget: ${selector} not found`);
    return element;
  }

  get #messages(): Messages {
    return LOCALES[this.locale];
  }

  /** Writes the texts of the layout in the Widget's language. */
  #localize(): void {
    const messages = this.#messages;
    for (const element of this.#root.querySelectorAll<HTMLElement>('[data-text]')) {
      element.textContent = messages[element.dataset.text as TextKey];
    }
    for (const element of this.#root.querySelectorAll<HTMLElement>('[data-label]')) {
      element.setAttribute('aria-label', messages[element.dataset.label as TextKey]);
    }
    for (const option of this.#el<HTMLSelectElement>('select').options) {
      if (option.value) option.textContent = messages.feedbackTypes[option.value as FeedbackType];
    }
  }

  #toggle(): void {
    if (this.#el('.panel').hidden) this.#open();
    else this.#close();
  }

  #open(): void {
    this.#el('.panel').hidden = false;
    this.#el('form').hidden = false;
    this.#el('.confirmation').hidden = true;
    this.#el('.launcher').setAttribute('aria-expanded', 'true');
    this.#el('textarea').focus();
  }

  #close(): void {
    this.#el('.panel').hidden = true;
    this.#el('.launcher').setAttribute('aria-expanded', 'false');
    this.#el('.launcher').focus();
  }

  /** The Capture to attach, as the preview shows it (blurs included), or nothing. */
  async #readyCapture() {
    await this.#captureInProgress;
    const checkbox = this.#el<HTMLInputElement>('input[name="capture"]');
    if (!checkbox.checked || !this.#capture) return null;
    return (await encodeCapture(this.#el<HTMLCanvasElement>('canvas'))) ?? 'too_large';
  }

  /** Takes the page Capture, with the Author's consent (box checked), and shows it. */
  async #takeCapture(): Promise<void> {
    const status = this.#el('.capture-status');
    const error = this.#el('.error');
    const checkbox = this.#el<HTMLInputElement>('input[name="capture"]');
    error.hidden = true;
    status.hidden = false;
    checkbox.disabled = true;
    try {
      const taken = await capturePage(this);
      // The Author may have unchecked the box during the capture: it is not sent.
      if (!checkbox.checked) return;
      const preview = this.#el<HTMLCanvasElement>('canvas');
      preview.width = taken.width;
      preview.height = taken.height;
      const context = preview.getContext('2d')!;
      context.drawImage(taken, 0, 0);
      this.#capture = context.getImageData(0, 0, taken.width, taken.height);
      this.#el('.preview').hidden = false;
    } catch {
      checkbox.checked = false;
      error.textContent = this.#messages.captureFailed;
      error.hidden = false;
    } finally {
      status.hidden = true;
      checkbox.disabled = false;
    }
  }

  #removeCapture(): void {
    this.#capture = null;
    this.#el<HTMLInputElement>('input[name="capture"]').checked = false;
    this.#el('.preview').hidden = true;
    const preview = this.#el<HTMLCanvasElement>('canvas');
    preview.width = 0;
    preview.height = 0;
  }

  /**
   * Blurring: the Author draws a rectangle on the preview (mouse, finger or pen), and
   * the area is blurred in the image that will be sent; "Remove blurs" restores the
   * original image (host masks included: those cannot be removed).
   */
  #wireBlurring(): void {
    const preview = this.#el<HTMLCanvasElement>('canvas');
    const selection = this.#el('.selection');
    const capturePoint = (event: PointerEvent) => {
      const box = preview.getBoundingClientRect();
      const scale = preview.width / box.width;
      return {
        x: Math.min(Math.max(0, (event.clientX - box.left) * scale), preview.width),
        y: Math.min(Math.max(0, (event.clientY - box.top) * scale), preview.height),
      };
    };
    const rectangle = (a: { x: number; y: number }, b: { x: number; y: number }): Rectangle => ({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    });
    const show = (area: Rectangle) => {
      const scale = preview.getBoundingClientRect().width / preview.width;
      Object.assign(selection.style, {
        left: `${area.x * scale}px`,
        top: `${area.y * scale}px`,
        width: `${area.width * scale}px`,
        height: `${area.height * scale}px`,
      });
      selection.hidden = false;
    };
    preview.addEventListener('pointerdown', (event) => {
      if (!this.#capture) return;
      event.preventDefault();
      preview.setPointerCapture(event.pointerId);
      this.#drag = capturePoint(event);
      show(rectangle(this.#drag, this.#drag));
    });
    preview.addEventListener('pointermove', (event) => {
      if (this.#drag) show(rectangle(this.#drag, capturePoint(event)));
    });
    const finish = (event: PointerEvent, blur: boolean) => {
      if (!this.#drag) return;
      const area = rectangle(this.#drag, capturePoint(event));
      this.#drag = null;
      selection.hidden = true;
      if (blur && area.width >= 4 && area.height >= 4) blurArea(preview, area);
    };
    preview.addEventListener('pointerup', (event) => finish(event, true));
    preview.addEventListener('pointercancel', (event) => finish(event, false));
    this.#el('.clear-blurs').addEventListener('click', () => {
      if (this.#capture) preview.getContext('2d')!.putImageData(this.#capture, 0, 0);
    });
  }

  async #submit(): Promise<void> {
    const messages = this.#messages;
    const form = this.#el<HTMLFormElement>('form');
    const text = this.#el<HTMLTextAreaElement>('textarea');
    const email = this.#el<HTMLInputElement>('input[name="email"]');
    const type = this.#el<HTMLSelectElement>('select').value as FeedbackType | '';
    const error = this.#el('.error');
    const button = this.#el<HTMLButtonElement>('.submit');
    text.setCustomValidity(text.value.trim() ? '' : messages.textEmpty);
    if (!form.reportValidity()) return;

    error.hidden = true;
    button.disabled = true;
    button.textContent = messages.submitting;
    const result = await this.#readyCapture().then(async (capture) =>
      capture === 'too_large'
        ? ({ status: 'error', message: messages.captureTooLarge } as const)
        : postFeedback(
            {
              publicKey: this.publicKey,
              api: this.api,
              author: this.#author,
              metadata: this.#metadata,
            },
            {
              text: text.value,
              ...(type ? { type } : {}),
              ...(email.value ? { email: email.value } : {}),
              ...(capture ? { capture } : {}),
            },
            messages,
          ),
    );
    button.disabled = false;
    button.textContent = messages.submit;

    if (result.status === 'error') {
      error.textContent = result.message;
      error.hidden = false;
      return;
    }
    form.reset();
    this.#removeCapture();
    form.hidden = true;
    const confirmation = this.#el('.confirmation');
    confirmation.textContent = messages.sent;
    confirmation.hidden = false;
  }
}

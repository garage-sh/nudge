import type { FeedbackType } from '@nudge/shared';
import { blurArea, capturePage, encodeCapture, type Rectangle } from './capture.js';
import { LIMITS } from './domain.js';
import { en } from './locales/en.js';
import { LOCALES, resolveLocale, type Locale, type Messages } from './locales/index.js';
import type { DeclaredAuthor, Metadata, RedactUrl, WidgetOptions } from './options.js';
import { STYLES } from './styles.js';
import { postFeedback } from './submission.js';

/** The element's name: `<nudge-widget public-key="nk_pub_…" api="https://nudge.example">`. */
export const ELEMENT_NAME = 'nudge-widget';

/** The keys of the plain texts, which the layout points to with `data-text` and `data-label`. */
type TextKey = { [K in keyof Messages]: Messages[K] extends string ? K : never }[keyof Messages];

const FEEDBACK_TYPES = Object.keys(en.feedbackTypes) as FeedbackType[];

/** The message length from which the counter shows how close the limit is. */
const COUNTER_FROM = Math.round(LIMITS.text * 0.8);

/** Line icons drawn on a 24-unit grid, in the current text color. */
const ICONS = {
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  title:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  camera:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
};

const TYPE_ICONS = {
  bug: '<path d="M9 7.1V6a3 3 0 1 1 6 0v1.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Zm0 0v-9M6.5 9C4.6 8.8 3 7.1 3 5m3 8H2m1 8c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4m-.8 4c2.1.1 3.8 1.9 3.8 4"/>',
  suggestion:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6m-5 4h4"/>',
  opinion:
    '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  question:
    '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01"/>',
} satisfies Record<FeedbackType, string>;

const icon = (paths: string, className = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" class="${className}">${paths}</svg>`;

// The texts are filled in by `#localize`, in the Widget's language.
const LAYOUT = `
<div class="root">
  <section class="panel" role="dialog" aria-labelledby="title" hidden>
    <div class="header">
      <span class="header-mark">${icon(ICONS.title)}</span>
      <div class="header-text">
        <h2 id="title" data-text="title"></h2>
        <p class="subtitle" data-text="subtitle"></p>
      </div>
      <button type="button" class="close" data-label="close">${icon(ICONS.close)}</button>
    </div>
    <div class="body">
      <form novalidate>
        <fieldset class="field">
          <legend data-text="type"></legend>
          <div class="types">
            ${FEEDBACK_TYPES.map(
              (type) => `<label class="type">
              <input type="radio" name="type" value="${type}">
              <span class="type-face">${icon(TYPE_ICONS[type])}<span class="type-name"></span></span>
            </label>`,
            ).join('')}
          </div>
        </fieldset>
        <div class="field">
          <label class="label" for="text" data-text="text"></label>
          <div class="message">
            <textarea id="text" name="text" rows="5" maxlength="${LIMITS.text}" data-placeholder="textPlaceholder"></textarea>
            <span class="counter" aria-hidden="true" hidden></span>
          </div>
        </div>
        <div class="field">
          <label class="label" for="email" data-text="email"></label>
          <input id="email" name="email" type="email" autocomplete="email" maxlength="${LIMITS.email}" data-placeholder="emailPlaceholder">
        </div>
        <div class="field">
          <label class="capture">
            ${icon(ICONS.camera, 'capture-icon')}
            <span class="capture-text" data-text="attachCapture"></span>
            <input type="checkbox" name="capture">
          </label>
          <p class="capture-status" hidden><span class="spinner"></span><span data-text="captureInProgress"></span></p>
          <div class="preview" hidden>
            <p class="help" data-text="captureHelp"></p>
            <div class="frame">
              <canvas role="img" data-label="capturePreview"></canvas>
              <div class="selection" hidden></div>
            </div>
            <button type="button" class="clear-blurs" data-text="clearBlurs"></button>
          </div>
        </div>
        <div class="error" role="alert" hidden>${icon(ICONS.alert)}<span class="error-text"></span></div>
        <div class="footer">
          <span class="shortcut" aria-hidden="true"><kbd class="modifier"></kbd><kbd>↵</kbd></span>
          <button type="submit" class="submit">
            <span class="spinner" hidden></span><span class="submit-text" data-text="submit"></span>${icon(ICONS.send)}
          </button>
        </div>
      </form>
      <div class="done" hidden>
        <span class="done-mark">${icon(ICONS.check)}</span>
        <p class="confirmation" role="status"></p>
        <button type="button" class="again" data-text="sendAnother"></button>
      </div>
    </div>
  </section>
  <button type="button" class="launcher" aria-expanded="false">
    <span class="launcher-icons" aria-hidden="true">${icon(ICONS.message, 'icon-message')}${icon(ICONS.close, 'icon-close')}</span>
    <span class="launcher-label" data-text="launcher"></span>
  </button>
</div>`;

/** Command on Apple systems, Control elsewhere: the modifier that sends with Enter. */
const isApple = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

// Outside a browser (server rendering of a React app), the class stays importable.
const HtmlElement = (
  typeof HTMLElement === 'undefined' ? class {} : HTMLElement
) as typeof HTMLElement;

const PROPERTIES = ['publicKey', 'api', 'author', 'metadata', 'locale', 'redactUrl'] as const;

/**
 * The Widget: an always-reachable button that opens a Feedback form, all inside a
 * Shadow DOM. Attributes `public-key`, `api` and `locale`; properties `author` and
 * `metadata` for the identity and context the host provides, and `redactUrl` to rewrite
 * the page URL sent with the Feedback.
 */
export class NudgeWidget extends HtmlElement {
  static readonly observedAttributes = ['locale'];

  #author: DeclaredAuthor | undefined;
  #metadata: Metadata | undefined;
  #redactUrl: RedactUrl | undefined;
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
  /** The chosen Feedback type, so that clicking it again clears it. */
  #type: FeedbackType | '' = '';

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${STYLES}</style>${LAYOUT}`;
    this.#el('.launcher').addEventListener('click', () => this.#toggle());
    this.#el('.close').addEventListener('click', () => this.#close());
    this.#el('.again').addEventListener('click', () => this.#showForm());
    this.#el('.panel').addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') this.#close();
    });
    this.#el('.panel').addEventListener('animationend', (event) => {
      const panel = event.target as HTMLElement;
      if (!panel.classList.contains('closing')) return;
      panel.classList.remove('closing');
      panel.hidden = true;
    });
    this.#el<HTMLTextAreaElement>('textarea').addEventListener('input', (event) => {
      const text = event.target as HTMLTextAreaElement;
      text.setCustomValidity('');
      this.#count(text.value.length);
    });
    for (const radio of this.#root.querySelectorAll<HTMLInputElement>('input[name="type"]')) {
      radio.addEventListener('click', () => {
        if (radio.value === this.#type) radio.checked = false;
        this.#type = radio.checked ? (radio.value as FeedbackType) : '';
      });
    }
    const apple = isApple();
    this.#el('.modifier').textContent = apple ? '⌘' : 'Ctrl';
    this.#el('.submit').setAttribute('aria-keyshortcuts', apple ? 'Meta+Enter' : 'Control+Enter');
    this.#el('form').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.#el<HTMLFormElement>('form').requestSubmit();
      }
    });
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

  /** Rewrites the page URL sent with the Feedback; by default, its fragment is dropped. */
  get redactUrl(): RedactUrl | undefined {
    return this.#redactUrl;
  }
  set redactUrl(value: RedactUrl | undefined) {
    this.#redactUrl = value;
  }

  /**
   * Sets the key, the Instance, the language, the identity, the host metadata and the
   * URL redaction at once.
   */
  configure(options: WidgetOptions): void {
    this.publicKey = options.publicKey;
    this.api = options.api;
    this.locale = options.locale;
    this.#author = options.author;
    this.#metadata = options.metadata;
    this.#redactUrl = options.redactUrl;
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
    for (const element of this.#root.querySelectorAll<HTMLElement>('[data-placeholder]')) {
      element.setAttribute('placeholder', messages[element.dataset.placeholder as TextKey]);
    }
    for (const radio of this.#root.querySelectorAll<HTMLInputElement>('input[name="type"]')) {
      radio.nextElementSibling!.querySelector('.type-name')!.textContent =
        messages.feedbackTypes[radio.value as FeedbackType];
    }
  }

  /** Shows the characters left once the message nears its limit. */
  #count(length: number): void {
    const counter = this.#el('.counter');
    counter.hidden = length < COUNTER_FROM;
    counter.textContent = `${length} / ${LIMITS.text}`;
    counter.classList.toggle('near', length >= LIMITS.text * 0.95);
  }

  #toggle(): void {
    const panel = this.#el('.panel');
    if (panel.hidden || panel.classList.contains('closing')) this.#open();
    else this.#close();
  }

  #open(): void {
    const panel = this.#el('.panel');
    panel.classList.remove('closing');
    panel.hidden = false;
    this.#el('.launcher').setAttribute('aria-expanded', 'true');
    this.#showForm();
  }

  /** The empty form, after opening or after a Feedback was sent. */
  #showForm(): void {
    this.#el('form').hidden = false;
    this.#el('.done').hidden = true;
    this.#el('textarea').focus();
  }

  /** Plays the closing animation; `animationend` then hides the panel. */
  #close(): void {
    const panel = this.#el('.panel');
    if (!panel.hidden) panel.classList.add('closing');
    this.#el('.launcher').setAttribute('aria-expanded', 'false');
    this.#el('.launcher').focus();
  }

  #showError(message: string): void {
    this.#el('.error-text').textContent = message;
    this.#el('.error').hidden = false;
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
      this.#showError(this.#messages.captureFailed);
    } finally {
      status.hidden = true;
      checkbox.disabled = false;
      // Disabling the box dropped the focus out of the form: give it back.
      if (!this.#root.activeElement) checkbox.focus({ preventScroll: true });
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
    const type = this.#type;
    const error = this.#el('.error');
    const button = this.#el<HTMLButtonElement>('.submit');
    const buttonText = this.#el('.submit-text');
    const spinner = this.#el('.submit .spinner');
    text.setCustomValidity(text.value.trim() ? '' : messages.textEmpty);
    if (!form.reportValidity()) return;

    error.hidden = true;
    button.disabled = true;
    buttonText.textContent = messages.submitting;
    spinner.hidden = false;
    const result = await this.#readyCapture().then(async (capture) =>
      capture === 'too_large'
        ? ({ status: 'error', message: messages.captureTooLarge } as const)
        : postFeedback(
            {
              publicKey: this.publicKey,
              api: this.api,
              author: this.#author,
              metadata: this.#metadata,
              redactUrl: this.#redactUrl,
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
    buttonText.textContent = messages.submit;
    spinner.hidden = true;

    if (result.status === 'error') {
      this.#showError(result.message);
      return;
    }
    form.reset();
    this.#type = '';
    this.#count(0);
    this.#removeCapture();
    form.hidden = true;
    this.#el('.confirmation').textContent = messages.sent;
    this.#el('.done').hidden = false;
    this.#el('.again').focus();
  }
}

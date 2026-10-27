import { ELEMENT_NAME, NudgeWidget } from './element.js';
import type { WidgetOptions } from './options.js';

export { ELEMENT_NAME, NudgeWidget } from './element.js';
export type { Locale } from './locales/index.js';
export type { DeclaredAuthor, Metadata, RedactUrl, WidgetOptions } from './options.js';

/** Registers `<nudge-widget>` (no effect if it already is). */
export function defineWidget(): void {
  if (!customElements.get(ELEMENT_NAME)) customElements.define(ELEMENT_NAME, NudgeWidget);
}

/** Creates the Widget with its options and adds it to the page (`document.body` by default). */
export function mountWidget(options: WidgetOptions, parent: Element = document.body): NudgeWidget {
  defineWidget();
  const widget = document.createElement(ELEMENT_NAME) as NudgeWidget;
  widget.configure(options);
  parent.append(widget);
  return widget;
}

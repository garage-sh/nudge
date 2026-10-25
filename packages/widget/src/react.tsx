import { createElement, useLayoutEffect, useRef } from 'react';
import { defineWidget, ELEMENT_NAME, type NudgeWidget as WidgetElement } from './index.js';
import type { WidgetOptions } from './options.js';

export type { Locale } from './locales/index.js';
export type { DeclaredAuthor, Metadata, WidgetOptions } from './options.js';

export type NudgeWidgetProps = WidgetOptions;

/**
 * The Widget as a React component: `<NudgeWidget publicKey="nk_pub_…" api="…" author={…} />`.
 * The element is mounted once; a props change updates its properties without
 * recreating it, so a form being filled in stays open.
 */
export function NudgeWidget({ publicKey, api, author, metadata, locale }: NudgeWidgetProps) {
  const ref = useRef<WidgetElement>(null);
  useLayoutEffect(() => {
    // Defined before writing the properties: the element is then upgraded.
    defineWidget();
    ref.current?.configure({ publicKey, api, author, metadata, locale });
  }, [publicKey, api, author, metadata, locale]);
  return createElement(ELEMENT_NAME, { ref });
}

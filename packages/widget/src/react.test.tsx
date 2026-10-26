import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { NudgeWidget as WidgetElement } from './index.js';
import { fr } from './locales/fr.js';
import { NudgeWidget } from './react.js';

afterEach(cleanup);

const widgetIn = (container: HTMLElement) => {
  const widget = container.querySelector<WidgetElement>('nudge-widget');
  if (!widget) throw new Error('<nudge-widget> missing');
  return widget;
};

const launcherText = (widget: WidgetElement) =>
  widget.shadowRoot?.querySelector('.launcher')?.textContent;

it('mounts the Widget with the host key, Instance, identity, metadata and URL redaction', () => {
  const redactUrl = (url: URL) => url.origin;
  const { container } = render(
    <NudgeWidget
      publicKey="nk_pub_react"
      api="https://nudge.example"
      author={{ id: 'u-1', name: 'Ada' }}
      metadata={{ version: '1.0.0' }}
      redactUrl={redactUrl}
    />,
  );

  const widget = widgetIn(container);
  expect(launcherText(widget)).toBe('Send feedback');
  expect(widget).toMatchObject({
    publicKey: 'nk_pub_react',
    api: 'https://nudge.example',
    author: { id: 'u-1', name: 'Ada' },
    metadata: { version: '1.0.0' },
    redactUrl,
  });
});

it('follows the props without remounting the Widget (a form in progress stays open)', () => {
  const props = { publicKey: 'nk_pub_react', api: 'https://nudge.example' };
  const { container, rerender } = render(<NudgeWidget {...props} />);
  const before = widgetIn(container);

  rerender(<NudgeWidget {...props} author={{ id: 'u-2' }} metadata={{ page: 'cart' }} />);

  expect(widgetIn(container)).toBe(before);
  expect(before.author).toEqual({ id: 'u-2' });
  expect(before.metadata).toEqual({ page: 'cart' });
});

it('speaks the requested language, and switches when the prop changes', () => {
  const props = { publicKey: 'nk_pub_react', api: 'https://nudge.example' };
  const { container, rerender } = render(<NudgeWidget {...props} locale="fr" />);
  const widget = widgetIn(container);
  expect(widget.locale).toBe('fr');
  expect(launcherText(widget)).toBe(fr.launcher);

  rerender(<NudgeWidget {...props} locale="en" />);

  expect(launcherText(widget)).toBe('Send feedback');
});

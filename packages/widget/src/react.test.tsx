import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { NudgeWidget as ElementWidget } from './index.js';
import { NudgeWidget } from './react.js';

afterEach(cleanup);

const widgetDe = (container: HTMLElement) => {
  const widget = container.querySelector<ElementWidget>('nudge-widget');
  if (!widget) throw new Error('<nudge-widget> absent');
  return widget;
};

it('monte le Widget avec la clé, l’Instance, l’identité et les métadonnées de l’hôte', () => {
  const { container } = render(
    <NudgeWidget
      cle="nk_pub_react"
      api="https://nudge.exemple"
      auteur={{ id: 'u-1', nom: 'Ada' }}
      metadonnees={{ version: '1.0.0' }}
    />,
  );

  const widget = widgetDe(container);
  expect(widget.shadowRoot?.querySelector('.lanceur')?.textContent).toBe('Laisser un retour');
  expect(widget).toMatchObject({
    cle: 'nk_pub_react',
    api: 'https://nudge.exemple',
    auteur: { id: 'u-1', nom: 'Ada' },
    metadonnees: { version: '1.0.0' },
  });
});

it('suit les props sans remonter le Widget (un formulaire en cours reste ouvert)', () => {
  const props = { cle: 'nk_pub_react', api: 'https://nudge.exemple' };
  const { container, rerender } = render(<NudgeWidget {...props} />);
  const avant = widgetDe(container);

  rerender(<NudgeWidget {...props} auteur={{ id: 'u-2' }} metadonnees={{ page: 'panier' }} />);

  expect(widgetDe(container)).toBe(avant);
  expect(avant.auteur).toEqual({ id: 'u-2' });
  expect(avant.metadonnees).toEqual({ page: 'panier' });
});

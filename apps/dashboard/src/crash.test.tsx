import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './i18n/index.js';
import { ErrorBoundary } from './layout/ErrorBoundary.js';

function Broken(): never {
  throw new Error('render failed');
}

describe('Unexpected error', () => {
  it('says what happened and offers to reload, instead of a blank page', () => {
    // React logs the caught error: expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <I18nProvider locale="en">
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>
      </I18nProvider>,
    );

    expect(screen.getByRole('alert').textContent).toMatch(/Something went wrong/);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { createQueryClient } from '../api/query-client.js';
import { I18nProvider, type Locale } from '../i18n/index.js';
import { AppRoutes } from '../routes.js';

/**
 * Mounts the whole dashboard at the given URL, with a fresh cache. In English unless
 * `locale` says otherwise; `null` lets the dashboard detect it, as in a browser.
 */
export function renderDashboard(url: string, { locale = 'en' }: { locale?: Locale | null } = {}) {
  return render(
    <I18nProvider locale={locale ?? undefined}>
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[url]}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

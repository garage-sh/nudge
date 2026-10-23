import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { createQueryClient } from '../api/query-client.js';
import { AppRoutes } from '../routes.js';

/** Monte le dashboard entier à l'URL donnée, avec un cache neuf. */
export function renderDashboard(url: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

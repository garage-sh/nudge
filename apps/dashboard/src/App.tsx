import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { createQueryClient } from './api/query-client.js';
import { I18nProvider } from './i18n/index.js';
import { ErrorBoundary } from './layout/ErrorBoundary.js';
import { AppRoutes } from './routes.js';

export function App() {
  const [client] = useState(createQueryClient);
  return (
    <I18nProvider>
      <ErrorBoundary>
        <QueryClientProvider client={client}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}

import { Component, type ReactNode } from 'react';
import { useT } from '../i18n/index.js';

/**
 * Catches a render error anywhere below it: the Member sees what happened and how to
 * get out, never a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <Crash /> : this.props.children;
  }
}

function Crash() {
  const t = useT();
  return (
    <main className="public">
      <div className="card" role="alert">
        <h1>{t.crash.title}</h1>
        <p>{t.crash.help}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {t.crash.reload}
        </button>
      </div>
    </main>
  );
}

import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/** An in-memory `Storage`, the way a browser keeps it for the page. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
}

// Recent Node versions define their own `localStorage` global, undefined without
// `--localstorage-file`, and it hides jsdom's: the tests get a real one back.
if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}

// The default 1 s is too short for a first render on a CI runner busy with the other suites.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

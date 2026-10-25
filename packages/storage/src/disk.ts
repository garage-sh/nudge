import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { checkKey, type CaptureStorage } from './port.js';

/**
 * Captures on a local disk (the default): one file per key under `dir`.
 * The api and the worker must see the same directory (shared volume in containers).
 * Writes go through a renamed temporary file: a concurrent read never sees a
 * half-written Capture.
 */
export function diskStorage(dir: string): CaptureStorage {
  const root = resolve(dir);
  const pathOf = (key: string) => join(root, checkKey(key));

  return {
    async save(key, content) {
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content);
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    async read(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}

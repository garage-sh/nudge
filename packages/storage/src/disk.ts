import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { checkKey, type CaptureStorage, type StoredObject } from './port.js';

/**
 * Directory of the temporary files, under the root. Its name starts with a `.`: no key
 * can address it (`checkKey`), and `list` skips it.
 */
const TEMPORARY_DIR = '.tmp';

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** The files under `directory`, recursively, keyed by their `/`-separated relative path. */
async function* walk(directory: string, prefix = ''): AsyncGenerator<StoredObject> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      yield* walk(path, `${key}/`);
    } else if (entry.isFile()) {
      try {
        yield { key, modifiedAt: (await stat(path)).mtime };
      } catch (error) {
        // Deleted since the directory was read.
        if (!isMissing(error)) throw error;
      }
    }
  }
}

/**
 * Captures on a local disk (the default): one file per key under `dir`.
 * The api and the worker must see the same directory (shared volume in containers).
 * Writes go through a temporary file renamed into place: a concurrent read never sees
 * a half-written Capture. A process killed between the two leaves the temporary file
 * in `<dir>/.tmp`, until `removeIncomplete` collects it.
 */
export function diskStorage(dir: string): CaptureStorage {
  const root = resolve(dir);
  const temporaryDir = join(root, TEMPORARY_DIR);
  const pathOf = (key: string) => join(root, checkKey(key));

  return {
    async save(key, content) {
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      await mkdir(temporaryDir, { recursive: true });
      const temporary = join(temporaryDir, randomUUID());
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
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async *list(prefix) {
      for await (const object of walk(root)) {
        if (object.key.startsWith(prefix)) yield object;
      }
    },
    async removeIncomplete(before) {
      let removed = 0;
      for await (const { key, modifiedAt } of walk(temporaryDir)) {
        if (modifiedAt >= before) continue;
        await rm(join(temporaryDir, key), { force: true });
        removed += 1;
      }
      return removed;
    },
  };
}

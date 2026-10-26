/**
 * Capture storage port: a store of binary objects addressed by key.
 * The Instance only puts Captures in it that were already masked in the browser; their
 * type and size are in the database, along with the key.
 */
export interface CaptureStorage {
  /** Writes the object `key` (replaces it if it exists). */
  save(key: string, content: Uint8Array, contentType: string): Promise<void>;
  /** The content of the object `key`, or `null` if it does not exist. */
  read(key: string): Promise<Uint8Array | null>;
  /** Deletes the object `key`; no effect if it does not exist. */
  delete(key: string): Promise<void>;
  /**
   * Every object whose key starts with `prefix`, with its last modification date, in no
   * particular order: the sweep of orphaned Captures compares them with the database.
   */
  list(prefix: string): AsyncIterable<StoredObject>;
  /**
   * Removes what writes interrupted before `before` left behind (a process killed in
   * the middle of a `save`), which `list` does not show. Returns how many were removed.
   */
  removeIncomplete(before: Date): Promise<number>;
}

/** An object of the Capture storage, as `list` sees it. */
export interface StoredObject {
  readonly key: string;
  readonly modifiedAt: Date;
}

/**
 * A key is a relative path made of `[A-Za-z0-9._-]` segments that do not start with a
 * `.`: it cannot escape the directory (disk) or the prefix (S3), nor reach a hidden
 * entry such as the disk storage's temporary directory.
 */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function checkKey(key: string): string {
  const segments = key.split('/');
  const valid =
    key.length > 0 && key.length <= 512 && segments.every((segment) => SEGMENT.test(segment));
  if (!valid) throw new Error(`Capture storage: invalid key "${key}"`);
  return key;
}

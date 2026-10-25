import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diskStorage } from './disk.js';
import type { CaptureStorage } from './port.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('Capture storage on local disk', () => {
  let dir: string;
  let storage: CaptureStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nudge-captures-'));
    storage = diskStorage(join(dir, 'captures'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads back what it saved, byte for byte', async () => {
    await storage.save('feedbacks/8f1c.png', PNG, 'image/png');

    expect(await storage.read('feedbacks/8f1c.png')).toEqual(PNG);
  });

  it('returns null for a missing Capture', async () => {
    expect(await storage.read('missing.png')).toBeNull();
  });

  it('deletes a Capture, and does not throw if it no longer exists', async () => {
    await storage.save('to-delete.png', PNG, 'image/png');

    await storage.delete('to-delete.png');
    await storage.delete('to-delete.png');

    expect(await storage.read('to-delete.png')).toBeNull();
  });

  it('leaves no temporary file behind a write', async () => {
    await storage.save('one.png', PNG, 'image/png');

    expect(await readdir(join(dir, 'captures'))).toEqual(['one.png']);
  });

  it.each(['../escape.png', '/absolute.png', 'a/../../b.png', 'nul\u0000.png', '', 'a//b.png'])(
    'rejects the key "%s", which would escape the directory',
    async (key) => {
      await expect(storage.save(key, PNG, 'image/png')).rejects.toThrow(/key/i);
      await expect(storage.read(key)).rejects.toThrow(/key/i);
    },
  );
});

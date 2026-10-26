import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
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

    expect((await readdir(join(dir, 'captures'))).sort()).toEqual(['.tmp', 'one.png']);
    expect(await readdir(join(dir, 'captures', '.tmp'))).toEqual([]);
  });

  it.each(['../escape.png', '/absolute.png', 'a/../../b.png', 'nul\u0000.png', '', 'a//b.png'])(
    'rejects the key "%s", which would escape the directory',
    async (key) => {
      await expect(storage.save(key, PNG, 'image/png')).rejects.toThrow(/key/i);
      await expect(storage.read(key)).rejects.toThrow(/key/i);
    },
  );

  it.each(['.tmp/abc', '.hidden.png', 'feedbacks/.env', 'a/./b.png'])(
    'rejects the key "%s", whose segment starts with a dot',
    async (key) => {
      await expect(storage.save(key, PNG, 'image/png')).rejects.toThrow(/key/i);
      await expect(storage.read(key)).rejects.toThrow(/key/i);
    },
  );

  it('lists the stored objects under a prefix, with their modification date', async () => {
    const before = new Date(Date.now() - 1000);
    await storage.save('feedbacks/a.png', PNG, 'image/png');
    await storage.save('feedbacks/b.webp', PNG, 'image/webp');
    await storage.save('other/c.png', PNG, 'image/png');

    const listed = [];
    for await (const object of storage.list('feedbacks/')) listed.push(object);

    expect(listed.map(({ key }) => key).sort()).toEqual(['feedbacks/a.png', 'feedbacks/b.webp']);
    expect(listed.every(({ modifiedAt }) => modifiedAt >= before)).toBe(true);
  });

  it('lists nothing when nothing was ever stored', async () => {
    const listed = [];
    for await (const object of storage.list('')) listed.push(object);

    expect(listed).toEqual([]);
  });

  it('removes the temporary files an interrupted write left before the given date', async () => {
    await storage.save('one.png', PNG, 'image/png');
    const temporaryDir = join(dir, 'captures', '.tmp');
    // Writes killed between the temporary file and its rename: one old, one in progress.
    await writeFile(join(temporaryDir, 'stale'), PNG);
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(join(temporaryDir, 'stale'), old, old);
    await writeFile(join(temporaryDir, 'in-progress'), PNG);

    const removed = await storage.removeIncomplete(new Date(Date.now() - 60 * 60_000));

    expect(removed).toBe(1);
    expect(await readdir(temporaryDir)).toEqual(['in-progress']);
    expect(await storage.read('one.png')).toEqual(PNG);
  });

  it('does not list the temporary files', async () => {
    await storage.save('one.png', PNG, 'image/png');
    await writeFile(join(dir, 'captures', '.tmp', 'stale'), PNG);

    const listed = [];
    for await (const object of storage.list('')) listed.push(object.key);

    expect(listed).toEqual(['one.png']);
  });
});

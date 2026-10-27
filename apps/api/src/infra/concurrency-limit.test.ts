import { describe, expect, it } from 'vitest';
import { ConcurrencyLimit } from './concurrency-limit.js';

describe('Concurrency limit', () => {
  it('runs up to the limit at once, then queues, then refuses at once', async () => {
    const limit = new ConcurrencyLimit({ concurrency: 2, waiting: 1 });
    const first = await limit.acquire();
    const second = await limit.acquire();
    let thirdStarted = false;
    const third = limit.acquire().then((release) => {
      thirdStarted = true;
      return release;
    });

    expect(await limit.acquire()).toBeNull();
    await Promise.resolve();
    expect(thirdStarted).toBe(false);

    first!();
    const releaseThird = await third;
    expect(thirdStarted).toBe(true);
    expect(releaseThird).not.toBeNull();
    second!();
    releaseThird!();
    expect(await limit.acquire()).not.toBeNull();
  });

  it('frees a slot only once, even released twice', async () => {
    const limit = new ConcurrencyLimit({ concurrency: 1, waiting: 0 });
    const release = await limit.acquire();
    release!();
    release!();

    expect(await limit.acquire()).not.toBeNull();
    expect(await limit.acquire()).toBeNull();
  });
});

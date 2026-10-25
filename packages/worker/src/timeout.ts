/**
 * Returns the result of `call`, or rejects with the `onTimeout` error if `timeoutMs`
 * elapses first: the signal passed to `call` is then aborted with that same error, so
 * the call in flight does not keep running.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  onTimeout: () => Error,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = onTimeout();
      abort.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(abort.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

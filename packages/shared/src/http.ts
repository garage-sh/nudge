/**
 * The start of a response body as text: at most `maxBytes` bytes are read, the rest
 * of the body is cancelled without being downloaded. A UTF-8 sequence cut at the limit
 * is dropped; a body that fails midway yields what was read. `''` without a body.
 */
export async function readTextPrefix(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let remaining = maxBytes;
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, remaining);
      remaining -= chunk.length;
      text += decoder.decode(chunk, { stream: true });
    }
  } catch {
    // Body interrupted: keep what was read.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

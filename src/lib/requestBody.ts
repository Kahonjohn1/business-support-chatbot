// Bounded request-body reading.
//
// `Content-Length` can be absent (chunked bodies) or dishonest, so the only
// trustworthy limit is the number of bytes actually pulled from the stream. We
// read at most `limit` bytes and stop — cancelling the source — as soon as the
// limit would be exceeded, so a request body can never be buffered without
// bound. The returned bytes (at most `limit`) can then be parsed normally.

export type BodyReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too-large" | "read-error" };

/**
 * True only when a well-formed `Content-Length` header exists and declares a
 * body larger than `limit`. A missing or malformed header returns false; the
 * actual size is still enforced afterwards by {@link readBodyWithLimit}.
 */
export function declaredBodyTooLarge(
  contentLengthHeader: string | null,
  limit: number
): boolean {
  if (contentLengthHeader === null) return false;
  const value = Number(contentLengthHeader);
  return Number.isFinite(value) && value > limit;
}

/**
 * Reads a request body while enforcing a hard byte limit. Reading stops (and
 * the underlying stream is cancelled) the moment the limit is exceeded, so the
 * caller never holds more than `limit` bytes in memory.
 */
export async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null | undefined,
  limit: number
): Promise<BodyReadResult> {
  if (!body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > limit) {
        // Stop reading and leave the rest unconsumed. Cancelling the web stream
        // here tears down the socket before the 413 can flush (the client sees
        // ECONNRESET); the route closes the connection instead so the error
        // response is delivered cleanly. No more than `limit` bytes are held.
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "read-error" };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The lock may already have been released; nothing more to do.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

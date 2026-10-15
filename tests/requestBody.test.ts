import { test } from "node:test";
import assert from "node:assert/strict";

import {
  declaredBodyTooLarge,
  readBodyWithLimit,
} from "../src/lib/requestBody.ts";

const encoder = new TextEncoder();

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
      } else {
        controller.close();
      }
    },
  });
}

test("declaredBodyTooLarge: missing header is not treated as oversized", () => {
  assert.equal(declaredBodyTooLarge(null, 100), false);
});

test("declaredBodyTooLarge: header above the limit is oversized", () => {
  assert.equal(declaredBodyTooLarge("101", 100), true);
  assert.equal(declaredBodyTooLarge("104857600", 100), true);
});

test("declaredBodyTooLarge: header at or below the limit is allowed", () => {
  assert.equal(declaredBodyTooLarge("100", 100), false);
  assert.equal(declaredBodyTooLarge("50", 100), false);
});

test("declaredBodyTooLarge: malformed or negative header is not oversized", () => {
  assert.equal(declaredBodyTooLarge("not-a-number", 100), false);
  assert.equal(declaredBodyTooLarge("-1", 100), false);
});

test("readBodyWithLimit: reads a body within the limit verbatim", async () => {
  const payload = encoder.encode("hello world");
  const result = await readBodyWithLimit(streamOf([payload]), 1024);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(Array.from(result.bytes), Array.from(payload));
  }
});

test("readBodyWithLimit: rejects a body that exceeds the limit", async () => {
  const chunks = [encoder.encode("aaaa"), encoder.encode("bbbb")];
  const result = await readBodyWithLimit(streamOf(chunks), 5);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "too-large");
});

test("readBodyWithLimit: stops reading once the limit is exceeded", async () => {
  let pulled = 0;
  const chunks = Array.from({ length: 1000 }, () => encoder.encode("xxxxxx"));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < chunks.length) {
        pulled += 1;
        controller.enqueue(chunks[pulled - 1]);
      } else {
        controller.close();
      }
    },
  });

  const result = await readBodyWithLimit(stream, 15);

  assert.equal(result.ok, false);
  assert.ok(pulled < chunks.length, `should not drain the stream (pulled ${pulled})`);
  assert.ok(pulled <= 10, `should stop near the limit (pulled ${pulled})`);
});

test("readBodyWithLimit: empty or absent body yields empty bytes", async () => {
  const empty = await readBodyWithLimit(streamOf([]), 10);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.bytes.length, 0);

  const absent = await readBodyWithLimit(null, 10);
  assert.equal(absent.ok, true);
  if (absent.ok) assert.equal(absent.bytes.length, 0);
});

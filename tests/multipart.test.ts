import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMultipartBody } from "../src/lib/multipart.ts";

async function serialize(form: FormData): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    body: form,
  });
  const bytes = new Uint8Array(await request.arrayBuffer());
  return {
    bytes,
    contentType: request.headers.get("content-type") ?? "",
  };
}

test("parseMultipartBody: parses a normal multipart request", async () => {
  const form = new FormData();
  form.append(
    "payload",
    JSON.stringify({ messages: [{ role: "user", content: "hello" }] })
  );
  form.append(
    "file:att-1",
    new File([new Uint8Array([1, 2, 3])], "a.txt", { type: "text/plain" }),
    "a.txt"
  );

  const { bytes, contentType } = await serialize(form);
  const result = await parseMultipartBody(bytes, contentType);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.payload, {
    messages: [{ role: "user", content: "hello" }],
  });

  const file = result.files.get("att-1");
  assert.ok(file, "file part should be captured under its id");
  assert.equal(file.name, "a.txt");
  assert.equal(file.type, "text/plain");
  assert.deepEqual(Array.from(file.bytes), [1, 2, 3]);
});

test("parseMultipartBody: ignores non-file fields and empty ids", async () => {
  const form = new FormData();
  form.append("payload", JSON.stringify({ messages: [] }));
  form.append("file:", new File([new Uint8Array([9])], "x.txt"), "x.txt");
  form.append("other", "ignore-me");

  const { bytes, contentType } = await serialize(form);
  const result = await parseMultipartBody(bytes, contentType);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.files.size, 0);
});

test("parseMultipartBody: rejects a missing payload", async () => {
  const form = new FormData();
  form.append("file:att-1", new File([new Uint8Array([1])], "a.txt"), "a.txt");

  const { bytes, contentType } = await serialize(form);
  const result = await parseMultipartBody(bytes, contentType);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.message, "Missing request payload.");
  }
});

test("parseMultipartBody: rejects an invalid JSON payload", async () => {
  const form = new FormData();
  form.append("payload", "{not json");

  const { bytes, contentType } = await serialize(form);
  const result = await parseMultipartBody(bytes, contentType);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.message, "Invalid request payload.");
  }
});

test("parseMultipartBody: rejects a malformed body", async () => {
  const result = await parseMultipartBody(
    new TextEncoder().encode("not multipart at all"),
    "multipart/form-data; boundary=does-not-exist"
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

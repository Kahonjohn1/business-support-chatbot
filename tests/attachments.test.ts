import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createAttachmentFromFile,
  releaseAttachmentFiles,
  totalAttachmentBytes,
  totalAttachmentSizeError,
  validateAttachmentFile,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "../src/lib/attachments.ts";
import { buildRequestContext } from "../src/lib/requestContext.ts";
import type { Attachment, ChatMessage } from "../src/types/chat.ts";

function attachment(id: string, overrides: Partial<Attachment> = {}): Attachment {
  return {
    id,
    name: `${id}.txt`,
    size: 10,
    type: "text/plain",
    kind: "document",
    contentAvailable: true,
    ...overrides,
  };
}

function file(name = "f.txt"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "text/plain" });
}

test("releaseAttachmentFiles removes only the given ids", () => {
  const cache = new Map<string, File>([
    ["pending", file("p.txt")],
    ["sent", file("s.txt")],
  ]);

  releaseAttachmentFiles([attachment("pending")], cache);

  assert.equal(cache.has("pending"), false, "pending file is released");
  assert.equal(cache.has("sent"), true, "unrelated file is preserved");
});

test("releasing composer files keeps already-sent attachments resolvable", () => {
  const cache = new Map<string, File>([
    ["composer", file("c.txt")],
    ["sent-message", file("o.txt")],
  ]);

  releaseAttachmentFiles([attachment("composer")], cache);

  const message: ChatMessage = {
    id: "m1",
    role: "user",
    content: "here is the file",
    createdAt: new Date().toISOString(),
    attachments: [attachment("sent-message")],
  };

  const context = buildRequestContext([message], cache);

  assert.deepEqual(
    context[0].attachmentIds,
    ["sent-message"],
    "file bytes for an already-sent message survive a composer reset"
  );
});

test("releaseAttachmentFiles is a no-op for an empty list", () => {
  const cache = new Map<string, File>([["keep", file()]]);
  releaseAttachmentFiles([], cache);
  assert.equal(cache.has("keep"), true);
});

test("validateAttachmentFile accepts supported types within the size limit", () => {
  assert.equal(validateAttachmentFile(file("doc.pdf")), null);
  assert.equal(
    validateAttachmentFile(new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" })),
    null
  );
});

test("validateAttachmentFile rejects unsupported types", () => {
  const result = validateAttachmentFile(
    new File([new Uint8Array([1])], "malware.exe", { type: "" })
  );
  assert.ok(result, "expected an error message");
  assert.match(result ?? "", /not a supported file type/);
});

test("validateAttachmentFile rejects files over the size limit", () => {
  const oversize = {
    name: "big.pdf",
    type: "application/pdf",
    size: MAX_ATTACHMENT_BYTES + 1,
  } as unknown as File;

  const result = validateAttachmentFile(oversize);
  assert.ok(result, "expected an error message");
  assert.match(result ?? "", /larger than/);
});

test("createAttachmentFromFile records document metadata and availability", () => {
  const created = createAttachmentFromFile(file("report.txt"));

  assert.equal(created.kind, "document");
  assert.equal(created.contentAvailable, true);
  assert.equal(created.type, "text/plain");
  assert.equal(created.size, 3);
  assert.equal(created.previewUrl, undefined);
});

test("totalAttachmentBytes sums the sizes of every attachment", () => {
  assert.equal(totalAttachmentBytes([]), 0);
  assert.equal(
    totalAttachmentBytes([
      attachment("a", { size: 100 }),
      attachment("b", { size: 250 }),
    ]),
    350
  );
});

test("totalAttachmentSizeError accepts attachments at or below the limit", () => {
  assert.equal(totalAttachmentSizeError([]), null);
  assert.equal(
    totalAttachmentSizeError([
      attachment("a", { size: MAX_TOTAL_ATTACHMENT_BYTES }),
    ]),
    null
  );
});

test("totalAttachmentSizeError rejects combined attachments over the limit", () => {
  const result = totalAttachmentSizeError([
    attachment("a", { size: MAX_TOTAL_ATTACHMENT_BYTES - 1 }),
    attachment("b", { size: 2 }),
  ]);

  assert.ok(result, "expected an error message");
  assert.match(result ?? "", /limit for a single message/);
});

test("MAX_TOTAL_ATTACHMENT_BYTES mirrors the server's 25 MB total limit", () => {
  assert.equal(MAX_TOTAL_ATTACHMENT_BYTES, 25 * 1024 * 1024);
});

// Multipart/form-data parsing for the chat endpoint.
//
// The router reads and size-limits the raw body first (see `requestBody.ts`);
// this module only parses an already-bounded byte buffer. It never touches the
// network request directly, which keeps parsing off an unbounded stream and
// makes the logic independently testable.

export interface RawFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export type MultipartResult =
  | { ok: true; payload: unknown; files: Map<string, RawFile> }
  | { ok: false; status: number; message: string };

/**
 * Parses a buffered multipart/form-data body. `contentType` must include the
 * boundary. File parts are expected to be named `file:<id>`; the JSON request
 * payload is expected in the `payload` field.
 */
export async function parseMultipartBody(
  body: Uint8Array,
  contentType: string
): Promise<MultipartResult> {
  let form: FormData;
  try {
    // Reconstruct a bounded request from the already-limited bytes so parsing
    // cannot buffer an unbounded stream.
    const bounded = new Response(body.slice(), {
      headers: { "content-type": contentType },
    });
    form = await bounded.formData();
  } catch {
    return { ok: false, status: 400, message: "Invalid request body." };
  }

  const payloadRaw = form.get("payload");
  if (typeof payloadRaw !== "string") {
    return { ok: false, status: 400, message: "Missing request payload." };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return { ok: false, status: 400, message: "Invalid request payload." };
  }

  const files = new Map<string, RawFile>();
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("file:") || typeof value === "string") continue;
    const id = key.slice("file:".length);
    if (!id) continue;
    const bytes = new Uint8Array(await value.arrayBuffer());
    files.set(id, { name: value.name, type: value.type, bytes });
  }

  return { ok: true, payload, files };
}

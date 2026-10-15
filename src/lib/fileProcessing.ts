import "server-only";

import { inflateRawSync } from "node:zlib";

import {
  MAX_DOCX_INFLATED_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_FILE_BYTES,
} from "@/lib/chatLimits";

// Server-only file inspection and text extraction. Files are validated by their
// magic bytes (never by the client-supplied name or MIME type alone) before any
// content is handed to the model.

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";
export const TEXT_MIME = "text/plain";
export const CSV_MIME = "text/csv";

export type SupportedMime =
  | typeof PDF_MIME
  | typeof DOCX_MIME
  | typeof TEXT_MIME
  | typeof CSV_MIME
  | "image/png"
  | "image/jpeg"
  | "image/webp";

/** A validated file ready to be turned into Gemini request parts. */
export interface PreparedFile {
  id: string;
  name: string;
  mimeType: SupportedMime;
  kind: "inline" | "text";
  /** Base64 payload for inline (binary) parts. */
  base64?: string;
  /** Extracted UTF-8 text for text parts. */
  text?: string;
  truncated?: boolean;
}

export type PrepareFileResult =
  | { ok: true; file: PreparedFile }
  | { ok: false; status: number; message: string };

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0
): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0x00) return false;
  }
  return decodeUtf8(bytes) !== null;
}

/** Determines the real type of a file from its leading bytes. */
function sniffMime(bytes: Uint8Array): SupportedMime | "text" | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF_MIME; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return DOCX_MIME;
  if (looksLikeText(bytes)) return "text";
  return null;
}

function truncateText(
  id: string,
  name: string,
  mimeType: SupportedMime,
  rawText: string
): PreparedFile {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    return {
      id,
      name,
      mimeType,
      kind: "text",
      text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS),
      truncated: true,
    };
  }
  return { id, name, mimeType, kind: "text", text };
}

export function prepareFile(input: {
  id: string;
  name: string;
  declaredMime: string;
  bytes: Uint8Array;
}): PrepareFileResult {
  const { id, name, declaredMime, bytes } = input;

  if (bytes.length === 0) {
    return { ok: false, status: 400, message: `"${name}" is empty.` };
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      message: `"${name}" is larger than 10 MB.`,
    };
  }

  const sniffed = sniffMime(bytes);
  if (!sniffed) {
    return {
      ok: false,
      status: 415,
      message: `"${name}" is not a supported file type.`,
    };
  }

  if (sniffed === PDF_MIME || sniffed.startsWith("image/")) {
    const mime = sniffed as SupportedMime;
    return {
      ok: true,
      file: {
        id,
        name,
        mimeType: mime,
        kind: "inline",
        base64: Buffer.from(bytes).toString("base64"),
      },
    };
  }

  if (sniffed === DOCX_MIME) {
    let extracted: string;
    try {
      extracted = extractDocxText(bytes);
    } catch {
      return {
        ok: false,
        status: 415,
        message: `"${name}" could not be read. Share a valid DOCX, PDF, image, or TXT/CSV file.`,
      };
    }
    return { ok: true, file: truncateText(id, name, DOCX_MIME, extracted) };
  }

  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      ok: false,
      status: 415,
      message: `"${name}" is not valid UTF-8 text.`,
    };
  }
  const mimeType: SupportedMime = declaredMime === CSV_MIME ? CSV_MIME : TEXT_MIME;
  return { ok: true, file: truncateText(id, name, mimeType, text) };
}

// ---------------------------------------------------------------------------
// DOCX support: a minimal ZIP reader built on Node's zlib, used to pull text
// out of word/document.xml without pulling in a third-party dependency.
// ---------------------------------------------------------------------------

function readUint16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const EOCD_SIGNATURE = 0x06054b50;
  const minOffset = Math.max(0, data.length - 65557);
  for (let i = data.length - 22; i >= minOffset; i -= 1) {
    if (readUint32(data, i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function readZipEntry(
  data: Uint8Array,
  localHeaderOffset: number,
  compressedSize: number,
  method: number
): Uint8Array {
  const LOCAL_SIGNATURE = 0x04034b50;
  if (readUint32(data, localHeaderOffset) !== LOCAL_SIGNATURE) {
    throw new Error("Invalid local file header.");
  }
  const nameLength = readUint16(data, localHeaderOffset + 26);
  const extraLength = readUint16(data, localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const raw = data.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return raw;
  if (method === 8) {
    return inflateRawSync(raw, { maxOutputLength: MAX_DOCX_INFLATED_BYTES });
  }
  throw new Error("Unsupported compression method.");
}

function extractDocxXml(data: Uint8Array): string {
  const eocd = findEndOfCentralDirectory(data);
  if (eocd < 0) throw new Error("Not a ZIP archive.");

  const centralDirOffset = readUint32(data, eocd + 16);
  const entryCount = readUint16(data, eocd + 10);
  const CENTRAL_SIGNATURE = 0x02014b50;

  let pointer = centralDirOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (readUint32(data, pointer) !== CENTRAL_SIGNATURE) {
      throw new Error("Invalid central directory.");
    }
    const method = readUint16(data, pointer + 10);
    const compressedSize = readUint32(data, pointer + 20);
    const nameLength = readUint16(data, pointer + 28);
    const extraLength = readUint16(data, pointer + 30);
    const commentLength = readUint16(data, pointer + 32);
    const localHeaderOffset = readUint32(data, pointer + 42);

    const name = Buffer.from(
      data.subarray(pointer + 46, pointer + 46 + nameLength)
    )
      .toString("ascii")
      .replace(/\\/g, "/");

    if (name === "word/document.xml") {
      const compressed = readZipEntry(
        data,
        localHeaderOffset,
        compressedSize,
        method
      );
      return new TextDecoder("utf-8").decode(compressed);
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("word/document.xml not found.");
}

function safeFromCodePoint(codePoint: number): string {
  if (codePoint < 0 || codePoint > 0x10ffff) return "";
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      safeFromCodePoint(parseInt(dec, 10))
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractWordText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/?>/g, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/?>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^[ \t]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractDocxText(bytes: Uint8Array): string {
  return extractWordText(extractDocxXml(bytes));
}

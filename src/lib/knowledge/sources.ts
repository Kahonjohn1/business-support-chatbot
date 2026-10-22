// Source metadata shared by the API, the message store, and the interface.
//
// Pure and isomorphic: no server-only marker and no filesystem access, so the
// client can validate whatever it receives before rendering it.

import type { ChatSource } from "@/types/chat";

export type { ChatSource };

/** Longest accepted source title or section label. */
export const MAX_SOURCE_TEXT_LENGTH = 200;

/** Document identifiers look like "KB-003". */
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SOURCE_TEXT_LENGTH) return undefined;
  return trimmed;
}

/**
 * Validates one source entry. Returns null when the entry is unusable, so a
 * malformed payload can never put a fabricated title or id on screen.
 */
export function parseSource(value: unknown): ChatSource | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = readText(candidate.id);
  if (!id || !SOURCE_ID_PATTERN.test(id)) return null;
  const title = readText(candidate.title);
  if (!title) return null;
  const section = readText(candidate.section);
  return { id, title, ...(section ? { section } : {}) };
}

/**
 * Validates a list of sources and drops every unusable entry. Returns an empty
 * list when nothing valid remains, so the interface shows no citations rather
 * than broken ones.
 */
export function parseSourceList(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ChatSource[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const source = parseSource(entry);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    sources.push(source);
  }
  return sources;
}

// Approved knowledge-base documents: the explicit allowlist, Markdown parsing,
// and chunking.
//
// Pure module: no filesystem access and no `server-only` marker, so the parsing
// and chunking rules can be unit-tested directly. Reading the files from disk
// is the job of knowledgeService.ts, which is the only module that touches the
// filesystem.

export interface ApprovedDocument {
  /** Stable document identifier, e.g. "KB-003". */
  id: string;
  /** File name inside the knowledge-base directory. */
  fileName: string;
}

/**
 * The seven approved source documents.
 *
 * This is an explicit allowlist on purpose: nothing else in the knowledge-base
 * directory is ever ingested. `manifest.md` is the source manifest (it
 * documents the approval process, not approved content) and is deliberately
 * excluded.
 */
export const APPROVED_DOCUMENTS: readonly ApprovedDocument[] = [
  { id: "KB-001", fileName: "KB-001-company-overview.md" },
  { id: "KB-002", fileName: "KB-002-services.md" },
  { id: "KB-003", fileName: "KB-003-delivery-process.md" },
  { id: "KB-004", fileName: "KB-004-marque-contact-overview.md" },
  { id: "KB-005", fileName: "KB-005-nfc-sharing.md" },
  { id: "KB-006", fileName: "KB-006-contact-card-benefits.md" },
  { id: "KB-007", fileName: "KB-007-pricing-delivery-support.md" },
];

/** Metadata declared in a document's own header. Never invented. */
export interface KnowledgeDocumentMeta {
  id: string;
  title: string;
  /** The original approved source(s), exactly as the document states them. */
  source?: string;
  /** The document version, exactly as stated (may literally say "Not stated"). */
  version?: string;
  /** Publication date, exactly as stated (may literally say "Not stated"). */
  publicationDate?: string;
  status?: string;
}

/** One heading-delimited section of a document. */
export interface KnowledgeSection {
  heading: string;
  text: string;
}

export interface KnowledgeDocument {
  id: string;
  fileName: string;
  title: string;
  meta: KnowledgeDocumentMeta;
  sections: KnowledgeSection[];
}

/** A retrievable unit of text that keeps its document, title, and section. */
export interface KnowledgeChunk {
  documentId: string;
  documentTitle: string;
  section: string;
  text: string;
  /** Position of the chunk inside the document (stable ordering). */
  index: number;
}

/** Largest chunk produced from a section before it is split further. */
export const MAX_CHUNK_CHARS = 700;

// "- **Document ID:** KB-001" and "- Source: some.pdf" are both accepted.
const METADATA_LINE =
  /^-\s+\*{0,2}\s*(Document ID|Source|Version|Publication Date|Status)\s*:?\s*\*{0,2}\s*(.*)$/i;

function applyMetadata(
  meta: Partial<Omit<KnowledgeDocumentMeta, "id" | "title">>,
  label: string,
  value: string
): void {
  const text = value.trim();
  if (!text) return;
  switch (label.toLowerCase()) {
    case "document id":
      // The allowlist owns the identifier; a conflicting declaration is ignored
      // rather than allowed to rename the document.
      break;
    case "source":
      meta.source = text;
      break;
    case "version":
      meta.version = text;
      break;
    case "publication date":
      meta.publicationDate = text;
      break;
    case "status":
      meta.status = text;
      break;
  }
}

/** Removes a leading "KB-002 — " style prefix from a document title. */
function normalizeTitle(title: string, id: string): string {
  const trimmed = title.trim();
  if (!trimmed) return id;
  const withoutId = trimmed
    .replace(new RegExp(`^${id}\\s*[—–-]\\s*`, "i"), "")
    .trim();
  return withoutId || trimmed;
}

/**
 * Parses one approved Markdown document into its metadata and sections.
 * Metadata is only recorded when the document states it; nothing is inferred.
 */
export function parseKnowledgeDocument(
  id: string,
  fileName: string,
  markdown: string
): KnowledgeDocument {
  const lines = markdown.split(/\r?\n/);
  let rawTitle = "";
  const meta: Partial<Omit<KnowledgeDocumentMeta, "id" | "title">> = {};
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level === 1) {
        rawTitle = text;
        continue;
      }
      current = { heading: text, lines: [] };
      sections.push(current);
      continue;
    }

    const metadata = METADATA_LINE.exec(line);
    if (metadata) {
      applyMetadata(meta, metadata[1], metadata[2]);
      continue;
    }

    if (!current) continue;
    current.lines.push(line);
  }

  const title = normalizeTitle(rawTitle, id);
  const parsedSections: KnowledgeSection[] = [];
  for (const section of sections) {
    const text = section.lines.join("\n").trim();
    if (text) parsedSections.push({ heading: section.heading, text });
  }

  return {
    id,
    fileName,
    title,
    meta: { id, title, ...meta },
    sections: parsedSections,
  };
}

/** Splits a long block into sentence-sized pieces that fit the size budget. */
function splitBySentences(text: string, maxChars: number): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const result: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxChars) {
      result.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChars) {
      if (current) {
        result.push(current.trim());
        current = "";
      }
      result.push(sentence.slice(0, maxChars).trim());
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/** Splits a section into paragraph-sized chunks within the size budget. */
function splitIntoChunks(text: string, maxChars: number): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const result: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length > 0) {
      result.push(current.join("\n\n"));
      current = [];
      currentLength = 0;
    }
  };

  for (const block of blocks) {
    if (block.length > maxChars) {
      flush();
      result.push(...splitBySentences(block, maxChars));
      continue;
    }
    if (currentLength + block.length + 2 > maxChars) flush();
    current.push(block);
    currentLength += block.length + 2;
  }
  flush();
  return result;
}

/**
 * Splits a document into retrievable chunks. Every chunk keeps the document
 * id, the document title, and the section it came from.
 */
export function chunkKnowledgeDocument(
  document: KnowledgeDocument
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let index = 0;
  for (const section of document.sections) {
    for (const text of splitIntoChunks(section.text, MAX_CHUNK_CHARS)) {
      chunks.push({
        documentId: document.id,
        documentTitle: document.title,
        section: section.heading,
        text,
        index: index++,
      });
    }
  }
  return chunks;
}

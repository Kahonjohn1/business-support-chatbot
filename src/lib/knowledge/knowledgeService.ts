// Server-side access to the approved knowledge base.
//
// This is the only module that touches the filesystem. It reads the seven
// approved Markdown documents listed in the allowlist, parses and chunks them,
// and answers questions with the passages that are actually relevant.
//
// Filesystem access keeps this module on the server: `node:fs` cannot be
// bundled for the browser, so nothing here can leak into the client bundle.

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  APPROVED_DOCUMENTS,
  chunkKnowledgeDocument,
  parseKnowledgeDocument,
} from "@/lib/knowledge/knowledgeBase";
import type { KnowledgeChunk, KnowledgeDocument } from "@/lib/knowledge/knowledgeBase";
import {
  selectPassages,
} from "@/lib/knowledge/retrieval";
import type { GroundingPassage, RetrievalOptions } from "@/lib/knowledge/retrieval";

/** Directory (relative to the project root) that holds the approved documents. */
export const KNOWLEDGE_BASE_DIR_NAME = "knowledge-base";

export interface KnowledgeRetrieval {
  /** The passages that support an answer, most relevant first. */
  passages: GroundingPassage[];
  /** Identifiers of the documents those passages came from. */
  documentIds: string[];
}

interface KnowledgeCache {
  directory: string;
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
}

let cache: KnowledgeCache | null = null;

/**
 * Resolves the knowledge-base directory from the project root. The path is
 * always built from the fixed directory name, so it can never escape the
 * project root.
 *
 * The production path is a literal subfolder of the working directory: a
 * computed path would make the bundler trace the whole project instead of just
 * the knowledge-base files.
 */
export function resolveKnowledgeBaseDir(rootDir?: string): string {
  if (rootDir === undefined) {
    return path.join(process.cwd(), "knowledge-base");
  }
  const root = path.resolve(rootDir);
  const directory = path.resolve(root, KNOWLEDGE_BASE_DIR_NAME);
  if (directory !== root && !directory.startsWith(root + path.sep)) {
    throw new Error("The knowledge base directory is outside the project root.");
  }
  return directory;
}

/**
 * Reads the approved documents from disk.
 *
 * A missing or unreadable file is skipped instead of failing the request: the
 * chat must keep working even when the knowledge base is incomplete.
 */
export async function loadApprovedDocuments(
  rootDir?: string
): Promise<KnowledgeDocument[]> {
  const directory = resolveKnowledgeBaseDir(rootDir);
  const documents: KnowledgeDocument[] = [];

  for (const entry of APPROVED_DOCUMENTS) {
    const filePath = path.join(/*turbopackIgnore: true*/ directory, entry.fileName);
    if (!filePath.startsWith(directory + path.sep)) continue;
    try {
      const markdown = await readFile(filePath, "utf8");
      documents.push(parseKnowledgeDocument(entry.id, entry.fileName, markdown));
    } catch {
      // Missing or unreadable file: skip it, never crash the chat.
    }
  }

  return documents;
}

/** Drops the in-memory copy of the knowledge base (used by the tests). */
export function clearKnowledgeCache(): void {
  cache = null;
}

async function getKnowledgeCache(rootDir?: string): Promise<KnowledgeCache> {
  const directory = resolveKnowledgeBaseDir(rootDir);
  if (cache && cache.directory === directory) return cache;

  const documents = await loadApprovedDocuments(rootDir);
  const chunks = documents.flatMap(chunkKnowledgeDocument);
  cache = { directory, documents, chunks };
  return cache;
}

/**
 * Returns the retrievable chunks of the approved knowledge base.
 * The documents are read once and reused for the lifetime of the process.
 */
export async function getKnowledgeChunks(
  rootDir?: string
): Promise<KnowledgeChunk[]> {
  return (await getKnowledgeCache(rootDir)).chunks;
}

/**
 * Retrieves the passages that support an answer to the question.
 *
 * Returns no passages when nothing in the approved knowledge base is relevant,
 * so the assistant can say that the answer is undocumented instead of guessing.
 */
export async function retrieveKnowledge(
  query: string,
  options: RetrievalOptions & { rootDir?: string } = {}
): Promise<KnowledgeRetrieval> {
  const chunks = await getKnowledgeChunks(options.rootDir);
  const passages = selectPassages(chunks, query, options);
  return {
    passages,
    documentIds: passages.map((passage) => passage.documentId),
  };
}

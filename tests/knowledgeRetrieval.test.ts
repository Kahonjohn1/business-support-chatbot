import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearKnowledgeCache,
  getKnowledgeChunks,
  loadApprovedDocuments,
  resolveKnowledgeBaseDir,
  retrieveKnowledge,
} from "../src/lib/knowledge/knowledgeService.ts";
import {
  selectPassages,
  tokensMatch,
} from "../src/lib/knowledge/retrieval.ts";

// Retrieval runs against the real approved documents in knowledge-base/ so the
// behaviour the user sees is the behaviour under test. No network is used.

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

test("the knowledge base directory resolves inside the project root", () => {
  const directory = resolveKnowledgeBaseDir(projectRoot);
  assert.equal(path.basename(directory), "knowledge-base");
  assert.ok(directory.startsWith(projectRoot));
});

test("every approved document is read and parsed", async () => {
  const documents = await loadApprovedDocuments(projectRoot);
  assert.equal(documents.length, 7);
  assert.deepEqual(
    documents.map((document) => document.id),
    ["KB-001", "KB-002", "KB-003", "KB-004", "KB-005", "KB-006", "KB-007"]
  );
  for (const document of documents) {
    assert.ok(document.sections.length > 0);
    for (const section of document.sections) {
      assert.ok(section.text.trim().length > 0);
    }
  }
});

test("a missing knowledge base yields no documents instead of an error", async () => {
  const documents = await loadApprovedDocuments(
    path.join(projectRoot, "tests", "fixtures", "no-knowledge-base")
  );
  assert.deepEqual(documents, []);
});

test("a missing knowledge base yields no passages instead of an error", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge("What is Marque Contact?", {
    rootDir: path.join(projectRoot, "tests", "fixtures", "no-knowledge-base"),
  });
  assert.deepEqual(retrieval.passages, []);
  assert.deepEqual(retrieval.documentIds, []);
  clearKnowledgeCache();
});

test("a Marque Contact question retrieves the product documents", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge("What is Marque Contact?", {
    rootDir: projectRoot,
  });

  assert.ok(retrieval.passages.length > 0);
  assert.ok(retrieval.documentIds.includes("KB-004"));
  const passage = retrieval.passages[0];
  assert.equal(passage.documentId, "KB-004");
  assert.ok(passage.section.length > 0);
  assert.ok(passage.text.toLowerCase().includes("marque contact"));
});

test("a delivery question retrieves the delivery process document and section", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(
    "How does Marque Technologies deliver a project?",
    { rootDir: projectRoot }
  );

  assert.ok(retrieval.documentIds.includes("KB-003"));
  const passage = retrieval.passages.find(
    (entry) => entry.documentId === "KB-003"
  );
  assert.ok(passage);
  assert.ok(
    passage.sections.some((section) => section.toLowerCase().includes("discover")),
    `expected a delivery stage, got ${passage.sections.join(", ")}`
  );
});

test("a services question retrieves the services document", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(
    "What services does Marque Technologies offer?",
    { rootDir: projectRoot }
  );

  assert.ok(retrieval.documentIds.includes("KB-002"));
});

test("an unrelated question retrieves no company content", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(
    "Can you write me a Python function that sorts a list?",
    { rootDir: projectRoot }
  );

  assert.deepEqual(retrieval.passages, []);
});

test("a general troubleshooting question retrieves no company content", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(
    "My website does not load, what should I check?",
    { rootDir: projectRoot }
  );

  assert.deepEqual(retrieval.passages, []);
});

test("retrieval is deterministic", async () => {
  clearKnowledgeCache();
  const first = await retrieveKnowledge("What is Marque Contact?", {
    rootDir: projectRoot,
  });
  const second = await retrieveKnowledge("What is Marque Contact?", {
    rootDir: projectRoot,
  });

  assert.deepEqual(
    first.passages.map((passage) => `${passage.documentId}:${passage.section}`),
    second.passages.map((passage) => `${passage.documentId}:${passage.section}`)
  );
});

test("near matching terms are recognised, unrelated terms are not", () => {
  assert.equal(tokensMatch("price", "price"), true);
  assert.equal(tokensMatch("card", "cards"), true);
  assert.equal(tokensMatch("app", "application"), true);
  assert.equal(tokensMatch("nfc", "near"), false);
  assert.equal(tokensMatch("price", "place"), false);
});

test("an empty query selects nothing", async () => {
  const chunks = await getKnowledgeChunks(projectRoot);
  assert.deepEqual(selectPassages(chunks, ""), []);
  assert.deepEqual(selectPassages(chunks, "   "), []);
});

test("no chunks select nothing", () => {
  assert.deepEqual(selectPassages([], "What is Marque Contact?"), []);
});

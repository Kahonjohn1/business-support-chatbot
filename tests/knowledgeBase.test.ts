import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APPROVED_DOCUMENTS,
  chunkKnowledgeDocument,
  parseKnowledgeDocument,
} from "../src/lib/knowledge/knowledgeBase.ts";

// The knowledge-base documents are the only approved source of company facts.
// These tests pin the parsing rules: what is read, what is never invented, and
// what the allowlist permits.

const KB_001 = `# Marque Technologies — Company Overview

- **Document ID:** KB-001
- **Source:** Marque Technologies Profile.pdf
- **Version:** Not stated in the source documents
- **Publication date:** Not stated in the source documents
- **Status:** Derived from approved source documents

## Overview

Marque Technologies is an African-focused smart digital products company.

## Knowledge Boundaries

- The source documents do not state a publication date or document version.
`;

test("the allowlist contains exactly the seven approved documents", () => {
  assert.equal(APPROVED_DOCUMENTS.length, 7);
  assert.deepEqual(
    APPROVED_DOCUMENTS.map((entry) => entry.id),
    ["KB-001", "KB-002", "KB-003", "KB-004", "KB-005", "KB-006", "KB-007"]
  );
});

test("the source manifest is not an approved document", () => {
  const files = APPROVED_DOCUMENTS.map((entry) => entry.fileName);
  assert.ok(!files.includes("manifest.md"));
});

test("a document keeps its stated metadata and sections", () => {
  const document = parseKnowledgeDocument(
    "KB-001",
    "KB-001-company-overview.md",
    KB_001
  );

  assert.equal(document.id, "KB-001");
  assert.equal(document.title, "Marque Technologies — Company Overview");
  assert.equal(document.meta.source, "Marque Technologies Profile.pdf");
  assert.equal(document.meta.version, "Not stated in the source documents");
  assert.equal(
    document.meta.publicationDate,
    "Not stated in the source documents"
  );
  assert.equal(
    document.meta.status,
    "Derived from approved source documents"
  );
  assert.deepEqual(
    document.sections.map((section) => section.heading),
    ["Overview", "Knowledge Boundaries"]
  );
});

test("a document that states no metadata leaves the fields undefined", () => {
  const document = parseKnowledgeDocument(
    "KB-007",
    "KB-007-pricing-delivery-support.md",
    "# KB-007 — Marque Contact Pricing, Delivery, and Support\n\n## Pricing\nPricing is tailored to requirements.\n"
  );

  assert.equal(document.meta.source, undefined);
  assert.equal(document.meta.version, undefined);
  assert.equal(document.meta.publicationDate, undefined);
  assert.equal(document.meta.status, undefined);
  assert.equal(document.title, "Marque Contact Pricing, Delivery, and Support");
});

test("metadata is never invented when a document omits it", () => {
  const document = parseKnowledgeDocument(
    "KB-002",
    "KB-002-services.md",
    "# Services\n\n## Website Development\nWe build websites.\n"
  );

  assert.equal(document.meta.version, undefined);
  assert.equal(document.meta.publicationDate, undefined);
  assert.equal(document.meta.source, undefined);
});

test("every chunk keeps its document, section, and position", () => {
  const document = parseKnowledgeDocument(
    "KB-002",
    "KB-002-services.md",
    "# Services\n\n## Website Development\nWe build websites.\n\n## Mobile Apps\nWe build mobile apps.\n"
  );
  const chunks = chunkKnowledgeDocument(document);

  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((chunk) => chunk.section),
    ["Website Development", "Mobile Apps"]
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.index),
    [0, 1]
  );
  for (const chunk of chunks) {
    assert.equal(chunk.documentId, "KB-002");
    assert.equal(chunk.documentTitle, "Services");
    assert.ok(chunk.text.length > 0);
  }
});

test("a long section is split into chunks that keep the same section", () => {
  const sentence =
    "Marque Technologies builds intelligent digital solutions for businesses across Africa. ";
  const long = sentence.repeat(12);
  const document = parseKnowledgeDocument(
    "KB-003",
    "KB-003-delivery-process.md",
    `# Delivery\n\n## Discover\n${long}\n`
  );
  const chunks = chunkKnowledgeDocument(document);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.equal(chunk.section, "Discover");
    assert.ok(chunk.text.length <= 700);
  }
});

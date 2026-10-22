import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearKnowledgeCache,
  retrieveKnowledge,
} from "../src/lib/knowledge/knowledgeService.ts";
import {
  buildGroundedAnswer,
  buildReferenceMaterial,
  isCompanyQuestion,
} from "../src/lib/knowledge/grounding.ts";

// Regression: the four-stages question used to be refused. The document was
// loaded and its chunks matched the question, but the relevance gate counted
// the task framing ("explain each stage using the approved knowledge base and
// show your sources") as question content and then judged only the
// highest-scoring chunk, so the passage that actually covers the question was
// never considered. The answer was refused and the chatbot claimed the
// knowledge base did not document the delivery process.

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const QUERY =
  "What are the four stages of Marque Technologies' project delivery process? Explain each stage using the approved knowledge base and show your sources.";

const STAGES = [
  "1. Discover",
  "2. Co-design",
  "3. Build and Test",
  "4. Launch and Scale",
];

function stageOrder(text: string): number[] {
  return STAGES.map((stage) => text.indexOf(stage));
}

test("the four-stages question is treated as a company question", () => {
  assert.equal(isCompanyQuestion(QUERY), true);
});

test("the four-stages question retrieves the delivery document", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(QUERY, { rootDir: projectRoot });

  assert.ok(
    retrieval.documentIds.includes("KB-003"),
    `expected KB-003 in ${retrieval.documentIds.join(", ")}`
  );

  const delivery = retrieval.passages.find(
    (passage) => passage.documentId === "KB-003"
  );
  assert.ok(delivery);
  assert.equal(delivery.documentTitle, "Project Delivery Process");
});

test("the retrieved evidence contains the four stages in order", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(QUERY, { rootDir: projectRoot });

  const delivery = retrieval.passages.find(
    (passage) => passage.documentId === "KB-003"
  );
  assert.ok(delivery);

  const stages = delivery.sections.filter((section) =>
    /^\d+\.\s/.test(section)
  );
  assert.deepEqual(stages, STAGES);

  // The stages must also appear in the evidence in that order.
  const positions = stageOrder(delivery.text);
  assert.ok(
    positions.every((position) => position >= 0),
    `a stage is missing from the evidence: ${positions.join(", ")}`
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    "the stages are not in order"
  );
});

test("the answer lists the four stages in order and cites KB-003", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(QUERY, { rootDir: projectRoot });

  const delivery = retrieval.passages.find(
    (passage) => passage.documentId === "KB-003"
  );
  assert.ok(delivery);

  // The reference material is what the model is given to answer from.
  const referenceMaterial = buildReferenceMaterial(retrieval.passages);
  assert.match(referenceMaterial, /1\. Discover/);
  assert.match(referenceMaterial, /4\. Launch and Scale/);

  // Stand in for the model: it answers from the evidence it was given.
  const stages = delivery.sections.filter((section) =>
    /^\d+\.\s/.test(section)
  );
  const reply = [
    "Marque Technologies' project delivery process has four stages:",
    ...stages.map(
      (stage, index) =>
        `${index + 1}. ${stage.replace(/^\d+\.\s*/, "")}: ${delivery.text
          .split(`[${stage}]`)[1]
          ?.split("\n\n")[0]
          ?.trim() ?? ""}`
    ),
    "",
    "Sources: KB-003",
  ].join("\n");

  const answer = buildGroundedAnswer(
    reply,
    retrieval.passages,
    QUERY,
    isCompanyQuestion(QUERY)
  );

  assert.equal(answer.insufficientEvidence, false);
  assert.ok(
    answer.sources.some((source) => source.id === "KB-003"),
    `expected KB-003 in ${answer.sources.map((s) => s.id).join(", ")}`
  );
  const cited = answer.sources.find((source) => source.id === "KB-003");
  assert.ok(cited);
  assert.equal(cited.title, "Project Delivery Process");

  const positions = stageOrder(answer.content);
  assert.ok(
    positions.every((position) => position >= 0),
    `the answer is missing a stage: ${positions.join(", ")}`
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    "the answer does not list the stages in order"
  );
});

test("the task framing does not change which documents are retrieved", async () => {
  clearKnowledgeCache();
  const withFraming = await retrieveKnowledge(QUERY, { rootDir: projectRoot });
  const withoutFraming = await retrieveKnowledge(
    "What are the four stages of Marque Technologies' project delivery process?",
    { rootDir: projectRoot }
  );

  assert.deepEqual(
    withFraming.documentIds,
    withoutFraming.documentIds
  );
  assert.ok(withFraming.documentIds.includes("KB-003"));
});

test("an unrelated question still retrieves no company content", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(
    "Can you write me a Python function that sorts a list?",
    { rootDir: projectRoot }
  );

  assert.deepEqual(retrieval.passages, []);
});

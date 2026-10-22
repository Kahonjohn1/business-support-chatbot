// Stage 1 retrieval evaluation harness.
//
// Runs the labelled question set against the real approved documents and
// reports how the retriever performs. No network, no embeddings, no changes to
// the retrieval algorithm: this measures the current lexical behaviour so a
// later change can be compared against it.
//
// Metrics (computed over the answerable cases):
// - precision@1: the first retrieved document is the gold document, or one of
//   the accepted alternatives for that question.
// - recall@3: the gold document is among the retrieved documents (at most
//   three documents are returned).
// - section accuracy: the gold document was retrieved and its passage carries
//   the expected section.
// - no-evidence false positives: an unrelated question that pulled a company
//   document into the answer.
// - missed gold documents: an answerable question whose gold document was not
//   retrieved at all. These are listed one by one.
//
// The measured numbers are stored in tests/knowledgeEvalBaseline.json. The
// baseline is a floor, not a target: retrieval may improve, but it must not
// silently lose answers it currently finds. Record a new baseline on purpose
// with: npm run eval:retrieval:record

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clearKnowledgeCache,
  retrieveKnowledge,
} from "../src/lib/knowledge/knowledgeService.ts";
import { EVAL_CASES } from "./knowledgeEvalCases.ts";
import {
  formatReport,
  projectRoot,
  readBaseline,
  runEvaluation,
  totalsOf,
} from "./knowledgeEvalRunner.ts";

/** Slack for the floating-point comparison against the recorded baseline. */
const TOLERANCE = 1e-9;

test("the evaluation set is well formed", () => {
  const ids = new Set<string>();
  for (const evalCase of EVAL_CASES) {
    assert.ok(!ids.has(evalCase.id), `duplicate case id: ${evalCase.id}`);
    ids.add(evalCase.id);
    assert.ok(evalCase.query.trim().length > 0, `${evalCase.id} has no query`);
    if (evalCase.expectEvidence) {
      assert.ok(
        evalCase.goldDocumentId,
        `${evalCase.id} expects evidence but names no gold document`
      );
    } else {
      assert.equal(
        evalCase.goldDocumentId,
        undefined,
        `${evalCase.id} expects no evidence but names a gold document`
      );
    }
  }
  assert.ok(
    EVAL_CASES.length >= 40,
    "the evaluation set should hold 40+ cases"
  );
  for (const category of [
    "exact",
    "paraphrase",
    "services",
    "marque-contact",
    "delivery",
    "pricing",
    "unrelated",
    "technical",
  ]) {
    assert.ok(
      EVAL_CASES.some((evalCase) => evalCase.category === category),
      `the evaluation set has no ${category} cases`
    );
  }
});

test("retrieval evaluation baseline", async () => {
  const outcomes = await runEvaluation();
  const totals = totalsOf(outcomes);
  console.log(formatReport(outcomes, totals));

  const baseline = readBaseline();
  assert.ok(baseline, "tests/knowledgeEvalBaseline.json is missing");
  assert.ok(
    Object.keys(baseline.cases).length > 0,
    "the baseline has no recorded cases"
  );

  assert.ok(
    totals.top1Hits / totals.answerable >=
      baseline.metrics.precisionAt1 - TOLERANCE,
    `precision@1 dropped below the baseline of ${baseline.metrics.precisionAt1}`
  );
  assert.ok(
    totals.goldHits / totals.answerable >= baseline.metrics.recallAt3 - TOLERANCE,
    `recall@3 dropped below the baseline of ${baseline.metrics.recallAt3}`
  );
  assert.ok(
    totals.sectionHits / totals.sectionChecked >=
      baseline.metrics.sectionAccuracy - TOLERANCE,
    `section accuracy dropped below the baseline of ${baseline.metrics.sectionAccuracy}`
  );
  assert.ok(
    totals.falsePositives <= baseline.metrics.falsePositives,
    `no-evidence false positives rose above the baseline of ${baseline.metrics.falsePositives}`
  );

  // A case that currently finds its gold document must keep finding it, and a
  // question that currently retrieves nothing must keep retrieving nothing.
  const byId = new Map(outcomes.map((o) => [o.evalCase.id, o]));
  for (const [id, recorded] of Object.entries(baseline.cases)) {
    const outcome = byId.get(id);
    assert.ok(outcome, `the baseline knows a case that no longer exists: ${id}`);
    if (recorded.hit) {
      assert.ok(
        outcome.goldHit,
        `${id} no longer retrieves ${outcome.evalCase.goldDocumentId}`
      );
    }
    if (!outcome.evalCase.expectEvidence && recorded.documents.length === 0) {
      assert.deepEqual(
        outcome.documentIds,
        [],
        `${id} now retrieves company content for an unrelated question`
      );
    }
  }
});

test("regression: the framed delivery question retrieves all four stages", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(
    "What are the four stages of Marque Technologies' project delivery process? Explain each stage using the approved knowledge base and show your sources.",
    { rootDir: projectRoot }
  );

  assert.ok(
    retrieval.documentIds.includes("KB-003"),
    `expected KB-003, retrieved ${retrieval.documentIds.join(", ") || "nothing"}`
  );
  const passage = retrieval.passages.find(
    (entry) => entry.documentId === "KB-003"
  );
  assert.ok(passage);
  for (const stage of [
    "1. Discover",
    "2. Co-design",
    "3. Build and Test",
    "4. Launch and Scale",
  ]) {
    assert.ok(
      passage.sections.includes(stage),
      `expected stage "${stage}", got ${passage.sections.join(", ")}`
    );
  }
});

test("regression: an unrelated Python question retrieves no company content", async () => {
  clearKnowledgeCache();
  const retrieval = await retrieveKnowledge(
    "Can you write me a Python function that sorts a list?",
    { rootDir: projectRoot }
  );

  assert.deepEqual(retrieval.passages, []);
  assert.deepEqual(retrieval.documentIds, []);
});

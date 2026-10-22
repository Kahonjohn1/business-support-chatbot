// Shared evaluation runner for the Stage 1 retrieval evaluation.
//
// Kept separate from the test file so the same code can produce the report and
// record the baseline snapshot. Nothing here talks to the network or changes
// how retrieval works: it only runs the labelled questions against the real
// approved documents.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearKnowledgeCache,
  retrieveKnowledge,
} from "../src/lib/knowledge/knowledgeService.ts";
import type { RetrievalOptions } from "../src/lib/knowledge/retrieval.ts";
import { EVAL_CASES } from "./knowledgeEvalCases.ts";
import type { EvalCase } from "./knowledgeEvalCases.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(testsDir, "..");
export const baselinePath = path.join(testsDir, "knowledgeEvalBaseline.json");

export interface BaselineCase {
  /** The gold document was retrieved. */
  hit: boolean;
  /** The gold or an accepted document was retrieved first. */
  top1: boolean;
  /** The expected section was found in the gold passage. */
  section: boolean | null;
  /** Documents that were retrieved, in order. */
  documents: string[];
}

export interface Baseline {
  recordedAt: string;
  description?: string;
  metrics: {
    precisionAt1: number;
    recallAt3: number;
    sectionAccuracy: number;
    falsePositives: number;
  };
  cases: Record<string, BaselineCase>;
}

export interface Outcome {
  evalCase: EvalCase;
  documentIds: string[];
  /** Gold document retrieved. */
  goldHit: boolean;
  /** First retrieved document is the gold document or an accepted one. */
  top1Hit: boolean;
  /** Expected section present in the gold passage; null when not checked. */
  sectionHit: boolean | null;
}

export interface Totals {
  answerable: number;
  noEvidence: number;
  top1Hits: number;
  goldHits: number;
  sectionChecked: number;
  sectionHits: number;
  falsePositives: number;
}

function hasSectionExpectation(evalCase: EvalCase): boolean {
  return Boolean(
    evalCase.expectedSections?.length ||
      evalCase.requiredSections?.length ||
      evalCase.acceptableSections?.length
  );
}

function sectionSatisfied(evalCase: EvalCase, sections: string[]): boolean {
  const present = new Set(sections);
  if (
    evalCase.requiredSections &&
    !evalCase.requiredSections.every((section) => present.has(section))
  ) {
    return false;
  }
  const wanted = [
    ...(evalCase.expectedSections ?? []),
    ...(evalCase.acceptableSections ?? []),
  ];
  if (wanted.length === 0) return true;
  return wanted.some((section) => present.has(section));
}

/**
 * Runs every labelled question against the approved documents.
 *
 * The retrieval options are passed straight through, so the same questions can
 * be measured under different thresholds without editing the retriever.
 */
export async function runEvaluation(
  options: RetrievalOptions = {}
): Promise<Outcome[]> {
  clearKnowledgeCache();
  const outcomes: Outcome[] = [];

  for (const evalCase of EVAL_CASES) {
    const retrieval = await retrieveKnowledge(evalCase.query, {
      rootDir: projectRoot,
      ...options,
    });
    const documentIds = retrieval.documentIds;
    const goldDocumentId = evalCase.goldDocumentId;
    const goldHit = goldDocumentId
      ? documentIds.includes(goldDocumentId)
      : false;

    const accepted = new Set([
      ...(goldDocumentId ? [goldDocumentId] : []),
      ...(evalCase.acceptableDocumentIds ?? []),
    ]);
    const top1Hit = documentIds.length > 0 && accepted.has(documentIds[0]);

    let sectionHit: boolean | null = null;
    if (hasSectionExpectation(evalCase)) {
      const goldPassage = goldDocumentId
        ? retrieval.passages.find(
            (passage) => passage.documentId === goldDocumentId
          )
        : undefined;
      sectionHit = goldPassage
        ? sectionSatisfied(evalCase, goldPassage.sections)
        : false;
    }

    outcomes.push({ evalCase, documentIds, goldHit, top1Hit, sectionHit });
  }

  return outcomes;
}

export function totalsOf(outcomes: Outcome[]): Totals {
  const answerable = outcomes.filter((o) => o.evalCase.expectEvidence);
  const noEvidence = outcomes.filter((o) => !o.evalCase.expectEvidence);
  const sectionChecked = answerable.filter((o) => o.sectionHit !== null);
  return {
    answerable: answerable.length,
    noEvidence: noEvidence.length,
    top1Hits: answerable.filter((o) => o.top1Hit).length,
    goldHits: answerable.filter((o) => o.goldHit).length,
    sectionChecked: sectionChecked.length,
    sectionHits: sectionChecked.filter((o) => o.sectionHit === true).length,
    falsePositives: noEvidence.filter((o) => o.documentIds.length > 0).length,
  };
}

export function ratio(part: number, total: number): string {
  if (total === 0) return "n/a";
  return `${part}/${total} = ${((part / total) * 100).toFixed(1)}%`;
}

/** Builds the human-readable report printed by the harness. */
export function formatReport(outcomes: Outcome[], totals: Totals): string {
  const misses = outcomes.filter(
    (o) => o.evalCase.expectEvidence && !o.goldHit
  );
  const falsePositives = outcomes.filter(
    (o) => !o.evalCase.expectEvidence && o.documentIds.length > 0
  );
  const rankedLower = outcomes.filter((o) => o.goldHit && !o.top1Hit);

  const lines: string[] = [];
  lines.push("=== Retrieval evaluation ===");
  lines.push(
    `cases: ${outcomes.length} (answerable ${totals.answerable}, no-evidence ${totals.noEvidence})`
  );
  lines.push("");
  lines.push(
    `precision@1 (top-1 document is the gold or an accepted one): ${ratio(totals.top1Hits, totals.answerable)}`
  );
  lines.push(
    `recall@3    (gold document among the retrieved documents):  ${ratio(totals.goldHits, totals.answerable)}`
  );
  lines.push(
    `section accuracy (expected section in the gold passage):    ${ratio(totals.sectionHits, totals.sectionChecked)}`
  );
  lines.push(
    `no-evidence false positives: ${ratio(totals.falsePositives, totals.noEvidence)}`
  );
  lines.push("");

  lines.push(`missed gold documents (${misses.length}):`);
  if (misses.length === 0) {
    lines.push("  none");
  } else {
    for (const miss of misses) {
      lines.push(
        `  - [${miss.evalCase.category}] ${miss.evalCase.id}: ${miss.evalCase.query}`
      );
      lines.push(
        `      expected ${miss.evalCase.goldDocumentId}, retrieved ${miss.documentIds.join(", ") || "nothing"}`
      );
    }
  }
  lines.push("");

  lines.push(`no-evidence false positives (${falsePositives.length}):`);
  if (falsePositives.length === 0) {
    lines.push("  none");
  } else {
    for (const falsePositive of falsePositives) {
      lines.push(
        `  - [${falsePositive.evalCase.category}] ${falsePositive.evalCase.id}: ${falsePositive.evalCase.query}`
      );
      lines.push(`      retrieved ${falsePositive.documentIds.join(", ")}`);
    }
  }
  lines.push("");

  lines.push(
    `gold document found but not ranked first (${rankedLower.length}):`
  );
  if (rankedLower.length === 0) {
    lines.push("  none");
  } else {
    for (const lower of rankedLower) {
      lines.push(
        `  - ${lower.evalCase.id}: retrieved ${lower.documentIds.join(", ")}`
      );
    }
  }
  lines.push("");

  lines.push("by category:");
  const categories = [...new Set(outcomes.map((o) => o.evalCase.category))];
  for (const category of categories) {
    const group = outcomes.filter((o) => o.evalCase.category === category);
    const groupAnswerable = group.filter((o) => o.evalCase.expectEvidence);
    const groupTop1 = groupAnswerable.filter((o) => o.top1Hit).length;
    const groupGold = groupAnswerable.filter((o) => o.goldHit).length;
    const groupNoEvidence = group.length - groupAnswerable.length;
    const groupFalsePositives = group.filter(
      (o) => !o.evalCase.expectEvidence && o.documentIds.length > 0
    ).length;
    lines.push(
      `  ${category.padEnd(15)} cases ${String(group.length).padStart(2)} | precision@1 ${ratio(groupTop1, groupAnswerable.length)} | recall@3 ${ratio(groupGold, groupAnswerable.length)} | false positives ${groupFalsePositives}/${groupNoEvidence}`
    );
  }

  return lines.join("\n");
}

export function readBaseline(): Baseline | null {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

/**
 * Ratio rounded down, so the recorded baseline is a floor the current results
 * can never fall below because of rounding.
 */
export function floorRatio(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.floor((part / total) * 10000) / 10000;
}

/** Records the current results as the baseline the harness compares against. */
export function writeBaseline(outcomes: Outcome[], totals: Totals): void {
  const baseline: Baseline = {
    recordedAt: new Date().toISOString().slice(0, 10),
    description:
      "Baseline of the lexical retriever over tests/knowledgeEvalCases.ts. Regenerate with: npm run eval:retrieval:record",
    metrics: {
      precisionAt1: floorRatio(totals.top1Hits, totals.answerable),
      recallAt3: floorRatio(totals.goldHits, totals.answerable),
      sectionAccuracy: floorRatio(totals.sectionHits, totals.sectionChecked),
      falsePositives: totals.falsePositives,
    },
    cases: Object.fromEntries(
      outcomes.map((outcome) => [
        outcome.evalCase.id,
        {
          hit: outcome.goldHit,
          top1: outcome.top1Hit,
          section: outcome.sectionHit,
          documents: outcome.documentIds,
        },
      ])
    ),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

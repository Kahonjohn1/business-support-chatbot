// Records the current retrieval results as the evaluation baseline.
//
// Run it on purpose after an intentional retrieval change:
//   npm run eval:retrieval:record
//
// It prints the same report as the harness and writes the measured numbers
// and per-case outcomes to tests/knowledgeEvalBaseline.json.

import {
  formatReport,
  runEvaluation,
  totalsOf,
  writeBaseline,
} from "./knowledgeEvalRunner.ts";

async function main(): Promise<void> {
  const outcomes = await runEvaluation();
  const totals = totalsOf(outcomes);
  console.log(formatReport(outcomes, totals));
  writeBaseline(outcomes, totals);
  console.log("\nbaseline recorded in tests/knowledgeEvalBaseline.json");
}

main();

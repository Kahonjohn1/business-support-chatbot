import { test } from "node:test";
import assert from "node:assert/strict";

import { formatApprovalOutcome } from "../src/lib/approvalOutcome.ts";

test("a successful task creation reports the task that was created", () => {
  const report = formatApprovalOutcome({
    status: "executed",
    approvalId: "appr_test",
    result: {
      status: "executed",
      sampleData: true,
      projectName: "Business Support Chatbot",
      task: {
        title: "Prepare launch checklist",
      },
    },
  });

  assert.match(report, /Prepare launch checklist/);
  assert.match(report, /Business Support Chatbot/);
  assert.doesNotMatch(report, /TSK-/);
  assert.doesNotMatch(report, /PRJ-/);
  assert.match(report, /sample demo data/i);
});

test("a rejection states that no changes were made", () => {
  const report = formatApprovalOutcome({
    status: "rejected",
    approvalId: "appr_test",
  });

  assert.match(report, /rejected/i);
  assert.match(report, /No changes were made/);
});

test("a failed operation reports the reason and confirms no changes", () => {
  const report = formatApprovalOutcome({
    status: "failed",
    approvalId: "appr_test",
    error: "The approved operation arguments are invalid.",
  });

  assert.match(report, /could not be completed/);
  assert.match(report, /arguments are invalid/);
  assert.match(report, /No changes were made/);
});

test("an executed result without task details still reports success", () => {
  const report = formatApprovalOutcome({
    status: "executed",
    approvalId: "appr_test",
    result: { status: "executed" },
  });

  assert.equal(report, "The approved operation was completed successfully.");
});

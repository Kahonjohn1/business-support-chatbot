import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  clearAuditLogs,
  getAuditLogs,
  recordAuditEvent,
} from "../src/lib/auditLog.ts";

beforeEach(() => {
  clearAuditLogs();
});

test("audit details redact sensitive keys at every nesting level", () => {
  recordAuditEvent({
    requestId: "req_audit_test",
    toolName: "create_project_task",
    operation: "approval_execution",
    status: "executed",
    details: {
      password: "plain-secret",
      nested: {
        token: "nested-secret",
        visible: "keep-me",
      },
      list: [
        { authorization: "Bearer secret", keep: 1 },
        { keep: 2 },
      ],
    },
  });

  const logs = getAuditLogs({ requestId: "req_audit_test" });
  assert.equal(logs.length, 1);

  const details = logs[0].details as Record<string, unknown>;
  assert.equal(details.password, "[REDACTED]");

  const nested = details.nested as Record<string, unknown>;
  assert.equal(nested.token, "[REDACTED]");
  assert.equal(nested.visible, "keep-me");

  const list = details.list as Record<string, unknown>[];
  assert.equal(list[0].authorization, "[REDACTED]");
  assert.equal(list[0].keep, 1);
  assert.equal(list[1].keep, 2);
});

test("audit queries return the most recent entries up to the limit", () => {
  for (let index = 0; index < 3; index++) {
    recordAuditEvent({
      requestId: `req_${index}`,
      toolName: "tool",
      operation: "tool_execution",
      status: "executed",
    });
  }

  const latest = getAuditLogs({ limit: 2 });
  assert.equal(latest.length, 2);
  assert.equal(latest[0].requestId, "req_1");
  assert.equal(latest[1].requestId, "req_2");
  assert.match(latest[0].id, /^audit_/);
});

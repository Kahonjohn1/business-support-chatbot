import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkPermission,
  hasPermissionPolicy,
} from "../src/lib/permissions.ts";

test("permission policies exist for every registered business tool", () => {
  assert.equal(hasPermissionPolicy("get_project_status"), true);
  assert.equal(hasPermissionPolicy("list_project_tasks"), true);
  assert.equal(hasPermissionPolicy("create_project_task"), true);
  assert.equal(hasPermissionPolicy("unknown_tool"), false);
});

test("roles are enforced server-side", () => {
  const viewerRead = checkPermission("get_project_status", {
    role: "viewer",
    userId: "user_test",
    isDemo: true,
  });
  assert.equal(viewerRead.permitted, true);
  assert.equal(viewerRead.requiredPermission, "projects:read");

  const viewerWrite = checkPermission("create_project_task", {
    role: "viewer",
    userId: "user_test",
    isDemo: true,
  });
  assert.equal(viewerWrite.permitted, false);
  assert.equal(viewerWrite.requiredPermission, "tasks:write");

  const operatorWrite = checkPermission("create_project_task", {
    role: "operator",
    userId: "user_test",
    isDemo: true,
  });
  assert.equal(operatorWrite.permitted, true);

  const adminWrite = checkPermission("create_project_task", {
    role: "admin",
    userId: "user_test",
    isDemo: true,
  });
  assert.equal(adminWrite.permitted, true);
});

test("caller-supplied permissions cannot elevate a role", () => {
  const result = checkPermission("create_project_task", {
    role: "viewer",
    permissions: ["tasks:write", "admin:all"],
    userId: "user_test",
    isDemo: true,
  });
  assert.equal(result.permitted, false);
});

test("missing authorization and unknown tools fail closed", () => {
  const missing = checkPermission("get_project_status");
  assert.equal(missing.permitted, false);

  const unknown = checkPermission("delete_project", {
    role: "admin",
    userId: "user_test",
    isDemo: true,
  });
  assert.equal(unknown.permitted, false);
  assert.match(unknown.reason ?? "", /no permission policy/i);
});

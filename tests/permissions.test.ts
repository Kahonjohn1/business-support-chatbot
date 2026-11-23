import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkPermission,
  hasPermissionPolicy,
  type AuthorizationContext,
  type UserRole,
} from "../src/lib/permissions.ts";

test("permission policies exist for every registered business tool", () => {
  assert.equal(hasPermissionPolicy("get_project_status"), true);
  assert.equal(hasPermissionPolicy("list_project_tasks"), true);
  assert.equal(hasPermissionPolicy("create_project"), true);
  assert.equal(hasPermissionPolicy("create_project_task"), true);
  assert.equal(hasPermissionPolicy("list_integration_connections"), true);
  assert.equal(hasPermissionPolicy("connect_integration"), true);
  assert.equal(hasPermissionPolicy("disconnect_integration"), true);
  assert.equal(hasPermissionPolicy("use_integration_read"), true);
  assert.equal(hasPermissionPolicy("prepare_integration_action"), true);
  assert.equal(hasPermissionPolicy("list_automation_workflows"), true);
  assert.equal(hasPermissionPolicy("create_automation_workflow"), true);
  assert.equal(hasPermissionPolicy("update_automation_workflow"), true);
  assert.equal(hasPermissionPolicy("execute_automation_workflow"), true);
  assert.equal(hasPermissionPolicy("propose_automation_workflow"), true);
  assert.equal(hasPermissionPolicy("prepare_automation_workflow"), true);
  assert.equal(hasPermissionPolicy("unknown_tool"), false);
});

test("integration roles separate read access from management access", () => {
  const base = {
    userId: "user_test",
    workspaceKind: "personal" as const,
    source: "personal_owner" as const,
    isDemo: false,
  };

  const viewerRead = checkPermission("use_integration_read", { ...base, role: "viewer" });
  assert.equal(viewerRead.permitted, true);
  assert.equal(viewerRead.requiredPermission, "integrations:read");

  const viewerWrite = checkPermission("prepare_integration_action", { ...base, role: "viewer" });
  assert.equal(viewerWrite.permitted, false);
  assert.equal(viewerWrite.requiredPermission, "integrations:write");

  const operatorWrite = checkPermission("connect_integration", { ...base, role: "operator" });
  assert.equal(operatorWrite.permitted, true);

  const adminWrite = checkPermission("disconnect_integration", { ...base, role: "admin" });
  assert.equal(adminWrite.permitted, true);
});

test("automation roles separate read, write, and execute access", () => {
  const base = {
    userId: "user_test",
    workspaceKind: "personal" as const,
    source: "personal_owner" as const,
    isDemo: false,
  };

  const viewerRead = checkPermission("list_automation_workflows", { ...base, role: "viewer" });
  assert.equal(viewerRead.permitted, true);
  assert.equal(viewerRead.requiredPermission, "automations:read");

  const viewerWrite = checkPermission("create_automation_workflow", { ...base, role: "viewer" });
  assert.equal(viewerWrite.permitted, false);
  assert.equal(viewerWrite.requiredPermission, "automations:write");

  const operatorWrite = checkPermission("update_automation_workflow", { ...base, role: "operator" });
  assert.equal(operatorWrite.permitted, true);

  const operatorExecute = checkPermission("execute_automation_workflow", { ...base, role: "operator" });
  assert.equal(operatorExecute.permitted, true);

  const adminPrepare = checkPermission("prepare_automation_workflow", { ...base, role: "admin" });
  assert.equal(adminPrepare.permitted, true);
});

test("roles are enforced server-side", () => {
  const viewerRead = checkPermission("get_project_status", {
    role: "viewer",
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(viewerRead.permitted, true);
  assert.equal(viewerRead.requiredPermission, "projects:read");

  const viewerWrite = checkPermission("create_project_task", {
    role: "viewer",
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(viewerWrite.permitted, false);
  assert.equal(viewerWrite.requiredPermission, "tasks:write");

  const viewerProjectWrite = checkPermission("create_project", {
    role: "viewer",
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(viewerProjectWrite.permitted, false);
  assert.equal(viewerProjectWrite.requiredPermission, "projects:write");

  const operatorWrite = checkPermission("create_project_task", {
    role: "operator",
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(operatorWrite.permitted, true);

  const operatorProjectWrite = checkPermission("create_project", {
    role: "operator",
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(operatorProjectWrite.permitted, true);

  const adminWrite = checkPermission("create_project_task", {
    role: "admin",
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(adminWrite.permitted, true);

  const adminProjectWrite = checkPermission("create_project", {
    role: "admin",
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(adminProjectWrite.permitted, true);
});

test("caller-supplied permissions cannot elevate a role", () => {
  const result = checkPermission("create_project_task", {
    role: "viewer",
    permissions: ["tasks:write", "admin:all"],
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
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
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(unknown.permitted, false);
  assert.match(unknown.reason ?? "", /no permission policy/i);
});

test("unknown roles and invalid authorization scopes fail closed", () => {
  const unknownRole = checkPermission("create_project", {
    role: "manager" as UserRole,
    userId: "user_test",
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: true,
  });
  assert.equal(unknownRole.permitted, false);
  assert.match(unknownRole.reason ?? "", /unknown role/i);

  const missingScope = checkPermission("get_project_status", {
    role: "viewer",
    userId: "user_test",
    source: "personal_owner",
    isDemo: true,
  } as AuthorizationContext);
  assert.equal(missingScope.permitted, false);
  assert.match(missingScope.reason ?? "", /workspace scope/i);

  const personalWriteWithSharedSource = checkPermission("create_project", {
    role: "operator",
    userId: "user_test",
    workspaceKind: "personal",
    source: "verified_membership",
    isDemo: true,
  });
  assert.equal(personalWriteWithSharedSource.permitted, false);
  assert.match(personalWriteWithSharedSource.reason ?? "", /personal workspace ownership/i);

  const sharedAuthWithoutWorkspace = checkPermission("get_project_status", {
    role: "viewer",
    userId: "user_test",
    workspaceKind: "shared",
    source: "verified_membership",
    isDemo: true,
  });
  assert.equal(sharedAuthWithoutWorkspace.permitted, false);
  assert.match(sharedAuthWithoutWorkspace.reason ?? "", /verified workspace/i);
});

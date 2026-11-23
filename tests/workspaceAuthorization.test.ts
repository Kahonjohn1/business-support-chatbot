import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPermission } from "../src/lib/permissions.ts";
import {
  MARQUE_COMPANY_ID,
  PERSONAL_WORKSPACE_ROLE,
  assertPersonalConversationAccess,
  canAccessPersonalConversation,
  createEmployeeAuthorization,
  createPersonalWorkspaceAuthorization,
  createUserAuthorization,
  getEmployeeAuthorization,
  getSharedWorkspaceAuthorization,
  getUserAuthorization,
  isCustomerDatabaseRole,
  isMarqueCompanyId,
  mapVerifiedSharedWorkspaceRole,
  requireSharedWorkspaceAuthorization,
  requireUserAuthorization,
  toEmployeeToolRole,
} from "../src/lib/workspace/authorization.ts";
import { WorkspaceAccessError } from "../src/lib/workspace/errors.ts";
import type {
  DatabaseCompanyRole,
  WorkspaceContext,
} from "../src/lib/workspace/types.ts";

function contextFor(
  companyId: string,
  role: DatabaseCompanyRole
): WorkspaceContext {
  const activeCompany = {
    id: companyId,
    name: "Marque Technologies",
    slug: "marque",
    role,
    displayRole: role === "customer" ? ("customer" as const) : ("member" as const),
  };

  return {
    user: {
      id: "user_1",
      email: "employee@marquetechnologies.com",
      displayName: "Employee",
    },
    companies: [activeCompany],
    activeCompany,
  };
}

test("only the fixed Marque company is recognised", () => {
  assert.equal(isMarqueCompanyId(MARQUE_COMPANY_ID), true);
  assert.equal(isMarqueCompanyId("00000000-0000-0000-0000-000000000000"), false);
});

test("customer role is identified and never mapped to a tool role", () => {
  assert.equal(isCustomerDatabaseRole("customer"), true);
  assert.equal(isCustomerDatabaseRole("viewer"), false);
  assert.equal(toEmployeeToolRole("customer"), null);
  assert.equal(toEmployeeToolRole("owner"), "admin");
  assert.equal(toEmployeeToolRole("admin"), "admin");
  assert.equal(toEmployeeToolRole("operator"), "operator");
  assert.equal(toEmployeeToolRole("viewer"), "viewer");
});

test("employee authorization is created for internal Marque roles", () => {
  for (const role of ["owner", "admin", "operator", "viewer"] as const) {
    const auth = createEmployeeAuthorization(MARQUE_COMPANY_ID, role, "user_1");
    assert.ok(auth, `expected authorization for ${role}`);
    assert.equal(auth?.role, toEmployeeToolRole(role));
    assert.equal(auth?.userId, "user_1");
    assert.equal(auth?.isDemo, false);
  }
});

test("customer and non-Marque contexts fail closed", () => {
  assert.equal(createEmployeeAuthorization(MARQUE_COMPANY_ID, "customer", "user_1"), null);
  assert.equal(
    createEmployeeAuthorization(
      "00000000-0000-0000-0000-000000000000",
      "owner",
      "user_1"
    ),
    null
  );
  assert.equal(
    getEmployeeAuthorization(contextFor(MARQUE_COMPANY_ID, "customer")),
    null
  );
  assert.equal(
    getEmployeeAuthorization(
      contextFor("00000000-0000-0000-0000-000000000000", "admin")
    ),
    null
  );
  assert.equal(getEmployeeAuthorization({ ...contextFor(MARQUE_COMPANY_ID, "owner"), activeCompany: null }), null);
});

test("personal authorization works without a company membership and is never admin", () => {
  const context: WorkspaceContext = {
    ...contextFor("00000000-0000-0000-0000-000000000000", "customer"),
    activeCompany: null,
    companies: [],
  };

  const auth = getUserAuthorization(context);
  assert.ok(auth);
  assert.equal(auth?.userId, "user_1");
  assert.equal(auth?.role, PERSONAL_WORKSPACE_ROLE);
  assert.notEqual(auth?.role, "admin");
  assert.equal(auth?.workspaceKind, "personal");
  assert.equal(auth?.source, "personal_owner");
  assert.deepEqual(requireUserAuthorization(context), auth);
  assert.equal(createUserAuthorization(context.user).isDemo, false);
  assert.equal(createPersonalWorkspaceAuthorization(context.user).role, PERSONAL_WORKSPACE_ROLE);
  assert.equal(
    checkPermission("create_project", auth ?? undefined).permitted,
    true
  );
  assert.equal(
    checkPermission("delete_project", auth ?? undefined).permitted,
    false
  );
});

test("unauthenticated personal authorization fails closed", () => {
  assert.equal(getUserAuthorization(null), null);
  assert.throws(
    () => requireUserAuthorization(null),
    (error: unknown) =>
      error instanceof WorkspaceAccessError && error.status === 401
  );
  assert.throws(
    () => createUserAuthorization({ id: "", email: "", displayName: "" })
  );
});

test("shared workspace roles use only explicitly verified mappings", () => {
  assert.equal(mapVerifiedSharedWorkspaceRole("viewer"), "viewer");
  for (const role of ["owner", "admin", "operator", "customer"] as const) {
    assert.equal(mapVerifiedSharedWorkspaceRole(role), null);
  }
});

test("shared workspace authorization requires selected verified membership", () => {
  const viewerContext = contextFor(MARQUE_COMPANY_ID, "viewer");

  assert.equal(getSharedWorkspaceAuthorization(viewerContext, ""), null);
  assert.equal(getSharedWorkspaceAuthorization(null, MARQUE_COMPANY_ID), null);
  assert.equal(
    getSharedWorkspaceAuthorization(viewerContext, "00000000-0000-0000-0000-000000000000"),
    null
  );
  assert.equal(
    getSharedWorkspaceAuthorization(contextFor(MARQUE_COMPANY_ID, "customer"), MARQUE_COMPANY_ID),
    null
  );

  const auth = getSharedWorkspaceAuthorization(viewerContext, MARQUE_COMPANY_ID);
  assert.ok(auth);
  assert.equal(auth?.userId, "user_1");
  assert.equal(auth?.role, "viewer");
  assert.equal(auth?.workspaceKind, "shared");
  assert.equal(auth?.workspaceId, MARQUE_COMPANY_ID);
  assert.equal(auth?.source, "verified_membership");
  assert.deepEqual(
    requireSharedWorkspaceAuthorization(viewerContext, MARQUE_COMPANY_ID),
    auth
  );
  assert.throws(
    () =>
      requireSharedWorkspaceAuthorization(
        viewerContext,
        "00000000-0000-0000-0000-000000000000"
      ),
    (error: unknown) =>
      error instanceof WorkspaceAccessError && error.status === 403
  );
});

test("a shared workspace viewer cannot execute staff or manager write operations", () => {
  const auth = getSharedWorkspaceAuthorization(
    contextFor(MARQUE_COMPANY_ID, "viewer"),
    MARQUE_COMPANY_ID
  );
  assert.ok(auth);

  assert.equal(checkPermission("get_project_status", auth).permitted, true);
  assert.equal(checkPermission("list_project_tasks", auth).permitted, true);
  assert.equal(checkPermission("create_project", auth).permitted, false);
  assert.equal(checkPermission("create_project_task", auth).permitted, false);
});

test("personal ownership cannot grant another user access", () => {
  const auth = createPersonalWorkspaceAuthorization({
    id: "user_1",
    email: "user@example.com",
    displayName: "User",
  });
  assert.equal(canAccessPersonalConversation("user_2", auth.userId), false);
  assert.throws(
    () => assertPersonalConversationAccess("user_2", auth.userId),
    (error: unknown) =>
      error instanceof WorkspaceAccessError && error.status === 403
  );
});

test("conversation ownership is checked against the verified user", () => {
  assert.equal(canAccessPersonalConversation("user_1", "user_1"), true);
  assert.equal(canAccessPersonalConversation("user_2", "user_1"), false);
  assert.equal(canAccessPersonalConversation(null, "user_1"), false);
  assert.doesNotThrow(() => assertPersonalConversationAccess("user_1", "user_1"));
  assert.throws(
    () => assertPersonalConversationAccess("user_2", "user_1"),
    (error: unknown) =>
      error instanceof WorkspaceAccessError && error.status === 403
  );
});

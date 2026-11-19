import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MARQUE_COMPANY_ID,
  assertPersonalConversationAccess,
  canAccessPersonalConversation,
  createEmployeeAuthorization,
  createUserAuthorization,
  getEmployeeAuthorization,
  getUserAuthorization,
  isCustomerDatabaseRole,
  isMarqueCompanyId,
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
  return {
    user: {
      id: "user_1",
      email: "employee@marquetechnologies.com",
      displayName: "Employee",
    },
    companies: [],
    activeCompany: {
      id: companyId,
      name: "Marque Technologies",
      slug: "marque",
      role,
      displayRole: role === "customer" ? "customer" : "member",
    },
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

test("personal authorization works without a company membership", () => {
  const context: WorkspaceContext = {
    ...contextFor("00000000-0000-0000-0000-000000000000", "customer"),
    activeCompany: null,
    companies: [],
  };

  const auth = getUserAuthorization(context);
  assert.ok(auth);
  assert.equal(auth?.userId, "user_1");
  assert.equal(auth?.role, "admin");
  assert.deepEqual(requireUserAuthorization(context), auth);
  assert.equal(createUserAuthorization(context.user).isDemo, false);
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

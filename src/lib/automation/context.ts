import { AutomationError } from "@/lib/automation/errors";
import type {
  AutomationContext,
  AutomationScopeFilter,
  AutomationWorkflowRecord,
} from "@/lib/automation/types";
import {
  checkPermission,
  type AuthorizationContext,
  type UserRole,
} from "@/lib/permissions";
import { toWorkspaceToolRole } from "@/lib/workspace/authorization";
import { requireHybridWorkspaceAccess } from "@/lib/workspace/hybridWorkspaceData";
import { verifiedWorkspaceIdFromAuth } from "@/lib/workspace/workspaceProjectData";

function requireAuth(auth: AuthorizationContext | undefined): AuthorizationContext {
  if (!auth || typeof auth !== "object" || !auth.userId?.trim()) {
    throw new AutomationError(401, "FORBIDDEN", "Authentication required.");
  }
  return auth;
}

export async function resolveAutomationContext(
  auth: AuthorizationContext | undefined
): Promise<AutomationContext> {
  const resolved = requireAuth(auth);
  if (resolved.workspaceKind === "shared") {
    let workspaceId: string;
    try {
      const verified = await verifiedWorkspaceIdFromAuth(resolved);
      if (!verified) {
        throw new AutomationError(
          403,
          "FORBIDDEN",
          "A verified business workspace is required."
        );
      }
      workspaceId = verified;
    } catch {
      throw new AutomationError(
        403,
        "FORBIDDEN",
        "A verified business workspace is required."
      );
    }
    try {
      const { membership } = await requireHybridWorkspaceAccess(
        resolved,
        workspaceId,
        "viewer"
      );
      return {
        scope: "workspace",
        workspaceId,
        actorUserId: resolved.userId,
        actorRole: toWorkspaceToolRole(membership.role),
        auth: resolved,
      };
    } catch (error) {
      throw toAutomationAccessError(error);
    }
  }

  if (resolved.source !== "personal_owner") {
    throw new AutomationError(
      403,
      "FORBIDDEN",
      "Personal workspace ownership is required."
    );
  }
  return {
    scope: "personal",
    workspaceId: null,
    actorUserId: resolved.userId,
    actorRole: resolved.role,
    auth: resolved,
  };
}

function toAutomationAccessError(error: unknown): AutomationError {
  if (error instanceof AutomationError) return error;
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? (error as { status: number }).status
      : 403;
  return new AutomationError(
    status === 404 ? 404 : 403,
    "FORBIDDEN",
    "Workspace access is not permitted."
  );
}

export function automationFilter(context: AutomationContext): AutomationScopeFilter {
  return {
    scope: context.scope,
    workspaceId: context.workspaceId,
    userId: context.actorUserId,
  };
}

export function requireAutomationPermission(
  toolName: string,
  auth: AuthorizationContext
): void {
  const result = checkPermission(toolName, auth);
  if (!result.permitted) {
    throw new AutomationError(403, "FORBIDDEN", result.reason ?? "Permission denied.");
  }
}

export async function authorizationForWorkflow(
  workflow: AutomationWorkflowRecord
): Promise<AuthorizationContext> {
  if (workflow.scope === "personal") {
    return {
      userId: workflow.ownerUserId,
      role: workflow.ownerRole,
      workspaceKind: "personal",
      source: "personal_owner",
      isDemo: false,
    };
  }

  const workspaceId = workflow.workspaceId;
  if (!workspaceId) {
    throw new AutomationError(403, "FORBIDDEN", "A verified workspace is required.");
  }
  const synthetic: AuthorizationContext = {
    userId: workflow.createdByUserId,
    role: workflow.ownerRole,
    workspaceKind: "shared",
    workspaceId,
    source: "verified_membership",
    isDemo: false,
  };
  try {
    const { membership } = await requireHybridWorkspaceAccess(
      synthetic,
      workspaceId,
      "viewer"
    );
    const role: UserRole = toWorkspaceToolRole(membership.role);
    return { ...synthetic, role };
  } catch {
    throw new AutomationError(
      403,
      "FORBIDDEN",
      "The workflow owner no longer has workspace access."
    );
  }
}

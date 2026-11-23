import "server-only";

import { WorkspaceAccessError } from "@/lib/workspace/errors";
import {
  createPersonalWorkspaceAuthorization,
  createWorkspaceMembershipAuthorization,
} from "@/lib/workspace/authorization";
import {
  listHybridWorkspaces,
  requireHybridWorkspaceAccess,
} from "@/lib/workspace/hybridWorkspaceData";
import type { AuthorizationContext, WorkspaceKind } from "@/lib/permissions";
import type {
  AuthenticatedUser,
  WorkspaceContext,
  WorkspaceMemberRole,
} from "@/lib/workspace/types";

export const PERSONAL_WORKSPACE_ID = "personal";
export const ACTIVE_WORKSPACE_COOKIE = "marque_support_active_workspace";

export interface WorkspaceOption {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly role?: WorkspaceMemberRole;
}

export interface WorkspaceSelection {
  readonly active: WorkspaceOption;
  readonly options: readonly WorkspaceOption[];
  readonly unavailableReason?: string;
  readonly selectionWarning?: string;
}

export interface ActiveWorkspaceContext {
  readonly selection: WorkspaceSelection;
  readonly auth: AuthorizationContext;
}

const PERSONAL_OPTION: WorkspaceOption = Object.freeze({
  id: PERSONAL_WORKSPACE_ID,
  name: "Personal",
  kind: "personal",
});

export function findWorkspaceOption(
  options: readonly WorkspaceOption[],
  requestedId: unknown
): WorkspaceOption | null {
  if (typeof requestedId !== "string") return null;
  const id = requestedId.trim();
  if (!id) return null;
  return options.find((option) => option.id === id) ?? null;
}

export async function listWorkspaceOptions(
  user: AuthenticatedUser
): Promise<WorkspaceSelection> {
  const options: WorkspaceOption[] = [{ ...PERSONAL_OPTION }];

  try {
    const workspaces = await listHybridWorkspaces({ userId: user.id });
    const businessOptions: WorkspaceOption[] = [];

    for (const workspace of workspaces) {
      if (workspace.type !== "business") continue;
      try {
        const access = await requireHybridWorkspaceAccess(
          { userId: user.id },
          workspace.id,
          "viewer"
        );
        businessOptions.push({
          id: workspace.id,
          name: workspace.name,
          kind: "shared",
          role: access.membership.role,
        });
      } catch {
        continue;
      }
    }

    businessOptions.sort((a, b) => a.name.localeCompare(b.name));
    return { active: PERSONAL_OPTION, options: [...options, ...businessOptions] };
  } catch {
    return {
      active: PERSONAL_OPTION,
      options,
      unavailableReason:
        "Shared workspaces are not available until the pending workspace migration is applied.",
    };
  }
}

export function toWorkspaceSwitcherView(selection: WorkspaceSelection) {
  return {
    active: selection.active,
    options: selection.options,
    notice: selection.unavailableReason ?? selection.selectionWarning,
  };
}

export function resolveWorkspaceSelection(
  requestedId: unknown,
  available: WorkspaceSelection
): WorkspaceSelection {
  const active = findWorkspaceOption(available.options, requestedId);
  if (active) {
    return { ...available, active };
  }
  if (!requestedId || requestedId === PERSONAL_WORKSPACE_ID) {
    return { ...available, active: PERSONAL_OPTION };
  }
  return {
    ...available,
    active: PERSONAL_OPTION,
    selectionWarning:
      "The selected workspace is no longer available. Showing Personal.",
  };
}

export async function getActiveWorkspaceSelection(
  context: WorkspaceContext
): Promise<WorkspaceSelection> {
  const available = await listWorkspaceOptions(context.user);
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const requestedId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  return resolveWorkspaceSelection(requestedId, available);
}

export async function getWorkspaceAuthForSelection(
  context: WorkspaceContext,
  selection: WorkspaceSelection
): Promise<AuthorizationContext> {
  if (selection.active.kind === "personal") {
    return createPersonalWorkspaceAuthorization(context.user);
  }

  try {
    const access = await requireHybridWorkspaceAccess(
      { userId: context.user.id },
      selection.active.id,
      "viewer"
    );
    const auth = createWorkspaceMembershipAuthorization(
      context.user,
      access.workspace,
      access.membership
    );
    if (!auth) {
      throw new WorkspaceAccessError(
        403,
        "Verified workspace membership is required."
      );
    }
    return auth;
  } catch {
    throw new WorkspaceAccessError(
      403,
      "Shared workspace access could not be verified."
    );
  }
}

export async function getActiveWorkspaceContext(
  context: WorkspaceContext
): Promise<ActiveWorkspaceContext> {
  const selection = await getActiveWorkspaceSelection(context);
  return { selection, auth: await getWorkspaceAuthForSelection(context, selection) };
}

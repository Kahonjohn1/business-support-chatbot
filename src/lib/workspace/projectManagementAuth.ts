import type { AuthorizationContext } from "@/lib/permissions";
import type { WorkspaceContext } from "@/lib/workspace/types";

export interface ActiveProjectManagementAuth {
  readonly context: WorkspaceContext;
  readonly auth: AuthorizationContext;
}

export async function getActiveProjectManagementAuth(): Promise<ActiveProjectManagementAuth> {
  const [{ requireAuthenticatedApi }, { getActiveWorkspaceContext }] =
    await Promise.all([
      import("@/lib/workspace/server"),
      import("@/lib/workspace/workspaceSelection"),
    ]);
  const context = await requireAuthenticatedApi();
  const { auth } = await getActiveWorkspaceContext(context);
  return { context, auth };
}

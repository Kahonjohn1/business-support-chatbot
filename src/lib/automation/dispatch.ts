import { emitProjectEvent, emitTaskEvent } from "@/lib/automation/engine";
import type { AuthorizationContext } from "@/lib/permissions";
import type {
  PersonalProjectRecord,
  PersonalTaskRecord,
} from "@/lib/personalProjectData";
import type { AutomationEventType } from "@/lib/automation/types";

export async function dispatchTaskMutation(
  auth: unknown,
  type: AutomationEventType,
  task: PersonalTaskRecord
): Promise<void> {
  try {
    await emitTaskEvent(auth as AuthorizationContext | undefined, type, task);
  } catch {
    return;
  }
}

export async function dispatchProjectMutation(
  auth: unknown,
  type: AutomationEventType,
  project: PersonalProjectRecord
): Promise<void> {
  try {
    await emitProjectEvent(auth as AuthorizationContext | undefined, type, project);
  } catch {
    return;
  }
}

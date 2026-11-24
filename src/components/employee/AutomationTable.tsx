import { MoreHorizontal } from "lucide-react";
import type { Automation } from "@/lib/employee/mockData";
import { AvatarWithName } from "./Avatar";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

function automationTone(status: Automation["status"]) {
  if (status === "Active") return "success" as const;
  if (status === "Paused") return "neutral" as const;
  return "warning" as const;
}

export function AutomationTable({ automations }: { automations: Automation[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            <th className="px-3 py-2.5 font-semibold">Workflow</th>
            <th className="px-3 py-2.5 font-semibold">Trigger</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Last run</th>
            <th className="px-3 py-2.5 font-semibold">Success rate</th>
            <th className="px-3 py-2.5 font-semibold">Owner</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {automations.map((automation) => (
            <tr key={automation.id} className="border-b border-border/70 last:border-0">
              <td className="px-3 py-3">
                <p className="text-sm font-semibold text-foreground">{automation.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Preview workflow</p>
              </td>
              <td className="px-3 py-3">
                <p className="text-xs font-medium text-foreground">{automation.trigger}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{automation.cadence}</p>
              </td>
              <td className="px-3 py-3">
                <StatusBadge tone={automationTone(automation.status)}>{automation.status}</StatusBadge>
              </td>
              <td className="px-3 py-3 text-xs text-muted-foreground">{automation.lastRun}</td>
              <td className="px-3 py-3">
                <ProgressBar value={automation.successRate} />
              </td>
              <td className="px-3 py-3">
                <AvatarWithName name={automation.owner} />
              </td>
              <td className="px-3 py-3 text-right">
                <button
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-lg p-1.5 text-muted-foreground opacity-60"
                  aria-label={`Actions for ${automation.name}`}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

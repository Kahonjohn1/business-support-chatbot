import {
  Activity as ActivityIcon,
  ClipboardCheck,
  FolderKanban,
  UserPlus,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ActivityItem } from "@/lib/employee/mockData";
import { Avatar } from "./Avatar";

const kindConfig: Record<ActivityItem["kind"], { icon: LucideIcon; className: string }> = {
  project: {
    icon: FolderKanban,
    className: "bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]",
  },
  task: {
    icon: ActivityIcon,
    className: "bg-[#E8EEF9] text-[#284B8C] dark:bg-[#1A2540] dark:text-[#A9C4FF]",
  },
  approval: {
    icon: ClipboardCheck,
    className: "bg-[#FFF4E5] text-[#9A5A0B] dark:bg-[#3A2A17] dark:text-[#F1C27A]",
  },
  team: {
    icon: UserPlus,
    className: "bg-[#F2EBFA] text-[#6B3FA0] dark:bg-[#2C2038] dark:text-[#D6B8F7]",
  },
  automation: {
    icon: Workflow,
    className: "bg-[#E8F5EC] text-[#24703A] dark:bg-[#173020] dark:text-[#9BD7AC]",
  },
};

export function ActivityTimeline({
  items,
  compact = false,
}: {
  items: ActivityItem[];
  compact?: boolean;
}) {
  return (
    <div className="space-y-5">
      {items.map((item, index) => {
        const showGroup = index === 0 || items[index - 1].group !== item.group;
        const config = kindConfig[item.kind];
        const Icon = config.icon;

        return (
          <div key={item.id}>
            {showGroup ? (
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {item.group}
              </p>
            ) : null}
            <div className="flex gap-3">
              <div className="relative flex flex-col items-center">
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${config.className}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="mt-2 w-px flex-1 bg-border" aria-hidden="true" />
              </div>
              <div className={`min-w-0 flex-1 ${compact ? "pb-1" : "pb-3"}`}>
                <p className="text-sm leading-relaxed text-foreground">
                  <span className="font-semibold">{item.actor}</span> {item.action}{" "}
                  <span className="font-medium">{item.target}</span>
                </p>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Avatar name={item.actor} size="sm" />
                  <span>{item.time}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

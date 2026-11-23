"use client";

import { Building2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface WorkspaceSwitcherOption {
  readonly id: string;
  readonly name: string;
  readonly kind: "personal" | "shared";
  readonly role?: string;
}

interface WorkspaceSwitcherProps {
  readonly active: WorkspaceSwitcherOption;
  readonly options: readonly WorkspaceSwitcherOption[];
  readonly notice?: string;
}

export function WorkspaceSwitcher({
  active,
  options,
  notice,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const workspaceId = event.target.value;
    if (workspaceId === active.id) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) {
        setError("That workspace could not be selected.");
        return;
      }
      router.refresh();
    } catch {
      setError("That workspace could not be selected.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2" data-workspace-switcher="">
      <div className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground sm:flex">
        {active.kind === "personal" ? <UserRound size={16} /> : <Building2 size={16} />}
        <span className="truncate">
          Workspace: <span className="font-medium text-foreground">{active.name}</span>
        </span>
      </div>
      <label className="sr-only" htmlFor="active-workspace">
        Active workspace
      </label>
      <select
        aria-label="Active workspace"
        className="max-w-40 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground outline-none disabled:opacity-60"
        disabled={pending || options.length < 2}
        id="active-workspace"
        onChange={handleChange}
        title={notice ?? error ?? undefined}
        value={active.id}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.kind === "personal" ? "Personal" : option.name}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

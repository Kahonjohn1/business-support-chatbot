"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Mail, Send, UserPlus } from "lucide-react";
import { employeeRoles, roleLabels, type EmployeeRole } from "@/lib/employee/roles";

export function InviteEmployeeForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<EmployeeRole>("viewer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/employee/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName, role }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "The invitation could not be sent.");
        return;
      }

      setSuccess(payload.message ?? "Invitation sent.");
      setEmail("");
      setFullName("");
      setRole("viewer");
      router.refresh();
    } catch {
      setError("The invitation service could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-selected-teal text-action-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">Invite an employee</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Supabase sends an invitation email and a Marque Technologies membership invitation.
            Access is active after the invitee signs in and accepts the company invitation.
          </p>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[#F1C7C7] bg-[#FFF5F5] px-3 py-2.5 text-xs text-[#8A1F1F] dark:border-[#5A2929] dark:bg-[#2A1717] dark:text-[#F5B5B5]"
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          role="status"
          className="mt-4 rounded-lg border border-[#BFE4E8] bg-selected-teal px-3 py-2.5 text-xs text-brand-teal dark:border-[#20484D] dark:bg-[#102A2E] dark:text-[#A6E5EB]"
        >
          {success}
        </div>
      ) : null}

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">Full name</span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Alex Morgan"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">Work email</span>
          <div className="relative">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@marquetechnologies.com"
              className="h-10 w-full rounded-lg border border-border bg-surface pl-3 pr-9 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Mail
              className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">Role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as EmployeeRole)}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {employeeRoles.map((value) => (
              <option key={value} value={value}>
                {roleLabels[value]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {pending ? "Sending..." : "Send invitation"}
        </button>
      </form>
    </div>
  );
}

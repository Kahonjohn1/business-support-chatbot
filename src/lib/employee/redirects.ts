import { employeeRoutePrefixes } from "./routes";

export function safeNextPath(
  value: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (!value) return fallback;

  const allowed = employeeRoutePrefixes.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`)
  );

  return allowed ? value : fallback;
}

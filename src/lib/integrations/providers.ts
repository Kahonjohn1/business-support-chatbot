import type {
  IntegrationCapability,
  IntegrationProviderDefinition,
  IntegrationProviderId,
} from "@/lib/integrations/types";

const COMMON_GOOGLE_ENV = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "INTEGRATION_TOKEN_ENCRYPTION_KEY",
] as const;

export const GMAIL_PROVIDER: IntegrationProviderDefinition = Object.freeze({
  id: "gmail",
  label: "Gmail",
  description: "Search and read mailbox messages for supported workspace tasks.",
  authFamily: "google_oauth2",
  requiredScopes: Object.freeze([
    "https://www.googleapis.com/auth/gmail.readonly",
  ]),
  requiredEnv: COMMON_GOOGLE_ENV,
  capabilities: Object.freeze([
    "email:search",
    "email:read",
    "email:draft",
  ] as readonly IntegrationCapability[]),
});

export const GOOGLE_CALENDAR_PROVIDER: IntegrationProviderDefinition = Object.freeze({
  id: "google_calendar",
  label: "Google Calendar",
  description: "Read calendar events and check availability for supported workspace tasks.",
  authFamily: "google_oauth2",
  requiredScopes: Object.freeze([
    "https://www.googleapis.com/auth/calendar.readonly",
  ]),
  requiredEnv: COMMON_GOOGLE_ENV,
  capabilities: Object.freeze([
    "calendar:read",
    "calendar:availability",
    "calendar:draft",
  ] as readonly IntegrationCapability[]),
});

export const INTEGRATION_PROVIDERS: readonly IntegrationProviderDefinition[] =
  Object.freeze([GMAIL_PROVIDER, GOOGLE_CALENDAR_PROVIDER]);

export function isIntegrationProviderId(value: unknown): value is IntegrationProviderId {
  return (
    typeof value === "string" &&
    INTEGRATION_PROVIDERS.some((provider) => provider.id === value)
  );
}

export function getIntegrationProvider(
  value: unknown
): IntegrationProviderDefinition | null {
  return isIntegrationProviderId(value)
    ? INTEGRATION_PROVIDERS.find((provider) => provider.id === value) ?? null
    : null;
}

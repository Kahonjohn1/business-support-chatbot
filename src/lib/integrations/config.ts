import "server-only";

import { IntegrationError } from "@/lib/integrations/errors";
import { getIntegrationProvider } from "@/lib/integrations/providers";
import type { IntegrationProviderId } from "@/lib/integrations/types";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface IntegrationProviderConfigStatus {
  readonly configured: boolean;
  readonly missingConfig: readonly string[];
}

const CALLBACK_PATH = "/api/integrations/callback";

function readEnv(name: string): string {
  return typeof process.env[name] === "string" ? process.env[name]!.trim() : "";
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function allowedUrl(url: URL): boolean {
  if (url.username || url.password || url.hash || url.search) return false;
  if (url.protocol === "https:") return true;
  return !isProduction() && url.protocol === "http:" && isLoopbackHost(url.hostname);
}

function canonicalRedirectUri(value: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!allowedUrl(parsed)) return null;
    if (parsed.pathname !== CALLBACK_PATH) return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function canonicalOrigin(value: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!allowedUrl(parsed)) return null;
    if (parsed.pathname !== "/") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getIntegrationEncryptionKey(): string {
  return readEnv("INTEGRATION_TOKEN_ENCRYPTION_KEY");
}

export function getPreviousIntegrationEncryptionKey(): string {
  return readEnv("INTEGRATION_TOKEN_ENCRYPTION_KEY_PREVIOUS");
}

export function isIntegrationEncryptionConfigured(): boolean {
  const value = getIntegrationEncryptionKey();
  if (!value) return false;
  try {
    return Buffer.from(value, "base64url").length === 32;
  } catch {
    return false;
  }
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = readEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = readEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = canonicalRedirectUri(readEnv("GOOGLE_OAUTH_REDIRECT_URI"));

  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function getTrustedAppOrigins(): readonly string[] {
  const configured = readEnv("INTEGRATION_APP_ORIGINS")
    .split(",")
    .map((entry) => canonicalOrigin(entry.trim()))
    .filter((entry): entry is string => Boolean(entry));
  const callbackOrigin = canonicalRedirectUri(readEnv("GOOGLE_OAUTH_REDIRECT_URI"));
  const redirectOrigin = callbackOrigin ? new URL(callbackOrigin).origin : null;
  const origins = new Set<string>(configured);
  if (redirectOrigin) origins.add(redirectOrigin);
  return [...origins];
}

export function resolveTrustedRedirectOrigin(request: Request): string {
  const trusted = getTrustedAppOrigins();
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    const trustedOrigin = canonicalOrigin(originHeader);
    if (trustedOrigin && trusted.includes(trustedOrigin)) return trustedOrigin;
  }
  try {
    const requestOrigin = canonicalOrigin(new URL(request.url).origin);
    if (requestOrigin && trusted.includes(requestOrigin)) return requestOrigin;
  } catch {}
  if (trusted.length > 0) return trusted[0]!;
  throw new IntegrationError(
    503,
    "PROVIDER_NOT_CONFIGURED",
    "No trusted application origin is configured."
  );
}

function isGoogleRedirectUriConfigured(value: string): boolean {
  return Boolean(canonicalRedirectUri(value));
}

export function getIntegrationProviderConfigStatus(
  providerId: IntegrationProviderId
): IntegrationProviderConfigStatus {
  const provider = getIntegrationProvider(providerId);
  if (!provider) {
    return { configured: false, missingConfig: ["INTEGRATION_PROVIDER"] };
  }

  const missingConfig = provider.requiredEnv.filter((name) => {
    if (name === "INTEGRATION_TOKEN_ENCRYPTION_KEY") {
      return !isIntegrationEncryptionConfigured();
    }
    if (name === "GOOGLE_OAUTH_REDIRECT_URI") {
      return !isGoogleRedirectUriConfigured(readEnv(name));
    }
    return !readEnv(name);
  });

  return { configured: missingConfig.length === 0, missingConfig };
}

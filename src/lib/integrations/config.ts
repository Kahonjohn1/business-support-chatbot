import "server-only";

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

function readEnv(name: string): string {
  return typeof process.env[name] === "string" ? process.env[name]!.trim() : "";
}

export function getIntegrationEncryptionKey(): string {
  return readEnv("INTEGRATION_TOKEN_ENCRYPTION_KEY");
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
  const redirectUri = readEnv("GOOGLE_OAUTH_REDIRECT_URI");

  if (!clientId || !clientSecret || !redirectUri) return null;
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
  } catch {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

function isGoogleRedirectUriConfigured(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return !parsed.username && !parsed.password;
  } catch {
    return false;
  }
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

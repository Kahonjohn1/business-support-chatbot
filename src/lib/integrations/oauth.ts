import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getGoogleOAuthConfig } from "@/lib/integrations/config";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integrations/credentials";
import { IntegrationError } from "@/lib/integrations/errors";
import { getIntegrationProvider, isIntegrationProviderId } from "@/lib/integrations/providers";
import type {
  IntegrationConnectionScope,
  IntegrationProviderId,
} from "@/lib/integrations/types";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
export const INTEGRATION_OAUTH_COOKIE = "marque_support_integration_oauth";
export const INTEGRATION_OAUTH_MAX_AGE_SECONDS = 600;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface IntegrationOAuthState {
  readonly provider: IntegrationProviderId;
  readonly userId: string;
  readonly scope: IntegrationConnectionScope;
  readonly workspaceId: string | null;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface IntegrationPkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export interface GoogleTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
  readonly scopes: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

export function createIntegrationPkcePair(): IntegrationPkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function integrationOAuthCookieName(state: string): string {
  if (!state || !/^[A-Za-z0-9_-]+$/.test(state)) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Integration request is invalid.");
  }
  return `${INTEGRATION_OAUTH_COOKIE}.${state}`;
}

export function createIntegrationOAuthState(input: {
  provider: IntegrationProviderId;
  userId: string;
  scope: IntegrationConnectionScope;
  workspaceId: string | null;
  codeVerifier: string;
}): { state: string; cookieValue: string; cookieName: string } {
  const issuedAt = Date.now();
  const payload: IntegrationOAuthState = {
    provider: input.provider,
    userId: input.userId,
    scope: input.scope,
    workspaceId: input.workspaceId,
    nonce: base64Url(randomBytes(24)),
    issuedAt,
    expiresAt: issuedAt + INTEGRATION_OAUTH_MAX_AGE_SECONDS * 1000,
  };
  const state = base64Url(randomBytes(32));
  const cookieValue = encryptIntegrationSecret(
    JSON.stringify({
      state,
      payload,
      codeVerifier: input.codeVerifier,
    }),
    { purpose: "oauth_state", state }
  );
  return { state, cookieValue, cookieName: integrationOAuthCookieName(state) };
}

function validateIntegrationOAuthState(
  cookieValue: string | undefined,
  expectedState: string | undefined
): { payload: IntegrationOAuthState; codeVerifier: string } {
  if (!cookieValue || !expectedState) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Integration request expired.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      decryptIntegrationSecret(cookieValue, { purpose: "oauth_state", state: expectedState })
    );
  } catch {
    throw new IntegrationError(400, "INVALID_REQUEST", "Integration request expired.");
  }

  if (
    !isRecord(parsed) ||
    parsed.state !== expectedState ||
    typeof parsed.codeVerifier !== "string" ||
    !isRecord(parsed.payload)
  ) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Integration request is invalid.");
  }

  const payload = parsed.payload;
  const valid =
    isIntegrationProviderId(payload.provider) &&
    typeof payload.userId === "string" &&
    payload.userId.trim().length > 0 &&
    (payload.scope === "personal" || payload.scope === "workspace") &&
    (payload.workspaceId === null || typeof payload.workspaceId === "string") &&
    typeof payload.issuedAt === "number" &&
    typeof payload.expiresAt === "number" &&
    payload.expiresAt > Date.now() &&
    payload.expiresAt - payload.issuedAt <= INTEGRATION_OAUTH_MAX_AGE_SECONDS * 1000;

  if (!valid) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Integration request is invalid.");
  }

  return {
    payload: payload as unknown as IntegrationOAuthState,
    codeVerifier: parsed.codeVerifier,
  };
}

export function readIntegrationOAuthStateEnvelope(
  cookieValue: string | undefined,
  expectedState: string | undefined
): { payload: IntegrationOAuthState; codeVerifier: string } {
  return validateIntegrationOAuthState(cookieValue, expectedState);
}

export function readIntegrationOAuthState(
  cookieValue: string | undefined,
  expectedState: string | undefined,
  provider: IntegrationProviderId,
  userId: string
): { payload: IntegrationOAuthState; codeVerifier: string } {
  const result = validateIntegrationOAuthState(cookieValue, expectedState);
  if (result.payload.provider !== provider || result.payload.userId !== userId) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Integration request is invalid.");
  }
  return result;
}

export function buildGoogleAuthorizationUrl(
  provider: IntegrationProviderId,
  state: string,
  codeChallenge: string
): string {
  const config = getGoogleOAuthConfig();
  const providerDefinition = getIntegrationProvider(provider);
  if (!config || !providerDefinition || providerDefinition.authFamily !== "google_oauth2") {
    throw new IntegrationError(
      503,
      "PROVIDER_NOT_CONFIGURED",
      "This integration provider is not configured."
    );
  }

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", providerDefinition.requiredScopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

function parseTokenResponse(value: unknown): GoogleTokenSet {
  if (!isRecord(value) || typeof value.access_token !== "string" || !value.access_token) {
    throw new IntegrationError(
      502,
      "TOKEN_EXCHANGE_FAILED",
      "The provider did not return an access token."
    );
  }
  const expiresIn =
    typeof value.expires_in === "number" && Number.isFinite(value.expires_in)
      ? Math.max(0, Math.floor(value.expires_in))
      : null;
  return {
    accessToken: value.access_token,
    refreshToken: typeof value.refresh_token === "string" && value.refresh_token
      ? value.refresh_token
      : null,
    expiresAt: expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000).toISOString(),
    scopes:
      typeof value.scope === "string"
        ? value.scope.split(/\s+/).filter(Boolean)
        : [],
  };
}

async function postTokenRequest(
  body: Record<string, string>,
  fetchImpl: FetchLike
): Promise<GoogleTokenSet> {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new IntegrationError(
      503,
      "PROVIDER_NOT_CONFIGURED",
      "This integration provider is not configured."
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...body,
      }).toString(),
      cache: "no-store",
    });
  } catch {
    throw new IntegrationError(
      502,
      "TOKEN_EXCHANGE_FAILED",
      "The provider could not be reached."
    );
  }

  if (!response.ok) {
    throw new IntegrationError(
      502,
      "TOKEN_EXCHANGE_FAILED",
      "The provider rejected the authorization request."
    );
  }

  return parseTokenResponse(await response.json().catch(() => null));
}

export function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch
): Promise<GoogleTokenSet> {
  const config = getGoogleOAuthConfig();
  if (!config || !code || !codeVerifier) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Authorization code is missing.");
  }
  return postTokenRequest(
    {
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    },
    fetchImpl
  );
}

export function refreshGoogleAccessToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch
): Promise<GoogleTokenSet> {
  if (!refreshToken) {
    throw new IntegrationError(401, "RECONNECT_REQUIRED", "Reconnect this integration.");
  }
  return postTokenRequest(
    {
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    fetchImpl
  );
}

export async function revokeGoogleAccessToken(
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetchImpl(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function hasRequiredIntegrationScopes(
  provider: IntegrationProviderId,
  grantedScopes: readonly string[]
): boolean {
  const definition = getIntegrationProvider(provider);
  if (!definition) return false;
  const granted = new Set(grantedScopes);
  return definition.requiredScopes.every((scope) => granted.has(scope));
}

export async function fetchGoogleAccountLabel(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<string | null> {
  try {
    const response = await fetchImpl(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!isRecord(payload)) return null;
    return typeof payload.email === "string" && payload.email.trim()
      ? payload.email.trim().slice(0, 254)
      : null;
  } catch {
    return null;
  }
}

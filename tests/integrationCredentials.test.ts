import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  getIntegrationProviderConfigStatus,
  resolveTrustedRedirectOrigin,
} from "../src/lib/integrations/config.ts";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "../src/lib/integrations/credentials.ts";
import { INTEGRATION_PROVIDERS } from "../src/lib/integrations/providers.ts";

const KEY_NAME = "INTEGRATION_TOKEN_ENCRYPTION_KEY";
const OAUTH_ENV_NAMES = [
  "NODE_ENV",
  "INTEGRATION_APP_ORIGINS",
  "INTEGRATION_TOKEN_ENCRYPTION_KEY_PREVIOUS",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
] as const;
const TEST_KEY = "ayF9L3nQ8vR2sT5uW7xZ0aB4cD6eF8gH1jK4mN7pQ9s";
const OTHER_KEY = "Q9s7pN4mK1jH8gF6eD4cB0aZ7xW5uT2sR8vQ3nL9fYa";
const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of [KEY_NAME, ...OAUTH_ENV_NAMES]) {
    originalEnv.set(name, process.env[name]);
  }
  process.env[KEY_NAME] = TEST_KEY;
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/api/integrations/callback";
});

afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalEnv.clear();
});

const BINDING = {
  purpose: "connection",
  provider: "gmail",
  ownerUserId: "user-1",
  workspaceId: null,
} as const;

test("integration tokens are encrypted and decrypted with authenticated encryption", () => {
  const secret = "access-token-value";
  const encrypted = encryptIntegrationSecret(secret, BINDING);

  assert.notEqual(encrypted, secret);
  assert.equal(encrypted.includes(secret), false);
  assert.match(
    encrypted,
    /^v2\.[a-f0-9]{12}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
  );
  assert.equal(decryptIntegrationSecret(encrypted, BINDING), secret);

  const tampered = `${encrypted.slice(0, -2)}AA`;
  assert.throws(() => decryptIntegrationSecret(tampered, BINDING));
});

test("credentials cannot be transplanted between connections", () => {
  const encrypted = encryptIntegrationSecret("refresh-token-value", BINDING);
  assert.throws(() =>
    decryptIntegrationSecret(encrypted, {
      ...BINDING,
      ownerUserId: "user-2",
    })
  );
});

test("a previous encryption key can decrypt rotated credentials", () => {
  const encrypted = encryptIntegrationSecret("refresh-token-value", BINDING);
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_PREVIOUS = TEST_KEY;
  process.env[KEY_NAME] = OTHER_KEY;
  assert.equal(decryptIntegrationSecret(encrypted, BINDING), "refresh-token-value");

  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY_PREVIOUS = "";
  const rotated = encryptIntegrationSecret("new-token-value", BINDING);
  assert.equal(decryptIntegrationSecret(rotated, BINDING), "new-token-value");
});

test("provider configuration reports missing setup without exposing values", () => {
  assert.deepEqual(getIntegrationProviderConfigStatus("gmail"), {
    configured: true,
    missingConfig: [],
  });

  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const status = getIntegrationProviderConfigStatus("google_calendar");
  assert.equal(status.configured, false);
  assert.deepEqual(status.missingConfig, ["GOOGLE_OAUTH_CLIENT_SECRET"]);
  assert.equal(JSON.stringify(status).includes("secret-test"), false);
});

test("OAuth redirects use a canonical trusted origin", () => {
  process.env.INTEGRATION_APP_ORIGINS = "https://app.example.com";
  const request = new Request("https://evil.example.com/api/integrations/callback", {
    headers: { origin: "https://evil.example.com" },
  });

  assert.equal(resolveTrustedRedirectOrigin(request), "https://app.example.com");
});

test("production rejects insecure callback configuration", () => {
  const name: string = "NODE_ENV";
  process.env[name] = "production";
  assert.deepEqual(getIntegrationProviderConfigStatus("gmail"), {
    configured: false,
    missingConfig: ["GOOGLE_OAUTH_REDIRECT_URI"],
  });
});

test("providers request only read-only Google scopes", () => {
  assert.equal(INTEGRATION_PROVIDERS.length, 2);
  for (const provider of INTEGRATION_PROVIDERS) {
    assert.equal(provider.authFamily, "google_oauth2");
    assert.ok(provider.requiredScopes.length > 0);
    for (const scope of provider.requiredScopes) {
      assert.match(scope, /^https:\/\/www\.googleapis\.com\/auth\//);
      assert.doesNotMatch(scope, /gmail\.compose|gmail\.modify|gmail\.send|\/calendar\.events$/);
    }
  }
});

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { getIntegrationProviderConfigStatus } from "../src/lib/integrations/config.ts";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "../src/lib/integrations/credentials.ts";
import { INTEGRATION_PROVIDERS } from "../src/lib/integrations/providers.ts";

const KEY_NAME = "INTEGRATION_TOKEN_ENCRYPTION_KEY";
const OAUTH_ENV_NAMES = [
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

test("integration tokens are encrypted and decrypted with authenticated encryption", () => {
  const secret = "access-token-value";
  const encrypted = encryptIntegrationSecret(secret);

  assert.notEqual(encrypted, secret);
  assert.equal(encrypted.includes(secret), false);
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(decryptIntegrationSecret(encrypted), secret);

  const tampered = `${encrypted.slice(0, -2)}AA`;
  assert.throws(() => decryptIntegrationSecret(tampered));
});

test("a different encryption key cannot decrypt stored tokens", () => {
  const encrypted = encryptIntegrationSecret("refresh-token-value");
  process.env[KEY_NAME] = OTHER_KEY;
  assert.throws(() => decryptIntegrationSecret(encrypted));
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

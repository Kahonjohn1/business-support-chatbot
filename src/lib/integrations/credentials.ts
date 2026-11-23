import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getIntegrationEncryptionKey, getPreviousIntegrationEncryptionKey } from "@/lib/integrations/config";
import type { IntegrationProviderId } from "@/lib/integrations/types";

const CURRENT_ENVELOPE_PREFIX = "v2";
const LEGACY_ENVELOPE_PREFIX = "v1";

export interface IntegrationCredentialBinding {
  readonly purpose: "oauth_state" | "connection";
  readonly provider?: IntegrationProviderId;
  readonly ownerUserId?: string;
  readonly workspaceId?: string | null;
  readonly state?: string;
}

export class IntegrationCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationCredentialError";
  }
}

function canonicalKey(encoded: string): Buffer {
  if (!encoded) {
    throw new IntegrationCredentialError("Integration token encryption is not configured.");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) {
    throw new IntegrationCredentialError("Integration token encryption key is invalid.");
  }
  return key;
}

function currentKey(): Buffer {
  return canonicalKey(getIntegrationEncryptionKey());
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function candidateKeys(): readonly Buffer[] {
  const current = currentKey();
  const previous = getPreviousIntegrationEncryptionKey();
  if (!previous) return [current];
  const previousKey = canonicalKey(previous);
  if (keyId(previousKey) === keyId(current)) return [current];
  return [current, previousKey];
}

function aad(binding: IntegrationCredentialBinding): Buffer {
  return Buffer.from(
    JSON.stringify({
      purpose: binding.purpose,
      provider: binding.provider ?? null,
      ownerUserId: binding.ownerUserId ?? null,
      workspaceId: binding.workspaceId ?? null,
      state: binding.state ?? null,
    }),
    "utf8"
  );
}

export function currentCredentialKeyId(): string {
  return keyId(currentKey());
}

export function encryptIntegrationSecret(
  plaintext: string,
  binding: IntegrationCredentialBinding
): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new IntegrationCredentialError("A credential value is required.");
  }
  if (!binding || (binding.purpose !== "oauth_state" && binding.purpose !== "connection")) {
    throw new IntegrationCredentialError("A credential binding is required.");
  }
  const key = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    CURRENT_ENVELOPE_PREFIX,
    keyId(key),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptLegacy(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== LEGACY_ENVELOPE_PREFIX) {
    throw new IntegrationCredentialError("A credential envelope is malformed.");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const authTag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new IntegrationCredentialError("A credential envelope is malformed.");
  }
  for (const key of candidateKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      continue;
    }
  }
  throw new IntegrationCredentialError("A credential envelope could not be decrypted.");
}

export function decryptIntegrationSecret(
  envelope: string,
  binding: IntegrationCredentialBinding
): string {
  if (typeof envelope !== "string") {
    throw new IntegrationCredentialError("A credential envelope is required.");
  }
  if (!binding || (binding.purpose !== "oauth_state" && binding.purpose !== "connection")) {
    throw new IntegrationCredentialError("A credential binding is required.");
  }
  const parts = envelope.split(".");
  if (parts[0] === LEGACY_ENVELOPE_PREFIX) {
    return decryptLegacy(envelope);
  }
  if (parts.length !== 5 || parts[0] !== CURRENT_ENVELOPE_PREFIX) {
    throw new IntegrationCredentialError("A credential envelope is malformed.");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const authTag = Buffer.from(parts[3], "base64url");
  const ciphertext = Buffer.from(parts[4], "base64url");
  if (
    !/^[a-f0-9]{12}$/.test(parts[1]) ||
    iv.length !== 12 ||
    authTag.length !== 16 ||
    ciphertext.length === 0
  ) {
    throw new IntegrationCredentialError("A credential envelope is malformed.");
  }
  for (const key of candidateKeys()) {
    if (keyId(key) !== parts[1]) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      decipher.setAAD(aad(binding));
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new IntegrationCredentialError("A credential envelope could not be decrypted.");
    }
  }
  throw new IntegrationCredentialError("A credential envelope could not be decrypted.");
}

export function rewrapIntegrationSecret(
  envelope: string,
  binding: IntegrationCredentialBinding
): string {
  return encryptIntegrationSecret(decryptIntegrationSecret(envelope, binding), binding);
}

export function credentialNeedsRewrap(envelope: string): boolean {
  if (typeof envelope !== "string") return true;
  const parts = envelope.split(".");
  return parts[0] !== CURRENT_ENVELOPE_PREFIX || parts[1] !== currentCredentialKeyId();
}

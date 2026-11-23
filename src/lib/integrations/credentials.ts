import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getIntegrationEncryptionKey } from "@/lib/integrations/config";

const TOKEN_ENVELOPE_PREFIX = "v1";

export class IntegrationCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationCredentialError";
  }
}

function readKey(): Buffer {
  const encoded = getIntegrationEncryptionKey();
  if (!encoded) {
    throw new IntegrationCredentialError("Integration token encryption is not configured.");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) {
    throw new IntegrationCredentialError("Integration token encryption key is invalid.");
  }
  return key;
}

export function encryptIntegrationSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new IntegrationCredentialError("A credential value is required.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    TOKEN_ENVELOPE_PREFIX,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptIntegrationSecret(envelope: string): string {
  if (typeof envelope !== "string") {
    throw new IntegrationCredentialError("A credential envelope is required.");
  }
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_ENVELOPE_PREFIX) {
    throw new IntegrationCredentialError("A credential envelope is malformed.");
  }

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const authTag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", readKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new IntegrationCredentialError("A credential envelope could not be decrypted.");
  }
}

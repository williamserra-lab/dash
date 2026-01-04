// src/lib/secretBox.ts
// Utilitário simples para criptografar/decifrar segredos por tenant.
// Requer NEXTIA_MASTER_KEY no ambiente (ideal: base64 com 32 bytes).
//
// Formato armazenado: "v1:<base64(iv|tag|ciphertext)>"

import crypto from "crypto";

const VERSION_PREFIX = "v1:";

function getKey(): Buffer {
  const raw = process.env.NEXTIA_MASTER_KEY;
  if (!raw) {
    throw new Error("NEXTIA_MASTER_KEY não configurada no ambiente.");
  }

  // Aceita:
  // - hex (64 chars => 32 bytes)
  // - base64
  // - passphrase (hash sha256)
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const b = Buffer.from(trimmed, "base64");
    if (b.length === 32) return b;
  } catch {
    // ignore
  }

  return crypto.createHash("sha256").update(trimmed, "utf8").digest();
}

export function canStoreSecrets(): boolean {
  return Boolean(process.env.NEXTIA_MASTER_KEY && process.env.NEXTIA_MASTER_KEY.trim().length > 0);
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM nonce
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const packed = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `${VERSION_PREFIX}${packed}`;
}

export function decryptSecret(packed: string): string {
  if (!packed?.startsWith(VERSION_PREFIX)) {
    throw new Error("Segredo em formato inválido.");
  }
  const key = getKey();
  const b = Buffer.from(packed.slice(VERSION_PREFIX.length), "base64");
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const ciphertext = b.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return plain;
}

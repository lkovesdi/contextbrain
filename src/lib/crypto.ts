import crypto from "node:crypto";

// App-side encryption for BYOK secrets. We keep encryption in code (rather than
// SQL pgcrypto) so ciphertext round-trips cleanly through supabase-js as text
// and decryption lives next to where keys are used. Ciphertext format is a
// base64 triplet "iv:tag:ct" (AES-256-GCM), stored in text columns.

const ALGO = "aes-256-gcm";

// 32-byte symmetric key from a server-only env var. Accepts hex (64 chars) or
// base64. Throws if unset/malformed — callers that must not hard-fail (the LLM
// resolver) catch this and fall back to the platform key.
function getKey(): Buffer {
  const raw = process.env.BYOK_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("BYOK_ENCRYPTION_KEY is not set");
  }
  const buf =
    /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("BYOK_ENCRYPTION_KEY must decode to 32 bytes (hex or base64)");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed ciphertext");
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

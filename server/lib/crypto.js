import crypto from "node:crypto";

/* Production secret safety (P5):
   - production REQUIRES a valid 64-char hex ENCRYPTION_KEY (AES-256) and
     aborts boot otherwise — never silently derives a fallback key.
   - development falls back to sha256(raw < "dev key") so local dev works. */
const raw = process.env.ENCRYPTION_KEY || "";
const isValidHex = /^[0-9a-fA-F]{64}$/.test(raw);
const isProd = process.env.NODE_ENV === "production";

if (isProd && !isValidHex) {
  throw new Error(
    "[switchboard] Boot aborted: ENCRYPTION_KEY must be a 64-character hex key (32 bytes) in production."
  );
}
if (!isProd && !raw) {
  console.warn(
    "[switchboard] dev warning: ENCRYPTION_KEY not set — deriving an insecure dev key (dev only)."
  );
}

const KEY = isValidHex ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw || "dev_insecure_key").digest();

/**
 * Encrypt a secret. Output: base64(iv(12) || authTag(16) || ciphertext)
 */
export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypt a stored payload. Throws if tampered (auth tag mismatch).
 */
export function decryptSecret(payloadB64) {
  const buf = Buffer.from(payloadB64, "base64");
  if (buf.length < 12 + 16) throw new Error("Malformed encrypted payload");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const cipherText = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
}

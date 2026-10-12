import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Opaque thread handles for the supervisor confirm/override/reject route
 * (R-06 Task 10.4, `docs/tasks/R-06.md` §0 item 3). `thread_id` embeds the
 * device id (`unit_${device_id}_${window_id}:${n}`), and a plain hash is
 * brute-forceable back to it (device ids are human-chosen). So the
 * supervisor day record never carries a thread id directly — it carries
 * this handle, which only the server can open, scoped to one outlet (AAD),
 * server-only (`node:crypto`, never imported by browser code).
 */

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce size
const TAG_BYTES = 16; // GCM standard tag size
/** A sealed handle is never remotely this long; rejecting early avoids doing
 * any crypto work on an obviously-bogus or hostile input. */
const MAX_HANDLE_LENGTH = 512;

/**
 * Reads `THREAD_HANDLE_KEY` (base64 of exactly 32 raw bytes) from `env`.
 * Missing, not valid base64, or the wrong decoded length -> `null` (never
 * throws) — callers treat a `null` key as "the confirm route is not
 * configured yet" (503), not a crash.
 */
/** Standard, padded base64 (the `raw.length % 4 !== 0` check below rejects
 * unpadded input); `Buffer.from` silently drops invalid characters instead
 * of throwing, so this guards the format itself. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function readThreadHandleKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  // Secret Manager provisioning (`openssl rand -base64 32` piped via
  // `--data-file=-`) commonly leaves a trailing newline; trim it so that
  // doesn't silently turn every handle null (and can_review false everywhere).
  const raw = env.THREAD_HANDLE_KEY?.trim();
  if (!raw) return null;
  if (!BASE64_RE.test(raw) || raw.length % 4 !== 0) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) return null;
  return key;
}

/**
 * Seals `threadId` into an opaque handle: AES-256-GCM with a fresh random
 * 12-byte iv, AAD = utf8(outletId) (binds the handle to one outlet — opening
 * it under a different outlet's claims fails even with the right key), wire
 * format `base64url(iv ‖ ciphertext ‖ tag)`. Two seals of the same thread id
 * differ (fresh iv each call).
 */
export function sealThreadHandle(threadId: string, outletId: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(outletId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(threadId, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64url");
}

/**
 * Reverses `sealThreadHandle`. Any failure — too long, not base64url, too
 * short to contain iv+tag, a bad/tampered tag, or the wrong outlet AAD —
 * returns `null`. Never throws (so a route can treat a bad handle as a
 * clean 404, never a 500).
 */
export function openThreadHandle(handle: string, outletId: string, key: Buffer): string | null {
  if (handle.length === 0 || handle.length > MAX_HANDLE_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(handle)) return null;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(handle, "base64url");
  } catch {
    return null;
  }
  if (bytes.length < IV_BYTES + TAG_BYTES) return null;

  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(bytes.length - TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(outletId, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // Bad tag (tampered ciphertext, flipped character) or wrong outlet AAD.
    return null;
  }
}

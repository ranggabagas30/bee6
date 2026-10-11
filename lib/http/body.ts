import { AppError, PayloadTooLargeError } from "@/lib/http/errors";

/**
 * Small-body helpers for anonymous routes (R-12 M3). `req.text()` reads the whole body before any
 * size check, so an anonymous caller could make the server buffer megabytes; these refuse early.
 */

/**
 * Reads a request body as UTF-8 text, never holding more than `maxBytes`. A declared Content-Length
 * over the cap is refused before the stream is touched; the stream itself is counted in BYTES (not
 * characters) and cancelled the moment it crosses the cap, so a missing or lying Content-Length
 * cannot get past it.
 */
export async function readBodyTextCapped(
  req: { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<string> {
  const declared = req.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) throw new PayloadTooLargeError();
  if (req.body === null) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 415 unless the Content-Type's media type is exactly `application/json` (parameters and case ignored). */
export function requireJsonContentType(headers: { get(name: string): string | null }): void {
  const mediaType = (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new AppError("Content-Type must be application/json", "UNSUPPORTED_MEDIA_TYPE", 415);
  }
}

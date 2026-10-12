import { describe, expect, it } from "vitest";
import { AppError, PayloadTooLargeError } from "@/lib/http/errors";
import { readBodyTextCapped, requireJsonContentType } from "@/lib/http/body";

function reqOf(body: BodyInit | ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) {
  return new Request("http://localhost/x", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

describe("readBodyTextCapped", () => {
  it("returns the text of a body within the cap, and '' when there is no body", async () => {
    expect(await readBodyTextCapped(reqOf('{"a":1}'), 1024)).toBe('{"a":1}');
    expect(await readBodyTextCapped(new Request("http://localhost/x", { method: "POST" }), 1024)).toBe("");
  });

  it("accepts a body of exactly the cap and refuses one byte more", async () => {
    expect(await readBodyTextCapped(reqOf("x".repeat(10)), 10)).toBe("x".repeat(10));
    await expect(readBodyTextCapped(reqOf("x".repeat(11)), 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("refuses on a declared Content-Length over the cap without pulling the stream", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull: (c) => void (pulled++, c.enqueue(new Uint8Array(5))) }, { highWaterMark: 0 });
    await expect(readBodyTextCapped(reqOf(stream, { "content-length": "500" }), 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(pulled).toBe(0);
  });

  it("stops reading a stream with no Content-Length once the cap is crossed", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled += 1;
          c.enqueue(new Uint8Array(4));
          if (pulled > 1000) c.close();
        },
      },
      { highWaterMark: 0 },
    );
    await expect(readBodyTextCapped(reqOf(stream), 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(pulled).toBeLessThan(10);
  });

  it("counts bytes, not characters", async () => {
    await expect(readBodyTextCapped(reqOf("é".repeat(6)), 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(await readBodyTextCapped(reqOf("é".repeat(5)), 10)).toBe("é".repeat(5));
  });

  it("ignores a lying small Content-Length when the stream is bigger (the stream count is the backstop)", async () => {
    await expect(readBodyTextCapped(reqOf("x".repeat(50), { "content-length": "5" }), 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("treats a non-numeric Content-Length as absent (the stream is still capped)", async () => {
    await expect(readBodyTextCapped(reqOf("x".repeat(50), { "content-length": "abc" }), 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(await readBodyTextCapped(reqOf("x", { "content-length": "abc" }), 10)).toBe("x");
  });
});

describe("requireJsonContentType", () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { "content-type": v });

  it("accepts application/json with or without parameters, any case", () => {
    for (const v of ["application/json", "application/json; charset=utf-8", "Application/JSON", " application/json ;charset=UTF-8"]) {
      expect(() => requireJsonContentType(h(v)), v).not.toThrow();
    }
  });

  it("throws a 415 for anything else or nothing", () => {
    for (const v of [undefined, "", "text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp", "application/json-patch+json"]) {
      let err: unknown;
      try {
        requireJsonContentType(h(v));
      } catch (e) {
        err = e;
      }
      expect(err, String(v)).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(415);
      expect((err as AppError).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
  });
});

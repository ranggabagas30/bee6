import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { clientIp, ipBucketKey, resolveXffFromEnd, secondsToUtcMidnight, utcDay } from "@/lib/demo/limits";

const h = (v: Record<string, string>) => new Headers(v);

describe("ipBucketKey", () => {
  it("is HMAC-SHA256 (the salt is the key) of ip:day, hex, and never contains the ip", () => {
    const key = ipBucketKey("203.0.113.9", "2026-10-28", "pepper");
    expect(key).toBe(createHmac("sha256", "pepper").update("203.0.113.9:2026-10-28").digest("hex"));
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.9");
  });

  it("differs by ip, day and salt", () => {
    const base = ipBucketKey("1.1.1.1", "2026-10-28", "s");
    expect(ipBucketKey("1.1.1.2", "2026-10-28", "s")).not.toBe(base);
    expect(ipBucketKey("1.1.1.1", "2026-10-29", "s")).not.toBe(base);
    expect(ipBucketKey("1.1.1.1", "2026-10-28", "t")).not.toBe(base);
  });

  it("refuses an empty salt (never an unsalted hash)", () => {
    expect(() => ipBucketKey("1.1.1.1", "2026-10-28", "")).toThrow();
  });
});

describe("clientIp", () => {
  it("defaults to the LAST x-forwarded-for entry (the one Google's front end appends), trimmed", () => {
    expect(clientIp(h({ "x-forwarded-for": "10.0.0.1 , 203.0.113.9 " }))).toBe("203.0.113.9");
  });

  it("a hostile prefix ahead of the true tail cannot choose the bucket", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "a, b, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "a, b" }))).toBe("unknown"); // the tail itself is not an IP
  });

  it("falls back to the shared 'unknown' bucket when the header is missing or empty (E17)", () => {
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": " , " }))).toBe("unknown");
  });

  it("with fromEnd=N takes the Nth entry from the end", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" });
    expect(clientIp(headers, 1)).toBe("10.0.0.1");
    expect(clientIp(headers, 2)).toBe("203.0.113.9");
    expect(clientIp(headers, 3)).toBe("6.6.6.6");
  });

  it("falls back to unknown when fromEnd points outside the list", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1" }), 3)).toBe("unknown");
  });

  it("accepts only a real IP: strips :port and [brackets], else the unknown bucket", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9:4433" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "[2001:DB8::1]" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "9".repeat(500) }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "999.1.1.1" }))).toBe("unknown");
  });
});

describe("resolveXffFromEnd (DEMO_XFF_FROM_END)", () => {
  it("is 1 when unset or empty", () => {
    expect(resolveXffFromEnd(undefined)).toBe(1);
    expect(resolveXffFromEnd("")).toBe(1);
  });

  it("accepts a positive integer in range, ignoring surrounding whitespace and newlines", () => {
    expect(resolveXffFromEnd("2")).toBe(2);
    expect(resolveXffFromEnd("1\n")).toBe(1);
    expect(resolveXffFromEnd(" 3 ")).toBe(3);
    expect(resolveXffFromEnd("10")).toBe(10);
  });

  it("fails CLOSED to 1 (never the first entry) on anything else", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of ["abc", "100", "0", "-1", "1.5", "11", "1 2", "0x2", "+2"]) {
      expect(resolveXffFromEnd(bad)).toBe(1);
    }
    err.mockRestore();
  });

  it("logs the misconfiguration once per process, without echoing the value", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/demo/limits");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fresh.resolveXffFromEnd("abc");
    fresh.resolveXffFromEnd("100");
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).not.toContain("abc");
    err.mockRestore();
  });
});

describe("utcDay / secondsToUtcMidnight", () => {
  it("formats the UTC day", () => {
    expect(utcDay(Date.UTC(2026, 9, 28, 23, 59, 59))).toBe("2026-10-28");
    expect(utcDay(Date.UTC(2026, 9, 29, 0, 0, 0))).toBe("2026-10-29");
  });

  it("counts seconds to the next UTC midnight, at least 1", () => {
    expect(secondsToUtcMidnight(Date.UTC(2026, 9, 28, 23, 0, 0))).toBe(3600);
    expect(secondsToUtcMidnight(Date.UTC(2026, 9, 29, 0, 0, 0))).toBe(86_400);
    expect(secondsToUtcMidnight(Date.UTC(2026, 9, 28, 23, 59, 59, 999))).toBe(1);
  });
});

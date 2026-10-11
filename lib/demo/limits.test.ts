import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clientIp, ipBucketKey, secondsToUtcMidnight, utcDay } from "@/lib/demo/limits";

const h = (v: Record<string, string>) => new Headers(v);

describe("ipBucketKey", () => {
  it("is SHA-256 hex of ip:day:salt and never contains the ip", () => {
    const key = ipBucketKey("203.0.113.9", "2026-10-28", "pepper");
    expect(key).toBe(createHash("sha256").update("203.0.113.9:2026-10-28:pepper").digest("hex"));
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
  it("takes the first x-forwarded-for entry, trimmed", () => {
    expect(clientIp(h({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("falls back to the shared 'unknown' bucket when the header is missing or empty (E17)", () => {
    expect(clientIp(h({}))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": " , " }))).toBe("unknown");
  });

  it("with fromEnd=N takes the Nth entry from the end (proxy-appended, not client-supplied)", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientIp(headers)).toBe("6.6.6.6");
    expect(clientIp(headers, 1)).toBe("203.0.113.9");
    expect(clientIp(headers, 2)).toBe("6.6.6.6");
  });

  it("falls back to unknown when fromEnd points outside the list", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1" }), 3)).toBe("unknown");
  });

  it("bounds the length of what it returns (a hostile header never becomes a huge hash input)", () => {
    expect(clientIp(h({ "x-forwarded-for": "9".repeat(500) })).length).toBeLessThanOrEqual(64);
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

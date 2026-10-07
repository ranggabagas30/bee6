import { describe, expect, it } from "vitest";
import {
  ANSWER_CACHE_KEY,
  CacheWriteError,
  appendAnswer,
  cachedIds,
  pendingSummary,
  purgeExpired,
  purgeNow,
  readCache,
  removeEntry,
} from "@/lib/debrief/answer-cache";
import { ANSWER_CACHE_MAX_AGE_MS } from "@/lib/debrief/constants";
import type { AnswerCacheEntry } from "@/lib/debrief/contract";

/**
 * Phone answer cache (R-07 Task 6, `docs/tasks/R-07-plan.md`). `Storage` is
 * injected — these tests use an in-memory fake, never `window.localStorage` —
 * so the rules (14-day purge, dedupe, no name/staff/device field) are proven
 * without a browser.
 */

class MapStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const NOW = 1_700_000_000_000;

function entry(overrides: Partial<AnswerCacheEntry> = {}): AnswerCacheEntry {
  return {
    question_id: "q_thread_1",
    debrief_business_date: "2026-10-06",
    answer: "yes",
    reason: "lupa restock",
    answered_at_ms: NOW,
    ...overrides,
  };
}

describe("readCache", () => {
  it("returns [] when the key is missing", () => {
    expect(readCache(new MapStorage())).toEqual([]);
  });

  it("returns [] on corrupt JSON, and the next append still succeeds", () => {
    const storage = new MapStorage();
    storage.setItem(ANSWER_CACHE_KEY, "{not json");
    expect(readCache(storage)).toEqual([]);

    expect(appendAnswer(storage, entry(), NOW)).toBe("added");
    expect(readCache(storage)).toEqual([entry()]);
  });

  it("returns [] when the stored value is valid JSON but not an array", () => {
    const storage = new MapStorage();
    storage.setItem(ANSWER_CACHE_KEY, JSON.stringify({ not: "an array" }));
    expect(readCache(storage)).toEqual([]);
  });

  it("drops an item that fails AnswerCacheEntrySchema (e.g. an added name field), keeps the rest", () => {
    const storage = new MapStorage();
    storage.setItem(
      ANSWER_CACHE_KEY,
      JSON.stringify([entry(), { ...entry({ question_id: "q2" }), name: "Dina" }]),
    );
    expect(readCache(storage)).toEqual([entry()]);
  });
});

describe("purgeExpired", () => {
  it("keeps an entry 1 ms younger than the max age", () => {
    const e = entry({ answered_at_ms: NOW - (ANSWER_CACHE_MAX_AGE_MS - 1) });
    expect(purgeExpired([e], NOW)).toEqual([e]);
  });

  it("removes an entry exactly at the max age", () => {
    const e = entry({ answered_at_ms: NOW - ANSWER_CACHE_MAX_AGE_MS });
    expect(purgeExpired([e], NOW)).toEqual([]);
  });
});

describe("appendAnswer", () => {
  it("adds a new entry", () => {
    const storage = new MapStorage();
    expect(appendAnswer(storage, entry(), NOW)).toBe("added");
    expect(readCache(storage)).toEqual([entry()]);
  });

  it("returns duplicate for an already-cached question_id, and leaves the first entry unchanged", () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry({ answer: "yes", reason: "first" }), NOW);
    const result = appendAnswer(storage, entry({ answer: "no", reason: "second" }), NOW + 1);
    expect(result).toBe("duplicate");
    expect(readCache(storage)).toEqual([entry({ answer: "yes", reason: "first" })]);
  });

  it("purges expired entries before appending", () => {
    const storage = new MapStorage();
    const stale = entry({ question_id: "old", answered_at_ms: NOW - ANSWER_CACHE_MAX_AGE_MS });
    storage.setItem(ANSWER_CACHE_KEY, JSON.stringify([stale]));
    appendAnswer(storage, entry({ question_id: "new" }), NOW);
    expect(readCache(storage).map((e) => e.question_id)).toEqual(["new"]);
  });

  it("throws CacheWriteError when storage.setItem throws (quota, private mode)", () => {
    const storage: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => appendAnswer(storage, entry(), NOW)).toThrow(CacheWriteError);
  });

  it("validates the entry with the schema before touching storage", () => {
    const storage = new MapStorage();
    expect(() =>
      appendAnswer(storage, { ...entry(), reason: "" }, NOW),
    ).toThrow();
    expect(readCache(storage)).toEqual([]);
  });
});

describe("removeEntry", () => {
  it("removes only the matching entry", () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry({ question_id: "a" }), NOW);
    appendAnswer(storage, entry({ question_id: "b" }), NOW);
    removeEntry(storage, "a");
    expect(readCache(storage).map((e) => e.question_id)).toEqual(["b"]);
  });

  it("is a no-op when the id is not cached", () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry({ question_id: "a" }), NOW);
    removeEntry(storage, "missing");
    expect(readCache(storage).map((e) => e.question_id)).toEqual(["a"]);
  });
});

describe("purgeNow", () => {
  it("removes expired entries and returns the count removed", () => {
    const storage = new MapStorage();
    const stale = entry({ question_id: "old", answered_at_ms: NOW - ANSWER_CACHE_MAX_AGE_MS });
    const fresh = entry({ question_id: "new", answered_at_ms: NOW });
    storage.setItem(ANSWER_CACHE_KEY, JSON.stringify([stale, fresh]));
    expect(purgeNow(storage, NOW)).toBe(1);
    expect(readCache(storage).map((e) => e.question_id)).toEqual(["new"]);
  });

  it("returns 0 and does not rewrite storage when nothing is expired", () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    expect(purgeNow(storage, NOW)).toBe(0);
    expect(readCache(storage)).toEqual([entry()]);
  });
});

describe("pendingSummary", () => {
  it("returns count 0 and oldest_date null for an empty list", () => {
    expect(pendingSummary([])).toEqual({ count: 0, oldest_date: null });
  });

  it("returns the count and the oldest entry's business date", () => {
    const entries = [
      entry({ question_id: "a", debrief_business_date: "2026-10-06", answered_at_ms: NOW }),
      entry({ question_id: "b", debrief_business_date: "2026-10-05", answered_at_ms: NOW - 86_400_000 }),
    ];
    expect(pendingSummary(entries)).toEqual({ count: 2, oldest_date: "2026-10-05" });
  });
});

describe("cachedIds", () => {
  it("returns the ids of unexpired cached entries only", () => {
    const storage = new MapStorage();
    const stale = entry({ question_id: "old", answered_at_ms: NOW - ANSWER_CACHE_MAX_AGE_MS });
    const fresh = entry({ question_id: "new", answered_at_ms: NOW });
    storage.setItem(ANSWER_CACHE_KEY, JSON.stringify([stale, fresh]));
    expect(cachedIds(storage, NOW)).toEqual(new Set(["new"]));
  });
});

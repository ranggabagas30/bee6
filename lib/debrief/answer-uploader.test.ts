import { describe, expect, it, vi } from "vitest";
import {
  createAnswerUploader,
  dispositionFor,
} from "@/lib/debrief/answer-uploader";
import { appendAnswer, readCache, ANSWER_CACHE_KEY } from "@/lib/debrief/answer-cache";
import { ANSWER_CACHE_MAX_AGE_MS } from "@/lib/debrief/constants";
import type { DeviceAuth } from "@/lib/capture/browser/client";
import type { AnswerCacheEntry } from "@/lib/debrief/contract";

/**
 * Phone answer uploader (R-07 Task 6). `fetchFn`/`storage`/`now` are all
 * injected so the flush loop, dispositions and single-flight are proven
 * without a real network or browser.
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
const AUTH: DeviceAuth = { deviceToken: "tok-123", deviceId: "dev-1" };

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

function okResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

/**
 * A fetch stand-in that behaves like the browser's: called with any `this` other than undefined/globalThis
 * it throws "Illegal invocation", exactly what `deps.fetchFn(...)` hit with the global fetch in Chromium.
 */
function strictFetch(respond: () => Promise<Response>): typeof fetch & { calls: number } {
  const fn = function (this: unknown): Promise<Response> {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    fn.calls += 1;
    return respond();
  } as unknown as typeof fetch & { calls: number };
  fn.calls = 0;
  return fn;
}

describe("dispositionFor", () => {
  it("removed_ok for 2xx", () => {
    expect(dispositionFor(200)).toBe("removed_ok");
    expect(dispositionFor(299)).toBe("removed_ok");
  });
  it("removed_refused for 400, 404, 422", () => {
    expect(dispositionFor(400)).toBe("removed_refused");
    expect(dispositionFor(404)).toBe("removed_refused");
    expect(dispositionFor(422)).toBe("removed_refused");
  });
  it("kept_retry for 401, 403, 409, 429 and >= 500", () => {
    expect(dispositionFor(401)).toBe("kept_retry");
    expect(dispositionFor(403)).toBe("kept_retry");
    expect(dispositionFor(409)).toBe("kept_retry");
    expect(dispositionFor(429)).toBe("kept_retry");
    expect(dispositionFor(503)).toBe("kept_retry");
  });
  it("kept_offline for a network failure", () => {
    expect(dispositionFor("network")).toBe("kept_offline");
  });
});

describe("createAnswerUploader.flush", () => {
  function makeDeps(fetchFn: typeof fetch, storage: Storage = new MapStorage()) {
    const devLog = vi.fn();
    return {
      deps: { storage, fetchFn, auth: AUTH, now: () => NOW, devLog },
      storage,
      devLog,
    };
  }

  it("caches the entry before any fetch call (commitAndSend call order)", async () => {
    const calls: string[] = [];
    const storage = new MapStorage();
    const wrappedStorage: Storage = {
      ...storage,
      setItem: (k, v) => {
        calls.push("setItem");
        storage.setItem(k, v);
      },
      getItem: (k) => storage.getItem(k),
      removeItem: (k) => storage.removeItem(k),
      clear: () => storage.clear(),
      key: (i) => storage.key(i),
      get length() {
        return storage.length;
      },
    };
    const fetchFn = vi.fn(async () => {
      calls.push("fetch");
      return okResponse(200);
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, wrappedStorage);
    const uploader = createAnswerUploader(deps);

    function commitAndSend(e: AnswerCacheEntry) {
      appendAnswer(wrappedStorage, e, NOW);
      return uploader.flush();
    }

    await commitAndSend(entry());
    expect(calls[0]).toBe("setItem");
    expect(calls).toContain("fetch");
    expect(calls.indexOf("setItem")).toBeLessThan(calls.indexOf("fetch"));
  });

  it("calls fetchFn without `this`: a browser fetch throws 'Illegal invocation' when called as a method of the deps", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    const fetchFn = strictFetch(async () => okResponse(200));
    const { deps } = makeDeps(fetchFn, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(fetchFn.calls).toBe(1);
    expect(result.last).toBe("removed_ok");
    expect(readCache(storage)).toEqual([]);
  });

  it("removes the entry on 200 and on 200 already_answered", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    const fetchFn = vi.fn(async () => okResponse(200));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(result.last).toBe("removed_ok");
    expect(readCache(storage)).toEqual([]);
  });

  it("removes the entry on 400 and devLogs question_id + status, no reason", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    const fetchFn = vi.fn(async () => okResponse(400));
    const { deps, devLog } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(result.last).toBe("removed_refused");
    expect(readCache(storage)).toEqual([]);
    expect(devLog).toHaveBeenCalledWith({
      kind: "answer_refused",
      question_id: "q_thread_1",
      status: 400,
    });
    const loggedJson = JSON.stringify(devLog.mock.calls[0]);
    expect(loggedJson).not.toContain("lupa restock");
  });

  it("removes the entry on 404", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    const fetchFn = vi.fn(async () => okResponse(404));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(result.last).toBe("removed_refused");
    expect(readCache(storage)).toEqual([]);
  });

  it("keeps the entry on 503, 409, 429 and 401", async () => {
    for (const status of [503, 409, 429, 401]) {
      const storage = new MapStorage();
      appendAnswer(storage, entry(), NOW);
      const fetchFn = vi.fn(async () => okResponse(status));
      const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
      const result = await createAnswerUploader(deps).flush();
      expect(result.last).toBe("kept_retry");
      expect(readCache(storage)).toEqual([entry()]);
    }
  });

  it("keeps the entry and returns kept_offline on a network failure", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    const fetchFn = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(result.last).toBe("kept_offline");
    expect(readCache(storage)).toEqual([entry()]);
  });

  it("purges an entry at exactly the max age without ever fetching it", async () => {
    const storage = new MapStorage();
    storage.setItem(
      ANSWER_CACHE_KEY,
      JSON.stringify([entry({ answered_at_ms: NOW - ANSWER_CACHE_MAX_AGE_MS })]),
    );
    const fetchFn = vi.fn(async () => okResponse(200));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.pending).toBe(0);
    expect(readCache(storage)).toEqual([]);
  });

  it("sends and removes an entry 1 minute younger than the max age", async () => {
    const storage = new MapStorage();
    appendAnswer(
      storage,
      entry({ answered_at_ms: NOW - ANSWER_CACHE_MAX_AGE_MS + 60_000 }),
      NOW - ANSWER_CACHE_MAX_AGE_MS + 60_000,
    );
    const fetchFn = vi.fn(async () => okResponse(200));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.pending).toBe(0);
  });

  it("stops the loop at the first kept_* result (a second entry is never fetched)", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry({ question_id: "a", answered_at_ms: NOW - 1000 }), NOW - 1000);
    appendAnswer(storage, entry({ question_id: "b", answered_at_ms: NOW }), NOW);
    const fetchFn = vi.fn(async () => okResponse(503));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    await createAnswerUploader(deps).flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(readCache(storage).map((e) => e.question_id)).toEqual(["a", "b"]);
  });

  it("sends oldest answered_at_ms first", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry({ question_id: "newer", answered_at_ms: NOW }), NOW);
    appendAnswer(storage, entry({ question_id: "older", answered_at_ms: NOW - 5000 }), NOW);
    const sentIds: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      sentIds.push(decodeURIComponent(String(url).split("/")[4] ?? ""));
      return okResponse(200);
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    await createAnswerUploader(deps).flush();
    expect(sentIds).toEqual(["older", "newer"]);
  });

  it("sends only the five cache-entry keys as the POST body, with device auth headers", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return okResponse(200);
    });
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    await createAnswerUploader(deps).flush();
    expect(capturedInit).toBeDefined();
    const body = JSON.parse(String(capturedInit?.body));
    expect(Object.keys(body).sort()).toEqual(
      ["answer", "answered_at_ms", "debrief_business_date", "question_id", "reason"].sort(),
    );
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer tok-123",
      "X-Device-Id": "dev-1",
      "Content-Type": "application/json",
    });
  });

  it("single-flight: a second flush() call while one is running returns the same promise", async () => {
    const storage = new MapStorage();
    appendAnswer(storage, entry(), NOW);
    let resolveFetch: (() => void) | undefined;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => resolve(okResponse(200));
        }),
    );
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const uploader = createAnswerUploader(deps);
    const first = uploader.flush();
    const second = uploader.flush();
    expect(second).toBe(first);
    resolveFetch?.();
    await first;
  });

  it("returns pending 0 and last null when the cache is empty", async () => {
    const storage = new MapStorage();
    const fetchFn = vi.fn(async () => okResponse(200));
    const { deps } = makeDeps(fetchFn as unknown as typeof fetch, storage);
    const result = await createAnswerUploader(deps).flush();
    expect(result).toEqual({ last: null, pending: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

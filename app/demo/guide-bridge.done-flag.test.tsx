// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEBRIEF_DONE_EVENT, DEBRIEF_DONE_FLAG_KEY } from "@/lib/debrief/constants";
import { writeDoneFlag } from "@/lib/debrief/done-flag";
import { useDebriefDoneFlag } from "@/app/demo/guide-bridge";

/**
 * R-19 PR-5 round-3 D3: the guide phase must follow the debrief's done screen at once, not on the page's 30 s
 * clock tick. The code that writes the done flag announces it on the same document (a window event); other tabs
 * hear it through the browser's `storage` event. The capture page reads the flag through `useDebriefDoneFlag`,
 * which re-reads on either, so the bridge is re-published immediately.
 */

class MemStorage implements Storage {
  private map = new Map<string, string>();
  [name: string]: unknown;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const ENDS_AT = Date.parse("2026-10-14T15:00:00Z");

afterEach(() => vi.unstubAllGlobals());

describe("writeDoneFlag announces the flag on the document", () => {
  it("dispatches DEBRIEF_DONE_EVENT on window after writing the flag", () => {
    const storage = new MemStorage();
    const heard = vi.fn();
    window.addEventListener(DEBRIEF_DONE_EVENT, heard);
    try {
      writeDoneFlag(storage, ENDS_AT, { answered: 1, skipped: 0 });
      expect(heard).toHaveBeenCalledTimes(1);
      expect(storage.getItem(DEBRIEF_DONE_FLAG_KEY)).toBe(String(ENDS_AT));
    } finally {
      window.removeEventListener(DEBRIEF_DONE_EVENT, heard);
    }
  });

  it("the event name is namespaced and carries no data (no counts, no ids)", () => {
    expect(DEBRIEF_DONE_EVENT).toBe("bee6:debrief-done");
    const storage = new MemStorage();
    let seen: Event | null = null;
    const listener = (e: Event) => {
      seen = e;
    };
    window.addEventListener(DEBRIEF_DONE_EVENT, listener);
    try {
      writeDoneFlag(storage, ENDS_AT, { answered: 3, skipped: 2 });
    } finally {
      window.removeEventListener(DEBRIEF_DONE_EVENT, listener);
    }
    expect(seen).not.toBeNull();
    expect((seen as unknown as Event).constructor).toBe(Event);
  });
});

describe("useDebriefDoneFlag", () => {
  it("is null with no flag, and becomes the flag the moment writeDoneFlag runs in this document (no timer, no reload)", () => {
    const storage = new MemStorage();
    vi.stubGlobal("localStorage", storage);
    const { result } = renderHook(() => useDebriefDoneFlag());
    expect(result.current).toBeNull();
    act(() => writeDoneFlag(storage, ENDS_AT, { answered: 1, skipped: 0 }));
    expect(result.current).toBe(String(ENDS_AT));
  });

  it("re-reads on the browser's storage event for the flag key (another tab wrote it)", () => {
    const storage = new MemStorage();
    vi.stubGlobal("localStorage", storage);
    const { result } = renderHook(() => useDebriefDoneFlag());
    expect(result.current).toBeNull();
    storage.setItem(DEBRIEF_DONE_FLAG_KEY, String(ENDS_AT)); // as another tab would, no same-document event
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: DEBRIEF_DONE_FLAG_KEY, newValue: String(ENDS_AT) }));
    });
    expect(result.current).toBe(String(ENDS_AT));
    act(() => {
      storage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null })); // a clear() elsewhere
    });
    expect(result.current).toBeNull();
  });

  it("stops listening on unmount", () => {
    const storage = new MemStorage();
    vi.stubGlobal("localStorage", storage);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useDebriefDoneFlag());
    const addedTypes = add.mock.calls.map((c) => c[0]).filter((t) => t === DEBRIEF_DONE_EVENT || t === "storage");
    expect(addedTypes.sort()).toEqual([DEBRIEF_DONE_EVENT, "storage"]);
    unmount();
    const removedTypes = remove.mock.calls.map((c) => c[0]).filter((t) => t === DEBRIEF_DONE_EVENT || t === "storage");
    expect(removedTypes.sort()).toEqual([DEBRIEF_DONE_EVENT, "storage"]);
    add.mockRestore();
    remove.mockRestore();
  });

  it("a storage that throws reads as no flag (the phase falls back to the window rule)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    const { result } = renderHook(() => useDebriefDoneFlag());
    expect(result.current).toBeNull();
  });
});

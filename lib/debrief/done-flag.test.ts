import { describe, expect, it } from "vitest";
import { DEBRIEF_DONE_FLAG_KEY, DEBRIEF_DONE_SUMMARY_KEY } from "@/lib/debrief/constants";
import { readDoneFlag, writeDoneFlag } from "@/lib/debrief/done-flag";

/**
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3, terminal done): the completion flag a sandbox judge device
 * writes on entering `done`, so a reload inside the hour shows the done summary again instead of the entry
 * card. Plain strings in localStorage: no question text, no reason, no device id.
 */

class MemStorage implements Storage {
  private map = new Map<string, string>();
  throwOnSet = false;
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
    if (this.throwOnSet) throw new Error("quota");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const ENDS = 1_760_000_000_000;

describe("writeDoneFlag", () => {
  it("writes the flag as String(endsAtMs) under the documented key, and the counts beside it", () => {
    const s = new MemStorage();
    writeDoneFlag(s, ENDS, { answered: 3, skipped: 1 });
    expect(s.getItem(DEBRIEF_DONE_FLAG_KEY)).toBe(String(ENDS));
    expect(JSON.parse(s.getItem(DEBRIEF_DONE_SUMMARY_KEY) ?? "null")).toEqual({ answered: 3, skipped: 1 });
  });

  it("a storage that throws is swallowed (the done screen must still render)", () => {
    const s = new MemStorage();
    s.throwOnSet = true;
    expect(() => writeDoneFlag(s, ENDS, { answered: 1, skipped: 0 })).not.toThrow();
    expect(readDoneFlag(s, ENDS)).toBeNull();
  });
});

describe("readDoneFlag", () => {
  it("returns the counts when the flag equals this debrief's endsAtMs", () => {
    const s = new MemStorage();
    writeDoneFlag(s, ENDS, { answered: 2, skipped: 0 });
    expect(readDoneFlag(s, ENDS)).toEqual({ answered: 2, skipped: 0 });
  });

  it("null when there is no flag", () => {
    expect(readDoneFlag(new MemStorage(), ENDS)).toBeNull();
  });

  it("null when the flag belongs to another debrief (a different endsAtMs)", () => {
    const s = new MemStorage();
    writeDoneFlag(s, ENDS - 3_600_000, { answered: 2, skipped: 0 });
    expect(readDoneFlag(s, ENDS)).toBeNull();
  });

  it("a matching flag with a missing or malformed summary reads as 0 answered, 0 skipped", () => {
    const s = new MemStorage();
    s.setItem(DEBRIEF_DONE_FLAG_KEY, String(ENDS));
    expect(readDoneFlag(s, ENDS)).toEqual({ answered: 0, skipped: 0 });
    s.setItem(DEBRIEF_DONE_SUMMARY_KEY, "{not json");
    expect(readDoneFlag(s, ENDS)).toEqual({ answered: 0, skipped: 0 });
    s.setItem(DEBRIEF_DONE_SUMMARY_KEY, JSON.stringify({ answered: -1, skipped: "x" }));
    expect(readDoneFlag(s, ENDS)).toEqual({ answered: 0, skipped: 0 });
  });

  it("a storage that throws on read is null, never an exception", () => {
    const s = new MemStorage();
    s.getItem = () => {
      throw new Error("blocked");
    };
    expect(readDoneFlag(s, ENDS)).toBeNull();
  });
});

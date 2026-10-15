import { describe, expect, it } from "vitest";
import { DEBRIEF_DONE_FLAG_KEY, DEBRIEF_DONE_SUMMARY_KEY, DEBRIEF_PROGRESS_KEY } from "@/lib/debrief/constants";
import { readDoneFlag, readProgress, writeDoneFlag, writeProgress } from "@/lib/debrief/done-flag";

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

describe("progress record (reload mid-debrief)", () => {
  it("round-trips the counts for the same endsAtMs; counts only (no ids, no text)", () => {
    const s = new MemStorage();
    writeProgress(s, ENDS, { answered: 3, skipped: 1, seen: ["q1", "q2", "q3", "q4"] });
    expect(readProgress(s, ENDS)).toEqual({ answered: 3, skipped: 1, seen: ["q1", "q2", "q3", "q4"] });
    const raw = s.getItem(DEBRIEF_PROGRESS_KEY) ?? "";
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["answered", "ends_at_ms", "seen", "skipped"]);
  });

  it("an older record without seen reads as an empty seen list, never crashes", () => {
    const s = new MemStorage();
    s.setItem(DEBRIEF_PROGRESS_KEY, JSON.stringify({ ends_at_ms: ENDS, answered: 2, skipped: 1 }));
    expect(readProgress(s, ENDS)).toEqual({ answered: 2, skipped: 1, seen: [] });
  });

  it("refuses more than 5 seen ids, an empty id or a non-string id", () => {
    const s = new MemStorage();
    const bad = (seen: unknown) => {
      s.setItem(DEBRIEF_PROGRESS_KEY, JSON.stringify({ ends_at_ms: ENDS, answered: 0, skipped: 0, seen }));
      return readProgress(s, ENDS);
    };
    expect(bad(["1", "2", "3", "4", "5", "6"])).toBeNull();
    expect(bad([""])).toBeNull();
    expect(bad([1])).toBeNull();
  });

  it("is null for another debrief's record, no record, a malformed record or a blocked storage", () => {
    const s = new MemStorage();
    expect(readProgress(s, ENDS)).toBeNull();
    writeProgress(s, ENDS, { answered: 3, skipped: 0, seen: [] });
    expect(readProgress(s, ENDS + 1)).toBeNull();
    s.setItem(DEBRIEF_PROGRESS_KEY, "not json");
    expect(readProgress(s, ENDS)).toBeNull();
    s.setItem(DEBRIEF_PROGRESS_KEY, JSON.stringify({ ends_at_ms: ENDS, answered: -1, skipped: 0 }));
    expect(readProgress(s, ENDS)).toBeNull();
    s.setItem(DEBRIEF_PROGRESS_KEY, JSON.stringify({ ends_at_ms: ENDS, answered: 1, skipped: 0, reason: "x" }));
    expect(readProgress(s, ENDS)).toBeNull();
  });

  it("never marks the debrief terminal: the done flag is untouched", () => {
    const s = new MemStorage();
    writeProgress(s, ENDS, { answered: 3, skipped: 0, seen: [] });
    expect(readDoneFlag(s, ENDS)).toBeNull();
    expect(s.getItem(DEBRIEF_DONE_FLAG_KEY)).toBeNull();
  });

  it("a storage that throws never breaks the screen", () => {
    const s = new MemStorage();
    s.throwOnSet = true;
    expect(() => writeProgress(s, ENDS, { answered: 1, skipped: 0, seen: [] })).not.toThrow();
  });
});

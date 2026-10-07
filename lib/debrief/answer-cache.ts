import { AnswerCacheEntrySchema, type AnswerCacheEntry } from "@/lib/debrief/contract";
import { ANSWER_CACHE_MAX_AGE_MS } from "@/lib/debrief/constants";

/**
 * The phone's answer cache (R-07 Task 6, `docs/tasks/R-07-plan.md`;
 * technical spec §8.11). `Storage` is injected — `window.localStorage` on
 * the page, an in-memory fake in tests — so every rule here is unit-tested
 * without a browser.
 *
 * Every entry is exactly the five `AnswerCacheEntry` keys (hard rule #7: no
 * name, staff id, PIN, role or device id field ever rides in this cache).
 * A corrupt or tampered stored value never throws; it is treated as empty
 * so the phone keeps working.
 */

export const ANSWER_CACHE_KEY = "bee6.debrief.answers";

/** Thrown only for a storage-write failure (quota exceeded, private mode). */
export class CacheWriteError extends Error {
  constructor(message = "Failed to write the answer cache") {
    super(message);
    this.name = "CacheWriteError";
  }
}

/**
 * Parses the stored value. Invalid JSON, a non-array, or any item that
 * fails `AnswerCacheEntrySchema` is dropped (never thrown) — each item is
 * checked independently so one bad entry doesn't discard the rest.
 */
export function readCache(storage: Storage): AnswerCacheEntry[] {
  const raw = storage.getItem(ANSWER_CACHE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: AnswerCacheEntry[] = [];
  for (const item of parsed) {
    const result = AnswerCacheEntrySchema.safeParse(item);
    if (result.success) out.push(result.data);
  }
  return out;
}

function writeCache(storage: Storage, entries: readonly AnswerCacheEntry[]): void {
  try {
    storage.setItem(ANSWER_CACHE_KEY, JSON.stringify(entries));
  } catch {
    throw new CacheWriteError();
  }
}

/** Keeps entries strictly younger than `ANSWER_CACHE_MAX_AGE_MS` (14 days). */
export function purgeExpired(
  entries: readonly AnswerCacheEntry[],
  now_ms: number,
): AnswerCacheEntry[] {
  return entries.filter((e) => now_ms - e.answered_at_ms < ANSWER_CACHE_MAX_AGE_MS);
}

/**
 * Purges expired entries, then appends `entry` unless its `question_id` is
 * already cached (first answer wins — "duplicate" changes nothing). Always
 * validates `entry` against the schema first (throws on an invalid shape,
 * not `CacheWriteError`), then performs exactly one `setItem` write.
 */
export function appendAnswer(
  storage: Storage,
  entry: AnswerCacheEntry,
  now_ms: number,
): "added" | "duplicate" {
  const validated = AnswerCacheEntrySchema.parse(entry);
  const existing = purgeExpired(readCache(storage), now_ms);
  if (existing.some((e) => e.question_id === validated.question_id)) {
    writeCache(storage, existing);
    return "duplicate";
  }
  writeCache(storage, [...existing, validated]);
  return "added";
}

/** Removes the entry with this `question_id`, if any; a no-op otherwise. */
export function removeEntry(storage: Storage, question_id: string): void {
  const entries = readCache(storage).filter((e) => e.question_id !== question_id);
  writeCache(storage, entries);
}

/** Purges expired entries and writes back only if something changed. Returns the count removed. */
export function purgeNow(storage: Storage, now_ms: number): number {
  const entries = readCache(storage);
  const kept = purgeExpired(entries, now_ms);
  if (kept.length !== entries.length) writeCache(storage, kept);
  return entries.length - kept.length;
}

/** Count and the oldest cached answer's business date (dev readouts, the heartbeat follow-up). */
export function pendingSummary(
  entries: readonly AnswerCacheEntry[],
): { count: number; oldest_date: string | null } {
  if (entries.length === 0) return { count: 0, oldest_date: null };
  let oldest = entries[0] as AnswerCacheEntry;
  for (const e of entries) {
    if (e.answered_at_ms < oldest.answered_at_ms) oldest = e;
  }
  return { count: entries.length, oldest_date: oldest.debrief_business_date };
}

/** The ids of unexpired cached answers, for the phone to filter out of the server's list. */
export function cachedIds(storage: Storage, now_ms: number): Set<string> {
  return new Set(purgeExpired(readCache(storage), now_ms).map((e) => e.question_id));
}

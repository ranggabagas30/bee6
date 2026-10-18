# QA after-days defects (18 Oct): root causes and fix plan

Source: `docs/tasks/QA-after-days-and-retry-18oct.md` (web-develop, image `9a74fe2` = origin/develop).
Author: tech-lead, read-only analysis (`git show 9a74fe2:<path>` exports and QA's saved evidence under the session
scratchpad `qa18/`). Nothing in the shared tree was mutated.

## 0. Summary and priority

| # | Severity | Root cause (one line) | Regression? | Today? | Branch | Owner |
|---|---|---|---|---|---|---|
| 1 | major | A line that **continues an open thread** (`O#` alias) has no `threads[]` entry (the label prompt forbids one), so `buildThreads` cannot resolve its category, puts it in `unassigned_line_ids`, and the tick ignores that list: the ledger marks the line `done` and it is lost for good. A late note right after the closing card is exactly such a line. | No. Pre-existing since R-05b (prompt rule added 2 Oct, `3c4ead4`). Retry-after-End only made it reachable. **It also hits the pilot**: any continuation line is dropped. | Yes on staging (bug-fix auto-ship rule). `main`/pilot only with Rangga's explicit go. Fallback: known gap (section 1.7). | A `fix/late-note-continuation` off origin/develop | `developer` (sonnet): pipeline |
| 2 | minor | `abortAllCaptureUploads()` calls `engine.abort()`, which stops the pump but leaves the item queued, counts no drop and emits no status. The page keeps the last "retrying (12x)" status forever, and no lost notice appears. | Yes, from the retry-after-End / Jump-wait work (`6b54d85`, `69ed031`, `5d2bff8`). | Yes | B `fix/jump-abandon-uploads` off origin/develop | `developer` (sonnet): capture engine |
| 3 | minor | Not a code bug. The after-days design (review-agent plan D2) shifts `sop_versions` (`effective_from_date`, `review_date`) back one day per jump, so after jumps 3->4 and 4->5 the stored start is Sat 17 Oct and the review is Sat 31 Oct. The approval summary QA quotes was captured **before** the jumps. Re-opened now, it would read Sat 17 / Sat 31 (it reads the live `GET /api/v1/sop`). Every screen agrees at any one moment, but the dates move between moments. | No (D2 by design) | Copy-only note (quick-win) | C `fix/guide-after-days-copy`, after review-agent merges | `developer-junior` |
| 4 | minor | The drawer shows the card body **and** the next-day lock line (`C-journey-next-day-*`), and both carry the same instruction. | Yes, from the after-days guide work (`13320b9`, `46b4847`, `5ed183f`) | Yes | C (same as 3) | `developer-junior` |
| 5 | minor | Known upstream 503 (two 10 s transcribe timeouts). The retry recovers it. | n/a | No action | n/a | n/a |

**Merge order:** `feature/review-agent` (in its final gate) -> **B** -> **C** (cut from origin/develop after review-agent is
merged, then rebase on B; the only shared file is `app/demo/JudgeGuide.tsx`, at different lines). **A** is independent and can
merge at any point. It goes to `develop`/web-develop first. `main`/pilot needs Rangga's go.

Why C waits for review-agent: both edit `lib/demo/guide.ts` and `lib/demo/guide.test.ts`. The hunks are separate:
review-agent changes the `reviews_ready.todo[1]` and `reviews_verdict.body` lines (guide.ts ~376-394) and one `it` block in
guide.test.ts (~408-422). C changes the `reviews_ready` footnote, `GuideCardContext` and the `debrief_done` day 3/4 blocks, and
adds new `it` blocks. Cutting C after the merge removes any conflict risk at no cost. C does **not** touch `lib/i18n/dict.ts`
(review-agent's file). Its strings live in `lib/i18n/v2/journey.ts` and `lib/demo/guide.ts`.

---

## 1. DEFECT 1 (major): a late note is stored but never reaches the day record

### 1.1 What the code does with a late segment (all at 9a74fe2)
1. `listSegmentsForDevice` (lib/firestore/tick-store.ts:245) reads **every** segment of the device. It has no time, session or
   watermark filter. A segment stored after the day's debrief is therefore read on the next tick. The `[pipeline-tick] skew`
   log QA saw at 13:34 proves this: it fires when `skew_newest_ms > 60 s`, and the late segment has `received_at - device_end`
   of about 84 s (spoken about 13:32:55, received 13:34:19.5).
2. `deriveAsOfMs` (lib/pipeline/label/clock.ts) uses the **newest segment only** (Decision 7). `skew_min_ms` is logged and
   never used. The 11.6 h `skew_min_ms` therefore cannot affect windowing, labelling or the day record. The day record shows
   C4's notes at 20:30-20:32 WIB = 13:30-13:32 UTC, so the device clock was correct. Ask dev-ops for the raw log entry only if
   someone wants the number explained. It is not on the defect's path.
3. `buildWindows` rebuilds the window from all segments. The late line (about 15-25 s after card 5) joins the day's window,
   and the window closes about 90 s after the late line's end (as_of advances with server time).
   `planLabelUnits` emits the window's unit. `filterUnlabelledLines` (lib/pipeline/label/ledger.ts) returns a
   `<unit_id>~late~<hash>` unit holding only the late line. This is the R-05b late-line design, and it works.
4. `processOneUnit` (lib/pipeline/tick/service.ts:242) offers the open threads within grace as `O1..On`
   (`openThreadsAt`, ROUTINE_OPS grace 120 s). The closing thread (last line about 13:32:2x) is one of them.
   The model follows its own threading rule ("A speaker's own remark right after an event ... belongs to that event's
   thread") and answers `lines: [{ i: 0, thread: "O<closing>" }]`. **The prompt (lib/pipeline/label/prompt.ts, "threads[]:
   one entry per NEW thread alias you used in lines[] (never for an echoed open thread alias)") forbids a `threads[]`
   entry for it.**
5. `remapOpenThreadAliases` maps `O#` to the real thread id. `buildThreads` (lib/pipeline/threads.ts) then finds no
   `label.threads` entry for that hint, so `categories.size === 0` and it hits `continue`. The line goes to
   `unassigned_line_ids`.
6. `processOneUnit` **never reads `built.unassigned_line_ids`**. It writes zero threads and a ledger row `status: "done"`
   whose `line_ids` include the late line, so no later tick retries it. The segment's text is not blanked (it was not
   NON_WORK). This matches QA's Firestore check exactly: the segment doc exists with its line text, and no thread or note
   holds it.

The unit tests never caught this because every continuation fixture includes a `threads[]` entry for `O1`
(lib/pipeline/tick/service.test.ts:615, 714, 800; lib/pipeline/threads.test.ts:226), which is the opposite of what the prompt
tells the model.

### 1.2 Answers to the brief's questions
- **Never processed, or never shown?** It is processed: a `~late~` unit is labelled and ledgered `done`. It is then dropped
  at threading, and never shown because no thread holds it. The day-record read (`lib/day/service.ts`,
  `attributedBusinessDate` on `first_line_start_ms`) is not at fault. The late line's start (about 13:32:4x) lies inside the
  session interval `[started_at, ended_at 13:33:04)`, so it would attribute to 18 Oct. The record shows only
  `evidence_line_ids` (lib/day/derive.ts `evidenceFor`), and the fix below adds the line there.
- **Watermark / closed-day finalisation / session intervals:** there is no watermark and no day finalisation in the tick,
  and session intervals are used only by the day-record attribution. None of these blocks the late line.
- **skew_min_ms 11.6 h:** not relevant (log only, Decision 7). See 1.1 step 2.
- **Is "recovered note reaches the day record" achievable?** Yes, and no new machinery is needed: no re-processing of a day
  and no query by session. The late-line ledger already re-labels late lines. The only gap is the dropped continuation.
  After the fix, a late note appears as an extra evidence line under the thread it continues (here, under "Closing"), about
  2-4 min after delivery (90 s window close plus the tick cadence). It still misses that day's debrief, as Rangga accepted.
- **Pilot impact:** any line the model files under an open thread is lost, not only late notes. For example, a window after a
  90-120 s pause that continues a routine task, or 90-300 s for a complaint or safety thread. That makes the fix worth doing.

### 1.3 Confirmation for dev-ops (read-only, ids and counts only, never text), project bee6-playground, database `staging`
Line id: `dc84d88f-557e-4efd-a727-0ee23177398b#0`, outlet `sbx-e30c2117f9ee`, device `jdg-e30c2117f9ee`.
1. `label_units` where `outlet_id == sbx-e30c2117f9ee` and `line_ids array-contains <line id>`: expect exactly 1 doc,
   `status == "done"`, a `unit_key` ending in `~late~` plus 8 hex characters, and `labelled_at_ms` after 13:34:19Z.
2. `threads` where `outlet_id == sbx-e30c2117f9ee` and `line_ids array-contains <line id>`: expect 0 docs.
3. The segment's `lines[0].text` is non-empty (QA already saw this; it proves the line was not NON_WORK-blanked).

If (1) finds no ledger row, the root cause is different (the line was never labelled). Stop and re-open the analysis before
building A.

### 1.4 Fix design (branch A `fix/late-note-continuation`, off origin/develop)
Quick-win and ultimate are the same change here. It only affects lines that are silently lost today, and nothing that
works now changes.

**New file `lib/pipeline/tick/continuation.ts`:**
```ts
import { GRACE_MS } from "@/lib/pipeline/categories";
import type { BuiltThread, LabelOutput, OpenThread } from "@/lib/pipeline/threads";
import type { LabelUnit } from "@/lib/pipeline/windowing";

/**
 * QA 18 Oct DEFECT 1. The label prompt lists a thread in `threads[]` only for a NEW alias, so a line that continues an
 * offered open thread (`O#`, already remapped to the real thread id) has no `threads[]` entry. `buildThreads` cannot
 * resolve its category and reports it in `unassigned_line_ids`. Before this, the tick ignored that list, so the line was
 * lost (its ledger row is `done`). This turns each group of such lines into a continuation of that open thread: the open
 * thread's id and category, confidence 1 (so `mergeThread`'s min keeps the stored confidence), the lines as evidence, and
 * an empty summary (so `mergeThread` keeps the stored one). Plain code, no model (hard rule #10). Unassigned lines whose
 * hint is not an offered open thread stay unassigned, as before.
 */
export function buildOpenContinuations(input: {
  unit: LabelUnit;                 // the SCRUBBED unit buildThreads saw
  label: LabelOutput;              // the REMAPPED label buildThreads saw
  openThreads: readonly OpenThread[];
  unassignedLineIds: readonly string[];
  alreadyBuiltIds: ReadonlySet<string>;
}): BuiltThread[] {
  const unassigned = new Set(input.unassignedLineIds);
  const hintByIndex = new Map<number, string>();
  for (const l of input.label.lines) {
    if (l.i < 0 || l.i >= input.unit.lines.length) continue;
    if (!hintByIndex.has(l.i)) hintByIndex.set(l.i, l.thread); // first wins, same as buildThreads
  }
  const result: BuiltThread[] = [];
  for (const ot of input.openThreads) {
    if (input.alreadyBuiltIds.has(ot.thread_id)) continue; // defensive: buildThreads already continued it
    const members = input.unit.lines.filter((line, i) => unassigned.has(line.line_id) && hintByIndex.get(i) === ot.thread_id);
    if (members.length === 0) continue;
    const firstStart = Math.min(...members.map((m) => m.start_ms));
    const gap = firstStart - ot.last_line_end_ms;
    if (gap < 0 || gap > GRACE_MS[ot.category]) continue; // same join rule as buildThreads
    const lineIds = members.map((m) => m.line_id);
    result.push({
      thread_id: ot.thread_id,
      category: ot.category,
      confidence: 1,
      line_ids: lineIds,
      evidence_line_ids: lineIds,
      lines: members.map((m) => ({ line_id: m.line_id, start_ms: m.start_ms, end_ms: m.end_ms, text: m.text })),
      first_line_start_ms: firstStart,
      last_line_end_ms: Math.max(...members.map((m) => m.end_ms)),
      summary: "",
      label_conflict: false,
      continued_from_open: true,
    });
  }
  return result;
}
```

**Edit `lib/pipeline/tick/service.ts` `processOneUnit`:** right after `const built = buildThreads(...)` (line 350):
```ts
const continuations = buildOpenContinuations({
  unit: scrubbedUnit,
  label: remapped,
  openThreads,
  unassignedLineIds: built.unassigned_line_ids,
  alreadyBuiltIds: new Set(built.threads.map((t) => t.thread_id)),
});
const synthetic = new Set(continuations);
```
Change the loop header `for (const builtThread of built.threads)` to `for (const builtThread of [...built.threads, ...continuations])`.
Right after `const stored = ...` add:
```ts
if (synthetic.has(builtThread) && stored === null) {
  // The open thread vanished between listRecentThreads and now (cannot happen under the lease; defensive). Never write a
  // summary-less thread: log the class only and leave the line unassigned, as before this fix.
  console.warn("[pipeline-tick] continuation target missing", { unit_id: unit.unit_id });
  continue;
}
```
Nothing else changes: `mergeThread`, the gate, `applyGateDecision`, "open stays open", the question write (tick-store never
reopens an answered question), the DebriefAgent `storedByThread` map, the ledger and NON_WORK blanking all behave as before.

**Prompt: no change.** It would be model-dependent and would churn the label snapshot. The code fix is deterministic.

### 1.5 Tests (A)
New `lib/pipeline/tick/continuation.test.ts`:
1. One unassigned line hinting an open thread within grace: returns one BuiltThread with the open id and category,
   `confidence 1`, `evidence_line_ids == line_ids == [line]`, `summary ""`, `continued_from_open true`.
2. A hint that is not an offered open thread (for example a `T2` with no threads entry): returns `[]`.
3. A line not in `unassignedLineIds` (already assigned): returns `[]`.
4. `alreadyBuiltIds` contains the open id: returns `[]`.
5. Gap negative, or gap > `GRACE_MS[category]`: returns `[]`.
6. Two unassigned lines to the same open thread plus one to another: two BuiltThreads, lines grouped correctly, first/last ms right.
7. A duplicate `label.lines` entry for the same `i` uses the first hint (mirrors buildThreads).

In `lib/pipeline/tick/service.test.ts`, add next to the "Decision 4" test (line 575), using the same FakeTickStore
fixture pattern:
8. **Regression for DEFECT 1:** first tick labels `s1` as a ROUTINE_OPS fact (conf 0.95, summary "Checked the oven").
   The second tick adds `s2` 15 s later. The model returns
   `{ lines: [{ i: 0, reply_to: null, thread: "O1" }], threads: [], non_work_lines: [] }`.
   Expect `threads_written 1` and the stored thread's `line_ids`/`evidence_line_ids` to contain `s2#0`, with `lines.length 2`,
   confidence still 0.95, summary still "Checked the oven", status still "fact", and no new gate question.
   The ledger row for the `~late~` (or second) unit is `done`.
9. Same as 8, but the stored thread is `open`: status stays `open` and the `q_thread_<id>` question is rewritten with the
   widened window. An `answered` question is not reopened (tick-store rule: assert only the write batch, as the fake allows).
10. Same as 8, but the model DOES send `threads: [{ id: "O1", ... }]`: the result is identical to today's Decision-4 test (no
    duplicate write, `threads_written 1`).
11. Mixed unit: line 0 to `T1` (new, PHONE_CALL) and line 1 to `O1` with no entry: two threads written (one new, one merge).

### 1.6 Risk (A)
- Blast radius: only lines currently in `unassigned_line_ids` whose hint is an offered open thread, and those lines are
  dropped today. A stored fact cannot be downgraded by the synthetic merge (confidence 1, so min keeps the stored value).
  A stored `open` stays `open`. `unverified` stays `unverified`. A staff or supervisor decision is carried over by the tick-store.
- Hard rules: plain code (#10), no names (the lines come from the scrubbed unit), no audio, nothing new stored beyond
  already-redacted line text inside an existing thread (#3, #7a).
- Pilot: it changes the pilot pipeline, so ship to `develop`/web-develop first, then have QA re-run the C4 scenario
  (`day1x.wav`, flag flip at 60 s). The note must appear as a second evidence line under "Closing" within about 5 min.
  `main` needs Rangga's go.

### 1.7 If A is not shipped today: known-gap line (README known gaps + technical spec §8)
"A spoken line that the labeller files under the conversation just before it (for example a note uploaded late, after
End) can be missing from the day record. It is stored, but no work note is built from it."

---

## 2. DEFECT 2 (minor): stale "Not sent yet · retrying (12x)" after the Jump abort, and no lost notice

### 2.1 Root cause
- `app/demo/JudgeGuide.tsx:855` `jump()` -> `abortAllCaptureUploads()` (lib/capture/browser/session.ts:118) ->
  `engine.abort()` (lib/capture/browser/engine.ts:263). `abort()` sets `mode = "aborted"` and wakes the pump, and the pump
  breaks. The head stays in the queue: no `dropHead`, no `uploadDropped += 1`, and **no `emitStatus()`**.
- The page's retained status (`retainedUploadRef` / `lastUploadStatus`, app/capture/page.tsx:541-544) is therefore frozen at the
  last report: `state "offline"`, `queuedCount 1`, `headFailedAttempts 12`. After the stop it renders
  `deriveRetainedUploadView(lastUploadStatus)` (page.tsx:1017), which gives `{ phase: "retrying", failedAttempts: 12 }`
  forever. `deriveLostNotice` reads `droppedCount`, which is still 0, so no notice appears.
- Regression from this work: `abortAllCaptureUploads` (6b54d85) and the Jump wait/abort (69ed031, 5d2bff8).

### 2.2 Options
- Quick-win: clear the row only (drop the queued items without counting them). This hides a real loss. **Rejected.**
- **Ultimate (recommended, same effort):** a new engine `abandon()` used only by Jump. The queued items count as lost, the
  status is re-emitted, the retry row disappears and the existing R-23 notice "Some speech was not captured" shows once
  (sticky until Dismiss or the next Start, the existing rule). `abort()` stays exactly as it is for Batalkan, sign-out and
  unmount (a cancelled day must not say "not captured").

### 2.3 Exact edits (branch B `fix/jump-abandon-uploads`, off origin/develop)
**`lib/capture/browser/engine.ts`** (class `CaptureEngine`):
- New fields next to `mode`:
  ```ts
  /** Set by abandon(): the queued segments of this aborted engine count as lost (Jump to tomorrow). */
  private abandoned = false;
  /** The queue item whose PUT is in flight right now, or null. */
  private uploadingId: string | null = null;
  ```
- New method after `abort()`:
  ```ts
  /**
   * Jump to tomorrow (QA 18 Oct DEFECT 2): a hard stop like abort(), but every queued segment is given up as lost and
   * counted in droppedCount, so the page shows "Some speech was not captured". The status is re-emitted so the page drops
   * its "Not sent yet · retrying" row. A PUT already in flight settles on its own: a 2xx confirms it, any other result
   * drops it as lost. Idempotent.
   */
  abandon(): Promise<void> {
    this.mode = "aborted";
    this.abandoned = true;
    for (const item of this.queue.items()) {
      if (item.id === this.uploadingId) continue;
      if (this.queue.remove(item.id)) this.uploadDropped += 1;
    }
    if (this.headAttempt !== null && this.headAttempt.id !== this.uploadingId) this.headAttempt = null;
    this.wake?.();
    this.emitStatus();
    return this.drain();
  }
  ```
- `pump()`: wrap the upload call:
  ```ts
  this.uploadingId = item.id;
  let status: number | null;
  try {
    status = await this.upload(item);
  } finally {
    this.uploadingId = null;
  }
  ```
  (Keep the rest. `const status` becomes the `let` above.) Replace the line `if (this.isAborted()) break;` that comes right
  after `this.emitStatus();` in the transient-failure branch with:
  ```ts
  if (this.isAborted()) {
    if (this.abandoned) this.dropHead(item.id); // counted as lost; dropHead re-emits the status
    break;
  }
  ```
- `handleSegment()`: right after the `encode` try/catch, before `emitEvent(segment_upload_started)`:
  ```ts
  if (this.abandoned) {
    // Encoded after Jump abandoned the queue: it can never be sent, so it counts as lost.
    this.uploadDropped += 1;
    this.emitStatus();
    return;
  }
  ```

**`lib/capture/browser/session.ts`:**
```ts
/**
 * Hard-aborts every capture engine on this page. Idempotent; never throws. `asLost: true` (Jump to tomorrow only) gives
 * up the queued segments as lost so the page shows the "not captured" notice and drops its retry row; sign-out, unmount
 * and discard keep the plain abort.
 */
export function abortAllCaptureUploads(options?: { asLost?: boolean }): void {
  for (const engine of liveEngines) void (options?.asLost === true ? engine.abandon() : engine.abort());
  liveEngines.clear();
  notifyIdleWaiters();
}
```

**`app/demo/JudgeGuide.tsx:855`:** `abortAllCaptureUploads({ asLost: true });`. Update the comment above it to:
"...then give up whatever is left: it counts as lost, so the phone shows the 'not captured' notice and no stale retry row."

**`app/capture/page.tsx`: no change.** The abandoned engine's `onStatus` arrives under the same generation (no Start in
between). `retainEngineStatus` therefore replaces the retained status: `queuedCount 0` and `state "listening"` give
`deriveRetainedUploadView` = null, so the row is gone. `droppedCount >= 1` gives `deriveLostNotice` = true, so the notice is
shown. `resetLostNotice` at the next Start clears it.

### 2.4 Tests (B)
`lib/capture/browser/engine.test.ts`, new `describe("abandon() (QA 18 Oct DEFECT 2)")`, using the existing fake
upload/sleep/now pattern of the "finish() vs abort()" suite (line 564):
1. A head refused with 503, then `finish()`, then `abandon()` during the backoff: the last emitted status has `queuedCount 0`,
   `droppedCount 1`, `state "listening"` and `headFailedAttempts 0`. The upload call count does not grow after advancing time.
   `deriveUploadView(lastStatus)` is null and `deriveLostNotice(lastStatus, 0)` is true (import from `app/capture/UploadStatusLine`).
2. Two queued items with the head PUT in flight; `abandon()`; the head PUT then resolves 200: `droppedCount 1` (only the second),
   `queuedCount 0`, no further upload.
3. Same, but the in-flight PUT resolves 503: `droppedCount 2`, `queuedCount 0`, no further upload.
4. Regression guard: `abort()` (not abandon) with a queued failing head leaves `queuedCount 1` and `droppedCount 0`, and emits
   no new status (documents that Batalkan and sign-out are unchanged).
5. A segment still encoding when `abandon()` is called (deferred encode promise) is counted as dropped and never uploaded.
6. `abandon()` twice: the second call changes nothing (idempotent).

`lib/capture/browser/session-stop.test.ts` (or the file with the `waitForCaptureUploads()` describe, line 287):
7. `abortAllCaptureUploads({ asLost: true })` with a finishing engine and a failing head: the last `onStatus` has
   `queuedCount 0` and `droppedCount 1`. With no option, the existing behaviour is unchanged (`queuedCount 1`).

`app/demo/JudgeGuide.test.tsx`:
8. Change the mock (line 43) to `abortAllCaptureUploads: (...a: unknown[]) => abortAllCaptureUploads(...a),`. In both Jump tests
   ("nothing pending", "pending: waits up to 25 s"), add `expect(abortAllCaptureUploads).toHaveBeenCalledWith({ asLost: true });`.

### 2.5 Risk (B)
Engine change, scoped to a new method. `abort()` and `finish()` paths are byte-identical apart from the `uploadingId` bookkeeping and
the `abandoned`-guarded lines, which are inert unless `abandon()` ran. Hard rule #2: no audio is persisted or logged (counts only).
The 2a queue stays off.

---

## 3. DEFECT 3 (minor): review dates differ between approval and Reviews on A5

### 3.1 Where each date comes from
- Approval summary "starts Mon 19 Oct ... reviewed on Mon 2 Nov": `app/proposals/ApprovalsReview.tsx:139-143`
  `AllDecided` reads `effective_from_date`/`review_date` from the live `GET /api/v1/sop` (`shippedChangeFor`). QA captured it
  at approval time, before the two after-day jumps.
- Each jump: `lib/demo/next-day.ts` `NEXT_DAY_SHIFT_COLLECTIONS` includes `sop_versions`. `NEXT_DAY_DATE_KEYS` includes
  `effective_from_date` (clone DATE_KEYS) and `review_date`, so each moves back 1 day (review-agent plan D2). After jump 3->4:
  start Sun 18 (= day 4's date). After 4->5: start Sat 17 (= day 4's date after its shift), review Sat 31 Oct.
- Reviews card "REVIEW ON SAT 31 OCT", "by Sat 7 Nov" (review_date + 7) and After window "Sat 17 Oct to Fri 30 Oct"
  (`effective_from_date` .. `review_date - 1`) all come from the shifted version, so they are consistent with each other. The
  After window does **not** start before the SOP start: the stored start is now Sat 17 Oct. QA compared it with the
  pre-jump Mon 19.
- B3 is consistent because it never jumped after the approval (early fast-forward), so nothing moved.

### 3.2 Why not "one fixed date everywhere"
The shift is load-bearing. Without it, day 4 (which runs on the real today) would fall before the SOP start, the After window
would be empty and the verdict would read "no suggestion". Keeping the 3-day path byte-identical rules out moving the sessions
instead. The audit entry keeps the original date (documented in D2).

### 3.3 Fix (quick-win, recommended today): one footnote on the after-days Reviews card (the 3-day path is untouched)
`lib/demo/guide.ts`, card `reviews_ready` (shown only once days 4 and 5 are captured): add after its `body: [...]`:
```ts
footnote: bi(
  "Each Jump to tomorrow moved the demo dates one day back, so the change's start and review dates now read earlier than on the approval screen.",
  "Setiap Lompat ke besok memundurkan tanggal demo satu hari, jadi tanggal mulai dan tanggal tinjauan perubahan kini lebih awal daripada di layar persetujuan.",
),
```
Test (new `it` in lib/demo/guide.test.ts, **not** inside review-agent's `it` at ~408): `GUIDE.reviews_ready.footnote?.en`
equals the EN string, `.id` differs from `.en`, and `GUIDE.reviews.footnote` and `GUIDE.reviews_verdict.footnote` are
unchanged. Ultimate: none planned. State it in the README known gaps: "Demo only: each Jump to tomorrow moves the
sandbox's dates, including an approved change's start and review date, one day back."

---

## 4. DEFECT 4 (minor): guide copy repeats or contradicts itself

### 4.1 Root cause
`app/demo/JudgeGuide.tsx` renders the card body (`guideCard(...)`, lib/demo/guide.ts) and, under it, the next-day control.
For a refused jump, that control shows `t(lang, NEXT_DAY_REASON_KEY[reason])` (JudgeGuide.tsx:908), which is the
`C-journey-next-day-*` line. Both strings carry the action:
- (a) day 3 + `approve_first`: the body "...Days 4 and 5 unlock after the Owner approves a change." and the line "Days 4 and 5
  open after the Owner approves a change. Sign out and continue as Supervisor."
- (b) day 3 + `review_exists`: the body still says days 4 and 5 unlock after approval, which contradicts the line.
- (c) day 5 + `max_days`: the body "...Sign out, continue as Supervisor, and open Reviews." and the line "All 5 demo days are
  done. Sign out and continue as Supervisor." The same double appears under the day-5 `debrief_question` card.
- (d) Same class, not seen by QA: day 4 + `review_exists` (an early fast-forward after day 4) shows "Jump to tomorrow to run day 5"
  next to "A review already exists".

### 4.2 Rule
The guide's lock lines state the fact only. The card body carries the action. The page's own `C-sess-next-day-*` lines (the
main screen text, shown on their own) are **unchanged**.

### 4.3 Exact edits (branch C `fix/guide-after-days-copy`)
**`lib/i18n/v2/journey.ts`** (EN block lines 106-108, Bahasa block lines 20-22):
| key | EN (new) | ID (new) |
|---|---|---|
| `C-journey-next-day-max_days` | `All 5 demo days are done.` | `Kelima hari demo sudah selesai.` |
| `C-journey-next-day-approve_first` | `Days 4 and 5 open after the Owner approves a change.` | `Hari 4 dan 5 terbuka setelah Pemilik menyetujui satu perubahan.` |
| `C-journey-next-day-review_exists` | `A review already exists, so the demo days are finished.` | `Tinjauan sudah ada, jadi hari demo selesai.` |
Keep each Bahasa line's `// PROVISIONAL` marker.

**`lib/demo/guide.ts`:**
1. `GuideCardContext` (line 447), add:
   ```ts
   /** The phone's `demo_session.next_day.reason`; read only by the day-3 and day-4 `debrief_done` cards (`review_exists`). */
   nextDayReason?: DemoNextDayStatus["reason"];
   ```
   (`DemoNextDayStatus` is already imported from `@/lib/demo/contract`.)
2. Day-3 `debrief_done` hand-over block (line ~576), new body:
   EN `That was day 3 of 5. Next, sign out and continue as Supervisor.`
   ID `Itu hari 3 dari 5. Selanjutnya, keluar dan lanjut sebagai Supervisor.`
   (The handle stays "Sign out and continue as Supervisor".)
3. Insert **before** that block, and after the `nextDayAllowed === true` block:
   ```ts
   if (day === 3 && key === "debrief_done" && ctx.nextDayReason === "review_exists") {
     return GuideCardSchema.parse({
       ...base,
       handle: bi("Sign out and open Reviews", "Keluar dan buka Tinjauan"),
       body: [bi("That was day 3 of 5. Next, sign out and open Reviews.", "Itu hari 3 dari 5. Selanjutnya, keluar dan buka Tinjauan.")],
     });
   }
   ```
4. Insert **before** the existing day-4 `debrief_done` block:
   ```ts
   if (day === 4 && key === "debrief_done" && ctx.nextDayReason === "review_exists") {
     return GuideCardSchema.parse({
       ...base,
       handle: bi("Sign out and open Reviews", "Keluar dan buka Tinjauan"),
       body: [bi("Day 4 of 5 is done. Next, sign out and open Reviews.", "Hari 4 dari 5 selesai. Selanjutnya, keluar dan buka Tinjauan.")],
     });
   }
   ```
5. The day-5 `debrief_done` and `debrief_question` bodies are **unchanged**. The shortened `max_days` line removes the
   double sign-out.

**`app/demo/JudgeGuide.tsx:278`:**
`guideCard(key, day, { openClosingReached, nextDayAllowed: bridge?.state.profile.next_day.allowed, nextDayReason: bridge?.state.profile.next_day.reason })`.

Resulting drawer text (EN):
- day 3, approve_first: "That was day 3 of 5. Next, sign out and continue as Supervisor." + "Days 4 and 5 open after the Owner approves a change."
- day 3, review_exists: "That was day 3 of 5. Next, sign out and open Reviews." + "A review already exists, so the demo days are finished."
- day 4, review_exists: "Day 4 of 5 is done. Next, sign out and open Reviews." + "A review already exists, so the demo days are finished."
- day 5, max_days: "That was the last demo day. Sign out, continue as Supervisor, and open Reviews." + "All 5 demo days are done."

Accepted side effect: the route-refusal race (the config said allowed, the POST got 409) now shows the fact-only line under the
"Jump to tomorrow" card. The next config poll swaps in the right card.

### 4.4 Tests (C)
- `lib/demo/next-day.test.ts:898-900`: the three new EN strings.
- `lib/demo/guide.test.ts:215` and `:258`: `en(3)` / `waiting.body[0].en` become
  `That was day 3 of 5. Next, sign out and continue as Supervisor.`
- New `it` in guide.test.ts: `review_exists` on day 3 and day 4 gives the bodies and handle above, and each Bahasa line differs
  from the EN one. `nextDayReason` is read only by the day 3/4 done cards: `guideCard("debrief_done", 2, { nextDayReason: "review_exists" })`
  equals `guideCard("debrief_done", 2)`, and the same holds for day 5 and for `debrief_question` on day 3.
  `{ nextDayAllowed: true, nextDayReason: null }` on day 3 still gives the "Owner approved" card.
- `app/demo/JudgeGuide.test.tsx`: line 1697, use the new day-3 body. Add: the drawer text matches `/Days 4 and 5/g`
  exactly once. Lines 1722-1723, use the new lock lines. Line 1735 (`review_exists` on day 4), use the new line and assert
  "Day 4 of 5 is done. Next, sign out and open Reviews." with no "Jump to tomorrow to run day 5". Line 1752, use
  "All 5 demo days are done." and assert `queryByText("All 5 demo days are done. Sign out and continue as Supervisor.")` is null.
  New: day 3 + `review_exists` config shows "That was day 3 of 5. Next, sign out and open Reviews." and never "unlock after".
- `lib/i18n` parity tests: run them. Each changed key must still exist in EN and ID.

### 4.5 Risk (C)
Copy and a pure-function branch only. The 3-day path's day-3 hand-over text changes on purpose (B3 showed the same
duplicate). Days 1 and 2 and every non-guide screen are unchanged.

---

## 5. DEFECT 5: known upstream 503 (about 21 s, 3 in about 120 PUTs), recovered by the retry. No action. It is already
listed with the transcribe preview in the known gaps.

## 6. Dispatch checklist for the PM
1. Dev-ops: run the read-only check in 1.3. Proceed with A only if it confirms the root cause.
2. `developer` (sonnet): A, with skills `tdd-workflow` + `code-review`.
3. `developer` (sonnet): B, with skills `tdd-workflow` + `react-testing`.
4. After review-agent merges: `developer-junior`: C (literal strings above), with `ux-copy` for the Bahasa review.
5. Each branch then gets a tech-lead review and QA (QA re-runs: C4 retry after End for A, B3 Jump wait for B, and the
   A5/B3 drawer texts plus the Reviews footnote for C).

---

## Dev-ops confirmation (DEFECT 1)

Read-only check, 18 Oct. Project `bee6-playground`, Firestore database `staging`, outlet `sbx-e30c2117f9ee`, line
`dc84d88f-557e-4efd-a727-0ee23177398b#0`. Firestore REST `runQuery` with my own gcloud token, GET/query only, no writes.
Ledger collection is `label_units` (`COLLECTIONS.labelUnits`). Counts only; no line text or names read out.
Outlet totals at check time: 3 `label_units`, 16 `threads`, 16 `segments`.

**Verdict: PASS. The premise holds; the tech-lead's root cause is confirmed.**

| # | Check | Expected | Found |
|---|---|---|---|
| 1 | `label_units` rows whose `line_ids` contain the line | 1 row, `done`, `~late~` key | 1 row; `status done`; `unit_key` ends `~late~` + 8 hex; 1 line in the row; device `jdg-e30c2117f9ee` |
| 2 | `threads` whose `line_ids`, `evidence_line_ids` or embedded `lines[].line_id` contain the line | 0 | 0 |
| 3 | Segment doc `...0ee23177398b`, `lines[0].text` | non-empty | 1 segment doc, 1 line, text non-empty (not NON_WORK-blanked) |
| 4 | Lines in a `done` ledger row but in no thread | wider loss? | 16 distinct lines in `done` rows; 15 are in a thread; 1 is not, and it is this same line (segment present, text non-empty, in the `~late~` row). No other line is lost on this outlet. 0 blank, 0 TTL-gone |

Ledger status mix on the outlet: 3 `done`, 0 `pending`, 0 `failed`.

Timing note: `labelled_at_ms` is 104 s after the segment's `received_at`, so it was labelled by the next tick, as designed. Both
stored values read 16 Oct (`received_at 2026-10-16T13:34:19.461Z`, `labelled_at_ms` = `2026-10-16T13:36:03.461Z`), exactly 48 h
before QA's 18 Oct wall clock. That is consistent with the demo outlet's two next-day jumps shifting stored timestamps back, not
with a defect. The time of day (13:34:19 receive, 13:36:03 labelled) is after the 13:34:19Z bound in 1.3. I did not read
`next-day.ts` (it is not in this checkout), so the date shift is an inference.

Scope: on this one outlet the loss is only the late line. The check cannot say whether other outlets or the pilot lose lines the
same way; the code path is shared, so assume yes until A ships.

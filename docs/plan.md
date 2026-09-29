# SOP Improvement Agent — Conservative Plan (v3, 30 Sept 2026, 01:30 WIB)

**This is the current plan.** It says *what gets built, by whom, and when*.
- Step-by-step detail for each task: `docs/backlog.md` (task backlog).
- What each part does: `docs/specs/web-backend-rbac.md` (web app, capture, backend, roles) and `docs/specs/pipeline-and-agents.md` (pipeline, debrief, agents, demo, evidence).
- Rules for the coding agent: `CLAUDE.md`.

**v3 change (30 Sept, 01:30):** Sprint 2 didn't fit on weekdays (27 h of work before Fri 9, but only 20 h available). GATI chose to **ship SOP v2 on Sat 10**. The review stays on Wed 14. R-05 starts Sun 4 using spare Sprint 1 time. R-13 moves to Wed 14.

## 1. Ground rules

| Rule | Value |
|---|---|
| Team | **Rangga**: all technical work, product ideas, roadmap and sprints. **Tiffany**: prompts and category guide, Proofed coordination, consent, labelling, demo clips, design, deck, video |
| Rangga's time | **4 h on weekdays, 8 h on weekends**, Wed 30 Sep – Fri 16 Oct ≈ **84 h** (Sat 17 – Sun 18 is emergency buffer) |
| Planning style | **Conservative**: AI coding help is a bonus and isn't counted |
| Dev tool | **Claude Code** in VS Code (the rules don't restrict dev tools). **The product uses only Google Cloud + Google AI.** Guardrails: no non-Google AI calls in product code; small, frequent commits in the public repo; README says "Built with Claude Code. Runs entirely on Google Cloud and Gemini." |
| Architecture | One architecture for demo and real use · one web app (Next.js, TypeScript) on **one Cloud Run service** in Jakarta · Gemini 3.5 Transcribe for all speech · Flash-Lite labels · ADK agents on Gemini 3.5 Flash · Live API voice debrief |
| Go-live at Proofed | **Mon 5 Oct** |
| Demo story | A **weekday problem**, picked Wed 7 Oct. The weekend egg tart story is dropped because the first weekend isn't captured |
| Load target | Planned work ≤ ~80% of 84 h; the rest is buffer |

## 2. What we simplified to fit one part-time builder

- **One Cloud Run service** (`web` = screens + API + pipeline + agents). The architecture slide still shows each named agent.
- **Users, staff PINs and the shop phone are set up by a seed script**, not by settings screens.
- **Tap debrief first** (R-07); **voice debrief added on top** (R-16), with tap as the fallback.
- **Gold set = Tiffany labels episodes in a Google Sheet**; the eval script reads the sheet.
- **In-memory upload queue** on the shop phone (about 10 min of offline time). The encrypted offline queue is P1.

**Kept (confirmed by GATI):** voice debrief (R-16) · CriticAgent (R-15).
**"If time" (P1):** see §8.
**Cut for this window:** photo and reminder lanes · second mic · event cards · Flex tier · building the Flash-Lite cheaper path (slide only, labelled as modelled) · DPIA (next priority, stated in the README).

## 3. Calendar

| Date | Milestone |
|---|---|
| Wed 30 Sep – Sun 4 Oct | **Sprint 1: capture + transcription core** |
| Thu 1 Oct | Consent signed and signage up at Proofed (Tiffany) |
| **Mon 5 Oct** | **Go-live step 1:** capture + transcription running at Proofed |
| **Tue 6 Oct** | **Go-live step 2:** labels + day record running (Monday's text is reprocessed) |
| **Wed 7 Oct** | Tap debrief running at close · **weekday problem picked** (evening) |
| **Fri 9 Oct** | **First real proposal** (evidence from Mon 5 – Thu 8) |
| Fri 9 – Sat 10 | Supervisor review (a real rejection if it happens) → revision → owner approval |
| **Sat 10 Oct** | **SOP v2 ships** (metric, failure condition, review date Wed 14) |
| Mon 12 – Tue 13 | Weekdays under SOP v2 |
| **Wed 14 Oct, 09:00** | **Review on date** → outcome memory. Loop closed |
| Thu 15 Oct | Freeze, tag v1.0, every link checked |
| **Fri 16 Oct** | **Submit** |
| Sat 17 – Sun 18 | Buffer (platform deadline Sun 18) |

**Honesty note for the video and deck:** "before" is 5 weekdays under v1 (Mon 5 – Fri 9), "after" is 2 weekdays under v2 (Mon 12 – Tue 13). Say this plainly. Speed up the *viewing*, never the calendar.

## 4. Sprint 1: capture + transcription core (Wed 30 Sep – Sun 4 Oct)

**Goal:** by Sun 4 Oct, the Android phone at the shop records all day through the web capture page, and every speech segment comes back as redacted, timestamped text from Gemini 3.5 Transcribe.
**Capacity:** 3 weekdays × 4 h + 2 weekend days × 8 h = **28 h**.

| Day | Rangga's work | Hours |
|---|---|---|
| Wed 30 | **R-01** GCP projects (pilot + demo), billing caps, **region probe**, public repo, Cloud Build → Cloud Run (Jakarta), Next.js skeleton | 4 |
| Thu 1 | **R-02** Firestore schema v0, Google sign-in with roles, shop device token + staff PINs via seed script (4 of 5 h) | 4 |
| Fri 2 | R-02 finish (1 h) · **R-03** `/capture` page starts (3 h) | 4 |
| Sat 3 | **R-03** finish (5 h): VAD, 15 s segments, Opus, upload + in-memory retry, wake lock, heartbeat, status · buffer 3 h | 8 |
| Sun 4 | **R-04** Segment API → Transcribe → redaction → store (4 h) · **R-05a** windowing, thread builder, evidence gate as plain code with unit tests (4 h) | 8 |
| | **Planned 25 h of 28 (89%) · buffer 3 h** | |

**Check-in Wed 30, 20:00:** region probe results + a 5-minute capture test on the shop phone. Start a **full-day (14 h) capture test** that evening and read it Thu 1. If the phone stops capturing → pick a fallback before Friday.

**If behind on Sat:** drop the input picker (built-in mic only) and the heartbeat screen; keep upload + retry. **If behind on Sun:** R-05a moves to Mon; go-live step 2 slips to Wed 7.

## 5. Sprint 2: understand the day and close the proposal loop (Mon 5 – Sun 11 Oct)

**Goal:** by Sat 10 Oct, a proposal built from real weekday evidence has passed supervisor review and owner approval and shipped as SOP v2.
**Capacity:** 5 weekdays × 4 h + 2 weekend days × 8 h = **36 h**.

| Day | Rangga's work | Hours | Live at the shop |
|---|---|---|---|
| Mon 5 | Go-live step 1 support (1 h) · **R-05b** label call: Flash-Lite, structured output, categories, work vs private (3 h) | 4 | Capture + transcription |
| Tue 6 | **R-06** day record screen (supervisor full, owner summaries) (3 h) · fixes (1 h) | 4 | + labels, day record |
| Wed 7 | **R-07** tap debrief: PIN → ≤ 5 questions → *Iya / Bukan* + optional typed fix; stored as "a staff member" (3 h) · **R-08** starts (1 h) | 4 | + tap debrief at close |
| Thu 8 | **R-08** ProposalAgent (ADK, Gemini 3.5 Flash): library intervention, ≥ 1 rubric criterion + ≥ 2 dated evidence items, or no proposal (logged) (4 h) | 4 | |
| Fri 9 | **R-09** approval screens: supervisor *Feasible / Reject + reason* (reason saved as a permanent rule), owner *Approve / Reject* (4 h) | 4 | First real proposal |
| Sat 10 | **R-10** SOP versions + v1→v2 diff (2 h) · **R-15** CriticAgent (3 h) · review support + fixes (3 h) | 8 | **SOP v2 ships** |
| Sun 11 | **R-16** voice debrief: Live API, one shared session per close, agent speaks first, tap fallback (6 h) · buffer (2 h) | 8 | |
| | **Planned 29 h of 36 (81%) · buffer 7 h** | | |

The first proposal (Fri 9) doesn't go through the Critic, because the Critic is built Sat 10. The revised proposal after a rejection does. State this in the video only if it's shown.

**If behind on Thu:** the diff (R-10) becomes a plain before/after list; the proposal is generated by a button instead of a schedule. **If behind on Sat:** R-16 moves to Sprint 3's buffer (the tap debrief keeps working).

## 6. Sprint 3: close the loop, demo outlet, submit (Mon 12 – Fri 16 Oct)

**Goal:** by Wed 14 the review has written a real outcome; by Thu 15 judges can try the demo outlet from a link; submit Fri 16.
**Capacity:** 5 weekdays × 4 h = **20 h**.

| Day | Rangga's work | Hours |
|---|---|---|
| Mon 12 | **R-11** ReviewAgent + Cloud Scheduler (Wed 14, 09:00 WIB) + verdict screen (*worked / revise / revert*) + outcome memory | 4 |
| Tue 13 | **R-12** demo outlet: seed by sending Tiffany's clips through the **real** segment API; "Try as Owner / Supervisor / Staff"; rate limits; "fast-forward to review date" (labelled simulated) | 4 |
| Wed 14 | Review runs 09:00 · **R-13** eval script: confusion matrix from the Google Sheet gold set + Transcribe quality on 20 clips (2 h) · fixes (2 h) | 4 |
| Thu 15 | **R-14** README (setup, architecture, models and regions, known gaps incl. **DPIA next**), tag v1.0, uptime check, incognito test of every link (3 h) · freeze | 4 |
| Fri 16 | Buffer · submit (Tiffany) | 4 |
| | **Planned 13 h of 20 (65%) · buffer 7 h** | |

## 7. Total load

| | Planned | Capacity | Load |
|---|---|---|---|
| Sprint 1 | 25 h | 28 h | 89% |
| Sprint 2 | 29 h | 36 h | 81% |
| Sprint 3 | 13 h | 20 h | 65% |
| **All** | **67 h** | **84 h** | **80%** |

Sprint 1 is the fullest and has the biggest unknown (browser recording on the shop phone). Its first cut is R-05a moving to Monday.

## 8. "If time" list (P1, in this order)
1. Encrypted offline queue in the browser (~4 h)
2. Cost-per-day tile for the owner (~3 h)
3. "Re-run this clip live" in the demo outlet (~2 h)
4. POS CSV import (~4 h)
5. Team and device settings screens (~4 h)
6. Guided tour in the demo outlet (~2 h)

## 9. Tiffany's dates

| By | Task |
|---|---|
| Thu 1 Oct | Consent forms signed, counter signage up, staff briefed |
| Sat 3 Oct | Custom vocabulary list (≤ 100 terms: products, staff first names, suppliers) |
| Sat 3 Oct | 5 short Bahasa demo clips (fictional outlet) — also used to test capture before real audio |
| Sun 4 Oct | `categories.yaml` example pairs (one real vs one hypothetical/retold per category) |
| Daily from Wed 30 | Ask Proofed about weekday problems |
| Wed 7 Oct | SOP v1 spec (private) · rubric + intervention library · 2–3 weekday problem candidates |
| Wed 7 – Sun 11 | Walk supervisors through the day record; make sure the debrief happens at close; supervisor + owner review of the proposal by Sat 10 |
| Sun 11 Oct | B-roll filmed (no customer faces, no SOP document on screen) · video script draft |
| Tue 13 Oct | 60+ episodes labelled in the Google Sheet (gold set) |
| Tue 13 – Wed 14 | Screen recordings (demo outlet Tue, review result Wed) |
| Thu 15 Oct | Video (< 3 min) and deck (PDF) final |
| Fri 16 Oct | Submit on Hack2skill; save the confirmation |

## 10. Decisions and open points

| # | Item | Status |
|---|---|---|
| 1 | One Cloud Run service | **Confirmed** (29 Sept) |
| 2 | Rangga's hours: 4 h weekdays, 8 h weekends | **Confirmed** (29 Sept) |
| 3 | Voice debrief (R-16) and CriticAgent (R-15) kept | **Confirmed** (29 Sept, 22:38) |
| 4 | Dev tool: Claude Code; product only Google Cloud + Google AI | **Confirmed** (29 Sept, 23:58) |
| 5 | SOP v2 ships **Sat 10**; review stays Wed 14 | **Confirmed** (30 Sept, 01:30) |
| 6 | Weekday demo problem | **Open.** Pick by Wed 7 evening from what supervisors say *and* what the day record shows Mon 5 – Wed 7 |
| 7 | Region probe results | **Open.** Wed 30 |
| 8 | Does the shop phone capture 14 h with the page open? | **Open.** Test Wed 30 → Thu 1 |
| 9 | Does GATI qualify for the $300 Google Cloud credit? | **Open.** GATI to check |
| 10 | Email the organisers to confirm Claude Code as a dev tool | Optional safety step |

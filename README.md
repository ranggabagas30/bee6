# bee6

SOP Improvement Agent for small F&B shops, built for the GATI x Google Cloud
AI Builder Cup 2026. A web app listens to a shop's day through one phone,
turns speech into short work notes (audio is never kept), asks staff *why*
gaps happened in a short evening debrief, and proposes changes to the shop's
SOP. A supervisor checks each proposal, the owner approves it, it ships as a
new SOP version, and the system checks on a set date whether it worked.
Pilot shop: Proofed (Indonesia). Judges try it through a demo outlet in the
same app.

## Stack

- **App:** Next.js (App Router) + TypeScript (strict), one Cloud Run service
  `web` in `asia-southeast2` (Jakarta) — screens, API routes, pipeline
  handlers and agents all live in this one service.
- **Data:** Firestore (Native mode, `asia-southeast2`).
- **Auth:** Firebase Authentication — Google sign-in for owner/supervisors,
  custom tokens for the shop device and staff PIN sessions.
- **AI:** `@google/genai` against Google Cloud (Vertex mode) only — Gemini
  3.5 Transcribe, Flash-Lite, Flash, and a Live API model for the voice
  debrief. No other AI provider or API key anywhere in the product code.
  Each model's region comes from `config/regions.yaml`, filled in by
  `npm run probe` against a real GCP project — never hard-coded.
- **Async work:** Cloud Tasks + Cloud Scheduler.
- **Validation:** zod for every API input and model output.

This repo is at the R-01 foundations stage: Next.js/TypeScript skeleton,
region probe script, and CI/CD config. See `docs/plan.md` and
`docs/backlog.md` for the full task list and dates; a fuller README lands at
R-14.

## Running locally

```bash
npm install
npm run dev         # local dev server
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # unit tests (vitest)
npm run probe        # region probe -> config/regions.yaml (needs a real GCP project)
```

`npm install` also runs `npm run prepare`, which points git at `.githooks`
(`core.hooksPath`) for this repo. From then on, `git push` runs lint, build,
and unit tests locally first and refuses the push if any of them fail (a
`npm run smoke` step is skipped for now — it's not built until R-13). Use
`git push --no-verify` to bypass this deliberately; that's standard git
behavior, reserved for a human's explicit call, not something an agent
decides on its own.

## Known gaps

- No live GCP project is wired up yet — `config/regions.yaml` is a placeholder
  (`UNPROBED`) until Rangga runs `npm run probe` against a real project.
- Capture, pipeline, and agent code are not built yet (later tasks).
- `T-206` (the incident-keyword fast path — flagging a safety/security
  incident immediately rather than waiting for the normal label pipeline) is
  specified but not built; no task currently owns it.
- `DAILY_TOKEN_CEILING` (the per-outlet daily cost-guard cap on non-essential
  model calls) is specified in `CLAUDE.md` §7 but not enforced anywhere in
  code yet.
- R-04's segment write runs Sensitive Data Protection redaction but has no
  staff-name scrub before storing line text, so a spoken staff name not
  caught by SDP's generic detectors can sit in a `segments` document for its
  48-hour TTL. Deferred: bounded exposure, and R-05b's `scrubStaffNames`
  utility will make an eventual fix cheap to add.
- A measured redaction-accuracy check (`scripts/eval-redaction.ts`,
  `npm run eval:redaction`, run 2 Oct against the real `bee6-playground`
  project) found Google DLP's `STREET_ADDRESS` detector misses common
  Indonesian "Komplek ... Blok ... No." addresses entirely, and only
  partially redacts "Jalan ... No." addresses it does catch (house number
  and district survive in clear text). Phone numbers, emails, and names all
  scored correctly (9/9 excluding address, 11/11 precision, no
  over-redaction). Accepted as a known gap rather than building a regex
  supplement now; revisit if R-13's gold-set eval shows it matters.
- See `CLAUDE.md` and `docs/` for the full set of hard rules, architecture,
  and honestly-stated known gaps (DPIA, Transcribe preview status, etc.).

---

Built with Claude Code. Runs entirely on Google Cloud and Gemini.

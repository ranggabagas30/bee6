# bee6: the SOP Improvement Agent

Built for the GATI x Google Cloud AI Builder Cup 2026.

## What it is

bee6 listens to a small food-and-beverage shop's working day through one paired phone and turns speech into short
work notes. Audio is never stored in the cloud. Staff tap **Start** (Mulai) to begin the day and **End** (Selesai)
to finish it; capture also stops by itself one hour after closing. A one-hour debrief then starts on the phone and
asks staff, one tap at a time, whether flagged moments happened and why.

From those notes the system proposes a change to the shop's SOP (standard operating procedure). A supervisor checks
the proposal, the owner approves it, it ships as a new SOP version, and on a set review date the system compares the
shop's notes before and after the change and suggests whether it worked. The supervisor and the owner decide.

Owners and supervisors sign in with email and password. Staff have no account: a phone is paired to the shop with a
6-digit code. The pilot shop is Proofed (Indonesia); it has not gone live yet. Judges use a demo outlet in the same
app.

## Try it

- Demo: [https://web-33uzb53tza-et.a.run.app](https://web-33uzb53tza-et.a.run.app)
- Repository: [https://github.com/ranggabagas30/bee6](https://github.com/ranggabagas30/bee6)
- Team contact: [TEAM CONTACT]

Every visit to the demo gets its own **private sandbox**: a copy of a fictional bakery that lasts 2 hours and cannot
be seen by anyone else. Nothing in it is real shop data. Choose a role on the sign-in page (Staff, Supervisor or
Owner) and use the shared demo credentials below. They are public on purpose and open nothing but a sandbox.

| Role | Sign in with |
| --- | --- |
| Staff | Staff code `000000` |
| Supervisor | `supervisor.judge@example.com` / `bee6-demo` |
| Owner | `owner.judge@example.com` / `bee6-demo` |

Suggested path:

1. **Staff.** Sign in with the staff code on a phone or laptop with a microphone, and allow the microphone. The
   capture page opens a **script drawer** with a script of about 3 minutes of reading: tap Start, then read each card aloud and tap Next.
   In the demo you can start at any time of day and end at once, and a session hard-stops 5 minutes after
   Start. Then answer the debrief questions. Up to two questions from the fictional bakery's earlier days are added to
   your own, marked "Earlier day".
   If several people start at the same time, start about a minute apart; the transcription service shares capacity.
2. **Supervisor.** Use the bar at the top to switch role inside the same sandbox. Open the day record, the questions
   queue and Proposals. Generate a proposal (the sandbox's earlier days already hold enough evidence), then mark it
   feasible or reject it.
3. **Owner.** Approve the proposal. It ships as a new SOP version, shown on the SOP page with a before/after list.
4. **Review.** On Reviews, use "Fast-forward to the review date (simulated)" to see the review and its suggested
   verdict. Supervisor and owner each record a verdict.

The demo is English-first. Bahasa Indonesia strings exist but are provisional.

## How it works

1. **Capture.** The paired phone's page listens with the microphone, detects speech in the browser (voice activity
   detection) and cuts it into short Opus segments of at most 15 seconds.
2. **Segment upload.** Each segment is sent to our API inside the request. The API checks the device's role and shop
   on the server.
3. **Transcription and redaction.** The audio is transcribed in memory by Gemini and dropped. The text is then redacted
   by Sensitive Data Protection (including person names) before it is written; staff names are scrubbed again from the
   lines before a thread is stored. Redacted segment text expires after 48 hours.
4. **Windows.** Plain code groups lines into windows.
5. **Threads and label.** A Gemini Flash-Lite call groups each window's lines into threads (a thread can continue an
   open one from an earlier window) and labels each thread with one of 12 categories, a confidence and the lines it
   relies on. Plain code assembles and stores the threads.
6. **Evidence gate.** Plain code, not AI. A label becomes a fact only if the gate's rules pass; otherwise it becomes a
   debrief question.
7. **Debrief.** After End or the auto-stop, staff answer Yes / No / Skip on the phone, with a reason that is scrubbed
   and redacted. An answer can confirm or reject a label. A supervisor can also confirm or reject one.
8. **Proposal.** A supervisor or owner asks for a proposal. If the facts reach the evidence floor (at least 2 facts on
   at least 2 different days, within 14 days), a `ProposalAgent` (Google ADK, Gemini Flash) picks one intervention from
   a fixed library and writes one SOP step change with a metric, a failure condition and a review date. Plain code
   checks its output (`pgate-v1`) and refuses anything that does not pass.
9. **Supervisor, then owner.** The supervisor marks the proposal feasible or rejects it; the owner approves or
   rejects it. A rejection reason becomes a permanent constraint that later proposals must acknowledge.
10. **SOP version.** Approval writes a new, immutable SOP version, effective the next day.
11. **Review.** A daily Cloud Scheduler job finds changes whose review date has come and compares the rate of the
    affected category per captured day before and after. The suggested verdict is plain code (a change of 20% or more,
    needing at least 2 captured days in each window), not a model. Supervisor and owner each decide; the owner's
    verdict is the outcome. A review nobody confirms within 7 days is recorded as "unknown".

More detail: [`docs/architecture.md`](docs/architecture.md).

## Models and regions

<!-- regions:start -->
| Model | Used for | Location |
| --- | --- | --- |
| `gemini-3.5-transcribe-preview` | Transcription | `global` |
| `gemini-3.5-flash-lite` | Labels | `global` |
| `gemini-3.5-flash` | Proposals | `asia-southeast1` |
| `gemini-live-debrief` | Voice debrief (not built) | Not probed |
| Sensitive Data Protection (service) | Redaction | `asia-southeast2` |

Probed on 2026-10-01 (`config/regions.yaml`).
<!-- regions:end -->

Services and data are in `asia-southeast2` (Jakarta). Each model's location comes from `config/regions.yaml`, written
by `npm run probe` and never hard-coded. A row says "Not probed" when the probe has no working location for that
model. This table is generated: run `npm run readme:regions` after a re-probe and paste the output between the
markers; a test fails if the two differ.

## Privacy by design

- **Audio is never stored in the cloud.** It arrives in the segment request, is transcribed in memory and dropped.
  There are no Cloud Storage writes, and no audio or base64 in logs, errors or Firestore. While the network is down the
  phone keeps about 10 minutes of audio in memory only.
- **Redaction before storage.** Sensitive Data Protection runs on transcript lines, and on debrief reasons after a
  staff-name scrub, before anything is written.
- **Names only in `staff`.** Staff names are used only for the scrub and the transcription vocabulary (see Known gaps). Threads,
  questions, answers, proposals, outcomes and audit logs store no name and no staff id.
- **Answers carry a device id only.** An answer stores the answering device and timestamps, not a role or a person.
  Supervisors see "a staff member answered", never who. No supervisor or owner screen shows a device id.
- **Browsers never talk to Firestore.** Every read and write goes through our API, which checks role and shop on the
  server.
- **SOP changes only through proposals** (evidence, supervisor, owner). No endpoint edits the SOP directly.
- **Google only.** Gemini on Google Cloud (Vertex) through `@google/genai` and Google ADK, with the project's service
  account. No other AI provider, SDK or key is used anywhere in the product code.
- **Retention.** Redacted segment text expires after 48 hours. Debrief answers, with their redacted reason text,
  expire after 14 days. Thread text currently has no expiry; the planned 14-day retention is not built yet (see Known
  gaps).
- **The public repository holds no real SOP, transcripts, staff or customer data, keys or audio.** Demo data is
  fictional.

## Setup

You need Node.js and a paid Google Cloud project (real shop data never goes through a free AI Studio key). For local
development, sign in with Application Default Credentials (`gcloud auth application-default login`).

```bash
npm install                  # also points git at .githooks (pre-push: lint, build, unit tests)
cp .env.example .env.local   # then fill in the values; the names are listed under Environment
npm run dev                  # local dev server
npm run probe                # region probe: writes config/regions.yaml (needs a real GCP project)
GOOGLE_CLOUD_PROJECT=<demo project> DEMO_MODE=true npm run seed -- --project demo
                             # fictional outlet, users, staff and a 6-digit device pairing code
npm run provision:web-user -- --project demo --email <email>   # owner or supervisor sign-in account
```

Other commands:

```bash
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm test                 # unit tests (vitest run)
npm run build            # next build
npm run readme:regions   # prints the Models and regions table for this file
npm run smoke            # not built: there is no end-to-end smoke script yet
```

`npm run seed -- --project demo --template` and `npm run demo:seed-template` build the demo's sandbox template through
the real segment route, on the demo project only. `npm run seed -- --project pilot` reads an untracked
`private/seed.pilot.json`. Pilot and demo are separate Google Cloud projects and the scripts refuse to mix them.

**Deploy:** a Cloud Build trigger on `main` builds the image (`cloudbuild.yaml`) and deploys the Cloud Run
service `web` in `asia-southeast2`. Cloud Scheduler calls two OIDC-verified internal routes: the pipeline
tick (`/api/internal/pipeline/tick`) and the daily review run (`/api/internal/reviews/run`). The `develop`
branch deploys to a separate private staging service `web-develop` on the demo project, kept as a future
staging environment before the pilot.

## Environment

Names only; values live in Secret Manager or an untracked `.env.local`, never in the repository.

- Project and region: `GOOGLE_CLOUD_PROJECT`, `APP_REGION`
- Firebase web config: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`
- Internal routes: `TASKS_INVOKER_SA`, `PIPELINE_TICK_AUDIENCE`, `REVIEW_RUN_AUDIENCE`
- Thread action handles: `THREAD_HANDLE_KEY`
- Demo project only (`DEMO_MODE` must stay unset on the pilot): `DEMO_MODE`, `DEMO_IP_SALT`, `DEMO_XFF_FROM_END`,
  `DEMO_SWITCH_IP_CAP`, `DEMO_SANDBOX_DAILY_CAP`, `DEMO_SANDBOX_IP_CAP` (default 30), `DEMO_SEGMENT_SANDBOX_CAP`, `DEMO_SEGMENT_DAILY_CAP`,
  `DEMO_GENERATE_SANDBOX_CAP`, `DEMO_GENERATE_DAILY_CAP`, `DEMO_FAST_FORWARD_SANDBOX_CAP`,
  `DEMO_REDACT_SANDBOX_CAP`, `DEMO_MODEL_DAILY_CAP`
- Development only: `NEXT_PUBLIC_DEV_CONTROLS` (the `/capture` dev panel; keep it off everywhere real)
- Named in the project rules but not read by any code yet: `CLOUD_TASKS_QUEUE`, `DAILY_TOKEN_CEILING`,
  `NEXT_PUBLIC_DEVICE_AUDIO_QUEUE`

## Evaluation

The eval scripts read local files or call the demo project. `eval:export` writes redacted line text to CSV files in a
directory you name outside the repository and prints counts only; `eval:redaction` and `eval:label` print their own
fictional fixture text; the others print metrics only. Their inputs (clips, references, the gold-set CSV) stay outside
the repository.

**No evaluation figures are reported yet.** When they are, each will carry its sample size `n`, its date and its
source, and the label figures will say they are measured on internal fictional speech by the team (internal testing and
the demo outlet), not on shop data. Cost figures are list price, not billed cost.

How each is run:

- **Label quality** (confusion matrix, per-category precision, recall and F1, macro-F1, a rush-hour subset and
  agreement between two reviewers). First export episodes from the demo or test outlet, label them in a sheet, download
  the sheet as CSV, then report from that pinned snapshot (the report prints its SHA-256):

  ```bash
  npm run eval:export -- --project <id> --outlet <id> --from YYYY-MM-DD --to YYYY-MM-DD --out-dir <dir outside the repo> [--allow-pilot] [--tz <IANA zone>]
  npm run eval -- --gold <gold CSV file> --source <internal|pilot>
  ```

  `eval:export` is read-only, refuses the pilot project unless `--allow-pilot` is given, refuses judge sandbox
  outlets (`sbx-*`), and never overwrites a file. `--source` is required and printed in the report.
- **Transcription quality** (pooled word error rate, latency p50 and p95, speech minutes and a list-price estimate)
  on locally recorded fictional clips of at most 15 seconds, against human-written references:

  ```bash
  GOOGLE_CLOUD_PROJECT=<demo project> npm run eval:transcribe -- --clips <clips dir> --refs <refs CSV> [--allow-project <project id>]
  ```

  It refuses the pilot project. Word error rate normalisation: Unicode NFKC, then lower-case; apostrophes are removed;
  a "." or "," between two digits is removed (so 1.5 becomes 15 and Rp 15.000 equals Rp 15000); every other
  character that is not a letter, digit, combining mark or space becomes a space; whitespace is collapsed.
- **Trap eval:** `GOOGLE_CLOUD_PROJECT=<demo project> npm run eval:label` runs a fictional what-if line through the real
  label call five times and checks that it is labelled as training each time.
- **Redaction check:** `GOOGLE_CLOUD_PROJECT=<demo project> DEMO_MODE=true npm run eval:redaction` measures recall and
  precision of redaction on fictional fixtures.

## Known gaps

- A full DPIA under Indonesia's PP 33/2026 is the next priority after submission.
- Gemini 3.5 Transcribe is in preview.
- Some models run outside Jakarta: transcription and labelling use the `global` endpoint and proposals use
  `asia-southeast1` (see the table), so model processing may happen outside `asia-southeast2` even though services and
  stored data are in `asia-southeast2`. `config/regions.yaml` was probed against the demo project only and must be
  re-probed on the pilot project before the pilot handles real data.
- Capture needs the capture page open, the screen on and the phone plugged in. There is no native app.
- Consent is collected outside the app (the bee6-shop paper contract plus an emailed consent notice, privacy policy and
  terms). There is no in-app consent or revoked-consent state; revocation is handled manually, acknowledged and
  completed within 7 working days.
- A forgotten Start looks like a day off.
- Firestore TTL deletion lags: it is used today for segment text (48 hours) and debrief answers (14 days), and deletion
  is not instant.
- The pilot shop has not gone live yet, so there is no pilot outcome. The closed loop is shown on the demo outlet. Its
  earlier days are fictional clips sent through the real pipeline with back-dated session times, and the review
  fast-forward is simulated time, marked "Simulated time (demo)". A visitor's own capture session and debrief are real.
- The suggested review verdict is plain code (a change of 20% or more in the per-day rate, with at least 2 captured
  days in each window), not a model. Supervisor and owner decide.
- The daily per-outlet token ceiling (`DAILY_TOKEN_CEILING`) is specified but not enforced in code. The demo project
  has its own request-count caps instead: sandboxes per network and per day, and per-sandbox and per-day limits on
  recordings, proposals, simulated time-skips and typed-text redactions. Most of them are environment-configurable (see
  Environment) and none is a token ceiling.
- Constraints cannot be edited or deleted in the app. Proposals respect them through the prompt and an acknowledgement
  that plain code checks, not a semantic check.
- The owner's approval screen has no cost or brand impact field.
- An outlet without a supervisor account cannot move proposals or reviews forward.
- A SOP step longer than 400 characters cannot be changed by a proposal: the model rewrites a step at up to 400
  characters (steps can be up to 800), so approval is refused instead of truncating.
- An outlet's SOP is loaded by the seed script; there is no upload screen yet.
- The category definitions, the proposal rubric and the intervention library are v0 drafts written by the team and not
  yet reviewed by the domain expert.
- The on-device encrypted audio queue (capture phase P3) is not built. Without it, about 10 minutes of speech survives
  a network drop, and only while the page stays open.
- The 14-day thread-text retention (capture phase P4) and its extra staff-name scrub pass over stored thread text are
  not built. Thread text has no expiry yet; staff names are scrubbed before the text is stored.
- The incident-keyword fast path (a safety or security keyword flagging a moment at once) is specified but not built.
- Sensitive Data Protection's street-address detector misses common Indonesian "Komplek ... Blok ... No." addresses and
  only partly redacts "Jalan ... No." addresses (the house number and district can survive). Phone numbers, emails and
  names were redacted correctly in the same check. Accepted as a gap for now.
- The debrief answer route has no per-device rate limit yet.
- Demo only: reloading the page in the middle of a demo capture session does not restore the session.
- Demo only: on WebKit browsers (Safari), a tap within about one second of the sign-in page loading may not move the
  focus into the panel.
- Demo only: the demo is English-first, and its Bahasa strings are provisional.
- Staff first names also live in the private, gitignored `config/vocabulary.yaml`, which is loaded as the transcription
  vocabulary (`lib/transcribe/vocabulary.ts`). Whether this fits the rule that staff names live only in `staff` is parked
  pending input from the domain expert (Tiffany).

## Next

- Upload a SOP in the app (R-17), with a version diff screen and a fixed sections format.
- Long-step handling, so steps above the model's 400-character rewrite limit can be changed.
- Pilot hardening: a rate limit on the pairing route and a Content-Security-Policy.
- A CriticAgent that challenges a proposal before it reaches the supervisor (R-15).
- Cross-device merge of one shop's notes from several phones (capture phase P5).
- Voice debrief with the Gemini Live API (R-16).
- Owner cost and brand impact on the approval screen, and outcome memory that feeds earlier results into new proposals.
- Constraint editing, a per-outlet token ceiling, and the on-device audio queue and 14-day retention above.
- The DPIA under PP 33/2026.

## Licences

bee6 is MIT-licensed: see [`LICENSE`](LICENSE). Third-party components and their licences are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

---

Built with Claude Code. Runs entirely on Google Cloud and Gemini.

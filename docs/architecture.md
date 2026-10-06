# Architecture (current as of 30 Sept 2026)

## Principle
**One architecture for the demo and for real use.** The judges' demo outlet and the pilot shop run the same code, endpoints, models and prompts. Only the input (recorded demo clips vs a live mic), the data (fictional vs real) and the clock ("fast-forward to review date" in the demo, labelled as simulated) differ.

## Picture in words
```
Shop phone (Chrome, /capture page, plugged in, screen on)
  mic → Silero VAD (in browser) → speech batched into ≤15 s segments → Opus
  → upload with retry → PUT /api/v1/segments/{device}:{seg}
                 │
                 ▼
Cloud Run service "web" (Next.js, asia-southeast2 Jakarta)
  ├─ Segment API: Gemini 3.5 Transcribe (in memory) → Sensitive Data Protection → Firestore
  │                audio dropped when the request ends
  ├─ Pipeline (Cloud Tasks): windows → Gemini Flash-Lite (threads + labels + work/private)
  │                          → evidence gate (plain code) → facts or debrief questions
  ├─ Agents (ADK): DebriefAgent · ProposalAgent · CriticAgent · ReviewAgent (Gemini 3.5 Flash; Live API for voice)
  └─ Screens: capture · staff debrief · supervisor · owner · demo "Try as…"
                 │
   Firestore (Jakarta) · Cloud Tasks · Cloud Scheduler · Secret Manager · Firebase Auth
   Gemini on Google Cloud: location per model from config/regions.yaml (Jakarta → Singapore → global)
```

## Named agents and guardrails (for the architecture slide)
| Name | Kind | Job | Model |
|---|---|---|---|
| Capture | Browser code | Voice detection, segments, upload | Silero VAD (MIT) |
| Transcriber | Model call | Speech → text | Gemini 3.5 Transcribe |
| Labeller | Model call | Threads, category, evidence, work vs private | Gemini 3.5 Flash-Lite |
| Evidence Gate | **Plain code** | Decides fact vs question; blocks weak proposals | — |
| DebriefAgent | ADK agent | Debrief questions after Selesai or the auto-stop, 1 h window (voice, agent speaks first; tap fallback; technical spec §8.10–§8.11) | Live API model |
| ProposalAgent | ADK agent | Picks an intervention from the library, cites rubric + ≥ 2 dated evidence items | Gemini 3.5 Flash |
| CriticAgent | ADK agent | Checks proposals using the Evidence Gate as a tool | Gemini 3.5 Flash |
| ReviewAgent | ADK agent + Scheduler | On the review date: worked / revise / revert | Gemini 3.5 Flash |

## Data flow and privacy
1. Audio lives only in the browser (in-memory queue) and in the segment request. Never stored in the cloud.
2. Transcript lines are redacted before storage; stored segments expire after 48 h.
3. Private (non-work) lines are removed after labelling and only counted.
4. Kept long-term: threads (category, summary, evidence line refs), questions, SOP versions, proposals, constraints, outcomes, audit log.
5. Names only in `staff`; everything else stores roles.

## Roles (summary)
Owner (Google sign-in, summaries + approvals) · Supervisor (Google sign-in, full day record + reviews + settings) · Staff (no sign-in in MVP 1: whoever holds a paired device answers that device's questions; name + PIN is post-MVP 1, `specs/web-backend-rbac.md` §2a) · Shop device (pairing token, uploads only) · Judge (demo outlet, picks a role). Full matrix: `specs/web-backend-rbac.md` §2.

## Cost (model spend per outlet per month)
- As built (Transcribe for all speech): **~$24 / $30 / $37** at 15 / 20 / 25% of the day being speech.
- Modelled cheaper path (Flash-Lite first pass, Transcribe when unsure): ~$11–16. Not built; labelled as modelled.
- Pilot + demo through judging: ~$60–65 of Google Cloud usage.

## Known gaps
DPIA (next priority) · Transcribe is preview · some models may use the global endpoint · browser capture needs the page open with the screen on.

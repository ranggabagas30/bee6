# ADR-001: Lean, Gemini-routed architecture for the SOP Improvement Agent

> **Repo note:** this is decision history. Sections 1–11 describe the 29 Sept morning analysis; several parts were later replaced (see §12 addenda). For the architecture as it stands, read `../architecture.md`.
**Status:** Accepted (Option B), 29 Sept 2026, with the addendum in §12
**Date:** 29 Sept 2026
**Deciders:** GATI founder/CEO (product + budget), build lead (pipeline), Tiffany (playground/demo UX)

> ## Current state at a glance (30 Sept 2026, 01:30 WIB)
> The sections below are the decision history. **What we build now:**
> - **One web app** (Next.js, TypeScript) as **one Cloud Run service** in Jakarta (asia-southeast2): screens + API + pipeline + ADK agents.
> - **Capture:** the capture page on a plugged-in Android phone (Chrome): browser VAD, ≤ 15 s segments, Opus upload. No audio stored in the cloud.
> - **Transcription:** Gemini 3.5 Transcribe for all speech. **Labels:** Gemini 3.5 Flash-Lite. **Agents:** Gemini 3.5 Flash (Proposal, Critic, Review). **Voice debrief:** Live API.
> - **Regions:** services in Jakarta; each model's location from a probe (Jakarta → Singapore → global).
> - **Roles:** Owner/Supervisor via Google sign-in; staff name + PIN on the shop phone only; judges via one-click demo roles.
> - **Team and plan:** Rangga builds (~4 h weekdays, 8 h weekends) with **Claude Code** as the dev tool; the product uses only Google Cloud + Google AI. Go-live Mon 5 Oct, SOP v2 Sat 10, review Wed 14, submit Fri 16. See `docs/plan.md`.
> - **Cost:** ~$24–37 per outlet-month as built; the cheaper path (~$11–16) is modelled, not built. **DPIA** is the next priority after submission.

**Scope:** audits GATI's private product context (§4, §6, §7, §11–§13) and tech brief. Where this ADR changes a locked decision it says so explicitly.

---

## 1. Context

The locked design is sound as a *product*: VAD on a store phone → Gemini transcription → redact → threads → labels → plain-code gate → debrief → ADK proposal agent → supervisor/owner approval → Cloud Scheduler review → outcome memory. Two things have moved since it was written, and one assumption was never tested:

**The platform moved (verified 28–29 Sept on Google's own pricing and docs pages):**
- Vertex AI is now **Gemini Enterprise Agent Platform**; Agent Engine is now **Agent Runtime**. Update names in the deck and README.
- Since **1 July 2026, non-global (regional) endpoints cost ~10% more** than global (e.g. 3.5 Flash-Lite $0.30 → $0.33 per 1M input). A pinned Singapore endpoint is no longer price-neutral.
- A **Flex tier** (50% off, 1–15 min latency, best-effort, Preview) now exists for 3.5/3.1 Flash-Lite and the Flash family, alongside Batch.
- **Gemini 3.5 Transcribe** is priced on Agent Platform at ~$0.0051/audio-minute (sync) and ~$0.0089/min (Live); it accepts no prompt and returns no per-word confidence.
- **Live API bills the whole accumulated session context on every turn.**
- Gemini 3.6/3.7/3.8 Flash are on **promo pricing that doubles on 1 Jan 2027**. 3.5 Flash and 3.5 Flash-Lite are not promo-priced.

**The untested assumption:** §7 and §10.8 cost only the *audio line* ($3–5/stream/month, "17–28% COGS"). Nobody costed the **whole stack** — reasoning per window, the "classify twice" confidence signal, Transcribe re-runs, the Live debrief per staff member, and the proposal agents. That is what the judges' business-model question and the real Proofed invoice will expose.

**Constraints that do not move:** Gemini as core; Cloud Run or Firebase; paid tier only for real Proofed data; internal deadline Fri 16 Oct; go-live Fri 2 Oct; one room mic for MVP; revenue anchor ~Rp300k ≈ $18/outlet/month.

---

## 2. Findings in one screen

| # | Finding | Severity |
|---|---|---|
| F1 | **Full-stack COGS as documented ≈ $40/outlet-month — ~2.3× the $18 revenue.** The audio line is fine; the rest is not. ~~A lean variant lands at $6.4–9.2 (36–51%)~~ **Corrected in §12.1: $10.9–15.9 (60–88%)**, because transcription can't run on Flex and every segment is its own call. | Business-model killer if a judge asks |
| F2 | **Residency claim may be false for the chosen models.** The Agent Platform ML-processing table visibly lists Gemini 3.5 Flash and 3.1 Flash-Lite for APAC regions; a third-party EU tracker reports 3.5 Flash-Lite's residency guarantee as EU multi-region only. 3.5 Transcribe and 3.8 Live were not found in the table. "Pinned regional processing" in the DPIA is only true model-by-model. | DPIA / legal slide credibility |
| F3 | **The evening debrief is the single biggest variable cost.** A Live session per staff member (4 staff) costs ~$9–15/month because context re-bills every turn. One shared Live session per close costs ~$2.3. | Cost |
| F4 | **"Mark uncertain words" only works on Flash-Lite, not Transcribe.** Transcribe takes no prompt and gives no confidence; the §11.7 confidence design needs a signal that actually exists. | Technical Merit (calibration story) |
| F5 | **Output tokens are nearly half the transcription bill (~48% at Flex).** Verbose JSON transcripts silently double cost. | Cost |
| F6 | **ADK on Agent Runtime is a hosting-rule grey zone.** The rules say Cloud Run or Firebase; keep ADK agents inside Cloud Run so the eligibility claim is unambiguous. | Eligibility |
| F7 | The Gemini API docs now list an **"Antigravity agent"** under managed agents. The context doc's "Antigravity is IDE-only" line needs a re-check before the deck repeats it. | Accuracy of a claim |

---

## 3. Decision

Adopt **Option B — Lean, Gemini-routed pipeline**: the same product flow, with each stage mapped to the cheapest Google surface that meets its quality bar, and the expensive surfaces confined to the moments where judges and users actually see them.

### 3.1 Stage → service → model → tier

| Stage | Where it runs | Model / service | Tier | Why this and not the alternative |
|---|---|---|---|---|
| Capture + VAD | Store Android phone (Kotlin foreground service) | Silero VAD (MIT) via ONNX Runtime Mobile | — | Free, on-device; unchanged |
| Encode + upload | Phone → Cloud Run | **Opus 16 kbps mono, inline in the request** (no GCS hop) | — | Gemini downsamples audio to 16 kbps mono anyway; a 6-min window ≈ 0.7 MB, well under the 20 MB inline limit. Audio never lands in cloud storage → "no audio at rest in the cloud" is literally true. ~605 MB/month upload at 20% gate |
| Always-on transcription + work flag | Cloud Run `ingest` | **Gemini 3.5 Flash-Lite** (or 3.1 Flash-Lite if F2 forces it) | **Flex**, standard fallback | Flex halves the largest line. Minutes of latency are fine for everything except incidents. Prompted to emit terse per-line JSON: `t`, `txt`, `work: bool`, `?` markers |
| Incident fast path | Cloud Run `ingest` | Same model | **Standard** | Keyword hit on-device or in the first pass → skip Flex |
| Redaction | Cloud Run `ingest` | Sensitive Data Protection (content method) | — | Transcripts are a few MB/month; per-GB pricing makes this negligible |
| Threads + labels per window | Cloud Run `ingest` | **3.5 Flash-Lite**, structured output with enum schema | **Flex** | Windows with zero `work` lines never reach this call (gating). Static category guide first in the prompt → implicit prefix caching |
| Second-opinion signal | Cloud Run `ingest` | 3.5 Flash-Lite re-classify | Flex | **Only for threads in the uncertain band** (e.g. 0.5–0.85), not all threads |
| Precision re-transcription | Cloud Run `ingest` | **Gemini 3.5 Transcribe** (verbatim + custom vocab) | Sync | Only segments that will become a debrief question (~3%). **Cross-model agreement** between the Flash-Lite and Transcribe versions of the same segment becomes the confidence signal F4 needs |
| Evening debrief | Cloud Run `agents` (ADK) | **Live API, one shared session per close**, ≤5 questions, ≤1.5k-token system context | Live | The visible "Gemini speaks first" moment. Fallback: turn-based cascade (Flash-Lite TTS asks, Transcribe hears, Flash-Lite interprets) for network drops and for staff answering next morning |
| Proposal / critic / review agents | Cloud Run `agents` (ADK) | **Gemini 3.5 Flash** with thinking | Standard | Low volume (~12 calls/month) → spend quality here. Not promo-priced, so the 2027 unit economics hold |
| Few-shot retrieval of corrections | Firestore | Gemini Embedding + **Firestore vector search** | — | Avoids managed vector/RAG services that bill per hour whether used or not |
| State, day record, outcome memory | Firestore | — | — | Source of truth, auditable. Agent Platform Memory Bank not needed for MVP |
| Review dates, morning re-opens | Cloud Scheduler → Cloud Tasks → `agents` | — | — | Cloud Tasks also gives durable retry/backoff for Flex 503/429 |
| Playground | Firebase Hosting (static) + one Cloud Run endpoint | Pre-computed scenarios; **one live Flash-Lite call** (step 4) | Standard, hard budget cap | Stable for 7 weeks unattended; no preview model on the live path |
| Evals + cost evidence | Local / CI | **ADK eval** on the gold set; Cloud Billing export → BigQuery | — | Produces the confusion matrix and a **measured $/outlet-day** — unfakeable Technical Merit evidence |

### 3.2 Three Cloud Run services, not ten
- `ingest` — receives windows, runs transcription → DLP → gating → labels → gate (plain code). Stateless, scale-to-zero.
- `agents` — ADK app: DebriefAgent, ProposalAgent (bound to the intervention library), CriticAgent (calls the plain-code evidence gate as a tool), ReviewAgent. Scheduler/Tasks call it.
- `web` — staff/supervisor/owner PWA + approval screens (or Firebase Hosting + `agents` API).

Draw these as **named agents** on the architecture slide (per §13.6); the plain-code gate is drawn as a guardrail, not an agent.

---

## 4. Options considered

### Option A — As documented
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | **~$40/outlet-month** (Flash-Lite std transcription $6.5 + ungated uncached reasoning $6.8 + classify-twice on everything $6.8 + Transcribe on 10% $2.6 + Live per staff with 8k context $15 + proposals $2.9) |
| Scalability | Linear in outlets and staff; debrief scales with headcount |
| Team familiarity | Same stack as B |
| Technical Merit | High |

**Pros:** simplest mental model; every call at standard latency.
**Cons:** COGS > revenue; residency claim unverified per model; confidence design relies on a Transcribe feature that doesn't exist.

### Option B — Lean, Gemini-routed (**recommended**)
| Dimension | Assessment |
|---|---|
| Complexity | Medium (+ Flex retry/fallback, gating flag, cross-model agreement) |
| Cost | **$6.4–9.2/outlet-month** at 15–25% VAD gate (≈36–51% of $18); +~$0.9 if the debrief uses one Live session instead of the cascade |
| Scalability | Transcription and reasoning scale with *speech minutes*, not staff; debrief is one session per outlet |
| Team familiarity | Same SDKs; Flex is one parameter |
| Technical Merit | **Higher than A** — five Gemini surfaces each chosen by measured cost/quality, plus evals and live cost telemetry |

**Pros:** survivable unit economics; a judge-proof cost slide; calibration signal that exists.
**Cons:** Flex is Preview and sheddable; more moving parts to test in 3 days.

### Option C — Transcribe everywhere
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | ~$25.7/outlet-month for transcription alone |
| Technical Merit | Good accuracy story, but no prompt → no work flag, no uncertainty markers |

**Pros:** best raw WER, custom vocabulary. **Cons:** above the whole POS price ceiling before any reasoning.

### Option D — On-device Gemma first pass (roadmap only)
Gemma 3n / Gemma 4 E2B can do on-device ASR through LiteRT-LM, which would drop NON_WORK speech before it ever leaves the phone. But published Android builds are flagship-class (8 GB+ RAM gating is common practice) and the 30-second clip limit at launch fits badly with 6-minute windows. **Deck slide, not build.** It is a strong "privacy by architecture" roadmap line for the finale.

---

## 5. Trade-off analysis

- **Flex latency vs cost.** 50% saving on the two biggest lines, in exchange for 1–15 min latency and possible 503s. Acceptable because the day record is reviewed in the evening; incidents bypass Flex. Mitigation: Cloud Tasks retry with backoff, then standard tier after ~10 min so no window is ever dropped.
- **Live API vs cascade for the debrief.** Live is the most impressive thing in the product and the costliest per minute. One shared session per close keeps the wow and caps cost; the cascade is the reliability fallback, not the headline.
- **3.5 vs 3.1 Flash-Lite.** 3.1 costs ~15% more for audio at non-global rates (~$0.50/month difference at Flex) but is the one visibly listed in the APAC residency table. If F2 checks out badly for 3.5, pay the difference — the DPIA claim is worth more than 50 cents.
- **Cross-model agreement as confidence.** Costs almost nothing (only ~3% of speech is re-run) and gives a calibration curve grounded in two independent Google models — a better story than self-reported confidence, which the literature says is overconfident.
- **Firestore over managed memory/RAG.** Loses a logo on the slide, gains auditability and a near-zero idle bill.

---

## 6. Cost model (per outlet, per month, one room mic)

Assumptions: 14 h × 30 d; Gemini audio 32 tokens/s; transcript ~175 text tokens per speech minute +30% for JSON wrappers; ~60 windows/day at 20% gate; reasoning prompt 4k static (90% implicit-cache hit) + 2.5k dynamic, 350 output tokens; Agent Platform non-global prices, Sept 2026.

| Line | As documented (A) | Lean (B), 20% gate |
|---|---|---|
| Always-on transcription (3.5 Flash-Lite) | $6.52 std | **$3.26 Flex** |
| Labels per window | $6.83 (ungated, uncached, 600 out) | **$1.28** (gated 70%, cached, 350 out, Flex) |
| Second-opinion pass | $6.83 (all threads) | **$0.26** (uncertain 20% only) |
| Transcribe re-runs | $2.57 (10%) | **$0.77** (3%) |
| Debrief | $14.98 (Live × 4 staff, 8k context) | **$1.36** cascade × 4 staff — or $2.28 one shared Live session |
| Proposal/review agents (3.5 Flash) | $2.90 (40 calls) | **$0.87** (12 calls) |
| DLP, embeddings, Firestore, Cloud Run, Scheduler | small, mostly free-tier | small, mostly free-tier |
| **Total (model spend)** | **≈ $40.6** | **≈ $7.8** |
| Share of $18 revenue | ~226% | ~43% |

Sensitivity (Lean): gate 15% → **$6.43 (36%)**; 20% → $7.80 (43%); 25% → $9.17 (51%). **The VAD gate % is still the variable that decides viability — measure it in Tuesday's spike.** Figures are model estimates; the Proofed billing export replaces them after week one.

**Deck consequence:** stop saying "17–28% COGS". Say "measured ~$X per outlet-day at Proofed, with a path to <40% gross COGS through routing, Flex and gating" — and show the billing export.

---

## 7. Loopholes and pitfalls (fix before 16 Oct)

| # | Loophole / pitfall | Fix |
|---|---|---|
| L1 | DPIA says "pinned regional processing" but not every model has an APAC ML-processing guarantee (F2) | Check the residency table per model on Tue 29. Use only models with a Singapore guarantee for real Proofed data; name each model and region in the DPIA; declare anything global explicitly |
| L2 | AI Studio / Developer API keys have no regional pin | All real-data calls through **Agent Platform** with project + location. AI Studio only for prompt hardening on synthetic clips |
| L3 | Full-stack COGS never costed (F1) | Adopt §6 lean table; instrument cost per outlet-day from billing export |
| L4 | Live API re-bills accumulated context every turn | One shared session per close, ≤5 questions, ≤1.5k-token system context, hard 4-min cap; enable session context compression if available |
| L5 | Transcribe has no prompt and no confidence (F4) | Uncertainty markers from Flash-Lite; confidence from Flash-Lite vs Transcribe agreement on the ~3% re-run segments |
| L6 | Flex is Preview, sheddable, 1–15 min | Never on incident path; Cloud Tasks retry → standard fallback; client timeout ≥10 min; log shed rate |
| L7 | 3.6–3.8 Flash prices double on 1 Jan 2027 | Build unit economics on 3.5 Flash / 3.5 Flash-Lite only |
| L8 | Non-global endpoints +10% | Already in §6 numbers; mention in the cost slide footnote |
| L9 | Output tokens ≈ half of transcription spend (F5) | Terse schema: short keys, line indices instead of re-quoted text, no prose summaries per window |
| L10 | Explicit context-cache storage bills per token-hour all day | Rely on implicit prefix caching (static guide first); no explicit caches for a 4k prompt |
| L11 | Managed RAG / vector index services bill per hour while idle | Firestore vector search for few-shot retrieval |
| L12 | ADK on Agent Runtime may read as "not Cloud Run" (F6) | Host ADK agents in the `agents` Cloud Run service; mention Agent Runtime as the scale path only |
| L13 | Two mics = 2× transcription + cross-bleed dedupe work | MVP = one stream (already §9); second mic is deck architecture |
| L14 | Antigravity claim may be stale (F7) | Re-read the Gemini API agents docs before the deck says "IDE-only" |
| L15 | Playground must survive 7 weeks unattended | Pin model versions; live step uses GA Flash-Lite, not a preview model; per-IP rate limit; daily token ceiling in app code |
| L16 | Budget alerts notify, they don't stop spend | App-level daily token ceiling per outlet + API quota cap on the playground project; separate GCP projects for pilot and playground |

---

## 8. Open decisions from §12 resolved by this ADR

**#1 Encrypted audio buffer → Accept, device-only.** Android Keystore AES-GCM ring buffer, 2 h cap, segment deleted on server ack or on expiry. Cloud side never stores audio because upload is inline. Deck/DPIA wording: *"Audio is held encrypted on the store device only until it is transcribed, then deleted; audio is never stored in the cloud. We keep work notes, not recordings."*

**#4 Merge training threads <10 min apart → Yes, as a `session_id`, not a rewrite.** Threads stay atomic (auditable evidence); a `training_session_id` groups them for the debrief and the rule-extraction step. No extra model call.

**#9 Session resilience → contracts:**
- Window upload: idempotent `PUT /windows/{device_id}:{window_start}`; server dedupes; device deletes only after `200`.
- Flex 503/429: Cloud Tasks exponential backoff; after ~10 min, re-issue on standard tier.
- Live debrief drop: resume the session if possible; otherwise continue the **same question queue** in the cascade; answers keyed by `question_id`, so no double-counting.
- Photos: WorkManager queue; resize to ≤1024 px long edge on device before upload.
- Clock: device timestamps carried in every window; server records skew at upload.

**#2 Per-person visibility → per-step for the owner (architecture default).** Person IDs live only in the debrief routing table; thread, proposal and outcome records carry role + step, not name. This makes the "no per-person scoring" claim true in the data model, not just the UI. Product can still overrule.

**§11.11 POS schema → canonical `SalesEvent` v1** (CSV adapter first):
`schema_version, outlet_id, source, adapter_version, receipt_id, line_no, occurred_at (ISO-8601 with offset), item_sku, item_name, qty, status (sale|void|refund), ingested_at`. Idempotency key = `source + receipt_id + line_no`. Check field names against ARTS POSLog before freezing; ESB export still unverified.

---

## 9. Technical Merit plays that cost ~nothing

1. **"Right model for each job" slide** — five Gemini surfaces (Flash-Lite, Transcribe, Live, Flash, Embedding) with the measured cost and quality reason for each. Judges reward deliberate routing over "we called the biggest model".
2. **Multi-agent ADK with a code guardrail** — Proposal → Critic (tool = plain-code evidence gate) → approval state machine. Show a suppressed proposal and why.
3. **ADK eval on the gold set** → confusion matrix and calibration chart (already in §8 metrics).
4. **Live cost telemetry** — billing export → BigQuery → "$ per outlet-day" tile in the owner view and on a slide.
5. **Structured output with enum schemas** — category set enforced by the API, not by regex.
6. **Privacy by architecture** — inline audio, no cloud audio at rest, DLP before reasoning, per-model residency table in the DPIA.

---

## 10. Consequences

**Easier:** a defensible business-model answer; a DPIA whose claims are checkable; a calibration story built on signals that exist; a playground that won't break or overspend during judging.
**Harder:** Flex retry/fallback logic; one more field (`work`) in the first-pass schema; per-model residency bookkeeping.
**Revisit:** Flex GA status and SLO; Transcribe residency and GA status; Live API pricing; gate % after the first Proofed weekend; ESB export availability; Antigravity's product surface.

---

## 11. Action items

| When | Item | Owner |
|---|---|---|
| Tue 29 Sept | Read the Agent Platform data-residency table per model (3.5 Flash-Lite, 3.1 Flash-Lite, 3.5 Transcribe, Live model, 3.5 Flash, Embedding) for asia-southeast1; pick models accordingly | Build lead |
| Tue 29 Sept | Separate GCP projects (pilot / playground); billing export to BigQuery on; budget alerts + app-level token ceiling | Build lead |
| Tue 29–Wed 30 | Spikes on team clips: VAD gate %, Flash-Lite vs Transcribe WER with Javanese, Flex latency distribution and shed rate, Live session cost for a 5-question debrief (read the billed tokens, don't estimate) | Build lead |
| Wed 30 Sept | ADK 1-day spike (unchanged); host in Cloud Run | Build lead |
| Thu 1 Oct | Implement terse first-pass schema with `work` flag and `?` markers; gating; Cloud Tasks retry | Build lead |
| Thu 1 Oct | DPIA v0: inline-audio flow, device-only buffer wording, per-model residency table | Founder |
| Mon 12–Tue 13 Oct | Replace §6 estimates with measured $/outlet-day; update deck cost slide | Founder |
| Before deck | Re-verify prices (they changed twice this year), Transcribe status, Antigravity wording | Founder |

---

## 12. Addendum: GATI decisions of 29 Sept (revised 16:30 WIB)

| # | Decision | Effect on this ADR |
|---|---|---|
| D0 | **One architecture for demo and production.** The playground and the pilot share services, models, prompts and routing; only the input (clips vs live mic), the dataset and the time scale differ | The pilot/production engine split proposed earlier today is withdrawn |
| D1 | **Segment-based transcription** (not streaming): VAD utterances batched into segments ≤ 15 s → encrypted device queue → idempotent `PUT` to `ingest` (Jakarta) → inline audio to Gemini Flash-Lite, **standard tier**, explicitly cached prompt prefix. Chosen over streaming by GATI at 18:48 after weighing Technical Merit | Streaming via Transcribe Live rejected: ~$38–61/outlet-month all-in at a 15–25% gate, 10-min sessions, region unconfirmed. Cloud STT rejected: Chirp 3 US/EU only, Chirp 2 streaming lacks Indonesian, not Gemini |
| D2 | **In-request escalation** to Gemini 3.5 Transcribe (sync) for unsure or incident segments before the audio is dropped | Replaces "re-transcribe flagged segments later"; cross-model agreement is the confidence signal (F4) with no audio retention |
| D3 | **Region priority Jakarta → Singapore → Malaysia → global** | Platform services in asia-southeast2; Gemini location per model from a probe (`config/regions.yaml`). No Malaysia region listed by Google |
| D4 | **Capture: Android phone and/or wireless mic, Bluetooth allowed** on a SIM-less store phone; sources < 16 kHz refused; auto-fallback to the built-in mic | Reverses the product-context Bluetooth exclusion |
| D5 | **DPIA deferred to after submission**; told to judges as the next priority | L1 becomes a README "known gap". Consent and signage remain mandatory before real audio |
| D6 | **Two-step go-live** (capture Fri 2 Oct, understanding pipeline Sat 3 Oct) | Redacted text held ≤ 48 h (TTL) until processed; audio never persisted in the cloud |

### 12.1 Correction to §6 (cost model)
§6 ran the always-on transcription lane on **Flex**. That conflicts with the incident fast path: incidents are only detectable after transcription, and Flex targets 1–15 min with best-effort availability. On the standard tier, with one shared Live debrief per close, the corrected all-in model spend is:

| Gate | Segment-based (D1) | Share of Rp300k (~$18) | Streaming (rejected) |
|---|---|---|---|
| 15% | $10.9 | 60% | $38.0 |
| 20% | $13.4 | 74% | $49.7 |
| 25% | $15.9 | 88% | $61.3 |

The segment figures include the per-call prefix (~1,100 tokens, explicitly cached, ~$1.2–2/month at an average segment of ~10 s). Sent utterance by utterance without a cache, that line alone would be ~$5–8.

The F1 headline "$6.4–9.2 (36–51%)" is withdrawn. Paths back toward ~40% COGS: price at Rp450–500k for the 3–30-outlet ICP; VAD gate tuning (~$2.5 per 5 points); on-device keyword spotting so transcription can move to Flex (≈ −$3). **Biggest open risk:** if Flash-Lite's ASR quality on Bahasa + Javanese fails the Wed 30 Sept spike, Transcribe (sync) for every segment is the fallback, at ~$19–32/outlet-month for transcription alone.

### 12.2 Update 29 Sept, 21:00 WIB
| # | Decision | Effect |
|---|---|---|
| D7 | **Web app replaces the Android app** (Next.js, TypeScript, on Cloud Run). Browser capture: Silero VAD in the browser, 15 s Opus segments, encrypted IndexedDB queue | Capture works only while the page is open with the screen on; shop device must stay plugged in |
| D8 | **Gemini 3.5 Transcribe for all transcription**; Flash-Lite first pass and escalation dropped | All-in ~$24–37/outlet-month (15–25% speech). Work/private detection moves to the text label call |
| D9 | **Roles:** Owner, Supervisor (Google sign-in), Staff (PIN on paired shop device), Shop device (pairing code), demo sessions for judges | Firestore closed to browsers; all access via API with role claims |

### 12.3 Update 30 Sept, 00:50 WIB
| # | Decision | Effect |
|---|---|---|
| D10 | **One Cloud Run service** (`web`) holds screens, API, pipeline and agents | Less to deploy for a one-person team; the architecture slide still names each agent |
| D11 | **Dev tool: Claude Code** (rules don't restrict dev tools); the **product uses only Google Cloud + Google AI** | No non-Google AI calls in product code; README credits the tool honestly |
| D12 | **Conservative plan** (`docs/plan.md`): go-live Mon 5 Oct, weekday demo problem, voice debrief + Critic agent kept | Transcribe-only confirmed (no Flash-Lite switch built); supervisors see "a staff member answered" |
| D13 | **SOP v2 ships Sat 10** (was Fri 9; 30 Sept, 01:30). Sprint 2 had 27 h of work before Fri 9 but only 20 weekday hours | R-05 starts Sun 4; first proposal Fri 9; Critic + diff Sat 10; voice debrief Sun 11; review stays Wed 14; "before" window grows to 5 weekdays |

Current plan docs (all rewritten 30 Sept, 01:30): `docs/plan.md` (plan + dates), `docs/backlog.md` (task backlog), GATI's private roadmap (roadmap), `docs/specs/pipeline-and-agents.md` and `docs/specs/web-backend-rbac.md` (specs).

---

## Sources (checked 28–29 Sept 2026)
- Gemini Developer API pricing — https://ai.google.dev/gemini-api/docs/pricing
- Agent Platform generative AI pricing (non-global rates, Transcribe, Live billing) — https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
- Audio understanding (32 tokens/s, 16 kbps downsampling, 20 MB inline) — https://ai.google.dev/gemini-api/docs/audio
- Gemini 3.5 Transcribe (custom vocabulary limits, modes, 1 h / 30 min limits) — https://ai.google.dev/gemini-api/docs/transcribe
- Flex inference (50% off, 1–15 min, sheddable, Preview) — https://ai.google.dev/gemini-api/docs/flex-inference
- Agent Platform data residency — https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/data-residency
- innFactory, Gemini EU availability tracker (3.5 Flash-Lite residency) — https://innfactory.ai/en/ai-models/google-gemini/
- Agent Runtime / Sessions / Memory Bank pricing — https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing
- ADK on Cloud Run — https://docs.cloud.google.com/run/docs/ai/build-and-deploy-ai-agents/deploy-adk-agent
- Cloud Run pricing (free tier as Tier-1 spending discount) — https://cloud.google.com/run/pricing
- Gemma 3n developer guide (on-device ASR, 30 s clips at launch) — https://developers.googleblog.com/en/introducing-gemma-3n-developer-guide/
- Cost model script: recomputed with Python in this session; numbers are estimates until replaced by the billing export.

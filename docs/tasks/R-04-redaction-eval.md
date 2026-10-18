# R-04 redaction accuracy measurement (diagnostic)

Not a backlog line item on its own — a diagnostic follow-up to R-04 (Sensitive
Data Protection redaction), requested directly by Rangga to measure real
recall/precision of `lib/redact/dlp.ts` + `lib/redact/indonesian-phone.ts`
against the real `bee6-playground` project before trusting it with real shop
audio.

## Scope
- `scripts/eval-redaction-fixtures.ts` — ~20-25 fictional Indonesian F&B lines
  (hard rule #8: never real shop data), each with `expectRedacted` and an
  optional `expectedInfoType`.
- `scripts/eval-redaction.ts` (`npm run eval:redaction`) — runs every fixture
  through `dlpRedactor()` (real DLP call) and `redactIndonesianPhones()`
  (pure regex) and prints a per-line comparison plus a recall/precision
  summary. Diagnostic output for a human, not a CI gate.
- Read-only with respect to `lib/redact/*` — no production code changed.

## Explicitly out of scope
- The staff-name scrub (R-05b/R-07, not built yet). The fixture set should be
  extended to cover it once that lands.
- Any change to `dlp.ts` / `indonesian-phone.ts` behaviour.

## Risks / notes
- Needs `GOOGLE_CLOUD_PROJECT=bee6-playground` + ADC with DLP access; run
  against the demo project only, never the pilot project, per hard rule #4
  (paid project, but keep demo and pilot data separate per project notes).
- DLP's actual PERSON_NAME/location heuristics are a black box — some
  near-miss fixtures are *expected* to occasionally go either way; the
  script reports actuals, it doesn't assert a hard pass/fail.

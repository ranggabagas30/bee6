# Third-party notices

bee6 is MIT-licensed (see `LICENSE`). It uses Google Cloud and Google AI
services only for anything AI-related (CLAUDE.md hard rule #1). The
open-source components below are planned for later tasks and are not yet
added as dependencies as of R-01 — this file is recorded now per T-003's
acceptance criteria, ahead of the code landing, so the notice always ships
with the licence.

## @google-cloud/dlp
- **Used for:** Sensitive Data Protection (SDP) de-identification of transcript
  lines before they are stored (R-04, hard rule #3) — phone numbers, emails,
  person names and street addresses are replaced with bracketed labels via the
  regional DLP endpoint.
- **License:** Apache-2.0
- **Version:** 7.1.1
- **Project:** https://github.com/googleapis/google-cloud-node/tree/main/packages/google-privacy-dlp

## @ricky0123/vad-web
- **Used for:** in-browser voice activity detection on the `/capture` page
  (R-03) — the AudioWorklet + frame processor that decides speech vs silence.
  Bundles the Silero VAD ONNX weights (see below).
- **License:** ISC
- **Version:** 0.0.31
- **Project:** https://github.com/ricky0123/vad
- **Vendored under:** `public/vendor/capture/vad/` (worklet bundle +
  `silero_vad_v5.onnx`), copied from node_modules by
  `scripts/vendor-capture-assets.mjs` at build time — served from our own origin,
  no CDN (hard rule #8).

## Silero VAD (model weights)
- **Used for:** the ONNX model file run by @ricky0123/vad-web for in-browser
  voice activity detection (R-03). Local signal processing, not a hosted AI
  provider — does not trip hard rule #1.
- **License:** MIT
- **Project:** https://github.com/snakers4/silero-vad

## webm-muxer
- **Used for:** muxing WebCodecs Opus chunks into a WebM/Opus container on the
  `/capture` page (R-03) so each segment matches the `audio/webm;codecs=opus`
  contract the segment PUT accepts.
- **License:** MIT
- **Version:** 5.x
- **Project:** https://github.com/Vanilagy/webm-muxer

## Google Agent Development Kit (ADK) for TypeScript
- **Used for:** DebriefAgent, ProposalAgent, CriticAgent, ReviewAgent
  (R-08 onward).
- **License:** Apache-2.0
- **Project:** https://github.com/google/adk-typescript (package name/docs to
  be confirmed before R-08 per CLAUDE.md §3; ask Rangga if it blocks more
  than 2 hours — the fallback is a plain state machine calling Gemini).

## ONNX Runtime Web
- **Used for:** running the Silero VAD model in the browser (R-03).
- **License:** MIT
- **Version:** 1.23.0
- **Project:** https://github.com/microsoft/onnxruntime
- **Vendored under:** `public/vendor/capture/ort/` (wasm binaries + loader
  modules), copied from node_modules by `scripts/vendor-capture-assets.mjs` at
  build time — served from our own origin, no CDN.

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

## @google/adk
- **Used for:** ProposalAgent (R-08); CriticAgent and ReviewAgent will reuse
  the same adapter in later tasks (R-11, R-15).
- **License:** Apache-2.0
- **Version:** 2.2.1 (exact pin)
- **Project:** https://github.com/google/adk-js
- **Note:** has a hard dependency on `@google-cloud/vertexai@1.12.0`
  (Google, Apache-2.0), which nests its own `@google/genai@1.52.0` copy
  under `node_modules/@google-cloud/vertexai/`. Neither is imported by our
  code (R-08's `ProposalAgent` uses the top-level `@google/genai@2.24.0`
  copy only); `lib/agents/no-vertexai-import.test.ts` guards this.

## ONNX Runtime Web
- **Used for:** running the Silero VAD model in the browser (R-03).
- **License:** MIT
- **Version:** 1.23.0
- **Project:** https://github.com/microsoft/onnxruntime
- **Vendored under:** `public/vendor/capture/ort/` (wasm binaries + loader
  modules), copied from node_modules by `scripts/vendor-capture-assets.mjs` at
  build time — served from our own origin, no CDN.

## firebase
- **Used for:** owner/supervisor sign-in in the browser (R-06) — the
  `firebase/app` + `firebase/auth` modular SDK only (`signInWithEmailAndPassword`,
  `onAuthStateChanged`, `signOut`, `getIdToken`). Still Google-only (hard rule
  #1): this is Firebase Authentication, the same product as the server-side
  `firebase-admin` SDK already in use. No other Firebase product
  (`firebase/firestore`, `firebase/database`, `firebase/storage`) is imported
  in browser code — enforced by `lib/auth/client/import-ban.test.ts`.
- **License:** Apache-2.0
- **Version:** 13.0.0
- **Project:** https://github.com/firebase/firebase-js-sdk

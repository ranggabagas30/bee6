# Third-party notices

bee6 is MIT-licensed (see `LICENSE`). It uses Google Cloud and Google AI
services only for anything AI-related (CLAUDE.md hard rule #1). The
components below are the runtime dependencies listed in `package.json`
(`dependencies`); versions are the ones locked in `package-lock.json`, and each
licence is the `license` field of the package's own `package.json` as installed
in `node_modules`. Development-only dependencies (test, lint and type tooling)
are not shipped and are not listed. Where a package ships no licence text file,
or a licence could not be confirmed from a primary source, this is said in that
entry.

## Runtime dependencies

| Package | Version | Licence | Licence file shipped in the package |
| --- | --- | --- | --- |
| `@google-cloud/dlp` | 7.1.1 | Apache-2.0 | No (`package.json` field only) |
| `@google/adk` | 2.2.1 (exact pin) | Apache-2.0 | Yes |
| `@google/genai` | 2.24.0 | Apache-2.0 | Yes |
| `@ricky0123/vad-web` | 0.0.31 | ISC | No (`package.json` field only) |
| `bcryptjs` | 3.0.3 | BSD-3-Clause | Yes |
| `firebase` | 13.0.0 | Apache-2.0 | No (`package.json` field only) |
| `firebase-admin` | 14.5.0 | Apache-2.0 | Yes |
| `google-auth-library` | 10.9.1 | Apache-2.0 | Yes |
| `next` | 16.3.7 | MIT | Yes |
| `onnxruntime-web` | 1.23.0 | MIT | No (`package.json` field only) |
| `react` | 19.2.8 | MIT | Yes |
| `react-dom` | 19.2.8 | MIT | Yes |
| `webm-muxer` | 5.1.4 | MIT | Yes |
| `yaml` | 2.9.1 | ISC | Yes |
| `zod` | 4.6.5 | MIT | Yes |

## Notes per component

### @google-cloud/dlp
Sensitive Data Protection (SDP) de-identification of transcript lines before
they are stored (hard rule #3): phone numbers, emails, person names and street
addresses are replaced with bracketed labels via the regional endpoint.
Project: https://github.com/googleapis/google-cloud-node/tree/main/packages/google-privacy-dlp

### @google/genai
The Gemini client (Vertex mode) for transcription, labelling and proposals.
Project: https://github.com/googleapis/js-genai

### @google/adk
Google Agent Development Kit for TypeScript: the `ProposalAgent`.
Project: https://github.com/google/adk-js

It has a hard dependency on `@google-cloud/vertexai@1.12.0` (Google,
Apache-2.0, licence file shipped), which nests its own `@google/genai@1.52.0`
copy under `node_modules/@google-cloud/vertexai/`. Neither is imported by our
code (the agent uses the top-level `@google/genai@2.24.0` copy only);
`lib/agents/no-vertexai-import.test.ts` guards this.

### firebase and firebase-admin
`firebase` is used in the browser for owner/supervisor sign-in: the
`firebase/app` and `firebase/auth` modular SDK only. No other Firebase product
(`firebase/firestore`, `firebase/database`, `firebase/storage`) is imported in
browser code; `lib/auth/client/import-ban.test.ts` enforces this. `firebase-admin`
is the server-side Firebase Auth and Firestore SDK. Both are Google-only (hard
rule #1).
Projects: https://github.com/firebase/firebase-js-sdk,
https://github.com/firebase/firebase-admin-node

### google-auth-library, bcryptjs, yaml, zod
Google credentials and OIDC token verification for the internal routes; hashing
for the staff PINs (dormant in MVP 1); parsing `config/*.yaml`; schema
validation of every API input and model output.

### next, react, react-dom
The web application framework and UI library.

### @ricky0123/vad-web
In-browser voice activity detection on the `/capture` page: the AudioWorklet and
frame processor that decide speech versus silence. It ships the Silero VAD
models (see below).
Project: https://github.com/ricky0123/vad

Its `dist/bundle.min.js.LICENSE.txt` also carries a banner for "ONNX Runtime Web
v1.22.0, Copyright (c) Microsoft Corporation, Licensed under the MIT License"
(that code is bundled inside the package's own browser bundle).

### onnxruntime-web
Runs the Silero VAD model in the browser.
Project: https://github.com/microsoft/onnxruntime

### webm-muxer
Muxes WebCodecs Opus chunks into a WebM/Opus container on the `/capture` page so
each segment matches the `audio/webm;codecs=opus` contract the segment route
accepts.
Project: https://github.com/Vanilagy/webm-muxer

## Assets copied into `public/vendor/capture/` at build time

`scripts/vendor-capture-assets.mjs` (run as `npm run vendor:capture` and before
`next build`) copies these files out of `node_modules` so the capture page serves
them from our own origin, with no CDN. The output directory `public/vendor/` is
gitignored: none of these files is committed to the repository.

- From `@ricky0123/vad-web/dist` (ISC): `vad.worklet.bundle.min.js` and
  `silero_vad_v5.onnx`.
- From `onnxruntime-web/dist` (MIT): `ort-wasm-simd-threaded.wasm`,
  `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.jsep.wasm` and
  `ort-wasm-simd-threaded.jsep.mjs`.

### Silero VAD (model weights, `silero_vad_v5.onnx`)
Local signal processing, not a hosted AI provider, so it does not trip hard
rule #1. Source: https://github.com/snakers4/silero-vad

- **Licence:** MIT. The Silero VAD repository states "Published under permissive
  license (MIT)" in its README (checked on 12 Oct 2026).
- **Unconfirmed:** the README does not give a separate licence for the
  pre-trained weights, and the `.onnx` file carries no licence text of its own.
  We rely on the repository's MIT statement covering the model file. The
  `@ricky0123/vad-web` package (ISC) does not state the model's licence.
  Rangga to confirm before the weights are described as MIT-only.

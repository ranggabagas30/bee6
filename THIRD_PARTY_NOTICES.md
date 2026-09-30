# Third-party notices

bee6 is MIT-licensed (see `LICENSE`). It uses Google Cloud and Google AI
services only for anything AI-related (CLAUDE.md hard rule #1). The
open-source components below are planned for later tasks and are not yet
added as dependencies as of R-01 — this file is recorded now per T-003's
acceptance criteria, ahead of the code landing, so the notice always ships
with the licence.

## Silero VAD
- **Used for:** in-browser voice activity detection on the `/capture` page
  (R-03), so speech is batched into segments before upload.
- **License:** MIT
- **Project:** https://github.com/snakers4/silero-vad

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
- **Project:** https://github.com/microsoft/onnxruntime
- Note: check the licence of whatever JS wrapper library ships the ONNX
  model file itself (per CLAUDE.md §3) before adding it as a dependency.

## Claude Code skills (Everything Claude Code / ECC)
- **Used for:** developer-workflow guidance loaded by our Claude Code agents
  during the build (see `docs/skills-policy.md`). These are authoring aids for
  the engineering process, **not** part of the shipped product runtime.
- **Vendored under:** `.claude/skills/` — the DAILY subset only (21 skills),
  so Claude Code Cloud/desktop checkouts can load them without a local install.
- **License:** MIT (Everything Claude Code / `tonsofskills` ecosystem).
- **Project:** https://github.com/jeremylongshore/claude-code-plugins
- Note: `code-review`, `verify`, and `dataviz` are shipped by Claude Code
  itself, not vendored here.

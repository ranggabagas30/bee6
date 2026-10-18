# Docs map

Start here if you are reviewing the system: `specs/technical-specification.md` (§9 is what is built, §10 the
known gaps), then `architecture.md`.

| Doc | What it's for | Status |
|---|---|---|
| `../CLAUDE.md` | Rules, hard rules, stack, workflow for the coding agent | **Current, wins over everything** |
| `specs/technical-specification.md` | The technical idea, the normative session / capture / privacy rules (§8), what is built (§9) and the known gaps and limitations (§10) | **Current (18 Oct), wins after `CLAUDE.md`** |
| `plan.md` | Team, hours, sprints, day-by-day calendar, what's in / out, decisions (§10) | **Current, wins on dates** |
| `backlog.md` | Steps, dependencies and "done when" for each task R-01 … R-16 | **Current** |
| `specs/web-backend-rbac.md` | Web app, browser capture, backend, login, roles, routes and data (§6.6) | **Current** |
| `architecture.md` | The architecture as built, in one page: components, agents and checkers, platform | **Current (18 Oct)** |
| `specs/pipeline-and-agents.md` | PRD + specs for the pipeline (windows, labels, gate), debrief, agents, approvals, demo, evidence, consent | **Current** (dated pilot plan marked superseded) |
| `specs/product-spec.md` | What the product does and why: the loop, categories, threads, privacy | Current (18 Oct) |
| `db-schema.md` | Firestore collections and fields (ERD) | Point-in-time reference (11 Oct); `lib/firestore/schema.ts` wins |
| `tasks/` | One plan per task (`R-xx.md`), design notes, QA reports and dated investigations; `tasks/UX-03-journey-design.md` has the screens and copy | Working record; each file is dated |
| `internal_testing/` | Feedback from internal demo test runs (fictional data) | History |
| `HANDOFF.md` | Running state of the work between sessions (newest entries first) | Working log, not a spec |
| `pm-playbook.md` | How the build was run: agent roles, gates, process rules | Process reference |
| `design/` | Static design mock-ups | Reference |
| `adr/ADR-001-lean-gemini-architecture.md` | Decision history (cost analysis, options, addenda) | History; read §12 addenda for the latest decisions |

Precedence when docs disagree (`CLAUDE.md` §1): `CLAUDE.md` → `specs/technical-specification.md` → `plan.md` →
`backlog.md` → `specs/web-backend-rbac.md` → `architecture.md` → `specs/pipeline-and-agents.md` →
`specs/product-spec.md` → `adr/`. On how a screen looks or reads, `tasks/UX-03-journey-design.md` wins.

Not in this repo on purpose: the pilot shop's real SOP, franchise documents, staff details, market research and
legal notes. They live in GATI's private workspace.

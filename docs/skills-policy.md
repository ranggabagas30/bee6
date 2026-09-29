# Skills policy (router) — bee6

**Purpose:** which installed ECC skills to load by default for *this* repo, and which to
keep searchable but not load. Derived from `agent-sort` run on 30 Sep 2026 against the real
stack (Next.js 16 App Router + React 19 + TypeScript strict + zod + Vitest, Google Cloud +
Gemini only, Cloud Run, Firestore/Firebase Auth). Re-run `agent-sort` if the stack changes.

## How every session (main + sub-agents) uses this file
- **You are a sub-agent working in this repo:** read this file first. Before writing code for a
  task, invoke the DAILY skill(s) that match the task (via the Skill tool). Do not load LIBRARY
  skills unless the triggering symptom appears.
- **Load just-in-time, not all at once** — loading skills costs context. Pull the 1–3 that fit
  the task at hand.
- **Hard rules win.** Where a skill's advice conflicts with `CLAUDE.md` §2 hard rules, follow
  the hard rule and say so.

## DAILY — load when the task matches
| Skill | Load for |
|---|---|
| `coding-standards` | any code change (TS quality, naming) |
| `git-workflow` | committing (small, frequent, conventional — CLAUDE.md #11) |
| `error-handling` | model calls, API I/O (typed errors, retry→question) |
| `react-patterns` | any `.tsx` UI (React 19 / Next 16) |
| `react-performance` | capture page, day record ("<2s on phone") |
| `react-testing` | testing React components (Vitest) |
| `frontend-a11y` | forms, modals, screens (360px, staff/owner/judge) |
| `nextjs-turbopack` | Next 16 dev/build issues, breaking-change guidance |
| `api-design` | REST routes, idempotent segment PUT, RBAC endpoints |
| `contract-first` | the R-03↔R-04 segment contract; any producer/consumer split |
| `tdd-workflow` | gate / thread builder / windowing / schemas (unit tests mandated) |
| `verification-loop` / `verify` | before marking any task done |
| `browser-qa` | post-deploy UI verification (QA gate) |
| `e2e-testing` | demo-outlet judge path, Playwright |
| `eval-harness` | label accuracy, hypothetical-trap 5/5, agent evals (R-13) |
| `agentic-engineering` | planning/executing the agent work (eval-first) |
| `agent-harness-construction` | tool/action-space design for the 4 agents (R-08/15/11) |
| `dataviz` | confusion matrix, judge English panel (R-13) |
| `security-review` / `security-scan` | any diff (no secrets, no audio persisted, RBAC) |
| `code-review` | correctness gate on a diff before human review |
| `architecture-decision-records` | recording a decision (repo uses docs/adr/) |
| `deployment-patterns` | Cloud Run CI/CD |

## LIBRARY — keep searchable, do NOT load by default
- **Off-stack languages/frameworks (no repo evidence):** all `django-*`, `laravel-*`,
  `rails-patterns`, `springboot-*`, `quarkus-*`, `java-*`, `jpa-patterns`, `kotlin-*`,
  `compose-multiplatform`, `android-clean-architecture`, `swift-*`, `swiftui-patterns`,
  `dart-flutter-patterns`, `flutter-dart-code-review`, `golang-*`, `rust-*`, `cpp-*`,
  `csharp-testing`, `dotnet-patterns`, `fsharp-testing`, `perl-*`, `angular-developer`,
  `vue-patterns`, `nuxt4-patterns`, `nestjs-patterns`, `bun-runtime`, `vite-patterns`,
  `python-patterns`, `python-testing`, `tinystruct-patterns`, `hexagonal-architecture`,
  `kubernetes-patterns`, `database-migrations` (SQL-only; Firestore not covered),
  `docker-patterns` (no Dockerfile yet).
- **Agent meta (use on symptom):** `agent-architecture-audit`, `agent-introspection-debugging`,
  `agent-eval`, `agent-self-evaluation`, `continuous-agent-loop`, `autonomous-loops`,
  `autonomous-agent-harness`, `agentic-os`, `dynamic-workflow-mode`.
- **Orchestration (we keep Rangga as the review gate):** `orch-*`, `plan-orchestrate`,
  `plan-canvas`, `team-agent-orchestration`, `team-builder`, `dev-team`, `council`,
  `council-multi-model`.
- **ECC/meta ops (occasional):** `configure-ecc`, `ecc-guide`, `ecc-recipes`,
  `ecc-tools-cost-audit`, `agent-sort`, `continuous-learning*`, `codebase-onboarding`,
  `code-tour`, `session-start-hook`, `accessibility` (web daily one is `frontend-a11y`),
  `artifact-design` / `artifact-capabilities` / `artifact-diagramming` (only if publishing
  an artifact), `api-connector-builder` (only if the P1 POS adapter is built).

## SUPPRESSED — conflicts with a hard rule
- **`claude-api`** — documents the **Claude/Anthropic** API. The **product uses Gemini only**
  (`@google/genai`, CLAUDE.md hard rule #1). Do **not** apply it to product code even though it
  may false-trigger on the word "Claude". For real Gemini/`@google/genai` docs use the
  **context7** MCP server (live docs), not memory and not this skill.

## Open questions (revisit)
- `docker-patterns` → DAILY *if* we add a Dockerfile instead of Cloud Run buildpacks (decide at R-01 deploy).
- `api-connector-builder` / `database-migrations` → promote only if the P1 POS CSV adapter is built.

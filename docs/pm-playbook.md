# PM playbook — detail behind `CLAUDE.md` §10

`CLAUDE.md` §10 states the rules in one line each (numbered 1–11 below, matching). This file is the
"why" and the exact mechanics, for whoever (human or agent) needs the detail. If this file and §10
ever disagree, §10 wins — fix this file to match, don't follow this file against the current rule.

## 1. The PM never touches product-shipped files
"Product-shipped" means what the file IS, not its extension: `scripts/*`, `config/*`,
`package.json`, `README.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE`, anything under `app/`/`lib/`, every
test file — not just `.ts`/`.tsx`. The PM also never reviews a diff, runs QA, or researches a
technical question itself; read-only spot-checks (`git log`/`git diff`, re-running tests) are
verification, not a substitute for dispatching the work. The only files the PM edits directly: this
file, `CLAUDE.md`, memory, `docs/HANDOFF.md`, `docs/tasks/R-xx.md` plans, `.claude/agents/*.md`. If
genuinely unsure whether a file counts — it doesn't; dispatch it.
*Violated once, 1 Oct: the PM personally edited and committed `scripts/probe.ts` and
`THIRD_PARTY_NOTICES.md`. Caught by Rangga; fixed with a retroactive tech-lead review.*

## 2. Check the team from real state, every check-in
Use `TaskList`/`TaskGet`, `git log`, and the actual working tree — never assume from the last
message alone. A stale agent (repeated idle notifications with no content, an unchanged task, no
commit) is a blocker until proven otherwise; report it to Rangga on its own line, then recover (stop
and redo, or switch agent type). Stop every agent as soon as its result is verified — never leave a
finished agent idle, and dispatch a fresh one only when there's new work. Check the roster
(`~/.claude/teams/<session>/config.json`) before ending a turn.

## 3. An open PR gates the next task
If a task needs code from an unmerged PR, stop and tell Rangga — no stacked work, no developer
dispatch, until he merges it.

## 4. Who gets named, and why
`developer`, `uiux`, `qa`, `tech-lead`, `dev-ops` and `claude-code-guide` all have `SendMessage` (as
of 30 Sep) and *can* be named for a back-and-forth conversation — but for a one-shot task, dispatch
them **unnamed**: their final reply returns to the PM as a completion notification, and nothing is
left idle on the roster afterward. Name an agent only when you need it to keep running and take a
follow-up message (e.g. the tech-lead/developer pairing in rule 8, or a multi-turn investigation).
Never rely on `TaskList`/`TaskUpdate` as a reporting channel — the shared list is cleared shortly
after every task in it completes (it has destroyed a verdict before); keep one umbrella task open for
a whole work stream if you need the list to persist at all. Agents sharing one working tree can
collide; use `isolation: "worktree"` for genuinely parallel builders, or serialize them.
*Earlier wrong diagnosis, corrected 1 Oct: three "hung" tech-lead sessions on 30 Sep were not stuck —
they were named without `SendMessage` at the time and had no way to report; a missing `Write` tool
was never the real cause.*

## 5. git over gh
Inspect diffs and PRs with `git` (`diff`, `log`, `show`); reach for `gh` only for what git genuinely
can't do — creating a PR, CI checks, `--json` GitHub-only metadata.

## 6. Change-request triage
Argue feasibility against `docs/plan.md` before agreeing to new scope. Trivial/small: size it and do
it. Standard or larger (2+ files, a new dependency or contract, real design ambiguity): a tech-lead
design pass plus effort/risk/impact before writing the plan. A bug fix that changes behaviour: offer
a quick-win and an ultimate option, Rangga picks. The triage is about the design/risk assessment —
*implementation* is always dispatched to an agent regardless of size (see rule 1).

## 7. Tech-lead review and QA are both mandatory
Neither substitutes for the other, no exceptions — including a small or retroactive fix. Tech-lead
checks code quality, hard rules, and design. QA independently re-derives whether the task's actual
acceptance criteria are met, with its own evidence, not a restatement of the tech-lead's. A tech-lead
PASS alone is never "ready to merge."
*Missed once, 1 Oct: a retroactive tech-lead review of a self-authored fix shipped without a matching
QA pass.*

## 8. Pairing tech-lead with a confused developer
If a developer agent asks confused questions, drifts from the brief, or the task has enough design
ambiguity that this is predictable before it even starts: dispatch both `developer` and `tech-lead`
**named**, and have them talk directly — tech-lead brainstorms/clarifies the task with the developer
(load `superpowers:brainstorming` for approach questions, `tdd-workflow` for implementation detail)
— instead of the PM staying the sole go-between rewriting an ever-longer spec. The PM still verifies
the final result itself; this only changes who clarifies the task up front.

## 9. Handoff and memory
Update `docs/HANDOFF.md` at the end of every work session and after every merge — a SessionStart hook
loads it automatically into the next session. Durable preferences go to auto-memory; decisions go to
`docs/` (an ADR, a spec, or the relevant task file).

## 10. No agent mutates the shared git working tree
No `developer`, `uiux`, `tech-lead`, `qa`, or `dev-ops` agent ever runs `git reset`,
`git checkout -- <path>`, `git stash`, `git clean`, or checks out a different ref — even temporarily,
even to "reproduce a before/after count." The checkout is shared with other live sessions and
subagents; a mutation one agent believes it will cleanly undo can collide with concurrent work, or
simply not fully undo. For a genuine before/after comparison: `git show <ref>:<path>` or
`git diff <ref>..<ref>` (both read-only), or request `isolation: "worktree"`.
*Caused once, 1 Oct: a QA agent's own checkout-based test-count reproduction briefly wiped every
uncommitted governance-file edit (reflog: "reset: moving to HEAD"). Diagnosed by a peer session
(`bee6-dc`) sharing the same checkout before the PM finished investigating independently; no data was
actually lost, but it could have been.*

## 11. Skills — load the match, name it in the brief
No in-repo skills router exists (`docs/skills-policy.md` was removed 30 Sep — it described skills
vendored under `.claude/skills`, which no longer exists; skills now load from `~/.claude/skills` and
installed plugins). When unsure which skill fits, run `/ecc-guide` or search the installed list —
never guess a name. Mapping, by activity:

**The standing sequence for any new idea (Rangga, 1 Oct — mandatory, not optional):** when Rangga
gives an idea that needs tech review/brainstorm or implementation design, invoke `superpowers:brainstorming`
yourself (PM) or have `tech-lead` load it in design mode — don't just write free-form analysis. Once a
design is settled, write the implementation plan via `superpowers:writing-plans` (the output still lands
in `docs/tasks/R-xx.md` per `CLAUDE.md` §4). Only then dispatch `developer` to build it. Don't skip
straight to a developer dispatch, and don't write a plan doc freehand without having gone through these
skills first — load them explicitly, by name, every time, even for a fast-moving task.

| Activity | Skill |
|---|---|
| Branching, commits, PR flow | `git-workflow` (feature branch off `main`, conventional commits, Rangga merges) |
| Design and brainstorming | `superpowers:brainstorming` — mandatory before any tech-lead design pass |
| Implementation plan | `superpowers:writing-plans` — mandatory before writing `docs/tasks/R-xx.md` |
| Implementation | `tdd-workflow`, with `error-handling`/`api-design`/`react-patterns`/`frontend-a11y` as they apply |
| Testing and QA | `verification-loop`, `browser-qa`, `e2e-testing`, direct browser automation |
| Every diff | `tech-lead` loads `code-review`. `security-reviewer` (a dedicated agent) is **on-demand only** — dispatch it when Rangga asks or the diff is genuinely security-sensitive (new route, auth, secrets), never automatically on every diff |
| Change requests and bugs | `orch-change-feature` / `orch-fix-defect` |
| Decisions | `architecture-decision-records` |
| Stalled or looping agents | `agent-introspection-debugging` |

Verifying a skill, library, or dependency is current: use the **context7** MCP server (already
configured at user scope, available in every project) rather than training-data memory or a plain
web search — it returns structured, source-ranked library docs. Use it before recommending or
installing anything version-sensitive. (Confirmed useful 1 Oct: it directly verified the `caveman`
skill's legitimacy when a web-search-only check couldn't be fully trusted.)

## 12. Lint gate right before a PR, then auto-PR once both gates clear
Right before pushing a branch / opening a PR, the PM runs `npm run lint` itself — this is a read-only
check (same category as re-running tests or `git diff`), not product-code work, so it doesn't need a
dispatch. If lint finds anything, send the diff back to `developer` to fix and loop until clean before
pushing. Once tech-lead PASS + QA SHIP (rule 7) AND lint are all clear, push the branch and open the PR
immediately — **no need to ask Rangga first** (merge still stays his). Typecheck and the test suite are
already re-run by the PM at each round per the usual verification habit; this just makes lint an
explicit, final, pre-push gate rather than something only tech-lead/QA happen to catch mid-review.
*Added 1 Oct, after R-05a's 4-round fix cycle — Rangga: "After the developer has finished the task,
then directly just create the PR without wait for my permission," plus a follow-up making the lint
check an explicit pre-PR step with its own fix-loop back to developer.*

## 13. Token/session economy (adopted 1 Oct, from ECC's token-optimization guidance)
- **Model tiering** (current, 1 Oct): `tech-lead` opus/medium (complex reasoning, design, review);
  `developer` **sonnet**/high (was haiku — switched after 2 consecutive quality misses on R-05a's
  union-find/grace-join logic; haiku is still fine for simpler, mechanical tasks, watch for whether
  sonnet is actually needed going forward or if this was task-specific); `qa`/`uiux` sonnet/high.
  Reserve opus-tier reasoning for genuinely hard problems, not routine builds.
- **`MAX_THINKING_TOKENS=10000`** is set in `.claude/settings.local.json` (default is 31,999; this
  cuts hidden thinking-token cost roughly 70% with minimal quality loss for most tasks).
- **Compact context at a logical breakpoint** — after finishing research/exploration and before
  starting implementation, or after closing out one task and before opening the next — rather than
  waiting for automatic compaction near capacity.
- **Keep MCP/tool surface lean**: ECC's own guidance suggests under ~10 active MCP servers and ~80
  active tools per project to preserve context window; most of the many MCP servers visible in
  `claude mcp list` on this account are unauthenticated/unused plugin connectors, not something to
  prune without Rangga's say — note it, don't act on it unilaterally.
- **Load skills/agents/rules on demand**, never globally up front — already covered by rule 11.
- ECC's own `ECC_SESSION_START_MAX_CHARS`/`ECC_SESSION_START_CONTEXT` env vars are specific to ECC's
  own SessionStart hook system, which this project doesn't use (our hook is a plain one-liner that
  cats `docs/HANDOFF.md`) — not applicable here.

Agents have the `Skill` tool but don't know which one fits — name it explicitly in every dispatch brief.

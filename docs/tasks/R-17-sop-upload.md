# R-17 Digitised SOP: format, version diff, upload (.txt / .md): design v2 + deep plan skeleton

Status: **DESIGN v2, tech-lead, Sun 11 Oct 2026 (evening). Nothing is built. NOT approved.** Renamed from
`R-15-sop-upload.md` (R-15 is the CriticAgent in `docs/backlog.md`, moved to the next MVP). v2 folds in Rangga's
11 Oct workflow statement (§0). Gates before any build:
(1) for the **diff screen (Phase D)**: only Rangga's timing answer (§11 Q-2), plus re-opening the diff part of
`docs/plan.md` §10 #51 (§4.6); no hard rule is touched;
(2) for **sections (Phase S)**: Rangga's "yes" to the format (§11 Q-3, Q-4);
(3) for **upload (Phase U)**: Rangga's **written amendment of CLAUDE.md hard rule #9** (§5.1, still unanswered: the
key open decision) and answers to §11.
Upload reverses two decisions made earlier on 11 Oct: R-10 §0a / Q-6 (upload out of scope) and R-SOP-sample-fit
"Decisions" item 5 and §5 ("No SOP import feature", "No `section` field").

> **For agentic workers:** this file is the spec and the plan in one (same convention as `R-08.md`-`R-11.md`). Once
> approved, execute it task by task, literally (`superpowers:executing-plans` or `superpowers:subagent-driven-development`,
> plus `superpowers:test-driven-development`). **If the plan is silent or looks wrong against the real code, stop and
> flag it to tech-lead. Do not improvise** (CLAUDE.md §10 rule 11). Sections marked **SKELETON** need finishing by
> tech-lead after §11 is answered; do not build them from this text.

**Base.** All code citations are from **`origin/develop` (`9ade803`, R-13 eval merged)**. The shared checkout is on a
stale branch (`feature/r-05b-label-call-pr2`); never read code from it and never switch refs in it. Build in a fresh
worktree off `origin/develop`; every PR targets `develop`.

**Reference only:** the "Bee6 Wireframes" design (W10 upload, W11-W13 SOP book). The wireframe is not a spec.

**Skills to load (build phase):** `superpowers:test-driven-development`, `api-design`, `error-handling`,
`react-patterns`, `frontend-a11y`, `accessibility`, `nextjs-turbopack` (route handlers and the `connection()` page
pattern of this Next major: mirror `app/api/v1/sop/route.ts` and `app/sop/page.tsx`), `react-testing`, `ux-copy`
(EN/ID keys). Never `claude-api`. Verify Firestore `Query.select()`, `Transaction.create` + `ALREADY_EXISTS` and TTL
via context7 (`@google-cloud/firestore`). **security-reviewer:** not needed for Phase D or S (read-only, no new
input surface beyond two integers); **recommended for Phase U** (untrusted file text into Firestore on a public demo).

---

## 0. Rangga's workflow statement (11 Oct) and the honest gap

Rangga's five points (derived from the wireframes):
1. Owner uploads the SOP (narrow first scope: `.txt`/`.md` only).
2. The app converts it to a **digitised SOP** and never relies on the raw document again (the file is not stored).
3. The digitised SOP has a fixed standard format: a version, contents (sections/chapters), steps within each section,
   roles, etc. Not a raw sheet/txt/md/word doc.
4. Approved changes are applied and the app shows the final new version. A **dedicated** feature shows the diff
   (git-diff style) between SOP versions. The final SOP view shows **no** diff marks.
5. So the app never re-generates a raw SOP document; the model only ever writes a small piece; storage is structured.

### 0.1 Gap table (against `origin/develop` 9ade803)

| # | Point | Status today | Evidence in code | What is missing |
|---|---|---|---|---|
| 1 | Owner uploads `.txt`/`.md` | **Not met** | No route, no screen. Rule #9 as written forbids a second SOP-creating path | Phase U + the rule-9 amendment (§5.1) |
| 2 | Digitised; raw doc never relied on, never stored | **Met for storage, not for conversion** | The only SOP store is structured `sop_versions` (`SopVersionSchema`, schema.ts l.664); the seed writes structured JSON (`scripts/seed.ts` `sop_v1`); nothing stores a raw document. But the only way in is hand-digitising into a seed file | A converter (Phase U's deterministic parser, §5.3) |
| 3 | Fixed standard format: version, sections, steps, roles | **Partly met** | Version: `version`, `sop_version_id`, `effective_from_date`, `previous_version_id`, `source` ✓. Steps: `step_id` (`^[a-z0-9][a-z0-9_-]{0,39}$`), `title` ≤ 160, `text` ≤ 800, `role` staff/supervisor/owner ✓. Order: array order ✓ | **Sections are not a field.** They exist only as a convention: a title prefix `"<Section> · "` and an id prefix (`open-07`), R-SOP-sample-fit §2. Phase S (§3) |
| 4a | Approved changes applied; app shows the final new version, no marks | **Met** | R-10 `planShip` (`lib/sop/ship.ts`) builds v{n+1} in plain code inside the owner's approval transaction; `/sop` (`app/sop/SopApp.tsx`) shows the latest version's steps as a plain `<ol>`; `SopChangeCard.test.tsx` l.96 pins "no diff wording or highlight elements (cut #51)" | Nothing. Stays as is (Rangga: the final view stays mark-free) |
| 4b | Dedicated diff between any two versions | **Not met** | Cut 4 Oct (`docs/plan.md` §10 #51, −1 h). Web spec §6.2 still lists `GET /api/v1/sop/diff?from=&to=`; the `sop:diff` permission exists (owner, supervisor; `lib/auth/rbac.ts` l.33) but only gates the `/sop` overview. `/sop` shows one before/after card per change, never a range | Phase D (§4) |
| 5 | Model writes only small pieces; never a whole SOP | **Met for proposals**, risky for long steps | ProposalAgent writes one step's full new text, wire cap `WIRE_MAX.change_text = 400` (`lib/proposals/wire-schema.ts` l.25); plain code assembles the whole version (`planShip`). R-11's ReviewAgent reads only `change.metric` and dates | Steps of 401-800 chars are a dead end (`STEP_TEXT_TOO_LONG`, ship.ts l.76); fixed by the long-step Phase 2 segment edit (R-SOP-sample-fit §7). Upload stays model-free (§5.3). §6 |

**Bottom line.** Points 2, 4a and 5 already hold (point 5 with a known long-step gap). Point 3 needs one additive
schema change (sections). Point 4b is a self-contained read-only feature. Point 1 is the only part that touches a hard
rule.

---

## 1. Findings (read first)

1. **Upload still collides with hard rule #9 as written** ("SOP changes only through proposals … No endpoint edits the
   SOP directly"). Unchanged from v1; Rangga has not answered. §5.1 keeps option A′ as the recommendation.
2. **The diff screen touches no hard rule.** It is read-only, plain code, owner/supervisor only, and the route and
   permission are already in the web spec (§6.2) and `rbac.ts`. Its only governance cost is re-opening the diff part
   of §10 #51.
3. **Sections are cheap only if added additively.** Optional `section_id` on `SopStep` plus an optional `sections` list
   on the version doc keeps every existing immutable doc valid. Nesting steps inside sections (`sections[].steps[]`)
   would break `planShip`, `SopChangeSchema.before/after`, the proposal prompt, R-11 and R-12's clone. Rejected.
4. **`planShip` would silently drop a section on modify (found in the code).** `ship.ts` builds
   `after = { step_id, title, text: c.change_text, role }` with four named fields. Adding `section_id` to `SopStep`
   without editing that line loses the section on every modified step. Phase S must change it and pin it with a test.
5. **A proposal's NEW step lands at the end today** (`steps = [...current.steps, after]`, `NEW_STEP_ROLE`). In a
   sectioned SOP the default is a trailing "Added steps" group (`section_id` absent); letting the model pick a section
   is a wire + prompt change (proposal-v3) that needs an eval. §3.4.
6. **`listVersions` must not feed the diff.** It returns up to 50 full versions (up to 200 steps × 800 chars each, plus
   before/after). The diff reads exactly two docs by id plus a field-projected head list (§4.3).
7. **Diff matching is by `step_id`, which is already stable** across versions (modify keeps the id; add mints a new
   one; nothing removes). So a plain-code diff is exact, not heuristic. Removal and section moves cannot happen today
   but the diff handles them so it never needs revisiting.
8. **Backlog id.** This file is now R-17 (Rangga's suggestion). `docs/backlog.md` needs an R-17 row (PM).

---

## 2. Global constraints (every phase inherits these)

- Immutable versions: `sop_versions` docs are written once with `tx.create`, only inside an owner-approval
  transaction (R-10's proposal path, Phase U's import path) or by the seed. No `set`/`update` on a version, ever.
- No person in any stored or returned field. Step `role` is a job role. No uid, email, name, staff id, device id.
- Views carry no `outlet_id`, `sop_version_id`, `source_proposal_id`, `source_import_id` or `intervention_id`
  (`lib/sop/contract.ts` rule). `step_id` and `section_id` may appear (they already do in `SopStepViewSchema`; they
  identify text, not people).
- Every read outlet-scoped from verified claims; malformed docs skipped and logged `{doc_id, error_class}` only.
- Step text is rendered as React text nodes with `white-space: pre-line`; never HTML, never a markdown renderer,
  never through `t()` placeholders.
- 360 px first; touch targets ≥ 48 px; copy only through `t(lang, key)`, EN + ID.
- Fictional fixtures only (hard rule #8).

---

## 3. The canonical digitised SOP format (Phase S) — point 3

### 3.1 Options

| Option | Shape | Cost | Risk | Verdict |
|---|---|---|---|---|
| S0 Convention only | No schema change; section = title prefix `"<Section> · "` (R-SOP-sample-fit §2) | 0 h | Fragile: a proposal's NEW step title may lack the prefix; rename = edit every title; not a "fixed standard format" | Today's state; fine for 18 Oct |
| **S1 Additive (RECOMMENDED)** | Optional `section_id` on each step + optional `sections: [{section_id, title}]` on the version doc; array order is the canonical order; each section is one contiguous run | ≈ 3.3 h incl. gates (§7) | Low: every field optional, old docs parse unchanged | **Recommended, after 18 Oct, before Phase U** |
| S2 Nested | `sections: [{title, steps: [...]}]` replaces `steps` | 8-12 h | High: `planShip`, `SopChangeSchema`, prompt, R-11, R-12 clone, every view | Rejected |

### 3.2 S1 schema (exact)

```ts
// lib/firestore/schema.ts, sop_versions section
const sopSlug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
export const SOP_MAX_SECTIONS = 30;

export const SopStepSchema = z.object({
  step_id: sopSlug,
  title: z.string().min(1).max(160),
  text: z.string().min(1).max(800),
  role: UserRoleSchema,
  section_id: sopSlug.optional(),            // NEW. Absent = unsectioned (all v1 seed docs; "Added steps")
}).strict();

export const SopSectionSchema = z.object({
  section_id: sopSlug,
  title: z.string().min(1).max(80),          // "Opening", "Pembukaan"; redacted like step text when uploaded
}).strict();

// SopVersionSchema gains:
//   sections: z.array(SopSectionSchema).max(SOP_MAX_SECTIONS).optional(),   // absent on old docs
// superRefine additions:
//   (a) section_ids unique within `sections`;
//   (b) every step.section_id appears in `sections` (sections absent ⇒ no step has section_id);
//   (c) contiguity: walking `steps` in order, each section_id forms ONE run, and the runs appear in the same
//       order as `sections`; steps without section_id may appear only AFTER every sectioned step (a trailing run);
//   (d) a section with zero steps is not allowed (remove it from `sections` instead);
//   (e) proposal branch: change.after.section_id must equal the step's section_id in `steps` (extend the existing
//       "change.after must equal the step" check from title/text/role to all five fields).
```

Decisions inside S1:
- **Order:** the `steps` array order is the order. No `position` field (it would duplicate array order and can drift).
- **Ids:** `step_id` unchanged and stable for life; `section_id` stable for life (a rename changes only `title`).
  Upload mints both deterministically (§5.3); seed/template set them by hand.
- **Version metadata:** already sufficient (`version`, `effective_from_date`, `previous_version_id`, `source`,
  `created_at_ms`). No SOP-level title (the outlet has a name).
- **Roles:** per step, unchanged (`staff|supervisor|owner`). No per-section role (a section mixes roles).
- **`when` field: NO.** Timing cues ("before opening", "every 30 min") stay in the step text or the section name
  ("Opening", "Closing"). A `when` enum needs a taxonomy, someone (a model or the owner) to fill it, and nothing reads
  it: the evidence gate is category-based and R-11 measures categories, not times. Revisit only if a reviewer or the
  gate needs per-step timing.
- **1 MiB:** `sections` adds at most 30 × ~120 bytes ≈ 4 KB. Negligible against the R-SOP-sample-fit §7.2 budget.

### 3.3 Blast radius of S1 (checked file by file)

| Consumer | Effect | Change needed |
|---|---|---|
| Existing `sop_versions` docs (immutable) | Parse unchanged (all new fields optional) | None. Pin: v1 seed fixture + R-10 proposal fixture parse |
| R-10 `planShip` modify | Would drop `section_id` (Finding 4) | `after = { ...target-derived fields, section_id: target.section_id }` written so an absent value stays absent (never `section_id: undefined`); copy `sections` from `current` |
| R-10 `planShip` add | New step without `section_id` appended at the end = trailing run, valid by rule (c) | Copy `current.sections`; no other change (§3.4) |
| R-10 `/sop` view (`SopOverviewSchema.latest`) | Needs section titles to group | `latest.sections: [{section_id, title}]` (empty when absent); `SopStepViewSchema` gains optional `section_id`; `SopApp` renders `<h3>` per section with its `<ol>`, then "Added steps" (`C-sop-added-steps`) for unsectioned steps when the version has sections; flat list exactly as today when it has none. Still mark-free |
| `SopChangeCard` | Before/after unchanged | Optionally show the section title under the step title (0.1 h; no marks) |
| R-08 ProposalAgent prompt | Unchanged in S1 (steps listed as today) | None. Adding section titles to the prompt is S1b (needs a dry-run; §3.4) |
| R-11 reviews | Reads `change.metric` and dates only; `isShippedChange` filters `source` | None |
| R-12 clone/template | `rewriteDeep` copies; `SopVersionSchema.parse` checks | Template's ~60-step demo SOP can carry `sections` (7) and `section_id`s; titles may drop the `"<Section> · "` prefix (or keep it; both valid). Sandbox reset unchanged |
| `scripts/seed.ts` | 5-step placeholder, no sections | None (stays flat; proves backward compatibility) |
| `lib/sop/write-boundary.test.ts` | No new writer | None |

### 3.4 Where a proposal's NEW step goes in a sectioned SOP

| Option | Behaviour | Cost | Verdict |
|---|---|---|---|
| **N1 (default)** | Lands in the trailing unsectioned run, shown under "Added steps" on `/sop` | 0 h beyond S1 | **Default.** Honest, deterministic, no model change |
| N2 | Wire gains `section_id` (string; plain code checks it against `current.sections`, unknown → absent → N1); prompt lists section ids and titles; new agent version `proposal-v3` | ≈ 2 h + ≈ 1 h dry-run on a fictional SOP | Later, with the long-step Phase 2 (same wire bump) |
| N3 | Supervisor or owner picks the section at check/approve | ≈ 2 h UI + a new field on the decision | Not recommended (adds a decision to the approval screen) |

---

## 4. Version diff screen (Phase D) — point 4b

### 4.1 What it is, and how it differs from the existing cards

| | `/sop` change card (exists, R-10) | `/sop/diff` (new) |
|---|---|---|
| Question it answers | **Why** one approved change happened (metric, failure condition, review date, outcome) | **What text differs** between any two versions |
| Range | One version vs its predecessor | Any `from < to` (e.g. v1 → v5 across 4 changes) |
| Text | Whole step before, whole step after, no marks (cut #51, pinned) | Inline word-level marks inside each changed step |
| Where | On `/sop` | Its own page, linked from `/sop` ("Compare versions") and from each change card ("Compare with version N") |

**`/sop` stays mark-free** (Rangga's point 4). The card test "no diff wording or highlight elements" stays true; the
new link text contains no "diff" (EN "Compare versions", ID "Bandingkan versi").

### 4.2 Diff computation (plain code, server side)

**Server, not client:** the server holds both versions; sending two full versions (up to 2 × ~200 KB) to compute in
the browser costs a 360 px phone more than receiving only the differences; the pure function is unit-testable; the
response is zod-validated like every other view.

`lib/sop/diff.ts` (pure, no I/O):
```ts
export type DiffSeg = { op: "same" | "del" | "ins"; text: string };
export function diffWords(a: string, b: string): DiffSeg[];
export function diffSopVersions(from: SopVersion, to: SopVersion): SopDiffBody;
```
- **Step matching by `step_id`.** In `to` only → `added`. In `from` only → `removed`. In both → compare `title`, `text`,
  `role`, `section_id`: any difference → `modified` with per-field results; `section_id` differs (and both versions
  have sections) → also `moved` (from section title → to section title). Equal → counted in `unchanged`, not listed.
  Index shifts caused by insertions are **not** reported as moves.
- **Sections:** by `section_id`: `added`, `removed`, `renamed` (title differs). Only when either version has sections.
- **Word-level text diff** (`diffWords`): tokenise with `/\s+|[^\s]+/gu` (words and whitespace runs, so the joined
  segments reproduce both texts exactly); LCS by dynamic programming on tokens; merge adjacent same-op segments.
  Guard: if either side has > 1,200 tokens, return `[{op:"del", text:a}, {op:"ins", text:b}]` (whole-block replace).
  800 chars ≈ 150 tokens → a 150 × 150 table; the 2,000-char long-step cap ≈ 400 tokens → 160k cells; both trivial.
  Word-level, not sentence-level: proposals usually change a time, a count or a clause, and a sentence diff would mark
  a whole 300-char sentence for a one-word edit. No new dependency (no `diff` npm package; ~40 lines).
- **Invariant tests:** concatenating `same+del` segments equals `a`; `same+ins` equals `b`, for every case.
- **Ordering of entries:** in `to`'s step order (added/modified/moved), then removed steps in `from`'s order.

### 4.3 Data, route, contract

- **Store** (`lib/firestore/sop-store.ts`, read-only, no write method still):
  `getVersion(n: number): Promise<SopVersion | null>` reads doc `${outletId}:v${n}` directly, parses, drops a foreign
  outlet. `listVersionHeads(): Promise<SopVersionHead[]>` = `.where("outlet_id","==",outletId)
  .select("version","source","effective_from_date","change.change_title","change.kind","created_at_ms").limit(200)`
  so no step text is read for the range header (verify `.select` on nested fields via context7; fallback: read heads
  only for versions in `(from, to]` by id, at most 49 docs).
- **Route:** `GET /api/v1/sop/diff?from=N&to=M` (`app/api/v1/sop/diff/route.ts`), exactly the web spec §6.2 row.
  `requireClaims` → `assertPermission(claims, "sop:diff")` (owner, supervisor; staff 403; device 401) → query zod
  `{from: int ≥ 1, to: int ≥ 2}` with `from < to` (else 422 `invalid_query`) → both versions exist (else 404
  `VERSION_NOT_FOUND`) → `diffSopVersions` → `SopDiffViewSchema.parse` → `Cache-Control: private, no-store`.
  Defaults are a UI concern (the page fills `from = latest − 1`, `to = latest`).
- **Contract** (`lib/sop/contract.ts`):
```ts
const DiffSegSchema = z.object({ op: z.enum(["same","del","ins"]), text: z.string() }).strict();
const FieldDiff = <T extends z.ZodTypeAny>(v: T) => z.object({ from: v, to: v }).strict();
export const SopDiffEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added"),   step: SopStepViewSchema, section_title: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("removed"), step: SopStepViewSchema, section_title: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("modified"), step_id: z.string(),
    title: z.array(DiffSegSchema).nullable(),          // null = title unchanged
    text: z.array(DiffSegSchema).nullable(),           // null = text unchanged
    role: FieldDiff(UserRoleSchema).nullable(),
    moved: FieldDiff(z.string().nullable()).nullable(), // section titles; null = not moved
    current_title: z.string(),                         // `to` title, for the heading
  }).strict(),
]);
export const SopDiffViewSchema = z.object({
  from: z.object({ version: z.number().int().min(1), effective_from_date: dateString.nullable() }).strict(),
  to:   z.object({ version: z.number().int().min(2), effective_from_date: dateString.nullable() }).strict(),
  latest_version: z.number().int().min(1),            // for the picker
  between: z.array(z.object({ version: z.number().int().min(2), source: z.enum(["proposal","upload"]),
    change_title: z.string().nullable(), effective_from_date: dateString.nullable() }).strict()).max(50),
  counts: z.object({ added: z.number().int(), removed: z.number().int(), modified: z.number().int(),
    unchanged: z.number().int() }).strict(),
  sections: z.array(z.object({ kind: z.enum(["added","removed","renamed"]), from_title: z.string().nullable(),
    to_title: z.string().nullable() }).strict()).max(60),
  entries: z.array(SopDiffEntrySchema).max(400),
}).strict();
```
  (`source: "upload"` in `between` exists only after Phase U; until then the enum is `["proposal"]`.)
- **Payload bound:** worst case 200 modified steps × ~1.7 KB ≈ 350 KB; typical (one change) < 3 KB.

### 4.4 Screen `/sop/diff?from=&to=`

- `app/sop/diff/page.tsx` (`await connection()`, same as `app/sop/page.tsx`) + `app/sop/diff/SopDiffApp.tsx`
  (client; same auth/role states as `SopApp`; owner and supervisor only, others see the existing forbidden copy).
- Top: `<h1>` "Compare SOP versions"; two full-width `<select>`s ("From version" / "To version", 1..latest, ≥ 48 px)
  and a "Show" button (updates the query string; no auto-fetch on every change); a summary line
  ("2 changed · 1 added · 0 removed · 57 unchanged"); a legend sentence explaining the marks; "Changes in between"
  list (version, date, change title as plain text).
- Each entry is an `<article>` with an `<h3>` naming the kind in words: "Step added", "Step removed", "Step changed",
  plus "Moved from {a} to {b}" and "Role: {a} → {b}" lines when present. Single column; **no side-by-side** at any width
  (360 px first); `overflowWrap: "anywhere"`, `white-space: pre-wrap` inside text so whitespace segments survive.
- **Not colour-only (WCAG 1.4.1):** removed words in `<del>` (strikethrough), added words in `<ins>` (underline +
  bold); colour tint is secondary and meets 4.5:1 text contrast. Screen readers do not reliably announce `<del>/<ins>`,
  so each mark carries a visually hidden prefix/suffix ("removed:" … "end removed"; "added:" … "end added") from the
  dictionary. Added/removed whole steps are labelled by their `<h3>`, not by colour.
- States: loading (`role="status"`), only one version ("There is only one version so far."), no differences, 404
  (`VERSION_NOT_FOUND` → "That version does not exist."), error with retry. Focus moves to the summary after "Show".
- `/sop` gains a link "Compare versions" (only when `latest.version ≥ 2`); each change card gains a link
  "Compare with version {previous}" → `/sop/diff?from={previous}&to={version}`.

### 4.5 Copy keys (EN / ID) — `lib/i18n/dict.ts`

| Key | EN | ID |
|---|---|---|
| `C-sopdiff-title` | Compare SOP versions | Bandingkan versi SOP |
| `C-sopdiff-from` / `-to` | From version / To version | Dari versi / Ke versi |
| `C-sopdiff-show` | Show | Tampilkan |
| `C-sopdiff-summary` | {modified} changed · {added} added · {removed} removed · {unchanged} unchanged | {modified} diubah · {added} ditambah · {removed} dihapus · {unchanged} tetap |
| `C-sopdiff-legend` | Crossed-out words were removed. Underlined bold words were added. | Kata yang dicoret dihapus. Kata bergaris bawah tebal ditambahkan. |
| `C-sopdiff-added` / `-removed` / `-changed` | Step added / Step removed / Step changed | Langkah ditambah / Langkah dihapus / Langkah diubah |
| `C-sopdiff-moved` | Moved from {from} to {to} | Dipindah dari {from} ke {to} |
| `C-sopdiff-role` | Role: {from} → {to} | Peran: {from} → {to} |
| `C-sopdiff-sr-del-start` / `-end` | removed: / end removed | dihapus: / akhir yang dihapus |
| `C-sopdiff-sr-ins-start` / `-end` | added: / end added | ditambah: / akhir yang ditambah |
| `C-sopdiff-between` | Changes in between | Perubahan di antaranya |
| `C-sopdiff-none` | No differences between these versions. | Tidak ada perbedaan antara versi ini. |
| `C-sopdiff-one` | There is only one version so far. | Baru ada satu versi. |
| `C-sopdiff-notfound` | That version does not exist. | Versi itu tidak ada. |
| `C-sop-compare` | Compare versions | Bandingkan versi |
| `C-sop-compare-prev` | Compare with version {version} | Bandingkan dengan versi {version} |

(Final wording through `ux-copy`; uiux may adjust EN/ID, not the meaning.)

### 4.6 Reconciling with cut #51 (what must be re-opened in `docs/plan.md` §10)

#51 was a **capacity** cut (4 Oct: "R-10 diff → plain before/after list, −1 h"), not a product veto; R-10 then pinned
"no diff wording or marks" on `/sop`'s card. Rangga's point 4 keeps that pin for the final view and asks for the diff
as a **separate** feature. So:
- **New §10 row (#60, PM):** "SOP version diff screen (Rangga, 11 Oct): a dedicated `/sop/diff` comparing any two
  versions with word-level marks; `/sop` and its change cards stay mark-free. Re-opens the diff part of #51 only.
  Timing: §11 Q-2 of `docs/tasks/R-17-sop-upload.md`." Status Open until Q-2 is answered.
- **#51 row:** append "Diff part superseded by #60 (11 Oct); P5 and R-15 cuts unchanged."
- **Follow-on doc notes (PM, same change):** `docs/backlog.md` R-10 line ("diff view cut") → "diff view moved to
  R-17 Phase D"; `R-10.md` Finding 9 ("the diff route stays unbuilt") gets a pointer to R-17 §4. Web spec §6.2 needs no
  change (the route is already listed).
- **New §10 rows for the other decisions** once answered: #61 rule-9 upload (A′), #62 SOP sections (S1), each closed
  in the same change as Rangga's answer (CLAUDE.md §10 rule 9).

### 4.7 Phase D edge cases

| # | Case | Behaviour |
|---|---|---|
| D-E1 | Outlet has only v1 | `/sop` shows no compare link; `/sop/diff` shows `C-sopdiff-one`; route with `to=2` → 404 |
| D-E2 | `from >= to`, non-integer, missing | 422 `invalid_query`; page normalises to defaults |
| D-E3 | v1 → v2 where v2 added a step (demo lead path after a NEW proposal) | one `added` entry, counts `1 added · N unchanged` |
| D-E4 | v1 → v3 where v2 and v3 both modified the same step | one `modified` entry diffing v1 text to v3 text; `between` lists both change titles |
| D-E5 | A one-word change in a 300-char step | only that word is `del`/`ins`; rest `same` |
| D-E6 | Text with newlines / list lines | segments keep `\n`; rendered with `pre-wrap` |
| D-E7 | Text containing `<script>` or markdown | plain text nodes, literal |
| D-E8 | Staff token / device token / other outlet | 403 / 401 / 404 (versions read by `${claims.outlet_id}:vN` only) |
| D-E9 | Malformed version doc | 404 for that version, logged `{doc_id, error_class}` |
| D-E10 | 1,300-token step (after long-step Phase 2) | whole-block replace, still correct |
| D-E11 | Sectioned `to`, unsectioned `from` (only possible after Phase U) | `sections` lists all `added`; steps not marked `moved` (from had no section) |

### 4.8 Phase D file map

| File | New / change | Responsibility |
|---|---|---|
| `lib/sop/diff.ts` (+test) | new | `diffWords`, `diffSopVersions` (pure) |
| `lib/sop/contract.ts` (+test) | change | `SopDiffViewSchema` and sub-schemas |
| `lib/sop/service.ts` (+test) | change | `getSopDiff(store, {claims, from, to})`; `SopStore` gains `getVersion`, `listVersionHeads` |
| `lib/firestore/sop-store.ts` (+test) | change | two read methods (still no write method) |
| `app/api/v1/sop/diff/route.ts` (+test) | new | GET, guard, query zod, `no-store` |
| `lib/i18n/dict.ts` | change | §4.5 keys |
| `app/sop/diff/page.tsx`, `app/sop/diff/SopDiffApp.tsx`, `app/sop/diff/DiffEntry.tsx` (+tests) | new | screen §4.4 |
| `app/sop/SopApp.tsx`, `app/sop/SopChangeCard.tsx` (+tests) | change | the two links only; the "no diff wording" test stays green |
| `app/sop/import-boundaries.test.ts` | change | include `app/sop/diff/**` |

---

## 5. Upload (Phase U) — points 1 and 2

### 5.1 Hard rule #9: options (unchanged from v1; **still Rangga's open decision**)

| Option | What it allows | Rule-9 change | Demo? | Pilot bootstrap? | Risk |
|---|---|---|---|---|---|
| A. Import as a full change path (create, append, replace/edit) | Upload may edit existing steps | Large | Yes | Yes | **High**: re-uploading a tweaked file edits steps with no evidence, defeating the product's core premise |
| B. First SOP only | v1 when none exists | Small | **No** (demo and template already have v1) | Yes | Low; invisible to judges |
| C. Append only | New steps after the current ones | Medium | Yes | **No** | Low-medium |
| **A′ = B + C, governed like a proposal (RECOMMENDED)** | Create v1, or add new steps (new sections at the end, new steps at the end of a matching section); **never edits, removes or reorders an existing step**; supervisor check → owner approval; ships with `tx.create` in the owner's transaction | Medium, wording below | Yes | Yes | Low-medium; the evidence gate still owns every change to an existing step |

Proposed CLAUDE.md §2.9 text (Rangga approves the exact wording; the PM may not edit §2 without it):
> 9. **SOP changes only through approved paths.** An existing step changes only through a proposal (evidence →
> supervisor → owner). A first SOP, or new steps and sections, may also come from an uploaded `.txt` or `.md` file
> after a supervisor check and the owner's approval; an upload never edits, removes or reorders an existing step. Both
> paths ship a new immutable version inside the owner's approval transaction. No endpoint edits the SOP directly.
> **9a.** An uploaded SOP file is read in memory and dropped: it is never stored (no Cloud Storage), its text and file
> name are never logged, and its steps are name-scrubbed and redacted before they are written.

Docs that follow the amendment (PM, same change): `docs/adr/ADR-002-sop-upload-add-only.md`; technical spec §1
non-goal + actor table, §3.1 step 9, retention table (`sop_imports`); web spec W8, §2 permission rows, §6.2 routes,
§6.4 collections; `docs/db-schema.md`; `docs/backlog.md` R-17; `docs/plan.md` §10 #61; `R-10.md` §0a and
`R-SOP-sample-fit.md` decision 5 and §5 marked superseded.

### 5.2 Flow (unchanged from v1 except sections)

```
owner/supervisor: choose file ─► browser reads text (UTF-8 fatal, ≤ 100 KB) ─► POST /api/v1/sop/imports {file_kind, text}
server (memory): parse → sections + steps ─► mask digits ─► scrub staff names ─► SDP (one batch) ─► draft
                 ─► store sop_imports/{id} "draft" (redacted only; TTL 24 h) ─► drop the text
uploader: answer questions (include / role per step) ─► submit ─► "awaiting_supervisor" (TTL 14 d)
supervisor: check {checked|reject} ─► "awaiting_owner" | "rejected"
owner: approve {approve|reject} ─► one tx: planImportShip on the in-tx latest ─► tx.create(v{n}) + import → approved
discard (owner or supervisor) any time before a decision.
```
The raw file is never stored, its name is never sent, and nothing about it survives except the parsed, redacted
steps (point 2 holds by construction: after approval the SOP **is** the structured version doc).

### 5.3 Parser → canonical format (deterministic, no model)

Same rules as v1 (input hygiene, dropped content, list items and paragraphs → steps, inline markdown stripped, EN/ID
role cues, caps; SKELETON regexes fixed in the parser task with tests), with S1 in place:
- **Sections:** each ATX heading (`#`-`######`; nearest heading wins), or a short `.txt` line (≤ 80 chars) ending in
  `:` followed by list items, opens a section `{section_id: slug(title), title}` (title ≤ 80, cut at a word boundary
  with `…`). Steps before the first heading go to an implicit section only if the file has headings later
  ("General" / "Umum"); a file with no headings produces an unsectioned SOP (valid under S1).
- **section_id:** `slug` (NFKD, strip marks, lower, `[^a-z0-9]+`→`-`, trim, ≤ 32) de-duplicated with `-2`, `-3`;
  never collides with a base section id unless the titles match (then it **is** that section, §5.4).
- **step_id:** `${section_id cut to 24}-${NN}`, counter per section, skipping any id in the base SOP. `title` = the
  step's first sentence/line (≤ 160, word boundary, `…`); no section prefix needed any more. Text never truncated.
- **Questions (plain-code flags, W10's "hard to read"):** `duplicate_in_file`, `already_in_sop`, `long_step`
  (401-800), `redacted`, `table_row`, dropped content with line numbers. W10's "two rules disagree" = optional model
  assist later (Phase U2, model may output only `{kind, a, b}` indices; never text).

### 5.4 Placement in append mode (new with sections)

- File section title matches a base section title (NFKC, case-folded, whitespace-collapsed) → its new steps are
  inserted at the **end of that section's run**. Otherwise → a new section appended after the last sectioned run and
  before the trailing unsectioned run.
- Base SOP without sections (e.g. the 5-step placeholder): the appended steps are stored **unsectioned** (the file's
  section names become a title prefix `"<Section> · "`, today's convention), because S1 rule (c) forbids sectioned
  steps after unsectioned ones, and sectioning an existing unsectioned SOP would reorder it, which A′ forbids.
- `planImportShip` pin (replaces v1's "new steps only at the end"): **every base step is byte-identical, none removed,
  base relative order preserved; base sections unchanged in order and title; only new steps and new sections added.**
- `SopUploadRecordSchema.added_step_ids` invariant becomes "a set of ids absent from the previous version whose
  removal from `steps` yields the previous version's `steps` exactly".

### 5.5 Everything else in Phase U

Unchanged from v1 and still the plan of record: the separate `sop_imports` collection with a mirrored two-person state
machine (ProposalSchema cannot host imports cheaply); privacy (digit mask → staff-name scrub → one SDP batch; SDP
failure stores nothing); RBAC (`sop:import`, `sop:import:check`, `sop:import:approve`); body-size and content-type
checks before parsing; no file name; logs and audits without text; `Cache-Control: private, no-store`; status codes
(201 create; 409 `SOP_CHANGED`/`SOP_STEP_LIMIT`/`IMPORT_DECIDED`/`IMPORT_NOT_READY`; 422 `EMPTY_FILE`/`NOT_TEXT`/
`FILE_TOO_LARGE`/`STEP_TOO_LONG`/`NOTHING_NEW`/`NOTHING_SELECTED`; 413; 429 daily cap of 10 per outlet; 503 SDP);
approved upload makes open proposals `SOP_CHANGED`; R-11 `overlapping_change` counts upload-append versions;
R-12 reset deletes `sop_imports` and `source: "upload"` versions, never `source: "seed"`; TTL on
`sop_imports.expires_at` (dev-ops, both projects). Schema sketch (`SopImportSchema`, `SopUploadRecordSchema`,
`source: "upload"` invariants) and edge cases E1-E28 carry over from v1 verbatim in Appendix A (SKELETON until §11).
`SopImportStepSchema` gains `section_id` and the import doc gains `sections` (the proposed sections, redacted).

---

## 6. Point 5: the model never writes a whole SOP

| Path | Who writes text | Size written by a model | Whole SOP regenerated? |
|---|---|---|---|
| Proposal (R-08/R-10) | ProposalAgent writes one step's full new text (`change_text` ≤ 400, `WIRE_MAX`) and title ≤ 160 | ≤ ~560 chars | **No.** `planShip` copies every other step and assembles the version in plain code |
| Long-step Phase 2 (R-SOP-sample-fit §7, planned) | Model edits one segment ≤ 400; plain code splices it into the step | ≤ 400 chars | No; untouched owner text byte-identical by construction |
| Upload (Phase U) | Nobody: deterministic parser; the owner's own words after redaction | 0 | No |
| Upload assist (U2, optional) | Model returns only enums and step indices | 0 chars of SOP text | No |
| Review (R-11) | ReviewAgent reads metric and dates only | 0 chars of SOP text | No |
| Diff (Phase D) | Plain code | 0 | No (computed, never stored) |

So point 5 holds today for every write path and stays true in every planned phase. **What remains risky:**
1. **Steps of 401-800 chars** are storable (seed, template, future upload) but a proposal targeting one dead-ends at
   the owner (`STEP_TEXT_TOO_LONG`), or the model silently shortens it. Known gap for 18 Oct (Rangga 11 Oct); the demo
   SOP keeps every step ≤ 300 chars. Upload flags them (`long_step`).
2. **Input size, not output:** the proposal prompt lists the whole SOP (200 × 800 chars worst case ≈ 40k tokens).
   That is reading, not regenerating, but it is cost; the `DAILY_TOKEN_CEILING` code does not exist yet.
3. **Full-step rewrite of a 250-400-char step** can re-redact unchanged words (SDP on the whole new text). Fixed by
   segment edit in long-step Phase 2.

---

## 7. Phases, hours, and what is demo-credible before 18 Oct

Hours are build (developer) + tests inside the tasks; gates = tech-lead review + live QA + one fix round. Error bar
±25%; every R-09-R-12 plan ran 1.5-2× its backlog slot.

| Phase | Content | Server | UI | Gates | Total | Hard rule touched | Before 18 Oct? |
|---|---|---|---|---|---|---|---|
| **D** Version diff | §4: pure diff, 2 store reads, route, `/sop/diff`, two links, EN/ID | 2.7 | 2.1 (incl. copy 0.3) | 1.7 | **≈ 6.5 h** | none | **Only if the §8 criteria hold** |
| D-lean | D without the version pickers (links only: "Compare with version N" per change card + latest-vs-v1) and without `between` | 2.4 | 1.6 | 1.5 | ≈ 5.5 h | none | same |
| **S** Sections (S1) | §3: schema + invariants, `planShip` carry, `/sop` grouping, template sections, diff `moved`/sections (if D exists) | 1.2 | 0.9 | 1.2 | **≈ 3.3 h** | none | No (after 18 Oct; nothing in the demo needs it) |
| S1b / N2 | model picks a section for a NEW step (proposal-v3 wire + prompt + dry-run) | 2 | 0.2 | 0.8 | ≈ 3 h | none | No |
| **U** Upload A′ | §5, two-person, stored draft, plain-code questions, sections, placement §5.4 | 9.6 | 3.9 | 4.7 (+ security-reviewer) | **≈ 18 h** (+0.7 docs/infra) | **#9 (amendment)**, #3, #7 | **No** |
| U2 | model assist for "two rules disagree" | 3 | 0.5 | 1.5 | ≈ 5 h | none new | No |
| Long-step Phase 2 | R-SOP-sample-fit §7 (segment edit, caps to 2,000, doc-size guard) | — | — | — | ≈ 9-11 h | none | No |

**All five points in full ≈ 28 h (D + S + U) plus long-step Phase 2.** That is a post-submission package.

**Calendar honesty.** About 13 h of committed work remains before 18 Oct (R-12 PR-B and its follow-up fixes, R-14,
promotion, live QA) plus the infra "go" items. Phase U (18 h) cannot fit and must not be attempted. Phase S has no
demo value (the demo SOP reads fine with the title-prefix convention). **Phase D is the only slice that is
demo-visible and hard-rule-free:** in the judge sandbox, after the lead scenario ships v2, "Compare versions" shows the
approved change as marked words. Be honest about its value for judges: with one shipped change it shows the same
step as the before/after card, with marks; its real value (ranges, many changes) appears in the pilot.

---

## 8. Recommendation

1. **Before 18 Oct: build Phase D (or D-lean) only if ALL hold on Wed 14 Oct 18:00 WIB:** (a) R-12 PR-B is merged and
   its follow-up fixes are closed; (b) R-14 is started and on track; (c) the promotion and live-QA slots are protected
   in the calendar; (d) at least **8 h** of unallocated build + gate capacity remains before the pre-submission freeze;
   (e) Rangga has answered Q-2 "pull forward". If any fails, Phase D waits; README "Next" lists it. I expect (d) to be
   tight; D-lean is the fallback if (d) shows 6-8 h.
2. **After 18 Oct, in this order:** S (sections; the parser's output format must exist first) → U (only after the
   rule-9 amendment) → long-step Phase 2 (pilot readiness) → N2/U2 if asked.
3. **Do not** build upload before 18 Oct under any condition: a new untrusted-input surface and a hard-rule change in
   the busiest week, invisible value to judges, and an approved upload mid-scenario breaks the lead demo path (every
   open proposal becomes `SOP_CHANGED`).
4. **Keep `/sop` mark-free** (Rangga's point 4, and the existing pin). The diff lives only on `/sop/diff`.

What would change my mind: Rangga wants upload as the headline of the submission video (then D drops, and U-lean
owner-only ≈ 11 h would need to replace R-14 polish, which I would argue against), or capacity on 14 Oct shows
≥ 14 h free (then D + S both fit).

---

## 9. Hard-rule checklist

| Rule | Phase D | Phase S | Phase U |
|---|---|---|---|
| #1 Google only | No model | No model | No model (U2 Vertex only) |
| #2 / 9a no file/audio storage | n/a | n/a | Text in one JSON body, dropped; no Cloud Storage; no file name |
| #3 redact before storing | Stores nothing | Stores nothing new (seed/template text is fictional) | Digit mask → name scrub → SDP before the draft; failure stores nothing |
| #5 regions | Firestore only | Firestore only | SDP via `getServiceLocation("dlp")`; U2 via `config/regions.yaml` |
| #6 no browser Firestore | API route, claims-checked | via existing `/api/v1/sop` | `/api/v1/sop/imports*` |
| #7 people data | Views carry no ids of people/devices; roles only | Role per step unchanged | Roles only on imports, versions, audits |
| #8 public repo | Fictional fixtures | Fictional template | Fictional fixtures |
| #9 SOP via proposals | Read-only; no write method added | Changes the shape, not the path; `planShip` still the only proposal writer | **Requires the amendment** (§5.1) |
| #10 gate is code | Diff is plain code | n/a | Parser, flags, ids, placement and ship plan are plain code |
| Dev mode (§4) | Skipped: the screen itself is the observation tool | Skipped | Skipped: visible on `/sop`, `/sop/import`, audit log |

---

## 10. Review focus (for tech-lead review of each PR)

- D: `/sop` or its card gains any mark or "diff" wording (pin stays green); a route path that reads a version by an id
  not built from `claims.outlet_id`; `listVersions` used for the diff (payload); colour-only marks; segment invariant
  (`same+del = a`, `same+ins = b`) missing from tests; no `no-store`.
- S: a modified step losing `section_id` in `planShip`; an explicit `section_id: undefined` written; an old fixture
  failing to parse; contiguity not enforced.
- U: everything in v1's review focus (edit of an existing step, second writer, unredacted text, file text/name in
  logs, races, role escalation, leftover steps after terminal status, HTML executed), plus base relative order
  preserved under §5.4 insertion.

---

## 11. Questions for Rangga (short list)

- **Q-1 Rule #9 (the key open decision; only you can make it).** Approve option **A′** (upload may create v1 or add new
  steps/sections; never edits, removes or reorders an existing step; supervisor check + owner approval; transactional
  ship) and the §2.9/9a wording in §5.1? Alternatives: B (first SOP only, not demoable), C (append only, cannot
  bootstrap the pilot), A (also edit; not recommended: it bypasses the evidence gate).
- **Q-2 Diff screen timing.** Pull Phase D forward under the §8 criteria (checked Wed 14 Oct 18:00), or after 18 Oct?
  Full D (pickers, ≈ 6.5 h) or D-lean (links only, ≈ 5.5 h) if pulled forward?
- **Q-3 Sections format.** Approve S1 (optional `section_id` per step + `sections` list on the version, array order,
  contiguous sections, no `when` field), after 18 Oct?
- **Q-4 NEW-step placement in a sectioned SOP.** Default N1 ("Added steps" group at the end), or N2 (the model picks a
  section; ≈ 3 h + dry-run, bundled with the long-step wire bump)?
- **Q-5 Diff detail.** Word-level marks (default) or sentence-level? Owner and supervisor only (default, existing
  `sop:diff`), staff never?
- **Q-6 Upload details (only once Q-1 is yes; defaults in brackets).** Supervisor check even on an owner's upload
  [yes]; who uploads [owner and supervisor]; redact uploaded text [yes]; steps of 401-800 chars [warn and allow];
  open proposals after an approved upload [become `SOP_CHANGED`, "Generate again"]; reject reason [none, no
  constraint]; model assist for "two rules disagree" [deferred].

## Appendix A. Phase U detail carried over from design v1 (R-15-sop-upload.md, 11 Oct; untracked, so kept here verbatim)

Read with §5: where §5.3/§5.4 differ (sections, `title` without a section prefix, insertion placement, the
`added_step_ids` invariant), §5 wins. "R-15" below means this task (R-17). Question numbers in this appendix are
v1's: v1 Q-1 is now §11 Q-1; v1 Q-2/Q-3/Q-4/Q-5/Q-7/Q-8/Q-9 are folded into §11 Q-6; v1 Q-0 (backlog id) is answered
(R-17); v1 Q-6 (timing) is §8.

### A.1 Parser rules and draft builder (v1 §1.3)

**Parser rules (`lib/sop/import/parse.ts`, pure). SKELETON: final regexes are fixed in Task 2 with tests.**
1. **Input hygiene:** strip a leading BOM; CRLF/CR → LF; NFC; remove zero-width (`U+200B-U+200D`, `U+FEFF`) and bidi
   controls (`U+202A-U+202E`, `U+2066-U+2069`). Reject (422 `NOT_TEXT`) on `U+0000`, other C0 controls except
   `\t \n`, or `U+FFFD`. Caps: ≤ 100,000 chars and ≤ 3,000 lines (422 `FILE_TOO_LARGE`; body > 150 KB → 413).
2. **Dropped (and noted, `dropped_content` with line number):** YAML front matter at the very top (`---` … `---`),
   fenced code blocks, HTML comments, images `![…](…)`, horizontal rules, table separator rows.
3. **Sections:** an ATX heading `#`-`######` sets the current section (nearest heading only, markdown stripped).
   In any file, a short line (≤ 80 chars) ending with `:` directly followed by list items also counts as a section
   (common in `.txt`). `.md` and `.txt` use the **same** parser; `file_kind` is only recorded.
4. **Steps:** each list item (`-`, `*`, `+`, `1.`, `1)` after ≤ 3 spaces) is one step. Lines indented under an item,
   and nested items, are **continuation** of that item, kept as `\n` / `\n- …` (a sub-list stays inside its step, the
   R-SOP-sample-fit "natural grouping"). Outside lists, each blank-line-separated paragraph is one step. Each table
   data row is one step, cells joined with ` · ` (flag `table_row`).
5. **Inline markdown:** `**x**`, `__x__`, `` `x` `` → `x`; `[t](url)` → `t` (URLs dropped, so no `javascript:`
   survives); blockquote `> ` stripped; any HTML is kept **as literal text** (rendered as text, never HTML).
6. **Role cues (EN + ID, case-insensitive):** an item prefix like `Supervisor:`, `[Owner]`, `(Staf) -`, or a heading
   suffix `(Supervisor)` sets the role (`staff|staf|crew|karyawan` → `staff`; `supervisor|spv|penyelia` →
   `supervisor`; `owner|pemilik` → `owner`); the cue is removed from the text. Default `staff`. Anything else
   (`Production:`, `Everyone:`) stays in the text; the uploader picks the role in the preview.
7. **Empty:** no steps after parsing → 422 `EMPTY_FILE`.

**Draft builder (`lib/sop/import/draft.ts`, pure), after redaction:**
- **Step id:** `slug(section)` = NFKD, strip combining marks, lower-case, `[^a-z0-9]+` → `-`, trim `-`, cut to 24,
  trim `-`; empty → `step`. Id = `${slug}-${NN}` (two digits, three past 99), counter per slug, skipping any id in
  the base SOP or already assigned. ≤ 28 chars, always matches `^[a-z0-9][a-z0-9_-]{0,39}$`. Example (5-step
  fixture): `opening-01`, `baking-01`, `stock-01`, `serving-01`, `closing-01`.
- **Title (≤ 160):** `"<section> · <lead>"`, where `section` ≤ 60 chars and `lead` = the text's first sentence or
  line, both cut at a word boundary with `…` so the total is ≤ 160; no section → `lead` only. Built from the
  **redacted** text. Shortening a title is allowed (the text keeps everything); **step text is never truncated.**
- **Text caps (after redaction, which can lengthen text):** > 800 → blocking 422 `STEP_TOO_LONG` with line numbers
  only (never echo text); 401-800 → flag `long_step` (§11 Q-5).
- **Duplicates:** key = NFKC, lower-case, collapsed whitespace, trailing punctuation stripped. Same key twice in the
  file → flag `duplicate_in_file` on the later one, default `include: false`. Same key as a base-SOP step (append) →
  flag `already_in_sop`, default `include: false`. If no step is left with `include: true` → 422 `NOTHING_NEW`.
- **Privacy flag:** redacted text contains a `[…]` token absent from the parsed text → flag `redacted` ("Some words
  were hidden for privacy. Edit the file and upload again if this hides a step's meaning.").
- **Step limit:** included steps (create) or base + included (append) > 200 → 422 `SOP_STEP_LIMIT` at upload and at
  submit; re-checked at approval (409).

### A.2 Privacy, security, cost, status codes (v1 §1.4-§1.5)

- **No file storage (rule 9a / like rule #2):** the browser reads the file with `TextDecoder("utf-8", {fatal: true})`
  and sends `{file_kind, text}` once. No multipart, no Cloud Storage, no file name sent or stored, nothing put in
  `localStorage`/IndexedDB (React state only; a reload loses it, which is fine).
- **Redaction before storing (hard rules #3, #7):** per step text and per section title: `maskDigitRuns` →
  `scrubStaffNames(text, scrubNames)` → **one** `redactBatch` call for all strings (≤ 100 KB, well under SDP's
  request limit). SDP failure → 503, **nothing stored**. `scrubNames` come from the helper constraints and proposals
  already use: `firestoreTickStore(db).listStaffScrubNames(outletId)` (`lib/firestore/constraint-store.ts` l.59,
  `lib/firestore/proposal-store.ts` l.210), exposed on the import store as `listStaffScrubNames()`.
- **RBAC:** new permissions in `lib/auth/rbac.ts`: `sop:import` (owner, supervisor: create, submit, list, discard),
  `sop:import:check` (supervisor), `sop:import:approve` (owner). Role and outlet only from verified claims;
  staff → 403, device → 401 (`requireClaims`). Every store read is outlet-scoped; a foreign import id → 404.
- **CSRF:** the API authenticates by `Authorization: Bearer` (no cookies), so cross-site form posts carry no
  credential. Routes still require `Content-Type: application/json` (else 415/400) and check claims **before**
  reading the body.
- **Body size:** `requireClaims` first; then reject `Content-Length` > 150,000 with 413; read `await req.text()`,
  re-check length (header may be absent), then `JSON.parse` + zod.
- **Markdown/HTML injection:** stored as plain text; every screen renders it as React text nodes with
  `white-space: pre-line`; never `dangerouslySetInnerHTML`, never a markdown renderer, never through `t()`
  placeholders.
- **Prompt injection:** Phase 1 has no model call. Later proposal generation already puts SOP steps in its prompt
  (as it does for the seed); upload does not widen that surface beyond what an owner could already type into a seed
  file, and R-08's wire schema + plain-code gate bound the output. Phase 2's assist sees only redacted text and may
  output only enums and integers.
- **Logs:** never the text, a title or a file name. Log `{outlet_id, import_id, step_count, flag_counts,
  error_class}` only. Store skips log `{doc_id, error_class}` (prefix `[sop-import-store]`).
- **Audit (`audit_log`, roles only, no text):** `sop_import.created` (`details: {mode, step_count, flag_counts,
  file_kind}`), `sop_import.submitted`, `sop_import.checked` / `sop_import.rejected` / `sop_import.discarded`
  (`details: {by_stage}`), `sop_import.approved` + `sop.version_created` (`details: {version, change_kind: "upload",
  mode, added_count, source_import_id, effective_from_date}`).
- **Responses:** `Cache-Control: private, no-store`; no `outlet_id`, no uid, no device id.
- **Cost:** Phase 1: SDP only, at most 10 imports per outlet per day. Demo: the R-12 per-IP limits apply on top.

### 1.5 Status codes

`POST /imports` → 201; all other success → 200 (`authedRequest` accepts both). 409 `ConflictError` codes:
`SOP_CHANGED`, `SOP_STEP_LIMIT`, `IMPORT_DECIDED`, `IMPORT_NOT_READY` (wrong stage). 422 `ValidationError` with
`details[].message` ∈ `EMPTY_FILE | NOT_TEXT | FILE_TOO_LARGE | STEP_TOO_LONG | NOTHING_NEW | NOTHING_SELECTED |
invalid_body` (details carry line numbers / step indices only). 413 `PayloadTooLargeError`. 429 `LockedError`
(daily cap). 503 redaction. Idempotency: repeating a decision already taken → `{result: "unchanged"}` 200 (R-09
pattern).

**What R-17 never does:** edit or remove an existing step; `set`/`update` a `sop_versions` doc; store the file, its
name or unredacted text; call a model (Phase 1); add a route that writes `sop_versions` outside the owner-approve
transaction.

### A.3 Data changes and schema sketch (v1 §3a)

| Collection | Change |
|---|---|
| `sop_versions` | `source` gains `"upload"`; two optional keys `source_import_id` (uuid) and `upload` (record below); invariants by source. Existing docs parse unchanged |
| `sop_imports` (new) | one doc per upload; TTL on `expires_at` (draft +24 h; from submit +14 d) |
| `audit_log` | new actions listed in §1.4 |
| indexes | **none composite**: equality-only queries (`outlet_id` + `status`; `outlet_id` + `created_local_date`). **TTL policy on `sop_imports.expires_at`** on both projects (dev-ops) |

```ts
// lib/firestore/schema.ts, sop_versions section (Task 1). SKELETON: exact superRefine wording in Task 1.
export const SOP_IMPORT_MODES = ["create", "append"] as const;
export const SopUploadRecordSchema = z.object({
  mode: z.enum(SOP_IMPORT_MODES),
  added_step_ids: z.array(SopStepSchema.shape.step_id).min(1).max(200),
  file_kind: z.enum(["md", "txt"]),
  approved_at_ms: z.number().int().min(0),
}).strict();
// SopVersionSchema: source: z.enum(["seed", "proposal", "upload"]),
//   source_import_id: z.string().uuid().nullable().optional(),
//   upload: SopUploadRecordSchema.nullable().optional(),
// Invariants:
//  seed|proposal: source_import_id and upload absent/null (added to the existing branches).
//  upload: source_proposal_id null; change absent/null; source_import_id and upload non-null;
//    mode "create" ⇔ version 1 ⇔ previous_version_id null ⇔ effective_from_date null,
//      and added_step_ids equals every step id in order;
//    mode "append" ⇒ version ≥ 2, previous_version_id = `${outlet}:v${version-1}`, effective_from_date non-null,
//      and added_step_ids equals the LAST added_step_ids.length step ids, in order.

// sop_imports (new section)
export const SOP_IMPORT_STATUSES = ["draft", "awaiting_supervisor", "awaiting_owner", "approved", "rejected", "discarded"] as const;
export const SOP_IMPORT_FLAGS = ["duplicate_in_file", "already_in_sop", "long_step", "redacted", "table_row"] as const;
export const SopImportStepSchema = SopStepSchema.extend({
  include: z.boolean(),
  flags: z.array(z.enum(SOP_IMPORT_FLAGS)).max(5),
  source_line: z.number().int().min(1),
}).strict();
export const SopImportSchema = z.object({
  ...withOutlet,
  import_id: z.string().uuid(),            // = doc id
  status: z.enum(SOP_IMPORT_STATUSES),
  mode: z.enum(SOP_IMPORT_MODES),
  base_sop_version_id: z.string().min(1).nullable(), // null iff mode "create"
  file_kind: z.enum(["md", "txt"]),
  created_by_role: z.enum(["owner", "supervisor"]),
  steps: z.array(SopImportStepSchema).max(200),       // non-empty iff status draft|awaiting_*
  notes: z.array(z.object({ kind: z.literal("dropped_content"), line: z.number().int().min(1) }).strict()).max(50),
  counts: z.object({ parsed: z.number().int().min(0), included: z.number().int().min(0) }).strict(),
  supervisor_check: z.object({ decision: z.enum(["checked", "rejected"]), decided_at_ms: z.number().int().min(0) }).strict().nullable(),
  owner_decision: z.object({ decision: z.enum(["approved", "rejected"]), decided_at_ms: z.number().int().min(0) }).strict().nullable(),
  result_sop_version_id: z.string().min(1).nullable(), // non-null iff approved
  created_local_date: dateString,
  created_at_ms: z.number().int().min(0),
  updated_at_ms: z.number().int().min(0),
  expires_at: isoDateTime,                  // Firestore TTL field
}).strict(); // + superRefine: decisions match status (mirror ProposalSchema), steps/notes empty iff terminal,
             //   unique step_id, base null iff create, result id iff approved.
```

### A.4 Edge cases E1-E28 (v1 §6)

| # | Case | Behaviour |
|---|---|---|
| E1 | 5-step placeholder `.md` on an outlet with **no** SOP | 5 steps, roles staff → submit → check → approve → `v1`, `source: "upload"`, `effective_from_date: null`; `/sop` shows "Version 1" and the 5 steps; proposal generation works on it |
| E2 | Same file on `demo-outlet` (seed v1 has the same 5 steps) | all 5 flagged `already_in_sop`, none included → 422 `NOTHING_NEW` ("Every step in this file is already in your SOP.") |
| E3 | 5-step file with 2 new steps on `demo-outlet` | v2 = v1's 5 steps byte-identical + 2 appended; effective tomorrow; open proposals → `SOP_CHANGED` |
| E4 | Headings only / blank file | 422 `EMPTY_FILE` |
| E5 | Windows-1252 or UTF-16 file | client decode error; if forced to the server, `U+FFFD`/NUL → 422 `NOT_TEXT` |
| E6 | 100 KB+ file, or a 3,001-line file | client refuses; server 413 / 422 `FILE_TOO_LARGE` |
| E7 | One 900-char paragraph | 422 `STEP_TOO_LONG` with its line number; nothing stored |
| E8 | 790-char step that SDP lengthens past 800 | 422 `STEP_TOO_LONG` (checked after redaction) |
| E9 | 401-800-char step | stored with `long_step` warning (Q-5) |
| E10 | Staff name or phone number in a step | `[STAFF]` / `[NUMBER]` / SDP token; `redacted` flag in the preview |
| E11 | `<script>`, `javascript:` link, "ignore previous instructions" | stored as literal text (link URL dropped), rendered as text; no model reads it in Phase 1 |
| E12 | 150 items + base 60 steps | 422 `SOP_STEP_LIMIT` (no partial import) |
| E13 | Two imports on the same base, both approved | first ships; second 409 `SOP_CHANGED`, stays `awaiting_owner`, can be discarded |
| E14 | A proposal ships while an import waits | import approve → 409 `SOP_CHANGED` |
| E15 | Create-mode draft, then the seed writes v1 | approve → 409 `SOP_CHANGED` |
| E16 | Double tap Approve | `unchanged`; one version, one audit pair |
| E17 | Owner presses Check / supervisor presses Approve | 403 |
| E18 | Staff token / device token / other outlet's import id | 403 / 401 / 404 |
| E19 | Submit with all `include: false`, or answers missing an index | 422 `NOTHING_SELECTED` / `invalid_body` |
| E20 | Draft left 24 h; submitted import left 14 d | TTL deletes it; until TTL runs, the service treats `expires_at < now` as gone (404, not listed) |
| E21 | 11th upload of the day | 429 `LOCKED`, retry after local midnight |
| E22 | SDP down | 503; nothing stored; the user retries with the same file |
| E23 | Approve at 23:30 / 00:30 local (append) | in force from the next calendar date (same as R-10 E6/E7) |
| E24 | R-11 review whose window contains an append | `overlapping_change: true` |
| E25 | Proposal later targets an appended step > 400 chars | known gap (R-SOP-sample-fit §7, `STEP_TEXT_TOO_LONG`); warned at upload |
| E26 | Judge uploads in a demo sandbox | lives only in that sandbox outlet; R-12 reset deletes `sop_imports` and `source: "upload"` versions (never `source: "seed"`) |
| E27 | File name contains a person's name | never sent, never stored |
| E28 | Same step text differing only in case/spacing | duplicate |


## Result

*(Filled in after the build.)*

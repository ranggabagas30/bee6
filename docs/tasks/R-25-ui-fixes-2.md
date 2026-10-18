# R-25 UI fixes 2: pair-code typing, the top white band, guide auto-open (tech-lead brief, Sat 17 Oct ~12:50 WIB)

Literal brief for `developer` (sonnet). Diagnosed read-only from `origin/develop` `85e4dc1` (worktree) and the served
build on `web-develop` (`5d514bb`: `/pair` HTML + both CSS chunks, fetched and grepped). Follow literally; flag a gap,
do not improvise. Skills: `react-patterns`, `react-testing`, `frontend-a11y`, `tdd-workflow` (failing test first).
Branch `fix/r25-ui-fixes-2` off `origin/develop`; one commit per section (§1, §2, §3); PR to `develop`.
Hard stop for new fixes 15:00: do §2, then §1, then §3 only on Rangga's go (§3 is an enhancement, see §0).

Aligned with `docs/tasks/QA-ui-mobile-17oct.md` (QA, in progress at 12:55: §A typing and §B band were complete; §B.3
real-Chrome line check and §C 360 px pass were still filling in). QA ids: **M-001** = the band, **M-002** = the full
field swallowing keys. Re-read QA §B.3 / §C / §D before opening the PR in case a new row needs a ruling.

## 0. Summary of rulings

| Id | Finding | Ruling | Size | Pilot risk | Ship before 15:00? |
|---|---|---|---|---|---|
| (2) white band | **Real, pre-R-25, on every demo route at >= 900 px** (QA **M-001**: `body padding-top` 70 px on every route at 1280 and 1920, header at y=70). `globals.css` `.b6-panel-collapsed body { padding-top: 70px }` and `.b6-panel-reserved:not(.b6-panel-open) body { padding-top: 70px }` (both on `main` too) push the whole page down to keep the fixed pill off the header. The page-2 boards have no strip: QA's static render puts the `.fab` **14 px below the header**, at the content area's top-right (`.dwrap{position:relative}`, y=87 in a 73 px-header frame). The band is white because only `.page`/`.shell` paint the ground; `<body>` is default. | Delete the two body padding rules. **Ruling (deviation from the board, see §2.1):** the pill stays at `top: 14px` inside the header band, and the three headers reserve right-hand room (`.b6-pill-room`) only while the pill is shown at >= 900 px. | ~45 min | None: no `b6-panel-*` class ever lands on `<html>` on the pilot (guide + first-paint script are DEMO_MODE-only) | **Yes** |
| (1) typing | **No defect in the React layer, the served DOM or the served CSS** (§1.1); QA (`QA-ui-mobile-17oct.md` §A) confirms typing works in every method on staging and on `main`. The one reproduction is QA **M-002**: once the field holds six digits (after "Fill in 000000", or six typed by hand) `maxLength=6` silently swallows every further keystroke; a tap puts the caret mid-string, typing does nothing, no feedback. Pre-R-25 (same on `main`). A second, unevidenced mechanism is the **hydration window** on `/pair` (§1.2b): the form is SSR'd inside the lazy `DemoAccess` chunk; React 19 keeps digits typed before that subtree hydrates in the DOM but not in state (`initInput`: `isHydrating \|\| value === element.value \|\| (element.value = value)`). | Fix M-002: a full field selects all on focus, and a digit typed into a full, unselected field replaces the whole value (§1.2a). Per-keystroke regression tests (§1.4). The hydration effect (§1.2b) is optional hardening, last. | ~40 min | None: pure client state in a form the pilot already uses; no route/data change | **Yes** |
| (3) auto-open | Enhancement. Open the judge guide by itself on `/` for the first visit per browser, **laptop only (>= 900 px)**: the side panel pushes content left (`body padding-right`), so nothing is covered; the phone sheet (content-high, ~290 px of a 640 px screen) would sit over the "Open staff screen" card at 360 px, which Rangga ruled out. The phone keeps the collapsed handle "Welcome · pick Staff to start". | §3. Flag `bee6.guide.welcome_seen` written on the first close (any way it closes, route change included). No focus move on open; Escape closes; focus returns to the pill on close. | ~1-1.5 h | None: `JudgeGuide` is mounted only with DEMO_MODE | **Rangga's call**; if not started by 14:00, defer to the post-17:00 P2 batch |

Hard rules: none touched (CSS, client state, one localStorage flag with no personal data). `DEMO_MODE` unset: the
pilot DOM gains only an inert class name on `StaffTopBar`'s `<header>`.

---

## 1. (1) `/pair` code field: regression test + hydration hardening

### 1.1 What was checked (so nobody re-checks it)

- `app/pair/PairForm.tsx`: one controlled `<input id="pairing-code">`; `onChange={(e) => setCode(digitsOnly(e.target.value))}`;
  `digitsOnly = replace(/\D/g,"").slice(0,6)`; `readOnly` only while submitting; no `onKeyDown`/`onBeforeInput`; no `autoFocus`;
  the only `focus()` calls are the refusal alert (`PairForm`), the refusal status (`DemoAccess`), and SidePanel open/close.
- `/pair` is not re-keyed (`key=` only on the sign-in staff panel). No `useEffect` resets `code`.
- No document-level `keydown` listener is mounted on `/pair` (the dialog ones live in `ResetDemoButton`, `SignOutDialog`,
  `EndConfirmSheet`, `ChangeLabelDialog`, none rendered there). `Sheet`/`SidePanel` handle Escape only.
- Nothing covers the field: `.b6-mist` is `pointer-events:none`; the phone sheet is a bottom handle (`.b6-sheet__body[hidden]{display:none}`
  is in the served CSS); the laptop pill is 48 px top-right; `.b6-sr-only` is 1 px. No `inert`, no `aria-hidden` wrapper.
- Served `/pair` markup (web-develop): `<input id="pairing-code" class="b6-codefield …" inputMode="numeric" autoComplete="one-time-code"
  pattern="[0-9]*" maxLength="6" placeholder="· · · · · ·" required value=""/>`, exactly one such id, no `readonly`.
  Served CSS for `.b6-codefield` = source; no bare `input`/`body` element rule in either chunk.
- A per-keystroke test (keyDown → beforeInput → input → keyUp per digit) against the real `PairScreen demo={true}` passes
  in jsdom: every digit lands, focus stays on the field, "Set up" enables (`PairForm.test.tsx` 16/16 + that test).
- Diff `origin/main..origin/develop -- app/pair/PairForm.tsx`: the six-box overlay went, the input gained `placeholder`,
  `pattern="[0-9]*"` (was `\d{6}`) and `onPaste`; the typing path is byte-identical.

### 1.2a Code change (M-002): `app/pair/PairForm.tsx` (judgment: small, `developer`)

A full field must never swallow a keystroke silently. Two handlers on the existing `<input>`, nothing else:

```tsx
// QA M-002: with six digits in, maxLength swallows every further key and a tap puts the caret mid-string. A full
// field selects its digits on focus, and a digit typed into a full, unselected field replaces them all.
onFocus={(event) => {
  if (event.currentTarget.value.length === CODE_LENGTH) event.currentTarget.select();
}}
onBeforeInput={(event) => {
  const el = event.currentTarget;
  const native = event.nativeEvent as InputEvent;
  if (native.inputType !== "insertText") return; // Backspace, cut, paste: untouched
  if (el.value.length === CODE_LENGTH && el.selectionStart === el.selectionEnd) el.select(); // the insert now replaces the selection
}}
```

- `onBeforeInput` runs before the browser applies the insert, so selecting synchronously makes the typed character
  replace the whole value; the existing `onChange` then receives `"7"` and `digitsOnly` keeps it. Paste keeps its own
  handler (`inputType` `insertFromPaste` is not `insertText`). Backspace (`deleteContentBackward`) is untouched.
- `readOnly` while submitting already stops both paths (no `beforeinput` on a read-only field).
- The sign-in staff panel (`RoleSignIn`) renders the same `PairForm`: it gets the fix for free.

### 1.2b Optional hardening (last, only if §2 and §1.2a are green before 14:30): pre-hydration digits

```tsx
const inputRef = useRef<HTMLInputElement>(null);
// The form is server-rendered inside a lazily hydrated subtree (/pair's DemoAccess). React 19 keeps the DOM value it
// finds at hydration but not in state: digits typed before the chunk arrived would show and never enable Set up.
useEffect(() => {
  const dom = inputRef.current?.value ?? "";
  if (dom !== "") setCode((prev) => (prev === "" ? digitsOnly(dom) : prev));
}, []);
```

- Put `ref={inputRef}` on the input. `initialCode` still wins when set (the effect only fills an empty state). On a
  normal client render the DOM value equals the state, so it is a no-op there.

### 1.3 Alignment with `QA-ui-mobile-17oct.md`

- §A.1: every typing method passes on staging and on `main`; `elementFromPoint` at the field's centre is the input;
  no console errors. Matches §1.1: no overlay, no swallowed key, no React defect.
- §A.2 (**M-002**): the only reproduction. §1.2a is its fix. QA's unreproduced "Fill in left 555555 once" is not a
  defect (a tap on the sheet handle); no change.
- If QA's human checklist (physical phone, OS one-time-code autofill) later shows something else, bring the evidence to
  the tech-lead; do not invent a fix for an unevidenced row.

### 1.4 Tests

`app/pair/PairForm.test.tsx` (extend; `fireEvent` per keystroke, no new dependency: `@testing-library/user-event` is not
installed and a new dev dependency at 15:00 is not worth it):

1. **"types six digits one by one: each digit lands, focus stays, Set up enables on the sixth"** — `renderForm()`;
   `input().focus()`; for each digit `d` of `"123456"` with the running value `next`: `fireEvent.keyDown(input(), {key:d})`,
   `fireEvent.input(input(), {target:{value:next}})`, `fireEvent.keyUp(input(), {key:d})`; assert `input().value === next`
   and `document.activeElement === input()` after each; after the loop `submitButton().disabled === false`.
2. **"a seventh digit and a letter are dropped while typing"** — continue from six with `"1234567"` → value `"123456"`;
   `"12345a"` → `"12345"`.
3. **"M-002: a full field selects all on focus, so the next digit replaces it"** — `renderForm({ initialCode: "000000" })`;
   `fireEvent.focus(input())`; assert `input().selectionStart === 0 && input().selectionEnd === 6`; then
   `fireEvent.input(input(), { target: { value: "7" } })` → value `"7"`, button disabled, hint back.
4. **"M-002: a digit typed into a full, unselected field replaces it"** — `renderForm({ initialCode: "000000" })`;
   `input().focus(); input().setSelectionRange(3, 3)`;
   `fireEvent(input(), new InputEvent("beforeinput", { inputType: "insertText", data: "7", bubbles: true, cancelable: true }))`;
   assert `selectionStart === 0 && selectionEnd === 6`; then `fireEvent.input(input(), { target: { value: "7" } })` → `"7"`.
   (jsdom's `InputEvent` carries `inputType`; if the constructor lacks it, build with `new Event("beforeinput", …)` and
   `Object.defineProperty(ev, "inputType", { value: "insertText" })`.)
5. **"M-002: Backspace on a full field is untouched (no select-all)"** — same setup, `beforeinput` with
   `inputType: "deleteContentBackward"` → selection stays `3..3`; `fireEvent.input(…, "00000")` → `"00000"`.
6. **"a full field: paste still replaces (own handler)"** — `renderForm({ initialCode: "000000" })`; `fireEvent.paste(input(), { clipboardData: { getData: () => "123 456" } })` → `"123456"`.
7. (only with §1.2b) **"adopts digits the browser already held when the component took the field over (hydration)"** —
   `renderToString` (`react-dom/server`) of `<LangProvider initial="en"><PairForm/></LangProvider>` into a container,
   set `container.querySelector("#pairing-code").value = "123456"`, then `await act(async () => { hydrateRoot(container, <same tree/>) })`
   (`react-dom/client`); assert "Set up" enabled and `input.value === "123456"`; `root.unmount()` inside `act`.
8. (only with §1.2b) **"does not override an initialCode with a stale DOM value"** — `renderForm({ initialCode: "000000" })` → `"000000"`.

`app/pair/PairScreen.test.tsx` (add one): the same per-keystroke loop against `<PairScreen demo config={null} />`
(the real lazy wrapper; `await screen.findByLabelText("6-digit code")` first), asserting the final value and the enabled
button. This is the regression test Rangga asked for: it exercises the actual `/pair` tree.

### 1.5 Risks

- `select()` on focus of a full field: a judge who taps a full field to *edit one digit* now replaces all six on the
  next key. Accepted: the field is a 6-digit code, "start over" is the OTP convention, and the alternative (silent
  swallow) is the reported bug. Backspace right after that focus deletes all six (standard select-all behaviour); a
  click inside the field first collapses the selection, after which Backspace deletes one digit as today.
- `beforeinput` is supported by every browser the demo targets (Chrome, Safari, Firefox >= 87). Where it is not, the
  field behaves as today (no regression).
- §1.2b (optional) is a mount-time no-op outside the hydration window.

---

## 2. (2) The white band at the top (>= 900 px, every demo route)

### 2.1 What makes it

- `app/ui/SidePanel.tsx` puts `b6-panel-collapsed` on `<html>` while the pill is shown; `app/demo/first-paint.ts` puts
  `b6-panel-reserved` on `<html>` before paint on `/`, `/sign-in`, `/pair`, `/capture` and wherever a live demo state exists.
- `app/globals.css` L573-585: `.b6-panel-collapsed body { padding-top: calc(var(--b6-panel-pill-h) + 14px + 8px) }`
  (= 70 px) and, at >= 900 px, the same for `.b6-panel-reserved:not(.b6-panel-open) body`. `<body>` has no ground colour
  (only `.page`/`.shell` do), so the 70 px (plus any default body margin on pages that do not cancel it) is a white strip
  holding only the fixed pill (`.b6-panel-pill { position: fixed; top: 14px; right: 20px }`). Routes: every route where the
  guide mounts at >= 900 px: `/`, `/sign-in`, `/pair`, `/capture` (sandbox), and the web routes with a live demo role.
- Boards (QA's static render, `QA-ui-mobile-17oct.md` §B.2): `.dtop` at y=0 (73 px tall); the closed guide
  `.fab{position:absolute;top:14px;right:20px}` is positioned inside `.dwrap{position:relative}`, i.e. **14 px below
  the header at the content area's top-right** (y=87), overlapping whatever content sits there. No strip anywhere.
- **Ruling R-fixes2-1 (deviation from the board, tech-lead):** the app keeps the pill `position: fixed; top: 14px`
  inside the header band rather than at the board's y=87. Reasons: (a) the board's spot is over content, and on the
  web pages that corner holds controls (the day-record date control, the proposals "Ask" button, the approvals
  actions) which a 250 px pill would cover; (b) a fixed pill at a header-relative `top` needs a known header height,
  which wraps to two rows between 900 and ~960 px; (c) the header's right zone is the one place that is guaranteed free
  once its own controls shift left, and the pill still reads as "top-right of the page". The visible difference from
  the board is ~73 px of vertical position; the band (the actual defect) is gone either way. Rangga can overrule to the
  board's position after judging; it is a `top:` value.
- The "dark 2-3 px line at the very top": QA saw none in headless Chromium at 1280/1920 (§B.1); real-Chrome check is
  QA §B.3. Nothing in the CSS paints `<html>`/`<body>`; if it survives this fix it is a separate item.

### 2.2 Change (mechanical once decided: `developer`, same PR)

`app/globals.css`:

1. `:root`: add `--b6-panel-pill-room: 300px;` right after `--b6-panel-pill-h: 48px;` (pill ~250 px wide at its longest
   content "JUDGE GUIDE [STAGE 5 OF 5] ⌄" + 20 px right offset + ~30 px air).
2. Delete the `.b6-panel-collapsed body { … }` rule (L573-575) and its comment, and the whole
   `@media (min-width: 900px) { .b6-panel-reserved:not(.b6-panel-open) body { … } }` block (L577-585) and its comment.
3. In their place:

```css
/* The pill is fixed at top 14 / right 20 inside the header band (boards D2-01, L2-01: the fab sits over the .dtop
   row). While it is shown, each header keeps its right-hand controls (ID | EN, Sign out) left of it: SidePanel puts
   b6-panel-collapsed on <html> for exactly as long as the pill is shown (laptop widths only), and the first-paint
   script's b6-panel-reserved reserves the same room from the first frame. The open panel insets the body instead. */
.b6-panel-collapsed .b6-pill-room.b6-pill-room {
  padding-right: var(--b6-panel-pill-room);
}

@media (min-width: 900px) {
  .b6-panel-reserved:not(.b6-panel-open) .b6-pill-room.b6-pill-room {
    padding-right: var(--b6-panel-pill-room);
  }
}
```

   Why the doubled class: the page modules set the headers' padding with two-class selectors at >= 900 px
   (`.shell .dtop { padding: 14px 28px }` in `shell.module.css`, `:global(.b6-dtop).bar { padding-right: … }` in
   `entry.module.css`) and they load after `globals.css`, so an equal-specificity global rule would lose. `.b6-pill-room.b6-pill-room`
   lifts the global rule to (0,3,0) / (0,4,0) with no `!important` and no leading `html` (tokens.test requires every
   selector to start with `.b6-`). The first rule needs no media guard: `b6-panel-collapsed` exists only while `SidePanel`
   is mounted, i.e. at >= 900 px; keep it outside the media block so `ruleDeclarations` in the tests can read it.

Headers (add the class, nothing else):

4. `app/web/EntryLanding.tsx` L121: `className={cx("b6-dtop", "b6-pill-room", styles.bar)}`.
5. `app/web/WebTopBar.tsx` `ShellBar` `<header className={cx("b6-dtop", "b6-pill-room", styles.dtop)}>`.
6. `app/shop/StaffTopBar.tsx` `<header className={cx("b6-pill-room", styles.bar)}>` (import `cx` from `@/app/ui/cx`).

`app/demo/first-paint.ts`: comment only (`b6-panel-reserved` now reserves the header's pill room, not body padding).
`app/ui/SidePanel.tsx`: comment on the collapsed-class effect only.

### 2.3 Tests

- `app/ui/SidePanel.test.tsx` L156-171 ("while collapsed to the pill it pushes every page down…"): rename to
  "while collapsed to the pill it keeps each header's controls left of it (a class on <html>, right padding on
  .b6-pill-room); open or unmounted removes it". Replace the three rule assertions with:
  `expect(ruleDeclarations(css, ".b6-panel-collapsed body")).toEqual({})`;
  `expect(ruleDeclarations(css, ".b6-panel-collapsed .b6-pill-room.b6-pill-room")["padding-right"]).toBe("var(--b6-panel-pill-room)")`;
  `expect(tokens["--b6-panel-pill-room"]).toBe("300px")`; keep `minHeightPx(... ".b6-panel-pill" ...) === 48` and every
  class-toggle assertion as is.
- `app/ui/SidePanel.test.tsx` L178-196 ("CSS contract: b6-panel-reserved on <html> reserves the pill's top padding…"):
  this is the test that pins the media rule, so it must change with it. Rename to "CSS contract: b6-panel-reserved on
  <html> reserves the header's pill room from the first paint at >= 900 px, unless the panel is open" and replace the
  body up to the `// the host owns the reserve class` comment with:
  `const media = parseCss(css).find((r) => r.prelude === "@media (min-width: 900px)" && r.children.some((c) => c.prelude.includes(".b6-panel-reserved")));`
  `expect(media).toBeDefined();`
  `const rule = media!.children.find((c) => c.prelude === ".b6-panel-reserved:not(.b6-panel-open) .b6-pill-room.b6-pill-room");`
  `expect(rule).toBeDefined();`
  `const decls = Object.fromEntries(declarations(rule!.body));`
  `expect(decls["padding-right"]).toBe(ruleDeclarations(css, ".b6-panel-collapsed .b6-pill-room.b6-pill-room")["padding-right"]);`
  `expect(Object.keys(decls)).toEqual(["padding-right"]);`
  `// never outside the media query, and never on <body>: a phone (bottom sheet, no pill) gets nothing`
  `expect(ruleDeclarations(css, ".b6-panel-reserved:not(.b6-panel-open) .b6-pill-room.b6-pill-room")).toEqual({});`
  `expect(ruleDeclarations(css, ".b6-panel-reserved body")).toEqual({});`
  `expect(ruleDeclarations(css, ".b6-panel-collapsed body")).toEqual({});`
  Keep the class-ownership assertions that follow unchanged. (`parseCss` finds the block by content, not position, so
  editing the existing block at L581 in place is safe; `DemoBarLoader.test.tsx` reads no CSS.)
- `globals.css` ownership: the T1/G0 lane is closed and merged; the tech-lead authorises this one edit. It adds **no**
  media block (the 900 px block at L581 is edited in place) and one flat `.b6-` rule, so the "never add a 900px block
  to globals" rule holds.
- `app/ui/tokens.test.ts`: add `--b6-panel-pill-room: "300px"` next to the layout tokens if a layout-token list exists;
  otherwise skip.
- `app/web/EntryLanding.test.tsx`, `app/web/WebTopBar.test.tsx` (L96 area), `app/shop/StaffTopBar.test.tsx` (L28 area):
  one assertion each, `expect(screen.getByRole("banner").classList.contains("b6-pill-room")).toBe(true)`.
- `app/demo/first-paint.test.ts`: unchanged (it tests the class, not the padding); fix the L10 comment.
- Nothing in `lib/**`, `app/capture/**`, `app/demo/JudgeGuide.tsx`.

### 2.4 Risks / what QA checks

- At 900-960 px a header with the full left group (logo, outlet line, STAFF/SUPERVISOR + DEMO DATA chips) and ID | EN +
  Sign out may wrap to two rows (flex-wrap exists on all three). Acceptable; the board is 1280.
- Scrolled pages: the pill stays fixed over content at top-right as before (unchanged behaviour, no longer in a strip).
- Expired-demo state: the amber "session ended" box (`DemoBar`, `margin: 8px 16px`) renders above the header, so the
  pill overlaps its right end at >= 900 px. Rare, text is short; accept.
- QA at 1280 and ~2000 px on `/`, `/pair`, `/sign-in`, `/day/<date>`, `/home`: no white strip, header starts at y=0,
  pill vertically inside the header band, bounding box of the pill does not intersect ID | EN or Sign out (QA's existing
  `r25-H-*-1280` check). At 360 px: unchanged (phone sheet).

---

## 3. (3) Judge guide auto-open on the entry page (enhancement; Rangga's go first)

### 3.1 Behaviour

- Route `/` only (`seg === ""`), demo deployments only (the guide is mounted only with DEMO_MODE), **>= 900 px only**
  (`SidePanel`), and only when `localStorage["bee6.guide.welcome_seen"] !== "1"`.
- The panel is open on first render of the guide (no animation, no focus move: the judge's focus stays where it was;
  `SidePanel` moves focus to the close button only on an open *transition*, which this is not).
- It closes the usual ways (close button, Escape inside the panel, a route change). Add: Escape anywhere in the
  document closes the auto-opened panel (the judge has not focused it). On close, focus goes to the pill (`SidePanel`
  already does this) and the flag is written. Once written, the guide never auto-opens again in that browser.
- Phone (< 900 px): no auto-open; the collapsed handle already reads "Welcome · pick Staff to start".
- Card copy: unchanged (`lib/demo/guide.ts` `entry`: kicker "WELCOME, JUDGE", the 20-minutes paragraph, footnote
  "To change role later: sign out, then pick a role again."). No new copy, so no Bahasa provisional line.

### 3.2 Change: `app/demo/JudgeGuide.tsx` only (judgment: `developer`)

```ts
export const WELCOME_SEEN_KEY = "bee6.guide.welcome_seen";
```

Replace `const [open, setOpen] = useState(false);` (L200) with:

```ts
// R-25 fixes-2 §3: on the entry page the laptop panel opens by itself the first time this browser sees it.
// Decided once, in the first client render (the guide never renders on the server); the phone sheet never auto-opens.
const [autoOpened] = useState(
  () => seg === "" && readLocal(WELCOME_SEEN_KEY) !== "1" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches,
);
const [open, setOpen] = useState(autoOpened);
// The first close of the auto-opened panel (close button, Escape, a route change, the pill) remembers it was seen.
useEffect(() => {
  if (autoOpened && !open) writeLocal(WELCOME_SEEN_KEY, "1");
}, [autoOpened, open]);
// Escape closes the auto-opened panel even while nothing inside it has focus (SidePanel handles Escape only inside).
useEffect(() => {
  if (!autoOpened || !open) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [autoOpened, open]);
```

- `seg` is computed above L200 already (L181). `readLocal`/`writeLocal` exist (L133-146) and swallow blocked storage.
- The route-change collapse effect (L259-266) initialises `prevRef` with the current values, so it does not fire on
  mount; a later navigation to `/pair` collapses the panel and the effect above writes the flag. Correct.
- No change to `SidePanel`, `Sheet`, `lib/demo/guide.ts`, `first-paint.ts` (CLS polish deliberately skipped: adding
  `b6-panel-open` before paint would leave a 360 px dead margin if the guide chunk ever failed to load; YAGNI).

### 3.3 Tests: `app/demo/JudgeGuide.test.tsx`

Setup: in `beforeEach`, after `vi.stubGlobal("localStorage", …)`, add `window.localStorage.setItem(WELCOME_SEEN_KEY, "1")`
so every existing test keeps its collapsed default (the L130 wide test on `/` would otherwise find no pill). Import
`WELCOME_SEEN_KEY` from `@/app/demo/JudgeGuide`. New `describe("entry auto-open (R-25 fixes-2 §3)")`, each test starts
with `window.localStorage.removeItem(WELCOME_SEEN_KEY)`:

1. wide, `/`, flag unset → `screen.getByRole("complementary", { name: "Judge guide" })` exists, no button named
   /Open the judge guide/, `screen.getByRole("heading", { name: "Welcome, judge" })`, `document.activeElement === document.body`
   (no focus steal), flag still unset.
2. close button → pill is back, `document.activeElement` is the pill, `localStorage.getItem(WELCOME_SEEN_KEY) === "1"`;
   `cleanup()` and `renderGuide()` again (flag kept) → collapsed.
3. flag `"1"` already → collapsed (pill present).
4. phone (`wide = false`), `/`, flag unset → collapsed sheet (`.b6-sheet__body` hidden), flag still unset.
5. wide, `pathname = "/pair"` and `"/sign-in"`, flag unset → collapsed.
6. wide, `/`, auto-open → `fireEvent.keyDown(document.body, { key: "Escape" })` → collapsed, flag `"1"`.
7. wide, `/`, auto-open → `pathname = "/pair"; rerender(...)` → collapsed, flag `"1"`.
8. storage blocked (`vi.stubGlobal("localStorage", { getItem(){ throw new Error("blocked") }, setItem(){ throw new Error("blocked") } })`)
   → wide `/` renders open and closing does not throw.

`lib/demo/guide.test.ts`: unchanged.

### 3.4 Risks

- A judge who narrows the window below 900 px while the panel is auto-open gets the open phone sheet (existing resize
  behaviour for any open guide); one tap outside collapses it.
- CLS on `/` at >= 900 px on the first visit: the body gains `padding-right: 360px` when the guide chunk mounts (content
  shifts left once). Accepted (first visit only; the alternative is riskier, §3.2).

---

## 4. Order, time, gates

1. §2 (band, QA M-001) — 45 min incl. tests. Commit `fix(guide): pill sits in the header band, no top strip (R-25 fixes-2 §2)`.
2. §1.2a + §1.4 tests 1-6 (typing, QA M-002) — 40 min. Commit `fix(pair): a full code field no longer swallows keystrokes; per-keystroke tests (R-25 fixes-2 §1)`.
3. §1.2b + tests 7-8 — 20 min, optional, only if 1-2 are green before 14:30. Commit `fix(pair): adopt digits typed before hydration (R-25 fixes-2 §1.2b)`.
4. §3 (auto-open) — 1-1.5 h, only on Rangga's go. Commit `feat(guide): auto-open on the entry page, first visit per browser (R-25 fixes-2 §3)`.

5. §5.1 M-003 and §5.2 M-004 — 30 min together, after §2 on the same branch (M-003 touches `globals.css` too; sequential, no conflict).

Gates: `npm run lint`, `npm run build`, `npx vitest run` (pre-push hook). **One** tech-lead review of the whole PR
(§1.2a, §2, §3, §5), then QA on web-develop; no extra gate point. QA's list: §2.4 at 1280 / ~2000 px; the "dark line"
re-check in real Chrome at 1280 after the fix (QA §B.3 found none before it; Rangga's ~2000 px capture most likely shows
the window edge, so this is a confirm-absent item, not a defect to chase); the 360 px no-change check; §1 = QA's M-002
repro (Fill in, tap the field, type a digit → the field now reads that digit; Backspace on a full field deletes; paste
still fills) in real Chrome at 390 and 1280 px, plus the human checklist row on a physical phone; §5 items at 360 px.

---

## 5. QA's smaller 360 px items (M-003, M-004, M-005): rulings (tech-lead, 13:10 WIB)

| Id | Ruling | Files | Conflict with the in-flight branch (§1.2a `PairForm.tsx`; §2 `globals.css`, `EntryLanding.tsx`, `WebTopBar.tsx`, `StaffTopBar.tsx`, tests; §3 `JudgeGuide.tsx`) | Time |
|---|---|---|---|---|
| M-003 placeholder clipped to 5 dots at 360 | **Fix now** (§5.1): placeholder-only spacing; digits unchanged | `app/globals.css` (`.b6-codefield::placeholder`, L1114) | same file as §2, different rule: same developer, same branch, commit after §2 | 10 min |
| M-004 supervisor nav: active tab off-screen at 360 | **Fix now** (§5.2): reveal the current item on mount / route change | `app/web/AppNav.tsx`, `app/web/AppNav.test.tsx` | none (§2 touches `WebTopBar.tsx`, not `AppNav`) | 20 min |
| M-005 owner header: DEMO DATA wraps alone to a third row | **Known gap** (post-17:00 P2 batch at the earliest): cosmetic, owner + phone only, 5 px; the fix (§5.3) edits `ShellBar` in `WebTopBar.tsx`, the file §2 is changing right now | `app/web/WebTopBar.tsx`, `app/web/shell.module.css`, `app/web/WebTopBar.test.tsx` | **yes** (`WebTopBar.tsx`): do not start it on the in-flight branch | 15 min, later |

"Reviews" being cut at the right edge at 360 is the overflow cue working as designed (the row scrolls, the 20 px fade
shows more follows); M-004's defect is only that the **current** item can sit off-screen.

### 5.1 M-003: `app/globals.css` (mechanical)

QA's numbers: placeholder "· · · · · ·" = 305 px at 28 px Geist Mono + 10 px letter-spacing + 10 px indent; the field's
content box at 360 is 280 px (312 − 2×16). Keep the digits' spacing (the board's) and tighten only the hint. Extend the
existing rule (no new rule, no media block):

```css
.b6-codefield::placeholder {
  color: var(--b6-faint);
  opacity: 1;
  /* six dots must fit a 280 px content box at 360 (QA M-003): the hint is spaced tighter than the digits */
  letter-spacing: 4px;
  text-indent: 4px;
}
```

(305 − 6×6 − 6 = 263 px < 280.) `letter-spacing` and `text-indent` are allowed on `::placeholder` in Chrome, Safari
and Firefox. Test: if any test reads `.b6-codefield::placeholder` (`grep -rn "codefield" app/ui/*.test.ts*`), extend it
with `letter-spacing: 4px`; otherwise add to `app/ui/Surfaces.test.tsx` next to the existing codefield assertions:
`expect(ruleDeclarations(css, ".b6-codefield::placeholder")["letter-spacing"]).toBe("4px")`. QA re-checks at 360: six
dots visible, centred.

### 5.2 M-004: `app/web/AppNav.tsx` (judgment: small, `developer`)

Reveal the current item when the row mounts or `current` changes, scrolling **only the nav row** (never
`scrollIntoView`, which can also scroll the page vertically):

```ts
// QA M-004: on a phone the row scrolls sideways and the current item can start off-screen (Reviews, Connected devices).
useEffect(() => {
  const nav = ref.current;
  const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
  // Right-align the item with 24 px of air (scroll-padding-inline), clamped; the row's own scrollLeft only.
  nav.scrollLeft = Math.max(0, link.offsetLeft + link.offsetWidth + 24 - nav.clientWidth);
}, [current, variant]);
```

- `ref` is the existing `useOverflowFade` ref on the `<nav>`. Runs after the fade effect; the fade re-evaluates on
  scroll (existing listener), so the cue updates. On the rail (`variant="rail"`, >= 900 px) `scrollWidth <= clientWidth`
  and nothing happens. `revealOnFocus` stays.
- Test (`AppNav.test.tsx`, next to the L95 scroll test): stub `scrollWidth` 554 / `clientWidth` 360 on the nav
  (`Object.defineProperty(nav, "scrollWidth", { value: 554, configurable: true })`, same for `clientWidth`), and
  `offsetLeft` 386 / `offsetWidth` 168 on the "Connected devices" link; render with `current="devices"` → expect
  `nav.scrollLeft` toBe(386 + 168 + 24 − 360 = 218). Second case: `current="day"` with `offsetLeft` 0 → `scrollLeft` 0.
  Third: no overflow (`scrollWidth` 360) → `scrollLeft` stays 0.

### 5.3 M-005 (deferred; written so the later batch is literal)

In `ShellBar` wrap the two chips in one unit so they wrap together or not at all:
`<span className={styles.chips}>{roleChip}{demoChip}</span>` with `.chips { display: inline-flex; flex: none; gap: 8px; align-items: center; }`
in `shell.module.css` (phone and desktop alike; the desktop `.meta` gap 14 px becomes the gap before the unit).
Result at 360: both roles show row 1 brand + controls, row 2 outlet line, row 3 the two chips (126 px, as the supervisor
today). Test: `WebTopBar.test.tsx` — the SUPERVISOR/OWNER chip and the DEMO DATA chip share one parent element.

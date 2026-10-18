# Demo feedback 2 — UI findings (3) and (4): design pass

Tech-lead design pass, Sat 17 Oct ~20:00 WIB. Read against `origin/develop` 09365e6 (worktree `../bee6-fb2`, identical tree).
Source: `docs/internal_testing/demo-feedback-2.md`, findings 3 and 4 (both OPEN). No code was edited.

Clock: code freeze 23:59; QA on the final build still owed; `web-develop` pinned, one PR at a time, each merge needs a
traffic-switch go. Rough budget per PR end-to-end (build → tech-lead review → QA live → merge → switch): finding 3 quick
win ≈ 1 h 15; finding 4 quick win ≈ 2 h 30 with zero slack.

**Recommendation in one line:** do finding 3 (quick win) tonight as PR A; finding 4 is a go/no-go for Rangga — only if PR A is
merged and switched by ~21:30, otherwise defer and leave the one-tap sign-in as a known gap.

---

## Finding 3 — the upload status is hidden under the open guide

### What is what (verified in code)

- **"Upload status"** = `UploadStatusLine` (`app/capture/UploadStatusLine.tsx`, `data-testid="upload-status"`), the one live
  region that says `Uploading` / `Not sent yet · retrying (Nx)` / `Upload succeeded` (+ the amber "Some speech was not
  captured" box with Dismiss). It is rendered in `app/capture/page.tsx` (~L1532) as the **last child** of
  `<main className={css.column}>`, after `StageScreen` (stage orb → h1 → sub → day line → footer with End, the sign-out link,
  the privacy note). Same slot in every mode (idle, running, ended) on purpose (UX-03 §5.7; page-structure tests pin that order).
- **"Draw UI"** = the Judge Guide drawer (`app/demo/JudgeGuide.tsx`). Under 900 px it is `app/ui/Sheet` — `position: fixed`,
  `z-index: var(--b6-z-overlay)`, body `max-height: 70dvh` when open, collapsed to a 96 px handle whose space the page reserves
  (`SHEET_RESERVE_PX`). From 900 px it is `app/ui/SidePanel` (fixed 360 px right); the body gets
  `padding-right: var(--b6-panel-w)` and capture's `<main>` is inset left (`drawer-layout.ts`), so **nothing is covered on a
  laptop**. The defect is phone-only: on 360 × 640 the open sheet covers ≈ 450 px of the 640, leaving only the top bar and a
  slice of the orb visible; the upload line is at the very bottom, under the sheet (and under End — End being covered is
  already accepted: `collapseOnOutsidePointerDown` lets the tap through).
- **Where the scenario waits:** `ScriptCard` in `JudgeGuide.tsx` keeps "I have spoken this · next card" disabled until
  `linesSinceCardShown >= 1` (`cardState` in `lib/demo/guide.ts`; the count comes from the page's `linesThisSession`, i.e. a
  server-accepted segment). While locked the card shows `C-journey-waiting-hear` ("Waiting for Bee6 to hear this card…") and,
  **only when `uploadBusy`** (`headFailedAttempts > 0`), `C-journey-catching-up`. A normal in-flight upload (queued, no failure)
  shows nothing in the card. So a judge reading the card sees "Waiting…" with no sign that an upload is running — the page
  says "Uploading" but it is under the sheet. That is exactly the confusion Rangga reports.

### Quick win (recommended tonight) — move the block above the orb on the sandbox screen

Put the upload block in the **top slot** of the sandbox column (right under the staff top bar, above the stage), so it is
inside the ~190 px that stay visible when the sheet is open at 360 × 640. The pilot keeps its current bottom placement
(UX-03 §5.7 "second line under the capture banner"; pilot structure untouched).

Files:
- `app/capture/page.tsx` — extract the existing `<UploadStatusLine … />` JSX (L1532–1545) into a local `renderUploadBlock()`;
  render it in two mutually exclusive slots: `{modern ? renderUploadBlock() : null}` placed **right after the `b6-sr-only`
  headline status `<p>` (L1485–1496) and before `{view === "loading" …}`**, and `{modern ? null : renderUploadBlock()}` in the
  current bottom slot. Note on the "no remount when config arrives" comment at L1430: `modern` flips false → true exactly
  once, at first config load, before any session exists, so the one remount is empty and harmless; after that `sandbox`
  never changes (config refreshes keep `demo_session`). Keep the `key` implicit; do not wrap in extra elements.
- `app/capture/capture.module.css` — no change required (`.upload` has `margin: 12px auto 0`, which reads fine under the top
  bar). Do **not** touch `app/globals.css` (no new `@media` blocks; `SidePanel`/`Surfaces`/`AppNav`/`shell-css` tests index the
  existing `@media (min-width: 900px)` blocks by position).
- No change to `UploadStatusLine.tsx`, `StageScreen.tsx`, `drawer-layout.ts`, `JudgeGuide.tsx`.

Tests:
- `app/capture/page-structure.test.tsx` — the three `inOrder(...)` assertions (L97 idle, L123, L160 running) move `upload` to
  directly after `header` (sandbox only). Add one test: "sandbox: the upload block sits between the top bar and the stage".
- `app/capture/page-copy.test.tsx` L135 ("upload block in the DOM in every mode") stays as is.
- `app/capture/page.test.tsx` — pilot assertions unchanged (verify none asserts sandbox bottom placement; grep `upload-status`).

Risks: 360 × 640 already scrolls slightly in the running view (top bar + 212 px stage + head + End + sign-out + note + 96 px
reserve ≈ 660 px); the block adds ~22 px (uploading row) or ~110 px when the amber lost box is up. End is still never covered
when scrolled to the bottom (the reserve). Visual-only risk; QA checks it on a real 360-wide viewport, sheet collapsed and
open. Hard rules: none touched (presentation only; no new data on screen).

Estimate: build 30 min (developer-junior, mechanical), review 15, QA live 20, merge + switch 15.

### Ultimate (defer) — also tell the judge inside the card

Publish the upload phase through the capture bridge and show one mono line in the script card while it is locked.
- `app/demo/guide-bridge.ts` — `CaptureBridge.state` gains `uploadPhase: "idle" | "uploading" | "retrying" | "succeeded"` (a
  phase only; still no transcript/audio/name in the bridge — the bridge's own rule).
- `app/capture/page.tsx` L736 — publish `uploadPhase: deriveUploadView(status)?.phase ?? "idle"`; add to the effect deps.
- `app/demo/JudgeGuide.tsx` `ScriptCard` — under `C-journey-waiting-hear`, when `!live.canMarkSpoken && uploadPhase === "uploading"`
  show new key `C-journey-uploading`; when `"succeeded"` and still locked show `C-journey-uploaded-listening`.
- `lib/i18n/v2/journey.ts` — EN: "Uploading what you said…" / "Upload done. Bee6 is listening for a work line — read the card
  again if nothing happens." ID (provisional): "Mengunggah ucapan Anda…" / "Unggahan selesai. Bee6 menunggu satu kalimat kerja —
  baca kartunya lagi jika tidak ada yang berubah."
- Tests: `page.test.tsx` L930/L965/L981 `toMatchObject` on the bridge gain the field; `guide-bridge.test.ts` type fixture;
  `JudgeGuide.test.tsx` two cases (line shown only while locked; not shown when `uploadBusy` says catching up).
Estimate ≈ 1 h 45 end-to-end. Worth it, but it is the second PR behind finding 4 if 4 goes ahead; otherwise after the freeze
is irrelevant — so: only if PR A merges early and Rangga prefers it over finding 4.

Should the guide card itself mention the upload wait? Yes — that is the ultimate above; the quick win alone already makes
"Uploading" visible next to the card, which is what the feedback asks for.

---

## Finding 4 — "Open Supervisor view": no tabs, credentials printed in the Judge Guide (REVISED after Rangga's decision)

**Rangga decided (Sat 17 Oct, evening):** keep the manual sign-in (the judge types the email and password; **no auto-start,
no `autoStart` prop**), drop the Staff/Supervisor/Owner radio group on the `?as=supervisor|owner` path, and **print the literal
demo email and password in the Judge Guide drawer** as a selectable card. The manual path for real (internal/QA) accounts stays.
The earlier "auto-start" quick win and its Q1–Q4 are superseded by this section. Read against `origin/develop` 09365e6.

### What happens today (verified, unchanged)

`/` (`app/web/EntryLanding.tsx`) links Supervisor → `/sign-in?as=supervisor`, Owner → `/sign-in?as=owner`. `app/sign-in/page.tsx`
reads `DEMO_MODE` and `?as`; `RoleSignIn.tsx` renders the radio group ("tabs") and, on demo, wraps the panel in `DemoAccess` (lazy
`next/dynamic`), whose box prints the email/password with "Fill in" and hands the form `interceptEmail`. The judge guide
(`app/demo/JudgeGuide.tsx`, mounted by the root layout on demo only) reads **only `usePathname()`**: on `/sign-in` it shows the
`entry` card ("Welcome, judge"), whatever `?as` says. The guide's auto-open at ≥ 900 px is **initial state on `/` only**
(`autoOpened`, `WELCOME_SEEN_KEY`); `SidePanel` moves focus to its close button whenever `open` flips true later
(`app/ui/SidePanel.tsx` L37-39), which is why the guide must **not** be opened programmatically on the sign-in page (it would steal
focus from the email field).

### Decisions (tech-lead; Rangga may overrule the ones marked ⚑)

- **D1 — `?as=supervisor|owner` on demo ("solo" mode):** no radio group; the page shows the "Sign in" h1, a kicker
  "Sign in as Supervisor/Owner", the reduced demo box (D3), and the email form. The role is fixed to `initialRole`; `chooseRole` is
  never reachable. Submitting the demo credential takes the existing `interceptEmail` → `startOrSwitch(role)` path, unchanged
  (the **credential** still decides the role: typing the owner credential on the supervisor page opens an owner sandbox, as
  today — the server contract, caps and expiry are untouched). Anything else signs in for real (QA accounts).
- **D2 ⚑ — bare `/sign-in` (where web Sign out lands) and `?as=staff` keep today's tabs tonight.** Reasons: (1) Sign out
  (`app/web/SignOutButton.tsx` → `router.replace("/sign-in")`) and the 401→refresh→401 expiry cycle land there and the judge needs
  *some* chooser; (2) the "Your demo session has ended" line lives on `/sign-in` only (finding 1 removed it from `/pair`; the
  DemoBar is hidden on `/sign-in` because the box carries it) — redirecting bare `/sign-in` to `/` would lose it; (3) the entry
  card's footnote "To change role later: sign out, then pick a role again" matches tabs. Picking the Supervisor/Owner tab there
  still shows the matching guide card (D4), so the credentials are reachable from the tabs too. Redirect-to-`/` stays the ultimate.
- **D3 — the on-page box is reduced, not removed.** `DemoAccess` (non-bare) keeps the "Demo access" card with: one new pointer line
  "Your demo email and password are in the Judge Guide.", the private-copy line, the "continuing until HH:MM" line and the
  `role="status"` line (busy / refusal / ended). The email, password rows and the on-page **Fill in** button go. Rationale for
  keeping a one-liner: on a phone the sheet is collapsed and on a laptop the pill is collapsed on `/sign-in` (and we cannot auto-open
  it — focus, above); without a pointer a judge who never opened the guide would see a blank form.
- **D4 — how the guide knows the role: a sign-in bridge, not `useSearchParams`.** Same pattern as the pair bridge
  (`app/demo/guide-bridge.ts`): `DemoAccess` publishes the panel's current `role` on mount/change and clears it on unmount; the guide
  subscribes and `guideKeyFor("/sign-in", { kind: "sign_in", role })` returns `sign_in_supervisor` / `sign_in_owner` (or `entry` for
  staff/null). Why not the URL: on bare `/sign-in` the role comes from the tab, not `?as`; `RoleSignIn` itself may not import demo
  code (pilot isolation), but `DemoAccess` is demo-only and already knows `role`. Nothing in the bridge is a credential: a role word.
- **D5 — the credential card** is a normal guide card with `{email}` / `{password}` placeholders in `lib/demo/guide.ts` (same rule as
  `{code}`: the literal never sits in copy; `JudgeGuide` fills it from `lib/demo/credentials.ts`, which it already imports). The
  filled values render as `<b class="cred">` (mono, `user-select: all`, wraps) so one tap selects the whole value.
- **D6 — "Fill in" from the drawer (cheap, included as the last slice; cut first if time runs out).** The pair card already does
  exactly this through the DOM (`FillCode`: native value setter + `input` event on `#pairing-code`). The email form's inputs are
  `#signin-email` / `#signin-password` (controlled, `onChange`), so a `FillCredentials` control is a 30-line copy. It collapses the
  sheet after filling (like the pair card) so the Sign in button is reachable on a phone. If the inputs are not in the DOM (auth
  still `loading`, or an already-signed-in user about to be redirected) the tap does nothing.
- **D7 — stage/chrome:** the two sign-in cards are "welcome" cards: DEMO chip and the "Welcome" label, like `entry` (not a
  stage number). The `entry` card gains one body sentence telling the judge where the credentials are (this is what the panel shows
  at ≥ 900 px where it auto-opens on `/`): "Supervisor and Owner sign in with the email and password this guide shows on the
  sign-in page." No auto-open anywhere on `/sign-in` (focus, above); on the phone the collapsed handle reads "Supervisor email and
  password" so the judge knows to tap.
- **D8 — no server change, no new route, no new storage.** Hard rules: §2.6 untouched (same `/sign-in`, same API); §2.8 fine
  (the credentials were already public on the box; they move to the drawer); pilot purity: `RoleSignIn`, `page.tsx`,
  `SignInScreen` still import no demo code statically; `lib/demo/credentials` importers stay exactly `DemoAccess` + `JudgeGuide`.

### Exact changes (developer, sonnet — slices A–C; slice D optional)

**Slice A — sign-in page (mechanical)**

1. `app/sign-in/RoleSignIn.tsx`
   - Add `const solo = demo && (initialRole === "supervisor" || initialRole === "owner");` after the state hooks.
   - In the JSX: render the `<fieldset>` radio group only when `!solo`. When `solo`, render instead, right under the heading:
     `<p className="b6-kick">{t(lang, "C-signin-solo", { role: t(lang, ROLE_KEY[initialRole]) })}</p>` (initialRole is narrowed by
     `solo`; use a local `const soloRole = solo ? initialRole : null`).
   - Remove `fill`, `codeFill`, the `onFill={fill}` prop, the `key={codeFill.nonce}` and `initialCode={codeFill.code}` on `PairForm`
     (the guide's Fill in works through the DOM, D6). Keep `emailFields` (the form needs it). Update the header comment (one line:
     "solo mode hides the radio group on the demo web-role path").
2. `app/sign-in/panel-hooks.ts` — delete `DemoFill` and the `onFill` prop from `DemoAccessProps`. Comment: "Fill in moved to the
   judge guide (demo feedback 2, finding 4)".
3. `app/pair/PairScreen.tsx` L65 — drop `onFill={() => {}}`.
4. `app/demo/DemoAccess.tsx`
   - Remove `DEMO_EMAILS`, `DEMO_PASSWORD` imports (keep `matchDemoCredential`), `fillFor`, `filledFor`, `fillIn`, the `filledFor`
     status branch and the `role !== "staff"` block (email/password rows + Fill in). Remove `VALUE_STYLE`, `ROW_STYLE` if unused.
   - Add, in the non-bare card after the title: `<p style={PARAGRAPH_STYLE}>{t(lang, "C-demo-cred-in-guide")}</p>` then the
     existing private line, continuing line, status line.
   - Add the bridge publish at the top of the component (both bare and non-bare paths):
     `useEffect(() => publishSignInRole(role), [role]);` (import `publishSignInRole` from `@/app/demo/guide-bridge`; the function
     returns its cleanup, see slice B).
   - Update the header comment: the box no longer prints credentials; the guide does.
5. `lib/i18n/dict.ts` — two new base keys, both languages:
   - `C-signin-solo`: EN `"Sign in as {role}"`, ID `"Masuk sebagai {role}"` (PROVISIONAL).
   - `C-demo-cred-in-guide`: EN `"Your demo email and password are in the Judge Guide."`, ID
     `"Email dan kata sandi demo Anda ada di Panduan Juri."` (PROVISIONAL).
   - Leave `C-demo-cred-email/password/fill/filled` in place (unused now; `dict-demo.test.ts` still lists them) — note as leftover.

**Slice B — guide model + bridge + rendering (judgement: developer, sonnet)**

6. `lib/demo/guide.ts`
   - `GUIDE_KEYS`: add `"sign_in_supervisor"`, `"sign_in_owner"` after `"entry"`.
   - `GuideActionSchema`: add `z.object({ kind: z.literal("fill_demo_credentials") }).strict()` with the comment
     `/** sign-in: "Fill in the form" puts the demo email and password into the page's fields (does not submit). */`.
   - New exported types next to `PairGuideState`:
     `export type SignInGuideRole = "staff" | "supervisor" | "owner";`
     `export interface SignInGuideState { kind: "sign_in"; /** The panel's role as DemoAccess publishes it; null before it mounts. */ role: SignInGuideRole | null; }`
     and `GuideState = CaptureGuideState | WebGuideState | PairGuideState | SignInGuideState`.
   - `guideKeyFor`: replace `if (seg === "sign-in") return "entry";` with
     ```ts
     if (seg === "sign-in") {
       const role = state?.kind === "sign_in" ? state.role : null;
       return role === "supervisor" ? "sign_in_supervisor" : role === "owner" ? "sign_in_owner" : "entry";
     }
     ```
   - `GUIDE` cards (EN final, ID PROVISIONAL). The Bahasa column of every line must differ from the EN (test UI-009), hence one
     combined line, not "Email: {email}" twice:
     ```ts
     sign_in_supervisor: card({
       title: bi("Sign in as Supervisor", "Masuk sebagai Supervisor"),
       handle: bi("Supervisor email and password", "Email dan kata sandi Supervisor"),
       kicker: bi("SIGN IN AS SUPERVISOR", "MASUK SEBAGAI SUPERVISOR"),
       body: [
         bi("Type these into the form, then tap Sign in.", "Ketik ini ke formulir, lalu ketuk Masuk."),
         bi("Email **{email}** · password **{password}**", "Email **{email}** · kata sandi **{password}**"),
         bi("This opens your own private copy of a fictional shop for 2 hours.", "Ini membuka salinan pribadi toko fiktif Anda selama 2 jam."),
       ],
       action: { kind: "fill_demo_credentials" },
       footnote: bi("To change role later: sign out, then pick a role again.", "Untuk berganti peran nanti: keluar, lalu pilih peran lagi."),
     }),
     sign_in_owner: /* identical with Owner / Pemilik: title "Sign in as Owner"/"Masuk sebagai Pemilik", handle "Owner email and password"/"Email dan kata sandi Pemilik", kicker "SIGN IN AS OWNER"/"MASUK SEBAGAI PEMILIK" */
     ```
   - `entry` card body: append a second `bi(...)`: EN "Supervisor and Owner sign in with the email and password this guide shows
     on the sign-in page.", ID "Supervisor dan Pemilik masuk dengan email dan kata sandi yang ditampilkan panduan ini di halaman
     masuk." (body max is 4; this makes 2). Footnote unchanged (pinned by a test).
   - Header comment: add `{email}`/`{password}` to the placeholder list ("rendered from lib/demo/credentials by the component").
7. `app/demo/guide-bridge.ts` — append a sign-in bridge, a copy of the pair bridge (module flag, listeners, hook); **no new import
   except** `import type { ..., SignInGuideRole } from "@/lib/demo/guide";` (that module is already on the bridge's allowed list):
   ```ts
   // ── the sign-in bridge (demo feedback 2, finding 4) ──
   // DemoAccess tells the guide which role panel the sign-in page shows, so the guide prints that role's demo email and
   // password. A role word only; never a credential. `publishSignInRole(role)` returns the cleanup that clears it.
   let signInRole: SignInGuideRole | null = null;
   const signInListeners = new Set<() => void>();
   function setSignInRole(next: SignInGuideRole | null): void { if (signInRole === next) return; signInRole = next; for (const l of [...signInListeners]) l(); }
   export function publishSignInRole(role: SignInGuideRole): () => void { setSignInRole(role); return () => setSignInRole(null); }
   export function clearSignInRole(): void { setSignInRole(null); }
   export function readSignInRole(): SignInGuideRole | null { return signInRole; }
   export function subscribeSignInBridge(onChange: () => void): () => void { signInListeners.add(onChange); return () => void signInListeners.delete(onChange); }
   /** The sign-in panel's role while DemoAccess is mounted; null otherwise and on the server. */
   export function useSignInBridge(): SignInGuideRole | null { return useSyncExternalStore(subscribeSignInBridge, readSignInRole, () => null); }
   ```
8. `app/demo/JudgeGuide.tsx`
   - Imports: `DEMO_EMAILS, DEMO_PASSWORD` from `@/lib/demo/credentials` (next to `DEMO_STAFF_CODE`); `clearSignInRole, useSignInBridge`
     from the bridge.
   - In `JudgeGuide`: `const isSignIn = seg === "sign-in"; const signInRole = useSignInBridge();` and, like the pair clear,
     `useEffect(() => { if (!isSignIn) clearSignInRole(); }, [isSignIn]);`.
   - `state`: insert before the `isPair` branch: `: isSignIn ? { kind: "sign_in", role: signInRole }`.
   - `const welcome = key === "entry" || key === "sign_in_supervisor" || key === "sign_in_owner";` and use `welcome` where
     `key === "entry"` picks `chipText` and `stageLabel` (two places, ~L313-315).
   - **Do not** add `signInRole` to `pageSig`: the role publish must update the open card in place, never collapse it.
   - `rich(text, strong?, boldClass?)`: `<b key={i} className={boldClass}>`. In `GuideCardView`:
     ```ts
     const creds = guideKey === "sign_in_supervisor" ? { email: DEMO_EMAILS.supervisor, password: DEMO_PASSWORD }
                 : guideKey === "sign_in_owner" ? { email: DEMO_EMAILS.owner, password: DEMO_PASSWORD } : {};
     const vars = { day: day ?? 1, next: (day ?? 1) + 1, ...creds };
     ```
     and pass `boldClass={creds.email ? styles.cred : undefined}` for body lines.
   - `{action?.kind === "fill_demo_credentials" ? <FillCredentials lang={lang} onFilled={onFilled} /> : null}` (slice D; until D
     lands, render nothing for this action — the schema already allows it).
9. `app/demo/guide.module.css` — add `.cred { font-family: var(--b6-font-mono); font-weight: 600; user-select: all; overflow-wrap: anywhere; }`.

**Slice C — tests (listed below). Slice D — `FillCredentials` (optional, 30 lines)**

10. `app/demo/JudgeGuide.tsx` — `FillCredentials({ lang, onFilled })`, a copy of `FillCode`: for `#signin-email` → `DEMO_EMAILS[role]`
    and `#signin-password` → `DEMO_PASSWORD` (pass `role` as a prop), native setter + `input` event each; if either input is missing
    return without changing state. Label `C-journey-fill-credentials`; after filling, label `C-journey-filled-short` and disabled;
    SR status `C-journey-filled-signin`; call `onFilled()` (collapses the sheet).
11. `lib/i18n/v2/journey.ts` — `C-journey-fill-credentials`: EN `"Fill in the form"`, ID `"Isi formulirnya"`;
    `C-journey-filled-signin`: EN `"Filled in. Tap Sign in."`, ID `"Sudah terisi. Ketuk Masuk."` (both PROVISIONAL; same placeholders
    in both languages — none).

### Copy summary (EN final / ID provisional)

| key / card | EN | ID |
|---|---|---|
| `C-signin-solo` | Sign in as {role} | Masuk sebagai {role} |
| `C-demo-cred-in-guide` | Your demo email and password are in the Judge Guide. | Email dan kata sandi demo Anda ada di Panduan Juri. |
| sign_in_* title | Sign in as Supervisor / Owner | Masuk sebagai Supervisor / Pemilik |
| sign_in_* handle | Supervisor email and password | Email dan kata sandi Supervisor |
| sign_in_* kicker | SIGN IN AS SUPERVISOR | MASUK SEBAGAI SUPERVISOR |
| sign_in_* body 1 | Type these into the form, then tap Sign in. | Ketik ini ke formulir, lalu ketuk Masuk. |
| sign_in_* body 2 | Email **{email}** · password **{password}** | Email **{email}** · kata sandi **{password}** |
| sign_in_* body 3 | This opens your own private copy of a fictional shop for 2 hours. | Ini membuka salinan pribadi toko fiktif Anda selama 2 jam. |
| entry body 2 | Supervisor and Owner sign in with the email and password this guide shows on the sign-in page. | Supervisor dan Pemilik masuk dengan email dan kata sandi yang ditampilkan panduan ini di halaman masuk. |
| `C-journey-fill-credentials` (D) | Fill in the form | Isi formulirnya |
| `C-journey-filled-signin` (D) | Filled in. Tap Sign in. | Sudah terisi. Ketuk Masuk. |

### Tests (exact)

- `app/sign-in/RoleSignIn.test.tsx`, demo describe:
  - CHANGE "shows the demo access box for the chosen role…" → "the box never prints a credential and has no Fill in; it points at the
    Judge Guide" (render staff, supervisor, owner; assert `queryByText(/judge@example\.com/)` null, `queryByText("bee6-demo")` null,
    no "Fill in" button, text contains "in the Judge Guide").
  - DELETE "Fill in puts the credential into the panel's fields…".
  - CHANGE "the demo box is in Bahasa too" → assert "Akses demo" and "Panduan Juri", no "Isi otomatis".
  - ADD "demo + initialRole supervisor: no radio group, the kicker says Sign in as Supervisor, the email form is there"
    (`queryAllByRole("radio")` length 0; `getByText("Sign in as Supervisor")`; `getByLabelText("Email")`).
  - ADD "demo + initialRole owner: same, Sign in as Owner".
  - ADD "demo + initialRole staff and demo + null keep the three radios" (`getAllByRole("radio")` length 3).
  - ADD "solo supervisor: the typed demo credential still opens the demo (startOrSwitch once, role from the credential), and a real
    account still goes to Firebase" (reuse `submitEmail`).
  - KEEP 13.T3/T4/T5/E3/E4, "anything else signs in for real", refusal, axe (axe loop: add `initialRole` solo cases), Bahasa.
  - Pilot describe: ADD "pilot + initialRole supervisor still renders the three radios (solo is demo-only)".
- `app/demo/DemoAccess.test.tsx`: DELETE "the credentials are selectable text in one tap"; CHANGE the first test (staff: no code) to
  assert for all three roles no credential text and the pointer line; ADD "publishes the panel's role to the guide bridge while
  mounted and clears it on unmount / on role change" (read `readSignInRole()`); Bahasa test → "Panduan Juri"; axe stays.
- `app/demo/guide-bridge.signin.test.tsx` (new, copy of `guide-bridge.pair.test.tsx`): `useSignInBridge` null → role while
  published → null after cleanup; `clearSignInRole` drops it.
- `lib/demo/guide.test.ts`: the actions test L62 adds `sign_in_supervisor`/`sign_in_owner` → `fill_demo_credentials`; the facts
  test L74 adds `expect(JSON.stringify(GUIDE)).not.toMatch(/judge@example|bee6-demo/)` and `toContain("{email}")`/`"{password}"`
  for both cards; handles table L205 and kickers table L223 gain the two keys; `guideKeyFor` L328: `/sign-in` with
  `{kind:"sign_in", role:"supervisor"}` → `sign_in_supervisor`, owner → `sign_in_owner`, staff/null/no state → `entry`;
  reachability L401 adds the two calls; the entry test keeps `/20 minutes/` and the footnote.
- `app/demo/JudgeGuide.test.tsx`: ADD describe "sign-in card": `pathname="/sign-in"`, `act(() => publishSignInRole("supervisor"))`
  → handle text "Supervisor email and password"; open → `getByText("supervisor.judge@example.com", { selector: "b" })` and
  `"bee6-demo"` bold with class `cred`; chip says DEMO, label "Welcome"; publishing "owner" swaps to the owner email **without
  collapsing** the open sheet; publishing "staff" / cleanup → entry card; wide + `/sign-in` stays collapsed (existing
  `it.each(["/pair","/sign-in"])` keeps passing); axe on the open card. Slice D: render `<EmailSignInForm>` harness (or two inputs with
  those ids) + guide, click "Fill in the form" → values set, `fetch`/Firebase not called, control reads "Filled in" disabled, sheet
  collapsed; with no inputs in the DOM the click changes nothing.
- `lib/i18n/dict-demo.test.ts`: add the two base keys to `DEMO_CRED_KEYS` (the "never carries a credential value" check then
  covers them). `lib/i18n/v2/v2.test.ts` covers the journey keys automatically.
- `app/demo/import-boundaries.test.ts` and `scripts/private-boundary.test.ts`: no edits; must stay green (credential importers
  still exactly `DemoAccess` + `JudgeGuide`; no literal outside `credentials.ts`/`pairing.ts`; `RoleSignIn`/`PairScreen` still
  dynamic-only; bridge imports still on the allowed list).
- `app/sign-in/page.test.tsx`, `app/web/EntryLanding.test.tsx` L114 ("never shows the credentials"): unchanged.

### Risks

- Medium test churn in `RoleSignIn.test.tsx` (~6 cases) and `DemoAccess.test.tsx` (~4). No logic change on the sign-in path itself.
- Discoverability on a laptop: the pill is collapsed on `/sign-in` (we must not auto-open it — `SidePanel` would steal focus from
  the email field); the on-page pointer line is the bridge. QA must confirm a first-time judge finds the pill from that line.
- Phone 360 px: the open sheet covers the form; "Fill in the form" collapses it (D6), and a judge who reads instead of filling must
  collapse the sheet to type — same as the pair card today (R-21 D7).
- The guide is lazy (`ssr:false`) and `DemoAccess` is lazy too: the card may show `entry` for a frame before the role publishes — in
  place update, no flicker of the sheet state.
- Hard rules: none touched (D8).

### Dependency on PR A (finding 3) and merge order

**None.** PR A (`fix/demo-feedback-2-upload-status`, worktree `bee6/bee6-fb3`) touches `app/capture/page.tsx` and
`app/capture/page-structure.test.tsx` only; finding 4 touches none of those files (list below). Cut `fix/demo-feedback-2-signin-guide`
from `origin/develop`; merge in either order; a rebase after PR A is file-disjoint. Only the deploy sequencing (one traffic switch
at a time on `web-develop`) orders them, not the code.

### Exact file list

Edit: `app/sign-in/RoleSignIn.tsx` · `app/sign-in/panel-hooks.ts` · `app/pair/PairScreen.tsx` · `app/demo/DemoAccess.tsx` ·
`app/demo/guide-bridge.ts` · `app/demo/JudgeGuide.tsx` · `app/demo/guide.module.css` · `lib/demo/guide.ts` · `lib/i18n/dict.ts` ·
`lib/i18n/v2/journey.ts` (slice D) · tests: `app/sign-in/RoleSignIn.test.tsx` · `app/demo/DemoAccess.test.tsx` ·
`app/demo/JudgeGuide.test.tsx` · `lib/demo/guide.test.ts` · `lib/i18n/dict-demo.test.ts` · new `app/demo/guide-bridge.signin.test.tsx`.
Untouched on purpose: `app/sign-in/page.tsx`, `SignInScreen.tsx`, `EmailSignInForm.tsx`, `EntryLanding.tsx`, `SignOutButton.tsx`,
`app/capture/**`, every server/API file.

### Estimate

Build 60–75 min (developer, sonnet; slices A→B→C, D last and droppable) · tech-lead review 20 · QA live 25 · merge + traffic switch 15
≈ 2 h 15 end-to-end.

### Dev brief (paste to `developer`, sonnet)

> Branch `fix/demo-feedback-2-signin-guide` from `origin/develop`. Skills: `react-patterns`, `react-testing`, `frontend-a11y`.
> Follow `docs/tasks/demo-feedback-2-ui.md` → Finding 4 → "Exact changes" literally, slices A, B, C, then D if under 60 min.
> Rules: no auto-start, no `autoStart` prop, no `useSearchParams`; the guide never opens itself on `/sign-in`; the credential
> literals appear only in `lib/demo/credentials.ts` (the card uses `{email}`/`{password}`, filled in `JudgeGuide`); `RoleSignIn`,
> `panel-hooks`, `PairScreen`, `page.tsx`, `SignInScreen` import no demo code statically; `guide-bridge.ts` gains no import beyond
> `type { SignInGuideRole } from "@/lib/demo/guide"`. Do not add `signInRole` to the guide's `pageSig`. Run `npx vitest run
> app/sign-in app/demo lib/demo lib/i18n scripts/private-boundary.test.ts`, then lint + typecheck. Commits: `feat(demo): solo sign-in
> for web roles, credentials in the judge guide` (A+B), `test(demo): …` (C), `feat(demo): fill-in from the guide` (D). Flag any gap
> instead of improvising.

### Ultimate (defer, post-freeze)

- Bare `/sign-in` on demo redirects to `/` (keep the ended-session line by moving it to the entry page first).
- Drop the unused `C-demo-cred-email/password/fill/filled` keys and the `?as` radio sync from the demo path.

---

## Questions Rangga must answer

**Finding 3**
- Q0. Go for the quick win as PR A now? (My answer: yes; junior-mechanical.)

**Finding 4 (revised; Q1–Q4 of the earlier version are closed by Rangga's decision)**
- Q5 ⚑ (D2). Bare `/sign-in` and `?as=staff` keep today's three tabs tonight (recommended; the ended-session line and Sign out
  need a chooser there). Say so if you want the redirect-to-`/` instead — it costs the ended line and ~30 min more.
- Q6 ⚑ (D3). Keep the one-line on-page pointer "Your demo email and password are in the Judge Guide." (recommended, since the
  guide cannot open itself on `/sign-in` without stealing focus)? Or remove every on-page hint and rely on the handle/pill alone?
- Q7 (D6). Slice D "Fill in the form" from the drawer: include if under 60 min of build (recommended), or skip outright?

# QA: mobile-layout accuracy, /pair manual typing and the top gap (17 Oct, QA, Fable)

Status: DONE 17 Oct 13:10 WIB. Verdict **DO-NOT-SHIP** (M-001 major reproduced; M-002..M-005 minor reproduced). The reported typing bug did not reproduce in any method; the only matching behaviour is M-002 (full field swallows input).

- App under test: https://web-develop-33uzb53tza-et.a.run.app (staging, `DEMO_MODE=true`, revision `web-develop-00039-ql4` = develop `5d514bb`). The R25-004 guide fix is not live there and is ignored here.
- Read-only comparison: https://web-33uzb53tza-et.a.run.app (main `web`, pre-R-25 build). No sandbox was created on either deployment during this run: the code field was typed into but never submitted on `web`; on staging every signed-in check reused the seeded `sbx-uitest*` sandboxes (`scratchpad/seed-run2.txt`, keys never printed).
- Design source: page-2 boards, local copy `<LOCAL_PATH>/boards/project/`. Boards were rendered statically with headless Chromium from `file://` (their `support.js` runtime is absent, so `{{ code }}` bindings and `sc-if` branches all paint at once; px geometry, tokens and copy are still exact). Every board comparison below is "from source, board rendered statically".
- Tools: Playwright 1.64 headless Chromium (360x780 @2x, `isMobile` + `hasTouch`; 1280x800; 1920x1000) for the repeatable checks; the Claude in Chrome extension (real Chrome profile, window resized to 390 and 1280 px wide) for the interactive typing checks. Scripts and screenshots: `<LOCAL_PATH>/m/` (`type.mjs`, `inputs.mjs`, `gap.mjs`, `mobile.mjs`, `board.mjs`; `gap-*.png`, `m-*.png`, `*-type-*.png`, `boards/*.png`).
- Code read from the throwaway worktree of `origin/develop` (`.../scratchpad/wt-develop`, `85e4dc1` = `5d514bb` + the guide fix), never the shared checkout.
- QA gap owned: earlier QA rounds only ever used the guide's "Fill in 000000" button on `/pair`; manual typing into the code field had never been exercised before this run.

## A. /pair 6-digit code field: manual typing

### A.1 Result: typing works in every method tried; no console errors

Field DOM on staging (`app/pair/PairForm.tsx`): `input#pairing-code` `type=text` `inputmode=numeric` `autocomplete=one-time-code` `pattern=[0-9]*` `maxlength=6` `placeholder="· · · · · ·"` `required`, classes `b6-codefield pair-module__input`, 312x64 px at x=24 y=271 (360 viewport), `pointer-events:auto`, `user-select:auto`, `-webkit-text-fill-color` = ink, `readOnly` only while submitting, never `disabled`. `document.elementFromPoint` at the field's centre returns the input itself (nothing overlays it). The value is React-controlled (`value={code}`, `onChange` -> `digitsOnly(event.target.value)` = strip non-digits, cut to 6); it is not reset on a keystroke. `onPaste` strips spaces and fills.

| Method (360x780 mobile emulation, touch) | Guide closed | Guide sheet open | main `web` (pre-R-25) |
|---|---|---|---|
| Real touch tap on the field, then `keyboard.type('123456', delay 120)` | `123456`, Set up enabled | same | same |
| `Backspace` x2 | `1234`, Set up disabled | same | same |
| `press Digit7`, `press Digit8` | `123478` | same | same |
| `page.fill('654321')` | `654321` | same | same |
| `keyboard.insertText('112233')` (IME / autofill-like) | `112233` | same | same |
| Paste `"123 456"` (ClipboardEvent + DataTransfer) | `123456` | same | `""` (old maxLength cut; not a staging issue) |
| Type `12ab34567` | `123456` (letters and 7th digit dropped) | same | same |
| Native value setter + `input` event (what the guide's Fill in does) | `999999` | same | same |
| `touchscreen.tap(x, y)` at the field centre, then type `135791` | focus lands, `135791` | same | same |
| Console / page errors during all of the above | none | none | none |

Real Chrome (extension; window 390 px wide, then 606 px after a navigation): click the field, `type "12"`, `key "3 4"` -> `1234`; `Backspace`, `type 789` -> `123789`; guide sheet open, `cmd+a`, `type 555555` -> `555555`; after Fill in (field `000000`) `cmd+a Backspace`, `type 12` -> `12`. Fill in on an empty field -> `000000` and Set up enabled; Fill in while the field held `12` -> `000000`; Fill in while the field held `555555` -> `000000`, button becomes "Filled in ✓" (disabled).

Other inputs (Playwright 360, real key events): `/sign-in` staff panel `#pairing-code` -> `123456` ok; `/sign-in?as=supervisor` and `?as=owner` `#signin-email` (`type=email`) and `#signin-password` type and backspace correctly. Entry `/` has no inputs.

### A.2 The one way the symptom reproduces: the field is already full

`maxlength=6` silently swallows every keystroke once six digits are present. Reproduced in real Chrome: tap "Fill in 000000" (field `000000`), tap the field (the caret lands mid-string, e.g. position 3), type `1` -> value stays `000000`, no feedback of any kind. Same after typing six digits by hand. The user must delete a digit or select-all first. This is the most likely reading of "the field cannot capture my input when I type manually" if the field had been filled (by Fill in, or by a previous attempt) before typing. Logged as **M-002**.

Unreproduced observation (recorded for honesty): on the very first real-Chrome attempt, clicking "Fill in 000000" while the field held `555555` collapsed the sheet but left `555555`. Two clean retries (field `12`, field `555555`, both fresh loads) gave `000000` and "Filled in ✓". The first click most likely landed on the sheet handle rather than the button; not counted as a defect.

Not testable from here: a physical phone keyboard, iOS/Android one-time-code autofill, Chrome DevTools "device mode" in the real profile (the extension cannot toggle it; Playwright `isMobile` + `hasTouch` is the equivalent). See the human checklist.

## B. Top gap above the header

### B.1 Measurement (guide closed)

`gap.mjs` on every route, three viewports. `bodyPadTop` = computed `padding-top` of `<body>`; `headerTop` = top of the real app header (`.b6-dtop` or the shop `.bar`).

| Route | 360x780 | 1280x800 | 1920x1000 |
|---|---|---|---|
| `/` entry | pad 0, header 0 | pad **70px**, header 70, pill top 14 | same as 1280 |
| `/pair` | 0 / 0 | 70 / 70 / pill 14 | same |
| `/sign-in`, `?as=supervisor`, `?as=owner` | 0 / 0 | 70 / 70 / pill 14 | same |
| supervisor `/day`, `/proposals`, `/sop`, `/reviews`, `/devices` | 0 / 0 | 70 / 70 / pill 14 | same |
| owner `/home`, `/proposals`, `/sop`, `/reviews` | 0 / 0 | 70 / 70 / pill 14 | same |

At >= 900 px `<html>` carries `b6-panel-reserved b6-panel-collapsed`; the band (y 0-70) is the bare `<body>`: transparent (= white) on `/` and `/pair`, ground `#F5F4F1` on `/sign-in` and the dashboard routes (`elementFromPoint(w/2, 1)` = `BODY`). The page wrapper's gradient/ground starts at y=70. The only thing inside the band is the collapsed "JUDGE GUIDE · STAGE n OF 5 ⌄" pill (`position:fixed; top:14px; right:20px`, 48 px tall). At 360 the guide is the bottom-sheet handle and no padding is applied. Screenshots: `gap-d1280-pub_pair.png`, `gap-d1920-*.png`, `gap-m360-*.png`.

No dark 2-3 px line at the very top in headless Chromium at 1280/1920; real-Chrome check in B.3.

### B.2 Cause and design comparison

- `app/globals.css` ~573: `.b6-panel-collapsed body { padding-top: calc(var(--b6-panel-pill-h) + 14px + 8px); }` = 48 + 14 + 8 = **70 px**, not media-gated.
- `app/globals.css` ~582: `@media (min-width: 900px) { .b6-panel-reserved:not(.b6-panel-open) body { padding-top: same } }`.
- `app/ui/SidePanel.tsx` puts `b6-panel-collapsed` on `<html>` whenever the pill is shown; `app/demo/first-paint.ts` puts `b6-panel-reserved` on `/`, `/sign-in`, `/pair`, `/capture` and wherever a live demo state exists, before first paint (CLS avoidance).
- Boards (rendered statically, `board.mjs`): `L2-01-Pair`, `D2-01-Entry`, `D2-02-DayRecord`, `D2-07-OwnerHome` all put `.dtop` at the very top of the frame (y=0, 73 px tall, `position:relative`) and the collapsed guide `.fab` at `position:absolute; top:14px; right:20px` **inside the content area below the header** (renders at y=87 = 73 + 14, x from 1137 in a 1400 frame). The design never reserves a band above the header; the pill overlaps the content's top-right corner. Screenshot: `boards/L2-01-Pair.png`.
- Verdict: the 70 px band is an app invention (room for a viewport-fixed pill), not in the design. Logged as **M-001**.

### B.3 Real Chrome check

Claude in Chrome, window 1280x860 (the Mac screen is 1512 px wide, so 1920 could not be set; 1280 and 1920 behave the same in Playwright): `/pair` shows the same band: `innerWidth` 1280, `<html>` `b6-panel-reserved b6-panel-collapsed`, `body padding-top 70px`, header top 70, pill at y 14-62 / x 1015-1260, `elementFromPoint(600, 2)` = `BODY`. Typing `123456` into the field at this width works (Set up enabled). **No dark 2-3 px line** at the top of the page in real Chrome either; the band is uniformly white. The line in Rangga's screenshot is most likely the browser window/tab-strip edge in his capture, not page content; not reproduced.

## C. 360 px mobile-layout pass

`mobile.mjs` (360x780 @2x, touch) on: `/` (guide closed + open), `/pair` empty / guide open / filled, `/sign-in` staff and supervisor panels, `/pair` Device set up (+ guide), `/capture` idle (+ guide), `/capture` listening (+ guide; `listen.mjs`, fake mic, `sbx-uitestproposal1`), supervisor `/day` `/proposals` `/sop` `/reviews` `/devices` (+ guide), owner `/home` `/proposals` `/sop` `/reviews` (+ guide). The seeded debrief sandbox's window had expired and was skipped as instructed. Full-page screenshots `m/m-*.png`, data `m/mobile-results.json`.

Automated checks on every screen above:
- Horizontal page scroll (`scrollWidth > clientWidth`): **none** on any screen.
- Tap targets under 44 px (buttons, links, inputs, tabs): **none** on any screen (the segmented ID | EN items are 48 px, nav tabs 44 px, sheet handle 84 px).
- Clipped text (`overflow:hidden` + `scrollWidth > clientWidth`): only `b6-sr-only` screen-reader spans (expected). Visual clipping found by eye: the code-field placeholder (M-003) and the supervisor nav's last tabs (M-004).
- Fixed/sticky overlays: only the guide sheet (84 px collapsed at y 696-780; 179 px open on short pages). It covers the bottom of the page content; every screen scrolls above it, and the "Set up" button is above the handle on `/pair` at 360 (handle at 696, button bottom 405).
- Console: no page errors; only `/robots.txt` 404s from the test harness itself.

Per screen vs the phone boards (rendered statically; the board runtime is absent, so every `sc-if` branch and the open drawer paint at once, which hides the lower part of each board):

| Screen | Board | Result |
|---|---|---|
| `/` entry | P2-01, P2-01o | Structure and copy match (logo, ID/EN, outlet line, kicker chip, h1, "TRY ALL THREE ROLES · ABOUT 20 MINUTES", three step cards). The h1 wraps to 4 lines at 360 vs 3 at the board's 390; no overflow. |
| `/pair` empty | P2-02 | Structure matches. **Placeholder shows 5 of 6 dots at 360** (M-003). |
| `/pair` guide open | P2-02o | Sheet: kicker + STAGE chip, "Staff · day 1", "STEP: PAIR THE DEVICE" card, Fill in 000000 button. Matches. (The board's "Day 1 of 3" handle chip is a known fidelity item, not a layout one.) |
| `/pair` Device set up | P2-03 | Check disc, h1, "For Demo Bakery · Outlet 1", 4 numbered steps, "Open the listening page" button above the handle. Matches. |
| `/capture` idle | P2-04, P2-04o | Big Start disc, "Ready to open", lead, date line, Start button, privacy line, Sign out. Matches. |
| `/capture` listening | P2-05 | Waveform disc, "Listening", "Focus on your customers. We'll keep the notes.", date line, disabled "End · available at closing time (21:45)", red "Sign out (cancels today's session)", privacy line; handle "Read card 1 of 5 aloud". Matches structurally. |
| supervisor pages | no phone boards (D2-* are 1400 px desktop) | Header stacks to 3 rows (126 px): logo + ID/EN + Sign out; outlet · ends; SUPERVISOR + DEMO DATA chips. Nav is a horizontal scroller with a 20 px fade; **"Reviews" is cut at the edge and "Connected devices" is off-screen, and the active tab is not scrolled into view** (M-004). Content is one column, cards full width, no overflow. |
| owner pages | no phone boards | Same shell; header is 131 px because the **OWNER chip sits on the outlet row while DEMO DATA wraps alone to a third row** (supervisor keeps both chips together) (M-005). Nav (Home, Approvals, SOP, Reviews) fits without scrolling. |

Note on a side effect of the run: the generic "first button in main" click used to reach a proposal detail landed on "Ask for another proposal" on the supervisor `/proposals` page of `sbx-uitestproposals`, which started a real proposal generation ("Bee6 is writing a proposal", screenshot `m-11b-sup-proposal-detail.png`). One model call on a throwaway UI sandbox; no other data touched.

## D. Defects

| Id | Severity | What | Repro | Screenshot | Suspected file |
|---|---|---|---|---|---|
| M-001 | major | 70 px empty band above the header on every route at >= 900 px (guide collapsed); design has the header at y=0 and the pill below it | open any route at 1280 or 1920 wide with the guide closed; `getComputedStyle(document.body).paddingTop` = `70px`; header top = 70 | `m/gap-d1280-pub_pair.png`, `m/gap-d1920-sup_day.png`, board `m/boards/L2-01-Pair.png` | `app/globals.css` (`.b6-panel-collapsed body`, `.b6-panel-reserved:not(.b6-panel-open) body`), `app/ui/SidePanel.tsx`, `app/demo/first-paint.ts` |
| M-002 | minor | Full 6-digit field swallows further typing with no feedback; caret lands mid-string on tap | `/pair` -> guide -> Fill in 000000 (or type six digits) -> tap the field -> type `1` -> value unchanged, no hint | `m/stg-closed-type-01-keyboard.png` (filled state) | `app/pair/PairForm.tsx` (`maxLength={6}`, no select-on-focus / replace-when-full) |
| M-003 | minor | Code-field placeholder "· · · · · ·" is clipped to 5 dots at 360 px and sits left of centre | `/pair` at 360 wide, empty field; placeholder text width = 305 px (28 px Geist Mono, 10 px letter-spacing, 10 px text-indent) vs 280 px content width (312 field - 2x16 padding); fits from 390 px (310) | `m/small/crop-pair-field-360.png`, `m/m-02-pair-empty.png` | `app/globals.css` `.b6-codefield` (`letter-spacing: 10px; text-indent: 10px; padding: 0 16px`) and the placeholder string in `app/pair/PairForm.tsx` |
| M-004 | minor | Supervisor nav at 360: "Reviews" cut at the right edge, "Connected devices" off-screen; on `/reviews` and `/devices` the active tab is itself off-screen (no scroll-into-view) | sign in as supervisor at 360, open `/reviews`: nav `scrollWidth` 554 vs 360; "Reviews" rect 295-382, "Connected devices" 386-554 | `m/m-13-sup-reviews.png`, `m/m-14-sup-devices.png` | `app/globals.css` `.b6-nav` (overflow-x auto + 20 px mask) / the shell nav component (no `scrollIntoView` for the active item) |
| M-005 | minor | Owner header at 360 wraps the DEMO DATA chip alone to a third row (131 px) while the supervisor header keeps SUPERVISOR + DEMO DATA on one row (126 px) | sign in as owner at 360: "OWNER" chip y=68 beside "ends 23:57", "DEMO DATA" y=96 alone | `m/m-23-own-reviews.png` vs `m/m-13-sup-reviews.png` | shell header (role chip placement differs between roles) |

## E. Human manual-test checklist (real hardware only)

- Real Android phone, Chrome: open staging `/pair`, tap the code field, type six digits on the soft keyboard -> digits appear one by one, Set up enables at six. Then tap the field again and type a seventh digit -> nothing happens (M-002); delete one and retype -> works.
- Real iPhone, Safari and Chrome: same, plus the one-time-code autofill suggestion above the keyboard (only an SMS can trigger it; expect none in the demo).
- Rangga: which browser and window width showed the "cannot capture my input" symptom, and had "Fill in 000000" (or a previous attempt) already filled the field?

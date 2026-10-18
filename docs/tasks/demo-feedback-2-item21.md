# Demo feedback 2, item 21 — "1t2d3196r9k-9.css was preloaded using link preload but not used"

Read-only diagnosis by tech-lead, 18 Oct 2026. Checked against `origin/develop` e01621e and `origin/main` 30c931d
(identical for every file involved) and the live `web` / `web-develop` services (curl only).

## Verdict

**Harmless. Accept as known noise for submission day. Do not change code before judging.**
Known-noise ticket; a proper fix (a `proxy.ts` redirect) is a post-judging task of ~1 h.

## 1. What the chunk is and where the warning comes from

`/_next/static/chunks/1t2d3196r9k-9.css` (10 kB) is the Turbopack CSS chunk shared by the phone-side and sign-in
routes. It contains `capture.module.css`, `debrief.module.css`, `pair.module.css`, `shop.module.css` and
`sign-in.module.css`. It is served as a plain `<link rel="stylesheet">` on `/pair`, `/capture` and
`/sign-in?as=…`, and on no other route (`/`, `/home`, `/day`, `/sop`, `/proposals`, `/reviews` use other chunks).
No server HTML on either service contains a `<link rel="preload">` for it; none of the JS chunks reachable from
`/` references it; the `<Link>` prefetch payloads for `/pair` and `/sign-in?as=…` are tree-only (dynamic routes,
no `loading.tsx`) and carry no CSS. So the preload is not global CSS, not the Judge Guide / DemoBar / DemoAccess
`next/dynamic` chunks, and not Link prefetching.

**The emitter is the demo `/sign-in` server redirect reached by a client-side navigation.** Exact chain:

1. A signed-out (or just signed-out) web user is on a web page, or sign-out runs. The page's auth guard calls
   `router.replace("/sign-in")` (`app/web/SignOutButton.tsx:24`, `app/home/HomeApp.tsx:48`, `app/day/DayRecordApp.tsx:57`,
   `app/sop/SopApp.tsx:159`, `app/proposals/ProposalsApp.tsx:73`, `app/reviews/ReviewsApp.tsx:65`, and the other
   `router.replace("/sign-in")` sites — ~20 call sites, all bare `/sign-in`).
2. The router fetches the RSC payload for `/sign-in`. On the demo deployment `app/sign-in/page.tsx:25`
   (`if (role === null) redirect("/")`, added in f67a005 for demo-feedback-2 items 12/13/14) throws a redirect.
   Next has already emitted the sign-in segment's stylesheet element in that payload; verified live:
   `curl -H 'RSC: 1' …/sign-in` returns 6.5 kB containing two `1t2d3196r9k-9.css` references **and**
   `NEXT_REDIRECT;replace;/;307`.
3. React (react-dom client, `preloadStylesheet`) inserts `<link rel="preload" as="style" href=…1t2d…>` for the
   stylesheet of the pending transition. The router then follows the redirect and renders `/` (entry page), whose
   tree does not include that chunk, so the stylesheet is never inserted and Chrome reports the preload as unused
   ~3 s later.

Evidence it is this path and not the plain landing: QA's only hit (`qa18/out-web-A-p360-expire.json`) came from the
`expire` run: demo record cleared + Firebase signed out, `page.goto('/day')`, frames show the URL already at `/` at
t = 106 ms (the auth bounce `/day` → `/sign-in` → `/`), warning logged on that page 3 s later, before any click.
Rangga's `web` sighting is the same chain in the judge flow: **Sign out** (or an expired demo session bouncing a
web page) → `/sign-in` → `/`. `/sign-in?as=staff` also redirects (to `/pair`) but `/pair` uses the same chunk, so
that preload is consumed and no warning appears.

## 2. Is it harmless?

Yes.
- Chrome DevTools hint only; `type: "warning"`, not an error; not a page error; invisible unless DevTools is open.
  Lighthouse/axe do not flag it (QA: 0 a11y violations, 0 page errors).
- No FOUC and no missing styles: `/` never needed that CSS. No double load: the file is immutable-cached, so the
  next `/pair` / `/sign-in?as=` visit reuses it (at worst it is fetched ~10 kB earlier than needed, once).
- Not a sign of CSS shipped to the wrong route: the stylesheet element belongs to `/sign-in`, which legitimately
  uses it; only the redirect leaves the preload orphaned.
- Pilot unaffected: the redirect is demo-only (`DEMO_MODE === "true"`), so the pilot never emits it.

## 3. Fix options

| Option | Change | Effort | Risk | Submission day? |
|---|---|---|---|---|
| **A. Accept as known noise (recommended)** | Add one line to the README known-gaps list / `docs/HANDOFF.md`; close item 21 as "known, cosmetic". | 5 min | none | Yes |
| B. Quick-win in code | Point the demo sign-out at `/` instead of `/sign-in`. There is no one-line version: the bare `/sign-in` target is in ~20 auth-guard call sites and the client does not know `DEMO_MODE` (not `NEXT_PUBLIC_`). A shared helper would touch every web page's guard. | 1–2 h + QA regression of every web page | medium: the auth bounce is on the judge path | No |
| C. Ultimate | Add `proxy.ts` (Next 16's middleware file) matching `/sign-in` only: when `DEMO_MODE === "true"` and `as` is missing/invalid → `NextResponse.redirect("/")`, `as=staff` → `/pair`; drop both `redirect()` lines from `app/sign-in/page.tsx`. The redirect then happens before any segment renders, so the RSC payload carries no stylesheet and nothing is preloaded. Unit test the matcher + env branches. | ~1 h | low-medium: a new routing primitive on every request path must be matcher-restricted and verified on the live URL; the Next 16 proxy conventions must be read from `node_modules/next/dist/docs` first | No — after judging |

Not viable: `prefetch={false}` on the entry-page links (prefetch is not the cause); changing `next.config.ts`
(no option turns off React's stylesheet preload for transitions); replacing `router.replace` with a hard
`window.location.assign("/sign-in")` (would fix the warning but turns a soft bounce into a full reload on every
signed-out web page — a visible regression for a cosmetic gain).

## 4. Recommendation

Mark item 21 **CLOSED — known cosmetic noise**, note it in the README known gaps ("a Chrome DevTools preload hint
after sign-out on the demo; no user impact"), and queue option C as a post-submission chore. Nothing to change on
`web` for the judges.

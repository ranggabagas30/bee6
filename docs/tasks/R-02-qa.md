# R-02 — QA verification report (code + unit gate)

**Scope:** independent verification of R-02 (Data + login + roles), Tech-Lead-PASSed,
commits `83d7094..HEAD` on `main`. No live GCP/Firebase available — this is a
code-and-unit-test verification pass only. Builder's plan/report: `docs/tasks/R-02.md`.

## VERDICT: SHIP

(For the code slice reviewed here. Two acceptance bullets involve live Google
sign-in / Firestore, which only Rangga can exercise on a real Firebase project —
see the Human manual-test checklist at the end. Nothing in this diff blocks
merging R-02 as the "agent-buildable, non-UI slice" it was scoped as.)

## GATES (reproduced myself, exact counts)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **ok** — no output, exit clean |
| Lint | `npm run lint` (`eslint .`) | **ok** — no output, exit clean |
| Unit tests | `npx vitest run` | **95/95 passed**, 10 test files (89 pre-existing + 6 I added — see below) |
| Build | `npm run build` (`next build`) | **ok** — compiled, all routes registered: `/api/health`, `/api/v1/auth/pin`, `/api/v1/auth/session`, `/api/v1/devices/pair`, `/pair` |
| Smoke | n/a | R-02 has no pipeline/model call to smoke-test |

I added **one test file**, `lib/http/guard.requireClaims.test.ts` (6 tests), because
the existing `rbac.test.ts` only proves the *pure* `authorize`/`assertOutlet`
functions, not the actual `requireClaims`/`requirePermission` guard a route calls.
It mocks only `verifyIdToken` (the one external dependency) and drives the real
guard end-to-end: a supervisor token scoped to outlet `"proofed"` requesting
`outletId: "demo-outlet"` is rejected with `ForbiddenError` through the real
`requirePermission` function, not just a hand-rolled `authorize()` call. This
directly answers the "read the guard and confirm routes actually call it, not
just that a test asserts a pure function" ask. No product code was touched.

## ACCEPTANCE ("Done when" — backlog R-02 + web spec §2/§3/§6.2/§6.4/§6.5)

- [x] **Owner/supervisor sign in and see only their outlet.** Code path exists
  and is proven: `POST /api/v1/auth/session` (`app/api/v1/auth/session/route.ts`)
  verifies the Firebase ID token, requires `email_verified === true`, and calls
  `linkGoogleUser`, which matches the verified email to a seeded `users` doc and
  sets custom claims `{outlet_id, role}`. Proved by
  `lib/auth/services.test.ts` → `linkGoogleUser`: "links a seeded verified email,
  sets claims, and saves the uid" (passes — asserts exact claims payload) and
  "rejects a verified email that is not seeded for any outlet" → throws
  `ForbiddenError` (passes). **Live Google sign-in itself needs Rangga** — the
  provider isn't enabled yet in either Firebase project (see checklist).

- [x] **A wrong outlet ID is rejected by the server.** Proved two ways:
  1. `lib/auth/rbac.test.ts` — the pure `assertOutlet`/`authorize` functions,
     full role × permission matrix (14 tests, all pass).
  2. `lib/http/guard.requireClaims.test.ts` (added by me) — drives the actual
     `requirePermission` guard: mocked `verifyIdToken` returns claims for
     outlet `"proofed"`; the call requests `outletId: "demo-outlet"`; the guard
     throws `ForbiddenError` — proving the wiring from token → claims →
     `authorize()` inside the guard itself, not just the pure function in
     isolation. Also proves a role without the permission is rejected even on
     its *own* outlet (owner requesting `day:read:evidence`, supervisor-only).
  **Caveat, stated precisely:** no R-02 route currently *calls*
  `requirePermission` — none of the three auth routes (`/pair`, `/auth/pin`,
  `/auth/session`) take a client-supplied `outlet_id` to check against claims;
  that first appears with R-03's segment/heartbeat uploads and R-04/R-06's
  resource routes. So this bullet is proven up to and including the guard
  function that future routes will call, not via an HTTP call to an existing
  route with a wrong outlet id in the body. The equivalent check that *does*
  exist today — the PIN route never trusts a client-supplied outlet — is
  covered by the next bullet.

- [x] **Staff PIN login works only on the paired phone.** Read
  `app/api/v1/auth/pin/route.ts` line by line: it calls `requireDevice(req)`
  *before* touching the JSON body. `requireDevice` (`lib/http/guard.ts`)
  requires an `Authorization: Bearer <device token>` header **and** an
  `X-Device-Id` header, then calls `authenticateDeviceToken`, which 401s if the
  device is unpaired (`token_hash` is `null`) or the token doesn't verify
  against the stored bcrypt hash. `outlet_id` and `device_id` passed into
  `staffPinLogin` come from `device.outlet_id` / `device.device_id` — the
  **verified device principal** — never from the request body. Proved by
  `lib/auth/services.test.ts` → `authenticateDeviceToken`: "rejects an unpaired
  device" and "rejects a wrong token" (both pass, throw `UnauthorizedError`).

- [x] **5 wrong PINs lock for 15 min.** Proved at both layers:
  - `lib/auth/pin.test.ts` — pure lockout state machine: increments below
    threshold, locks exactly on the 5th wrong try, `lockRemainingSeconds` is
    exact at `now`, at `locked_until - 1ms` (still locked) and at `locked_until`
    (unlocked) — boundary-tested, all pass.
  - `lib/auth/services.test.ts` → `staffPinLogin`: "counts a wrong PIN and locks
    after 5 tries for 15 minutes" drives 5 real wrong-PIN attempts through the
    service function; the 5th throws `LockedError`; a subsequent *correct* PIN
    attempt while still locked also throws `LockedError` (not simply a 6th
    wrong attempt) — passes.

- [x] **Pairing code single-use + 10-min expiry.** `lib/auth/pairing.test.ts`
  covers the TTL boundary precisely: valid at `expiry - 1ms`, expired at
  `expiry` exactly; a `null` expiry is treated as expired. Single-use is proved
  end-to-end in `lib/auth/services.test.ts` → `pairDevice`: "issues a device
  token for a valid code and clears the code" pairs successfully, then replays
  the *same* code and asserts the second call throws `UnauthorizedError`. This
  matches the store behaviour I read in `lib/firestore/stores.ts`:
  `savePairing` sets `pairing_code: null` on the device doc after a successful
  pair, so a Firestore-level replay of the same code will no longer match any
  device (`findByPairingCode` query would return nothing).

## HARD-RULE CHECKS (runtime, observable in code/tests)

- **Audio/base64:** none found in product storage/logging paths. Full-repo
  grep for `audio|base64` (excluding `*.test.ts`) across `lib/`, `app/`,
  `scripts/` hits only: (a) doc comments in `schema.ts`/`errors.ts` stating the
  rule, (b) `pairing.ts`'s `.toString("base64url")` — encoding a random
  high-entropy *device token*, not audio, (c) `scripts/probe.ts`'s synthetic
  silent WAV used only for the R-01 region-probe reachability check (never
  logged, never real shop audio, pre-existing from R-01, untouched by this
  diff). `SegmentSchema` in `lib/firestore/schema.ts` is `.strict()` with no
  audio/base64 field, and `schema.test.ts` has an explicit test — "rejects any
  audio/base64 field (hard rule #2)" — that passes.
- **Names only in `staff`:** grepped the full diff for `name` fields. Only
  `StaffSchema` carries `name`/`name_key`. `UserSchema`, `DeviceSchema`,
  `AuditLogSchema`, `CustomClaimsSchema`, `HeartbeatSchema`, `SegmentSchema` —
  none has a name field, and all are `.strict()` so an accidentally-added name
  field would fail to parse rather than silently pass through. The staff
  session's custom-token claims (`CustomClaims`) carry `staff_id` only, never
  `name`. `staffPinLogin`'s output/claims never include the typed name. The
  seed script (`scripts/seed.ts`) writes `name`/`name_key` to the `staff`
  collection doc only.
- **`email_verified` fails closed:** `linkGoogleUser` in `lib/auth/services.ts`
  checks `if (!input.email_verified) throw new UnauthorizedError(...)` as its
  first line, before any store lookup. Proved by
  `services.test.ts` → "rejects an unverified email before any lookup" — which
  also asserts `findByEmail` was **never called** (a `looked` flag stays
  `false`), confirming the check is a true gate, not just a post-hoc filter.
  `verifyIdToken` in `lib/firebase/admin.ts` defaults `email_verified` to
  `false` if the decoded token doesn't carry it (`decoded.email_verified ===
  true`), so an absent field also fails closed.
- **No secrets / no real Proofed data:** no `.env`, API-key-shaped string, or
  credential literal anywhere in the diff (`git diff 0adf8fa HEAD` grepped for
  `AIza|sk-|apikey|API_KEY=` — zero hits). The seed script refuses to load
  pilot data except from the untracked `/private/seed.pilot.json`, and refuses
  to run `--project pilot` while `DEMO_MODE=true` (and vice versa) — see
  `assertProjectMatchesEnv`. It only ever logs the outlet id, doc counts,
  device id, and the pairing code to stdout — never a PIN, a PIN hash, or a
  device token. `DEMO_SEED` is explicitly fictional (`"Ari Demo"`,
  `demo-owner@example.com`, etc.) per hard rule #8. `.gitignore` already
  excludes `/private/`, `.env*`, and audio file extensions.
- **No non-Google AI SDK/key:** `package.json` dependencies are
  `@google/genai`, `bcryptjs`, `firebase-admin`, `next`, `react`, `react-dom`,
  `yaml`, `zod` — no OpenAI/Anthropic/Cohere/Mistral package, and no such
  string anywhere in the diff.
- **Region-from-config:** not applicable to R-02 (no model call in this diff);
  the R-01 region-probe wiring is untouched.

## DEFECTS

None found. One **design note** (not a defect, not blocking): `requirePermission`/
`requireClaims` in `lib/http/guard.ts` are fully built and now unit-proven
end-to-end (via my added test), but **no route in this diff calls them yet** —
correct for R-02's scope, since none of its three routes take a
client-supplied `outlet_id`. Flag for the **R-03/R-04 QA pass**: confirm the
segment/heartbeat/day-record routes actually wire in `requirePermission`
(don't just trust that the helper exists).

## HUMAN MANUAL-TEST CHECKLIST (Rangga/Tiffany — live GCP, cannot be proven in code)

- Enable the **Google sign-in provider** in both the pilot and demo Firebase
  project consoles → sign in as the seeded owner and supervisor emails on
  each; confirm the ID token round-trips through `POST /api/v1/auth/session`
  and the returned `{outlet_id, role}` matches the seed data.
- Confirm a Google account **not** in the seeded `users` list gets a clean 403
  (not a crash/500) when it tries to sign in.
- Run `npm run seed -- --project demo` against real Firebase Admin credentials
  (ADC on the demo GCP project) and confirm the Firestore batch write lands
  with the expected doc IDs (`outlets/demo-outlet`,
  `staff/demo-outlet:demo-staff-1`, etc.) and the pairing code prints once to
  stdout, nowhere else.
- Later, run `npm run seed -- --project pilot` with a real, untracked
  `/private/seed.pilot.json` against the **pilot** GCP project and confirm it
  is refused if `DEMO_MODE=true` is accidentally set.
- On a phone browser, open `/pair`, type the printed 6-digit code, confirm
  pairing succeeds and a **second** attempt with the same code fails with
  "Invalid or expired pairing code".
- On the now-paired phone, POST a seeded staff name + correct PIN to
  `/api/v1/auth/pin` and confirm the returned Firebase custom token exchanges
  for a real ID token client-side (the custom-token mint→exchange round-trip
  can only be proven against live Firebase Auth, not in-process).
- On the same phone, deliberately enter 5 wrong PINs and confirm the UI/API
  reflects a 429 with `Retry-After` around 900s, then confirm a correct PIN
  still fails until the lock actually lifts.
- Set the **Firestore TTL policy** on `segments.expires_at` in each project
  console (a per-project setting; nothing in code sets this) — not urgent for
  R-02 since nothing writes `segments` yet, but must land before R-04.
- Ratify the four design decisions Rangga flagged in `docs/tasks/R-02.md`:
  bcryptjs for PIN/token hashing, the opaque long-lived device token design,
  Firebase custom tokens for staff sessions, and the plaintext short-TTL
  pairing code.

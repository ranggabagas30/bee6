# DEV-05: dev-only "sign in as Owner / Supervisor" (a real Firebase session, no Google prompt)

Status: **DEFERRED. Spec only, written by tech-lead (8 Oct). There is nothing to test it against yet.
Build it as Task 0 of R-06 (supervisor view), or right after R-06's sign-in screen lands.** Do not
dispatch it on its own before then.

> New idea, not a backlog task (CLAUDE.md §10 rule 11). Spec and plan in one file. Depends on DEV-03 Task 0
> (`pageExtensions` and `isDevToolsEnabled()`).

**Rangga's request #3 (8 Oct):** "Can login as Supervisor and Owner."

## 1. Why it waits (checked on `origin/main` @ `31161e6`)

- **There is no sign-in UI.** `app/` has `/`, `/capture` and `/pair` only. No owner or supervisor page exists.
- **No browser Firebase SDK.** `package.json` has `firebase-admin` only. There is no `firebase` package and no `signInWith…` anywhere.
- **No route checks a user session yet.** `requireClaims` / `requirePermission` (`lib/http/guard.ts`)
  have no caller. Every live route is device-only (`requireDevice`) or OIDC-only.
- R-06 (supervisor view) and R-09 (owner approvals) are not started (`docs/HANDOFF.md`).

Building a role switch now means building half of R-06's auth plumbing ahead of R-06, with nothing that
consumes it. The spec below is ready to drop into R-06's plan.

## 2. How real sign-in works today (the path the bypass must feed, unchanged)

1. Browser: Google sign-in through Firebase → a Firebase **ID token**.
2. `POST /api/v1/auth/session` → `verifyIdToken` → `linkGoogleUser` finds the seeded `users` doc by the
   verified email → `setCustomUserClaims(uid, { outlet_id, role })`. The browser refreshes its ID token.
3. Every later API call sends `Authorization: Bearer <ID token>` → `requireClaims` →
   `adminAuth().verifyIdToken` (real signature check) → `CustomClaimsSchema` → `authorize(claims, { permission, outletId })`.

## 3. Design: a dev route mints a Firebase **custom token**, and everything after it is the real path

- `app/api/dev/sign-in/route.dev.ts` `POST { role: "owner" | "supervisor" }` (zod, strict). It returns
  `{ data: { custom_token } }`.
  1. First statement: `if (!isDevToolsEnabled()) return new Response(null, { status: 404 });` (layers 1 and 2, DEV-03 §2).
  2. The outlet comes from the **server** env `DEV_SIGN_IN_OUTLET_ID` (for example `demo-outlet`), **never from the body**.
     Unset → 404.
  3. Load that outlet doc. `project_kind !== "demo"` → 403 `dev_demo_only` (layer 3). **This one is
     non-negotiable:** with `.env.local` pointing at the pilot project, "sign in as owner" would otherwise
     hand an owner session over the **real outlet's** SOP approvals to anyone running the dev server.
  4. Require a seeded `users` doc for that outlet with that role (the same collection `linkGoogleUser`
     reads). None → 404. This keeps the dev roles in step with what the seed actually grants.
  5. `claims = { outlet_id, role }`: **exactly** the shape `linkGoogleUser` sets. No email, no name, no
     staff id (hard rule §2.7).
  6. `mintCustomToken(\`dev-${role}-${outlet_id}\`, claims)` (the existing helper in `lib/firebase/admin.ts`).
     A dev-only uid, so no real `users` doc's `uid` is ever overwritten.
- Browser (the R-06 sign-in screen, only when `isDevToolsEnabled()`): two extra buttons,
  `Dev: sign in as Owner` and `Dev: sign in as Supervisor` → POST → `signInWithCustomToken(auth, token)` →
  `user.getIdToken()`. From here on it is **the same ID-token path as Google sign-in**. It does **not** call
  `/api/v1/auth/session` (the claims are already in the token).
- **What it fakes:** only the identity-provider step (Google OAuth). **What it must not fake:** the token
  verification, the claims schema or the RBAC check. `lib/http/guard.ts` and `lib/auth/rbac.ts` get **no**
  new branch, no header, no env read. Firebase signs the custom-token ID token, and `verifyIdToken` checks
  it exactly like a Google one. So a wrong permission or a cross-outlet bug fails for the dev role exactly
  as it would for a real owner. Review checklist item: `git diff` shows no change to `guard.ts`, `rbac.ts`,
  `roles.ts` or `services.ts`.

## 4. Prerequisites and risks (verify before building)

1. **Local custom-token signing (the main risk).** `createCustomToken` must sign. On Cloud Run it uses
   the service account through the metadata server. Locally, with **user** ADC, firebase-admin throws
   "Failed to determine service account" unless `initializeApp` gets a `serviceAccountId` **and** the
   developer holds `roles/iam.serviceAccountTokenCreator` on that service account (demo project). Plan: an
   optional `FIREBASE_SIGNER_SA` env read in `getAdminApp()` (passed as `serviceAccountId` only when set,
   so deployed behaviour does not change), plus a **dev-ops** IAM grant on `bee6-playground` only.
   Spike it first: 15 min.
2. The browser `firebase` SDK and the web config (`FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, … are already
   named in `.env.example`) arrive with R-06's Google sign-in, not with DEV-05.
3. `DEV_SIGN_IN_OUTLET_ID` goes into `.env.example` as an empty name-only entry with a comment.

## 5. Edge cases
| # | Case | Required behaviour |
|---|---|---|
| E1 | Any deployed build | The route does not exist (layer 1) / 404 (layer 2). |
| E2 | Pilot outlet configured | 403 `dev_demo_only`. No token is minted. |
| E3 | The role is not seeded for the outlet | 404. |
| E4 | Body `role: "staff"` or `"device"` | 422 (the enum allows owner/supervisor only). |
| E5 | Switching role | Sign out (`signOut(auth)`), then the other button. The new token carries the new claims. |
| E6 | Token refresh | Firebase refreshes custom-token sessions like any other. The claims persist because they live in the custom token. |

## 6. Tests (when built)
- Route: gate off → 404 with the minter not called. Pilot → 403 with the minter not called. Valid → the minter is called with
  `{ outlet_id, role }` only (deep-equal, no extra keys). Role `staff` → 422. `DEV_SIGN_IN_OUTLET_ID` unset → 404.
- An R-06 route test: a principal whose claims come from the dev path gets the same 403 for a missing
  permission as a Google principal (the same `authorize` call; there is no dev branch to test).

## 7. Effort
About **1.5 h** (developer) + **0.25 h** dev-ops IAM + the spike. Scheduled inside R-06.

## 8. Open question for Rangga
1. OK to defer DEV-05 into R-06 (recommended)? If you want it sooner, it would mean pulling R-06's
   Firebase browser SDK and sign-in screen forward. The custom-token minting is the small part.

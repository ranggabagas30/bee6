# R-P1 requireDevice guard rulings (tech-lead, 7 Oct)

Reviewed commit 95cc696 against 8bd428c (`lib/http/guard.ts`, `lib/http/guard.requireDevice.test.ts`).

1. **Missing X-Device-Id: keep 401 and amend the spec.** The device token is bcrypt-hashed, so it can
   only be checked against a named device. Without the header the caller is unauthenticated, and 401
   is the right answer. A 400 would show an unauthenticated caller how the route parses requests.
2. **403 for any verified Firebase ID token, including one with no claims: keep.** No device ever holds
   an ID token. `createCustomToken` is used only for staff PIN sessions, and devices use opaque tokens.
   Any verified ID token is therefore a non-device principal, and the route rejects it either way.
3. **Transient verifier failure falls through to 401: keep (fail closed).** An opaque token is not a JWT,
   so it fails locally and never depends on the verifier being up. During an outage the only change is
   that a user token gets 401 instead of 403, and the request is still denied. Returning 503 would mean
   classifying Admin SDK error codes, which is not worth the cost.

Verdict: PASS.

Spec change needed, §6.6.1 of web-backend-rbac.md:
- In the 400 bullet, change "a missing header" to "a missing header other than X-Device-Id".
- In the auth bullet, add: "A missing X-Device-Id with a token that is not a verified user token → 401
  (`Invalid device token`)."

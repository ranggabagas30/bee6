# R-P1 config contract decision (tech-lead, 7 Oct)

**Decision: (a).** Ship `GET /api/v1/capture/config` as the strict spec shape `{ timezone, weekly_hours, last_ended }`
(web-backend-rbac §6.6.2) and move the client and pages to it in the same PR (feat/capture-p1-server).

Why:
1. §6.6.2 is strict and a contract test must assert there is no `consent_complete` key, so a shape that keeps the legacy fields would contradict the spec on day one.
2. CLAUDE.md §2 #7b removes the consent gate, so the client's `no_consent` branch is dead and wrong, not just transitional.
3. The pure helpers already exist in `lib/capture/calendar.ts`. The client change is small, and the deploy note in §6.6.2 already covers the old bundle.

## Steps (tests first)
1. `lib/capture/calendar.ts`: export the existing private `hoursOn(localDate, weekly)`. Do not change its body.
2. Tests, written red first:
   - `client.test.ts`: `resolveCapturePhase` returns only `"outside_hours" | "active"`. Cases: inside today's hours (active); before open and after close (outside_hours); a closed weekday (`null`, outside_hours); 09:30-01:00 at 00:30 the next calendar day (active, via `businessDateOf`); 08:00-22:00. Also, `fetchCaptureConfig` throws on a payload that has an extra `consent_complete` (the schema is strict).
   - `page.test.tsx` (capture): the outside-hours copy shows today's `open`/`close` from `weekly_hours`. On a closed weekday it shows the next open day's hours. No no-consent section ever renders.
   - `pair/page.test.tsx`: step 3 shows `untilHm` from `mulaiWindowFor(businessDateOf(now), weekly_hours, tz).end_ms`, formatted HH:MM in `tz`. Step 3 is hidden on a closed day.
   - `session-events.test.ts`: update the fixture to the new shape.
3. `lib/capture/browser/client.ts`: `CapturePhase = "outside_hours" | "active"`. Delete the consent check. For active, use `plannedIntervalFor(businessDateOf(now_ms, tz), weekly_hours, tz)` and check `start_ms <= now < end_ms`. Stop importing `isWithinOpeningHours`.
4. `app/capture/page.tsx`: remove the `no_consent` view. For outside-hours, set `{from, to}` from `hoursOn(businessDate)`. If that day is closed, use the first non-null day searching forward (at most 7 days).
5. `app/pair/page.tsx`: replace `mulaiWindowEnd(config.closing_time)` with the step 2 derivation.
6. Remove `mulaiWindowEnd`/`isWithinOpeningHours` from `lib/capture/hours.ts` only if nothing else imports them (check with grep).
7. Leave `C-cap-noconsent-*` dict keys alone. Removing them is a UX-03 copy decision.

Developer: `developer` (sonnet), because this touches the business-date logic. Gates: typecheck, build and vitest are all green.

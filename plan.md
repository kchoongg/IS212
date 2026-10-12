# SPM-64 Configure Event Registration — plan

## Context
`Event` already has `registrationEnabled/Capacity/OpensAt/ClosesAt` and `registrationReviewReason`.
Nothing lets the assigned coordinator set them after submission: SPM-62's strict schema refuses
them on purpose, and only the organiser's draft form writes them. This story adds the coordinator's
own settings endpoint and form. Capacity is capped by the booked room's layout capacity, the period
is checked against the event start, a lowered capacity flags registrations instead of changing
them, and incomplete settings appear as an outstanding arrangement and block confirmation. A
review of docs/discussions added two things: attendees who already hold a place keep seeing the
event (#10), and a lost measured booking counts as incomplete (Week 7 #4).

(After approval this plan is copied again to `plan.md` at the repo root, replacing the earlier copy, and is not committed. Plan mode only
allows this file to be written.)

## Decisions (step 0)
| Topic | Decision |
|---|---|
| AC3/AC4 booking | **pending or approved** counts. Rejected and cancelled bookings never count. With no live booking, or a booking whose `layoutName` is null, setting a capacity is refused as a field error on `registrationCapacity`. The limit is the `VenueLayout.capacity` for (booking.venueId, booking.layoutName). If the venue no longer has that layout, it's refused the same way. `Venue.maxCapacity` is never used as a fallback (same rule as venueSuitability.ts). |
| AC4 storage | New `Event.registrationVenueBookingId String?`, an FK to VenueBooking with `onDelete: SetNull`, plus a migration. It applies now whenever an event has **more than one live booking**, multi-session events included. With exactly one live booking, it's picked automatically and stored. If the stored booking later stops being live (rejected, cancelled, or an expired tentative hold under Week 7 #4), registration setup becomes **incomplete** (see AC8), and the next save that sets capacity must choose a booking again. Nothing is flagged. |
| AC4 migration | The SQL is written by hand in `prisma/migrations/<ts>_add_registration_venue_booking/`. I'll ask you before applying it to the shared Neon DB. |
| AC5/AC6 edges | `opensAt < closesAt` (strict). `closesAt ≤ event.startsAt` (equal is allowed, matching the SPM-62 guard in information/route.ts). The event start is `Event.startsAt`, which multi-session events already derive and store. If the event has no start, the start check is skipped. Checked against the merged state (payload over saved values), as SPM-62's `crossFieldErrors` does. |
| AC7 | No separate "reopen" action. Moving `closesAt` later (including past a close date that has already gone by) is just an ordinary edit through the same PATCH. **Any change to the period is refused once `now ≥ event.startsAt`.** |
| AC8 | A new `registration` arrangement in `arrangementsFor()` (eventConfirmation.ts), which is the outstanding arrangements list Track Outstanding Arrangements will build on. It's `required` only when `registrationEnabled`. It's **incomplete** when any of these holds: capacity is missing, opensAt is missing, closesAt is missing, or the measured booking is no longer pending or approved. It drops off the list once all four are satisfied or registration is disabled. **Saving is never refused for being incomplete.** It **blocks Confirm Event** through the existing `checkEventConfirmation`. An event that is already Confirmed and becomes incomplete stays Confirmed: no revert. |
| Gap 1 (#10) | An attendee with a `registered` or `waitlisted` Registration keeps seeing a **Confirmed** event after registration is disabled. Withdrawn attendees don't. `canViewEvent` gains an optional `attendeeHoldsPlace` input, and `eventListWhere` gains the matching `registrations: { some: { attendeeId, status in HOLDING_A_PLACE } }` clause. The two are kept in step, as the existing comment requires. |
| Sessions (#74) | One event-level capacity. Per-session capacity is recorded as a gap in DOCUMENTATION.md. |
| AC9 codes | `registration_capacity_lowered` and `registration_disabled`, merged with `addReviewReasons()`. The count is `HOLDING_A_PLACE` (exported from applyEventInformation.ts). A flag is raised when the new capacity is below the count (equal is not flagged), or when registration goes enabled → disabled while the count is above 0. Registration rows are never written. |
| Statuses | Reuse `EVENT_INFORMATION_STATUSES` (approved, planning, confirmed), so a disallowed status gets a 400 with its own message, as SPM-62 does. |
| Disable | Disabling keeps the stored capacity and period, so turning registration back on restores them. |
| Capacity | Positive integer (Zod). There's no "clear" option: no AC asks for one. |

## Endpoint
`PATCH /api/events/[id]/registration`. The body is `configureRegistrationSchema` (strict, every field
optional): `registrationEnabled`, `registrationCapacity`, `registrationOpensAt`,
`registrationClosesAt`, `registrationVenueBookingId`. Responses follow the information route: 401
when unauthenticated, 404 via `hidden()` when the user can't view the event, 403 via `forbidden()`
when they're not the assigned coordinator, 400 for a disallowed status, and 400 with
`details.fieldErrors` for rule failures (readable by `readServerError`). On success it returns
`{ event, flagged: string[] }`. The read side is the existing `GET /api/events/[id]`, which already
returns the registration fields. It gains `registrationVenueBookingId`, and the bookings it returns
include `layoutName`.

## Permissions per role
- Assigned coordinator: view + change (`canConfigureRegistration` = `isAssignedCoordinator`, a new helper in permissions.ts with a doc comment).
- Organiser (own or same organisation): view only. The hub card shows the values, with no controls.
- Other coordinators, ops manager, venue staff, tech support: 403 on PATCH. On the hub they see the existing read-only card.
- Attendee: 404, or 403 if the event is visible (confirmed and registration enabled). Never any controls.
- Unauthenticated: 401.

## Pure module: `src/lib/registrationSettings.ts`
- `liveBookings(bookings)`: the pending or approved ones.
- `measuredBooking(bookings, selectedId)`: returns `{ ok, booking }`, or a field error (several bookings with none chosen, one that isn't live, or one from another event).
- `capacityLimit(booking, layouts)`: the number, or an error (no layout, layout missing).
- `periodErrors(merged, eventStartsAt, now, periodChanged)`: covers AC6 and AC7.
- `registrationReviewReasons(before, after, holdingCount)`: covers AC9.
- `registrationArrangementComplete(settings)`, used by eventConfirmation.ts.

## Step 0b: Record the decisions in DOCUMENTATION.md (first action after approval)
DOCUMENTATION.md is the only doc, per memory: no docs/stories files.
- A changelog entry at the top of 📝 CHANGELOG: `### 2026-10-09 — Sammi Chua (SPM-64, decisions)`, with a **Decisions** list in the same style as the SPM-42 and SPM-27 entries. It includes every row of the Decisions table above with its source (step 0 Q&A or a discussion number: #10, #30, #42, #74, #80, #112, #127, Week 7 #3/#4), that AC12 was dropped (the story has 11 ACs), no regression tests, Excel cases first, and the gaps judged out of scope (#99/#33 VIPs, #26/#44 waiting list, #119 attendance vs capacity, #127 status label, Week 7 #6 safety re-check, postponed excluded).
- 🕳️ KNOWN GAPS rows for: per-session capacity (#74), the safety re-check (Week 7 #6), waiting-list promotion on a capacity raise, and SPM-68 clearing `registrationReviewReason`.
- **Kept up to date:** each slice's stop adds a short changelog entry (what was built, the test count, any new decision). The final step adds the ⚖️ business-rule rows (`✅ done (SPM-64)`) and the closing changelog entry.

## Step A: Excel test cases first (before any unit test or code)
Run `/generate-test-cases SPM-64` in test-first mode, using AC1–AC11 from the pasted story (AC12 is dropped). It produces `docs/test-cases/SPM-64_test_cases.json` and `SPM-64_Test_Cases.xlsx`, generated by the skill's script from the template.
- Each AC gets one Positive case, plus Negative and Boundary cases only where they add a distinct check: the edge values from the slices below (0, the limit, limit + 1, closes = start, opens = closes, count = capacity).
- **No duplicates:** each behaviour is in exactly one case. The "wrong role is refused" matrix appears once, under AC11, with one case per refused role. It isn't repeated under every AC. The organiser's view-only case sits under AC10 alone.
- `source` = "Acceptance Criteria", `code_references` is empty, and the wording I choose (messages, labels) goes in `open_questions` as "DECIDED 2026-10-09: …".
- The skill's Step 5 (writing unit tests) is **skipped** here, because the slices below write them. I stop after Step A for your review.

## Unit-test rules for every slice
- Each test traces to an Excel case. A behaviour is tested once, at the lowest layer that can show it: pure rules in `src/lib/__tests__`, and the route test only for wiring (auth, status, error shape, what's written). The same edge value isn't re-tested in both places.
- The role matrix lives only in the route test (AC11). `canConfigureRegistration` gets no separate permissions.test entry, because it's a one-line alias of `isAssignedCoordinator`, which is already tested.
- No regression tests of existing behaviour.

## Slices (tests first, then code. Each slice ends with `npm test` and `npx tsc --noEmit`, a DOCUMENTATION.md changelog line, then a stop)
1. **AC1 + AC11**: `permissions.ts` (`canConfigureRegistration`), `validation/registrations.ts` (`configureRegistrationSchema`, enabled only), `validation/index.ts` export, new `src/app/api/events/[id]/registration/route.ts`. Tests: `src/app/api/__tests__/event-registration.test.ts` only.
2. **AC2 + AC3**: capacity in the schema; `registrationSettings.ts` (`liveBookings`, `capacityLimit`); the route loads bookings and layouts. Tests: `src/lib/__tests__/registrationSettings.test.ts` and the route test (0, negative, non-integer, exactly the limit, limit + 1, no booking, no layout).
3. **AC4**: `schema.prisma` field, migration, `measuredBooking`, the schema field, and storing it in the route. Tests: another event's booking, a cancelled or rejected booking, several bookings with no selection, one booking picked automatically.
4. **AC5 + AC6**: dates in the schema, `periodErrors`, merged-state check in the route. Tests: opens after closes, opens equal to closes, closes after start, closes exactly at start, dates independent of the event date.
5. **AC7**: the started-event guard in `periodErrors` (with an injected `now`). Tests: reopening before start succeeds; editing after start is refused.
6. **AC9**: export `HOLDING_A_PLACE`; `registrationReviewReasons`; the route counts and merges with `addReviewReasons`. Tests: below the count is flagged, equal is not, disabling with only waitlisted attendees is flagged, the flag merges with an existing reason, and `prisma.registration.update*` is never called.
7. **AC8**: `eventConfirmation.ts` (`ArrangementKind` gains `"registration"`, `ConfirmationInput.registration` holding the settings plus whether the measured booking is live); the confirm branch in `src/app/api/events/[id]/route.ts` passes them. Tests in `src/lib/__tests__/eventConfirmation.test.ts`, one per condition: missing capacity, missing opening date, missing closing date, measured booking no longer live, all complete (off the list), disabled (not required). One route test checks that an incomplete save still returns 200.
7b. **Gap 1 (#10)**: `canViewEvent` and `eventListWhere` in permissions.ts, and the GET routes that call them pass whether the attendee holds a place. Tests in permissions.test.ts: a registered attendee sees a Confirmed event with registration off; a waitlisted one does too; a withdrawn one doesn't; and `eventListWhere` agrees.
8. **AC10 + UI**: a `RegistrationSettings` component on the hub (`src/app/events/[id]/page.tsx`, replacing the read-only Registration card). It shows a form (toggle, capacity, booking picker when there are 2 or more live bookings, opens and closes) for the assigned coordinator in the allowed statuses, and read-only values for everyone else. Field errors go through `readServerError`, and the outstanding hint is shown when the settings are incomplete. Tests: `src/app/__tests__/event-registration-pages.test.tsx`.
(The old Slice 9 for AC12 is gone. The story has 11 ACs, and SPM-62's strict schema already covers what AC12 described. No regression tests are written, only tests of new SPM-64 behaviour.)

## Final step
Run `npm test`, `npx tsc --noEmit` and `npm run lint` and show the results. Run `/generate-test-cases SPM-64` a second time: check each case against the built screens, correct the wording, add any "Code" cases, and fill in `code_references`. Add `scripts/seed-spm64.ts` and `fixtures:spm64` only if the manual cases need events with several bookings, layout-less bookings or waitlisted attendees that the main seed lacks (likely yes). Then update DOCUMENTATION.md only: the requirements row, the risks (SPM-68 shows and clears flags; SPM-81 may revisit the measured-booking choice; per-session capacity under #74 isn't supported; the Safety Officer check from Week 7 #6 isn't re-triggered by a capacity change; raising capacity doesn't promote anyone from the waiting list, which is the attendee-side stories' job), and a changelog entry.

## Verification
Unit, route and page tests per slice; the full `npm test`, `tsc` and lint; then a manual run with `npm run dev` against the fixtures: coordinator configures, organiser views, a lowered capacity shows as flagged, and confirm is refused while settings are incomplete.

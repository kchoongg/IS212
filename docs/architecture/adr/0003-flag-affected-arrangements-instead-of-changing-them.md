# ADR-0003: Flag the arrangements an event change affects, never change them

- **Status:** Accepted
- **Date:** 2026-10-07 (merged)
- **Story:** SPM-62 Update Event Information. The flags are reviewed in SPM-68
  Review Flagged Arrangements.
- **Pull request:** [#40](https://github.com/kchoongg/IS212/pull/40)
- **Requirement:** SPM-62 acceptance criteria ("the affected arrangements are
  identified and flagged for review rather than automatically changed";
  a Confirmed event whose essential arrangements are affected reverts to
  Planning); discussion board #120, #122

## Context

After an event is approved, the assigned Coordinator can change its
information: date and time, expected attendance, layout, required
facilities and more (`PATCH /api/events/[id]/information`). By then the event
may already have:

- venue bookings: requested or approved by Venue Staff for a specific time and
  headcount;
- equipment requests: reviewed or reserved by Technical Support for a time
  window;
- registrations: attendees registered or waitlisted for the old date.

All of these were agreed with someone else. A venue booking copies its times
from the event when it's requested, so changing the event does not quietly
move an approved booking. The customer had already answered the same
question for venue changes. In #120 and #122, a change that affects an
existing booking is to be "identified for review", and the booking is not
reverted, cancelled or rescheduled automatically. SPM-39 had built that for
venue edits as `VenueBooking.needsReview` / `reviewReason` / `flaggedAt`.

## Decision

1. `src/lib/eventChangeImpact.ts` (pure functions) decides which changes are
   **important** (`schedule`, `attendance`, `venue_requirements`) and which
   arrangements each one puts at risk:
   - schedule: venue bookings, equipment requests and registrations;
   - attendance or venue requirements: venue bookings only.

   Only live arrangements are affected: pending or approved bookings, and
   open or reserved equipment that hasn't ended yet.
2. Affected arrangements are **flagged, not changed**. Times, status and
   reserved quantities stay exactly as they were. Flags use the SPM-39 shape:
   - `needsReview`, `reviewReason` and `flaggedAt` on `VenueBooking` (already
     there) and on `EquipmentRequest` (added in this story);
   - `Event.registrationReviewReason` for registrations.
3. Reason codes (`event_schedule_changed`, `event_attendance_changed`,
   `event_requirements_changed`) are **merged** into any reasons already
   stored, never overwritten (`addReviewReasons()`, `src/lib/reviewFlags.ts`).
   A flag from a venue edit and one from an event change can therefore sit on
   the same row.
4. A **Confirmed** event goes back to **Planning** when a venue booking or
   equipment request is flagged. A status-history row names the changes.
   Registrations alone don't revert it.
5. The change, the flags and the status change are written in **one
   transaction** (`applyEventInformation()`). It's kept out of the route so
   Process Event Change Request (SPM-32, not built yet) can apply an approved
   change with the same rules, and "important" means one thing everywhere.

## Alternatives considered

- **Move the arrangements to the new details automatically** (shift the
  booking's and equipment's times). Rejected for three reasons. The new time
  may clash with another event or with an unavailable period. Venue Staff and
  Technical Support approved the old time, not the new one. And #120 and
  #122 say not to.
- **Send them back for re-approval** (booking to pending, equipment to
  requested). Rejected. #120 says an update shouldn't revert a booking to
  "Requested", and this would release the hold the Coordinator may want to
  keep.
- **Cancel or release them and ask for new ones.** Rejected: the room or the
  kit could be lost to another event in the meantime.
- **Warn on screen only, store nothing.** Rejected. Nothing would drive the
  Coordinator's review list (SPM-68), and nothing would stop a Confirmed event
  staying Confirmed on arrangements that may no longer fit.

## Consequences

- **Schema change:** migration `20261005120000_add_event_change_review_flags`
  adds `needs_review`, `review_reason` and `flagged_at` (plus an index) to
  `equipment_requests`, and `registration_review_reason` to `events`.
  The migration only adds columns, and was applied without a reseed.
- A flagged arrangement can be stale: a booking may no longer cover the
  event's new time. The Coordinator resolves each one, keeping or replacing
  it, in Review Flagged Arrangements (SPM-68, PR #57), which lists the flags.
- Status changes outside the status route: Confirmed to Planning happens only
  as a consequence of an important change, never through
  `PATCH /api/events/[id]`.
- **No notifications are sent here.** Telling the organiser and attendees is
  SPM-53 (Known Gaps in `DOCUMENTATION.md`).
- Every later story that changes something arrangements depend on should
  write the same flags rather than invent its own. SPM-64 (registration
  settings), SPM-45 (venue unavailability) and SPM-55 (equipment out of
  service) already do. SPM-88 (safety outcome) is expected to.
- See `sequence-update-event-information.puml` for the flow.

# ADR-0002: Lock the venue row while checking a booking for conflicts

- **Status:** Accepted
- **Date:** 2026-10-06 (merged 2026-10-08)
- **Story:** SPM-44 Detect Venue Booking Conflicts
- **Pull request:** [#37](https://github.com/kchoongg/IS212/pull/37). Raised in
  review on that PR.
- **Requirement:** discussion board #35, #41 ("Only one active tentative hold
  or confirmed booking should exist for the same venue and overlapping time
  period")

## Context

A venue booking request (`POST /api/events/[id]/venue-bookings`, SPM-42) is
refused when it clashes with another event's pending or approved booking, or
with an unavailable period. SPM-44 made the refusal name what it clashes
with.

The rule is decided in application code (`findVenueConflict()`,
`src/lib/venueConflict.ts`), not by the database. The schema's convention is
that business rules live in route and service code. The route used to read
the venue's bookings and run the check **before** opening its transaction,
and then insert. Two Coordinators asking for overlapping times at the same
moment could both read "no clash" before either row was written. That left
two active holds on one room, which #41 forbids. Approval
(`PATCH /api/venue-bookings/[id]`, SPM-43) already locked the venue row and
re-checked, so only one of the two could ever be approved. The gap was
recorded under Known Gaps in `DOCUMENTATION.md`.

## Decision

The check and the insert are one step. Inside the transaction, the route
first takes a row lock on the venue:

```sql
SELECT id FROM venues WHERE id = $venueId FOR UPDATE
```

Then it reads the venue's active bookings and unavailable periods, runs
`checkVenueBookingRequest()`, and inserts. A second request (or an approval,
withdrawal or release) for the **same venue** waits at the lock until the
first transaction ends. It then reads the first one's booking, so the clash is
found. Every route that creates, approves, withdraws or releases a venue
booking takes this same lock:

- `POST /api/events/[id]/venue-bookings`
- `PATCH /api/venue-bookings/[id]`
- `PATCH /api/events/[id]/venue-bookings/[bookingId]` (SPM-67)

Reserving equipment uses the same pattern, locking the `equipment` row.

## Alternatives considered

- **No lock; rely on the approval re-check.** This was the state before.
  Approval would never double-book, but two pending holds could exist,
  contrary to #41. The Coordinator who lost would only find out at approval.
- **A PostgreSQL exclusion constraint** (`btree_gist`, overlapping
  `tstzrange`). Rejected for several reasons:
  - The occupied period depends on the venue's current setup and turnaround
    ([ADR-0001](0001-15-minute-booking-units-with-setup-and-turnaround.md)),
    which aren't stored on the booking.
  - The rule is different at request time (pending blocks) and at approval
    (only approved blocks).
  - Bookings of the same event are exempt.
  - Unavailable periods live in another table.

  None of these fits a single constraint, and Prisma can't declare one.
- **`SERIALIZABLE` isolation with retry.** This works, but every caller would
  need a retry loop for serialization failures (Prisma `P2034`). Failures
  would also hit unrelated transactions, and it's harder to reason about than
  one explicit lock.
- **A PostgreSQL advisory lock keyed on the venue id.** This is equivalent,
  but less visible: the lock isn't tied to a row, and the approval route
  already used the row lock.
- **Insert, then re-check and roll back.** This is still racy under
  `READ COMMITTED`, because neither transaction sees the other's uncommitted
  row.

## Consequences

- Requests and decisions for the **same venue** run one at a time. Different
  venues don't wait for each other. The lock is held only for a few reads and
  a pure function, so contention is negligible at this system's scale.
- Any **new code path that creates or re-activates a hold** on a venue must
  take the same lock before reading bookings, or it reopens the race. The
  sequence diagram `sequence-venue-booking-request.puml` shows the order.
- Recording an unavailable period (SPM-45,
  `src/lib/venueUnavailabilityService.ts`) doesn't take the lock. A
  booking committed **before** the period is recorded is flagged
  (`venue_unavailable`). One requested at the same moment can be missed both
  ways: neither transaction sees the other's uncommitted row, so the booking is
  neither refused nor flagged. Taking the same venue lock there would close
  this. It isn't fixed here, because this PR changes documentation only.
- The refusal is an ordinary 400 with the conflict described. The waiting
  request never fails because of the lock itself.

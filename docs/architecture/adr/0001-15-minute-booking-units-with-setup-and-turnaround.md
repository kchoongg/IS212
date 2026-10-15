# ADR-0001: Book venues in 15-minute units, with the venue's setup and turnaround around each booking

- **Status:** Accepted
- **Date:** 2026-10-09 (merged)
- **Story:** SPM-93 Book Venues in 15-Minute Units
- **Pull request:** [#41](https://github.com/kchoongg/IS212/pull/41)
- **Requirement:** Week 7 Customer Changes, Change #1; discussion board #126, #128
- **Supersedes:** the slot rules from discussion board #50, #107, #108 and #123

## Context

Until Week 7, a venue's day was split into three fixed slots: AM, PM and
Night (#50). A booking took whole slots (#107), and setup and turnaround were
each a whole adjacent slot (#108, #123). The rules lived in
`src/lib/venueSlots.ts`. Bookings, holds and unavailable periods were always
stored as real start and end times. The slots existed only in the rules and
on screen.

Week 7 Change #1 made setup and turnaround time part of Release 1, and the
customer then changed the unit of booking:

- #128 (2026-10-02): "the change of 3 slots to 15mins as the smallest unit of
  booking".
- #126 (2026-10-06): "the smallest unit of booking is 15mins, there will be no
  fixed lunch and dinner blackout period".
- Change #1: setup and turnaround "must be included when checking availability
  and detecting booking conflicts". For example, a 10:00-12:00 event with 30
  minutes of setup and 45 minutes of turnaround occupies the venue from 09:30
  to 12:45.

## Decision

1. A booking's start and end are times on a **15-minute grid**
   (`BOOKING_STEP_MINUTES` in `src/lib/venueTime.ts`). A venue's setup and
   turnaround minutes are also multiples of 15, including zero.
2. **Setup and turnaround belong to the venue** (`Venue.setupMinutes`,
   `Venue.teardownMinutes`). A booking **stores only the requested times**.
   The occupied period is worked out wherever it's needed:
   `occupiedWindow()` = start minus setup, end plus turnaround.
3. Every availability and conflict check compares **occupied periods**:
   request, approval, search and the calendar. Two periods clash when they
   overlap. Periods that only meet (one ends exactly when the next starts) do
   not clash.
4. The whole occupied period, setup and turnaround included, must fall
   within the venue's opening hours.
5. A pending request holds its setup and turnaround too, exactly as an
   approved booking does.
6. `venueSlots.ts` is replaced by `venueTime.ts`, the one module of time
   rules.

## Alternatives considered

- **Keep the three slots and add setup and turnaround as whole slots**
  (the #107/#108/#123 rules). The customer ruled this out in #126 and #128.
- **Store the occupied period on each booking** (start minus setup, end plus
  turnaround). Rejected for two reasons. Every check that adds the venue's
  buffers would count them twice. And the stored period would go stale when
  Venue Staff change the venue's minutes.
- **Copy the venue's setup and turnaround onto the booking when it is
  requested.** This keeps old bookings stable when a venue's minutes change.
  Rejected because Change #1 makes these a property of the venue, and a copy
  would mean two answers to "how long does this room need between events".
  The cost is a consequence below: changing the minutes affects existing
  bookings.
- **A finer or free-form grid** (any minute). Rejected: #126 and #128 set
  15 minutes as the smallest unit.

## Consequences

- **No schema change.** Bookings were already stored as times, so the change
  is in the rules, the forms and the screens.
- **Changing a venue's setup or turnaround moves the occupied period of every
  existing booking there.** That can create clashes or push a booking past
  opening hours. Finding those bookings and flagging them is SPM-80 (Re-check
  Bookings When Setup or Turnaround Time Changes). Until SPM-80 is built,
  `scripts/spm93-round-turnaround.ts` lists them.
- **Existing data was migrated without a reseed.**
  `scripts/spm93-round-turnaround.ts` rounds any setup or turnaround that
  isn't a multiple of 15 **up** to the next step (never down), and lists the
  bookings this makes problematic instead of removing them (Change #1).
  `prisma/seed.ts` holds the rounded values.
- **Test cases written to the slot rules are out of date.** These are in
  SPM-40, 42, 43, 44, 46 and 54. SPM-93's cases replace them, as recorded
  under Known Gaps in `DOCUMENTATION.md`.
- The column is still named `teardownMinutes`, while the customer and the
  screens say "turnaround". `venueTime.ts` documents the mapping. Renaming the
  column is not worth a migration.
- See [ADR-0002](0002-lock-venue-row-for-conflict-checks.md) for how
  concurrent requests are kept from both passing this check.

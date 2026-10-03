# Customer clarifications

The customer answers questions in **GitHub Discussions**, not in the brief:

> https://github.com/SinYang13/IS212-2026/discussions

**Check there before deciding a rule for yourself.** This file exists because
nothing in this repo used to point at it, and SPM-46 spent a day building a slot
grid and a setup model the customer had already specified a month earlier. If
you are about to write "the brief doesn't say, so we decided X", search the
discussions first — and if you do decide something, record it here with a date.

Numbers below are discussion numbers: `#50` is
`github.com/SinYang13/IS212-2026/discussions/50`.

---

## Venues, slots and bookings

| # | Date | The ruling |
|---|---|---|
| **#50** | 2026-08-25 | **The three slots and their times.** "The venue will be booked based on 3 time slots (AM, PM, Night); if full day will be all 3 slots. AM (7am-12pm, 1pm-6pm, 7pm-12am)" — i.e. **AM 07:00–12:00, PM 13:00–18:00, Night 19:00–24:00**, with the hours between them uncovered. Implemented in `src/lib/venueSlots.ts`. |
| **#107** | 2026-09-07 | **A slot touched at all is consumed in full.** "If an event runs across two slots, does it consume both slots in full? — Yes." So two approved bookings in one slot are a clash even when their own minutes never meet. |
| **#108** | 2026-09-07 | **One slot is the smallest unit of setup and turnaround.** The system "does not need to support setup or turnaround durations smaller than a slot" for Release 1. So `Venue.setupMinutes` / `teardownMinutes` are read as yes/no by the calendar, not as durations. |
| **#123** | 2026-09-14 | **Setup and turnaround take one whole *adjacent* slot, across days.** An AM event's setup takes the **previous day's Night**; a Night event's turnaround takes the **next day's AM**. Each is at most one slot. Implemented in `occupiedCells()`. |
| **#41** | 2026-08-25 | **Only one active tentative hold *or* confirmed booking per venue and overlapping period.** A hold "may later be confirmed or released" — which is our `VenueBooking.status = pending`. The calendar therefore shows pending requests without letting them take the slot; the hard block belongs at booking time (SPM-42), where the BPMN puts it. |
| **#109** | 2026-09-07 | Multiple candidate venues on hold *for one event* are **not** required for Release 1. Different question from #41. |
| **#35** | 2026-08-25 | Double-booking must be **blocked**, not merely warned about. |
| **#43** | 2026-08-25 | Venue Staff record setup, teardown and turnaround **per venue** — which is why the minute fields stay on the venue form even though the calendar reads them as yes/no. |
| **#46** | 2026-08-25 | Venue Staff maintain operating hours. All days are equal — no weekday/weekend or holiday calendar. |
| **#112** | 2026-09-07 | Capacity **varies by layout**, and is given as a venue attribute — the system never estimates it. |
| **#120** | 2026-09-07 | A venue attribute change must **not** revert bookings to "Requested". Flag the affected booking for review and notify the coordinator (`VenueBooking.needsReview`, SPM-39). |
| **#122** | 2026-09-09 | Retiring a venue must **not** cancel or reschedule its future bookings. They are identified for review. The calendar still shows them; only empty slots read "Closed". |
| **#45** | 2026-08-25 | Venue Staff may **reject a booking and suggest an alternative venue or arrangement**; the change itself is made by the coordinator. So a suggestion is stored on the rejected request and books nothing (`VenueBooking.suggestedVenueId` / `suggestedAlternative`, SPM-43). |
| **#110** | 2026-09-07 | Venue Staff **cannot approve with amended details**. They suggest; the coordinator updates the request before approval. So the suggestion exists only on a rejection. |
| **#83** | 2026-08-31 | Filtering finds candidate venues; **suitability checking** assesses one already chosen. They are different things (SPM-41). |

## Events

| # | Date | The ruling |
|---|---|---|
| **#80** | 2026-08-31 | Approval ≠ confirmation. Approval means there is enough information to plan; confirmation needs every arrangement *that event* actually requires. The system should refuse to confirm while a required one is incomplete. |
| **#68** | 2026-08-25 | Only the **event coordinator in charge** may cancel, at any stage. |
| **#71** | 2026-08-25 | The coordinator marks an event completed; the system may auto-complete 7 days after the end date. |
| **#73** | 2026-08-25 | The **Event Operations Manager** assigns the coordinator after submission. |
| **#69**, **#121** | 2026-08-25, 2026-09-07 | Postponement is allowed **without** a new date. Release the bookings, keep the event record. |
| **#102** | 2026-09-07 | After submission an organiser does **not** edit directly — changes go through the coordinator. |
| **#103** | 2026-09-07 | Withdrawal is requested outside the system and recorded by the coordinator; it must stay distinguishable from draft/submitted/approved/rejected. |
| **#74** | 2026-08-25 | Multi-session events may differ per session in venue, equipment and attendance. |

## Users and access

| # | Date | The ruling |
|---|---|---|
| **#81** | 2026-08-31 | An organiser edits the events they are responsible for; others in the same client organisation may **view** but not edit; never across organisations. |
| **#66** | 2026-08-25 | Staff get the information their responsibilities need, and are **not** scoped by venue, equipment type or location. |
| **#101** | 2026-09-07 | Event Operations Manager is a **separate system role**. |
| **#49** | 2026-09-07 | No account onboarding in Release 1 — pre-loaded accounts are fine. "Attendee Registration" means registering for an event, not creating an account. |

## Non-functional

| # | Date | The ruling |
|---|---|---|
| **#36** | 2026-08-25 | **Singapore time throughout.** All venues are in Singapore. |
| **#28** | 2026-08-25 | English only. |
| **#55** | 2026-08-31 | Notifications may be batched at a configurable interval; real-time is acceptable if simpler. No delivery-time guarantee. |
| **#118** | 2026-09-07 | A role-based dashboard is **not** a mandatory Release 1 feature. |

---

## Still unanswered, and decided by us

Recorded so the next person does not re-decide them. If the customer rules
differently later, that ruling wins.

| Question | Our decision | Date |
|---|---|---|
| Should Technical Support see the venue availability calendar? AC6 says "authorised internal users" without naming roles. | **No.** #66 gives staff what their responsibilities need; Technical Support handles equipment, not rooms. The calendar reuses `venue:view`, which they do not hold. | 2026-09-26 |
| What should a slot show when the venue is open for only part of it? The AC say nothing about opening hours. | **"Free" plus the hours it is open**, e.g. "Open from 08:00" — not a generic "Limited hours", which with AM starting at 07:00 fired on almost every cell. #6 leaves UI/UX to us. | 2026-09-26 |
| Is the S-21 mockup (`design/mockups/VenueCalendar.dc.html`), an hour-by-hour grid with "tentative holds", superseded? | **Yes**, by AC2 and #50. Three fixed slots, not a continuous grid. Holds are shown, but as a note on the slot rather than a band on a timeline. | 2026-09-26 |
| SPM-43 AC7 says an approved request becomes a "Confirmed" booking. What do the screens call it? | **"Approved"**, as in the BPMN ("Booking approved?"). It is the same state the calendar shows as Booked and conflict detection blocks on; "Confirmed" stays an event status, so a booking on an event still in Planning is never labelled Confirmed. | 2026-10-02 |
| What form does Venue Staff's suggested alternative take (#45 says only that they may suggest one)? | **An optional venue picked from the catalogue and/or optional free text**, on the rejection. The coordinator gets a "Request this venue" shortcut to the normal request form; nothing is booked or held. | 2026-10-02 |
| How should the screen warn about a booking whose room time falls entirely between slots (12:00–13:00, 18:00–19:00, 24:00–07:00)? | `hiddenMinutes()` reports it and the booking card says the grid cannot show all of it. Time in a gap that still holds the slots either side is **not** warned about — that is ordinary changeover. | 2026-09-26 |

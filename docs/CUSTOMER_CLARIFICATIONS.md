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
| **#128**, **Week 7 Change #1** | 2026-10-02 | **15 minutes is the smallest unit of booking**, replacing the three slots: "One major change from what was clarified is the change of 3 slots to 15mins as the smallest unit of booking." Each venue has a setup time and a turnaround time, and "these periods must be included when checking availability and detecting booking conflicts. For example, an event scheduled from 10:00am to 12:00pm with 30 minutes of setup and 45 minutes of turnaround effectively occupies the venue from 9:30am to 12:45pm." Existing bookings that become problematic "should be identified rather than silently removed". Implemented in `src/lib/venueTime.ts` (SPM-93). **Supersedes #50, #107, #108 and #123 below.** |
| **#126** | 2026-10-06 | "With the week 7 change, the smallest unit of booking is 15mins, there will be **no fixed lunch and dinner blackout period**." |
| ~~#50~~ | 2026-08-25 | *Superseded by #128 (SPM-93).* **The three slots and their times.** "The venue will be booked based on 3 time slots (AM, PM, Night); if full day will be all 3 slots. AM (7am-12pm, 1pm-6pm, 7pm-12am)" — i.e. **AM 07:00–12:00, PM 13:00–18:00, Night 19:00–24:00**, with the hours between them uncovered. Implemented in `src/lib/venueSlots.ts`. |
| ~~#107~~ | 2026-09-07 | *Superseded by #128 (SPM-93).* **A slot touched at all is consumed in full.** "If an event runs across two slots, does it consume both slots in full? — Yes." So two approved bookings in one slot are a clash even when their own minutes never meet. |
| ~~#108~~ | 2026-09-07 | *Superseded by #128 (SPM-93): setup and turnaround are now minutes, in 15-minute steps.* **One slot is the smallest unit of setup and turnaround.** The system "does not need to support setup or turnaround durations smaller than a slot" for Release 1. So `Venue.setupMinutes` / `teardownMinutes` are read as yes/no by the calendar, not as durations. |
| ~~#123~~ | 2026-09-14 | *Superseded by #128 (SPM-93).* **Setup and turnaround take one whole *adjacent* slot, across days.** An AM event's setup takes the **previous day's Night**; a Night event's turnaround takes the **next day's AM**. Each is at most one slot. Implemented in `occupiedCells()`. |
| **#41** | 2026-08-25 | **Only one active tentative hold *or* confirmed booking per venue and overlapping period.** A hold "may later be confirmed or released" — which is our `VenueBooking.status = pending`. The calendar therefore shows pending requests without letting them take the slot; the hard block belongs at booking time (SPM-42), where the BPMN puts it. |
| **#109** | 2026-09-07 | Multiple candidate venues on hold *for one event* are **not** required for Release 1. Different question from #41. |
| **#35** | 2026-08-25 | Double-booking must be **blocked**, not merely warned about. |
| **#43** | 2026-08-25 | Venue Staff record setup, teardown and turnaround **per venue**. Since SPM-93 the two minute fields are "Setup time (minutes)" and "Turnaround time (minutes)" (`teardownMinutes` in the database), in 15-minute steps, and they are used as durations. |
| **#46** | 2026-08-25 | Venue Staff maintain operating hours. All days are equal — no weekday/weekend or holiday calendar. |
| **#112** | 2026-09-07 | Capacity **varies by layout**, and is given as a venue attribute — the system never estimates it. |
| **#120** | 2026-09-07 | A venue attribute change must **not** revert bookings to "Requested". Flag the affected booking for review and notify the coordinator (`VenueBooking.needsReview`, SPM-39). |
| **#122** | 2026-09-09 | Retiring a venue must **not** cancel or reschedule its future bookings. They are identified for review. The calendar still shows them; only empty slots read "Closed". |
| **#45** | 2026-08-25 | Venue Staff may **reject a booking and suggest an alternative venue or arrangement**; the change itself is made by the coordinator. So a suggestion is stored on the rejected request and books nothing (`VenueBooking.suggestedVenueId` / `suggestedAlternative`, SPM-43). |
| **#110** | 2026-09-07 | Venue Staff **cannot approve with amended details**. They suggest; the coordinator updates the request before approval. So the suggestion exists only on a rejection. |
| **#83** | 2026-08-31 | Filtering finds candidate venues; **suitability checking** assesses one already chosen. They are different things (SPM-41). |

## Equipment

Only the answers SPM-55 relied on are recorded here so far; the other equipment
answers (#2, #5, #19, #87, #90, #113, #114) are cited in `src/lib/equipmentAvailability.ts`.

| # | Date | The ruling |
|---|---|---|
| **#9** | 2026-08-25 | **Only Technical Support Staff decide equipment status:** "Technical Support Staff are responsible for maintaining equipment status." Coordinators cannot mark equipment damaged or unavailable (SPM-55). |
| **#23** | 2026-08-25 | **No expected return date, no automatic pre-booking.** "Equipment can be recorded as unavailable, damaged or under maintenance. Expected return date and automatic pre-booking are not specified; please propose if appropriate." We record no date: units stay out of service until Technical Support return them (SPM-55, decided 2026-10-11). |
| **#86** | 2026-08-31 | Defects found when equipment is **returned after an event** are recorded by Technical Support, and "the operational status of the affected equipment should be updated accordingly." Logging the defect is SPM-70; updating the status is SPM-55's screen. |

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
| What should a slot show when the venue is open for only part of it? The AC say nothing about opening hours. | **"Free" plus the hours it is open**, e.g. "Open from 08:00". *Moot since SPM-93: no slots; the opening hours are in the calendar's subtitle.* | 2026-09-26 |
| Is the S-21 mockup (`design/mockups/VenueCalendar.dc.html`), an hour-by-hour grid with "tentative holds", superseded? | **Yes**, by AC2 and #50. Three fixed slots, not a continuous grid. Holds are shown, but as a note on the slot rather than a band on a timeline. *Since SPM-93 the calendar lists actual times per day (see below).* | 2026-09-26 |
| SPM-43 AC7 says an approved request becomes a "Confirmed" booking. What do the screens call it? | **"Approved"**, as in the BPMN ("Booking approved?"). It is the same state the calendar shows as Booked and conflict detection blocks on; "Confirmed" stays an event status, so a booking on an event still in Planning is never labelled Confirmed. | 2026-10-02 |
| What form does Venue Staff's suggested alternative take (#45 says only that they may suggest one)? | **An optional venue picked from the catalogue and/or optional free text**, on the rejection. The coordinator gets a "Request this venue" shortcut to the normal request form; nothing is booked or held. | 2026-10-02 |
| How should the screen warn about a booking whose room time falls entirely between slots (12:00–13:00, 18:00–19:00, 24:00–07:00)? | *Moot since SPM-93: there are no slots and no gaps (#126).* | 2026-09-26 |
| Must a booking's setup and turnaround also fit within the venue's opening hours? Our question #131 (Q3) is unanswered. | **Yes** — the whole room-in-use period. The Week 1 briefing lists operating hours, setup and turnaround together as what decides availability, and Week 7 Change #1 says setup and turnaround are when the venue is "effectively occupied". A room cannot be set up while it is closed. If the customer answers #131 otherwise, that wins. | 2026-10-08 |
| Does a pending request (tentative hold) hold its setup and turnaround too? | **Yes.** #41 allows one hold or booking per "overlapping time period", and Week 7 Change #1 puts setup and turnaround into every availability check. | 2026-10-08 |
| What happens to venues whose setup or turnaround is not a 15-minute step (two seeded rooms had 20)? | **Rounded up**, never down, so Venue Staff keep at least the time they recorded (`scripts/spm93-round-turnaround.ts`). Bookings that then clash are listed, not changed (Week 7 Change #1); flagging them for the coordinator is SPM-80. | 2026-10-08 |
| How does the availability calendar show times now that there are no slots? #6 leaves it to us. | **One row per day listing each entry at its times** — "Setup 09:30–10:00", "Booked 10:00–12:00", "Turnaround 12:00–12:45", plus "Requested" for a hold and "Unavailable" — instead of AM / PM / Night columns. | 2026-10-08 |
| May two sessions of one event hold the same room at overlapping times? SPM-44 allowed it; SPM-81 AC4 says the same venue cannot be requested twice for the same event for overlapping times. | **No** — AC4 as written, per event (SPM-81). One room cannot host two of an event's sessions at once. Sessions that only meet end to start may follow each other in the room, and the event's own setup and turnaround never block it. | 2026-10-10 |
| With several venues per event (Week 7 Change #3), may a second venue be requested for only part of the event's time? | **No.** Every request still covers the event's (or session's) whole time, and may be wider. Change #3 describes spaces used "at the same time"; a room needed for part of the day is a session, which is booked for its own times. | 2026-10-10 |

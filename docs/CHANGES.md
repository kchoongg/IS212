# Change trail

Every change to the requirements after the Week 4 baseline: the six Week 7
Customer Changes, and the four forum answers that changed what we build
(#103, #125, #128, #129). For each: how we classified it, which stories it created,
reopened or reworded, the acceptance criteria before and after, and what it did
to test cases, automated tests and design documents.

**Sources: Jira comments and history, and git history only.** Where neither
records something, this page says "not recorded". AC numbers are positions in
the story's list on the date shown. Dates are Singapore time.

What each change made out of date is listed case by case in
[test-cases/DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md). The stories
themselves, with their PRs and tests, are in
[traceability/TRACEABILITY.md](traceability/TRACEABILITY.md).

**Reopened stories: none, for any of these changes.** The Jira history has no
story moved out of Done because of them. The only moves out of Done (SPM-4,
SPM-23, SPM-47) were on 2026-09-20, before Week 7. Where a Done story's
behaviour had to change, the team made a new story instead (SPM-81, SPM-88,
SPM-90, SPM-93), per the Week 7 Guide to Managing Changes, as the SPM-34
comment of 2026-10-02 22:18 explains.

| # | Change | Classification | New stories | Reworded stories |
|---|---|---|---|---|
| [1](#week-7-change-1--venue-setup-and-turnaround-time) | Venue setup and turnaround time | New requirement | SPM-80, SPM-93 | SPM-68 |
| [2](#week-7-change-2--venue-becomes-unavailable-after-booking) | Venue becomes unavailable after booking | Clarification | none | SPM-45, SPM-68 |
| [3](#week-7-change-3--multiple-venues-for-one-event) | Multiple venues for one event | New requirement | SPM-81, SPM-90 | SPM-33, SPM-34, SPM-37, SPM-38, SPM-64, SPM-67, SPM-68 |
| [4](#week-7-change-4--tentative-venue-holds-expire) | Tentative venue holds expire | New requirement | SPM-82 | none |
| [5](#week-7-change-5--addition-of-event-coordinator-lead-role) | Event Coordinator Lead role | New requirement, then a rename (see #129) | SPM-83, SPM-84 | SPM-53, SPM-58, SPM-74 |
| [6](#week-7-change-6--operational-feasibility-check) | Operational feasibility (safety) check | New requirement | SPM-85, SPM-86, SPM-87, SPM-88 | SPM-33, SPM-34, SPM-37, SPM-38 |
| [#103](#forum-103--record-request-withdrawal) | Record request withdrawal | Clarification | SPM-59 | none |
| [#125](#forum-125--who-sees-a-review-outcome) | Who sees a review outcome | Correction | SPM-94 | SPM-53 |
| [#128](#forum-128--15-minute-booking-unit-week-7-clarification) | 15 minutes as the booking unit | Clarification that corrects earlier rulings (#108, #123) | SPM-93 | SPM-45, SPM-67, SPM-68, SPM-80, SPM-81, SPM-82 |
| [#129](#forum-129--event-coordinator-lead-is-the-renamed-operations-manager) | Lead = renamed Operations Manager | Clarification, recorded as a change request (rename) | none (SPM-83 folded into SPM-84) | SPM-58, SPM-74, SPM-83, SPM-84 |

## Superseded acceptance criteria

Current Jira ACs that a change replaced but that were left as written,
because their stories are Done. `npm run trace` reads this table and shows these
ACs as **Superseded** rather than as gaps. Keep it in this format: one row per
story, ACs comma-separated.

| Story | AC | Replaced by | Change |
|---|---|---|---|
| SPM-42 | AC2, AC3 | SPM-93 AC1, AC5, AC6 (times on a 15-minute grid; setup and turnaround in minutes) | #128 |
| SPM-44 | AC2, AC4 | SPM-93 AC6, AC7 (conflicts compared by occupied period, not slot) | #128 |
| SPM-46 | AC2 | SPM-93 AC9 (calendar at actual times) | #128 |
| SPM-83 | AC1, AC2 | SPM-84 AC2, AC3 (SPM-83 folded into SPM-84 on 2026-10-06) | #129 |

Week 7 changes were applied to Jira on 2026-10-02 (Kristen Choong), and the new
stories SPM-80 to SPM-88 were created that day. SPM-90 was split from SPM-81 on
2026-10-04. SPM-93 and SPM-94 were created on 2026-10-06.

---

## Week 7 Change #1 – Venue setup and turnaround time

**Classification:** new requirement. SPM-80's description: "New requirement.
Follows on from Manage Venue Catalogue (SPM-39, Done), which stays Done."

**Stories created:** SPM-80 Re-check Bookings When Setup or Turnaround Time
Changes (2026-10-02, Sprint 4; built 2026-10-20). The booking unit itself became
SPM-93 after forum #128 (see below).

**Stories reworded:**
- SPM-68, AC2 (2026-10-02): old "…why it was flagged (e.g. event date changed, attendance changed, venue attributes updated, venue retired, venue blocked, equipment marked unavailable)" → new "…(e.g. event date changed, attendance changed, venue attributes updated, venue setup or turnaround time changed, venue retired, venue blocked, equipment marked unavailable)". Jira comment 2026-10-02 22:06: "'Venue setup or turnaround time changed' added to the reasons a booking can be flagged – Change #1".
- SPM-80, AC1 removed (2026-10-04 15:44): "Venue Staff can set and change the setup time and the turnaround time for each venue." Comment 2026-10-04 15:45: "Criterion removed: already built… in SPM-39."
- SPM-80, AC1–AC3 reworded for minutes (2026-10-06 22:29, comment the same day), for example AC2: old "…now occupy the same period once setup and turnaround are included…" → new "…now occupy overlapping periods once setup and turnaround are included…".

**Test cases:** SPM-80-TC01 to TC09 (`docs/test-cases/SPM-80_Test_Cases.xlsx`, 2026-10-20). SPM-80 also changed the venue page's message after a save that flags nothing, from "No approved bookings were affected, …" to "No bookings were affected, …", since a setup or turnaround change re-checks pending requests too. Ten cases quote it and are marked Updated (Week 7 #1): SPM-39-TC05, TC13, TC18, TC22, TC24; SPM-43-TC14; SPM-45-TC01, TC08, TC11; SPM-93-TC07 ([DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md)). The slot-based cases this change and #128 made out of date are listed under #128.

**Automated tests:** SPM-80's are `src/lib/__tests__/turnaroundRecheck.test.ts`, the SPM-80 block of `src/app/api/__tests__/venues.test.ts`, one test in `src/app/__tests__/venue-catalogue-pages.test.tsx` and `integration/venue-turnaround-recheck.test.ts`. Three existing tests in `venue-catalogue-pages.test.tsx` now expect the new "No bookings were affected" wording. SPM-80 also changed the venue page's subtitle from "…bookings that are already approved…" to "Changes here can affect this venue's bookings. Nothing is changed for them automatically."; no test case or test quoted the old one. The tests for setup and turnaround in minutes came with SPM-93 (#128).

**Design documents:** PR #45 (merged 2026-10-10, kayalvizhi24, "Update BPMN and status lifecycle diagrams for the Week 7 changes") changed `docs/ConnectSphere_BPMN.drawio`: "the venue search and Venue Staff's review say availability and conflicts include setup and turnaround time". See #128 for SPM-93's.

---

## Week 7 Change #2 – Venue becomes unavailable after booking

**Classification:** clarification. SPM-45 comment, 2026-10-02 22:06: "Change #2 clarifies this story, so it is updated in place."

**Stories created:** none.

**Stories reworded:**
- SPM-45 (2026-10-02 22:06), for example AC3: old "Venue Staff can provide a reason for the unavailability." → new "Venue Staff must select a reason category for the unavailability: maintenance, equipment failure, renovation, safety concern, or other operational reason, and can add a description." Added: AC7 "Venue Staff can record an unavailable period even when future events are already booked…", AC9 "The affected event is not cancelled…", AC10 "The Coordinator can search for and request a replacement venue…".
- SPM-45 was then cut down twice on 2026-10-04 (15:45, and 15:59: "Story scaled down again, to dates on the existing retire function… Dropped from this story: the reason category…"). On 2026-10-06 the reason category came back (17:45, KANDASAMY KAYALVIZHI: AC6 "Venue Staff must select the reason for an unavailable period…"), and the story was reworded for the 15-minute grid (#128, 22:28).
- SPM-68 (2026-10-02 22:06): old AC7 "The Coordinator can replace a flagged venue booking by releasing it and requesting another venue" → new AC8–AC10: search pre-filled from the flagged booking, "The Coordinator can request the replacement venue; the flagged booking stays on the event record until the Coordinator releases it", "Replacing a venue does not change the event's own information or status." Comment: "Change #2… 'The system should preserve the original event information while allowing the coordinator to search for and request a replacement venue.'"

**Test cases:** none retired or updated. SPM-45's cases were written after the rewording, against the 15-minute version (PR #44).

**Automated tests:** added in PR #44 (SPM-45, merged 2026-10-10): `src/app/api/__tests__/venue-unavailability.test.ts` and `src/lib/__tests__/venueUnavailability.test.ts`. Their header says they were "Rewritten on 2026-10-09 for times on the 15-minute grid (Week 7 Change #1, SPM-93), before the code was reworked."

**Design documents:** PR #44 changed `SCHEMA_REFERENCE.md`, `UI_DESIGN.md`, `docs/ConnectSphere_Status_Lifecycle.drawio` and `docs/PERMISSIONS.md`. PR #45 (merged 2026-10-10, kayalvizhi24, "Update BPMN and status lifecycle diagrams for the Week 7 changes") changed the BPMN: the exception start reads "Venue retired, marked unavailable or attributes changed", and its "no longer suitable" end returns to venue search for a replacement.

---

## Week 7 Change #3 – Multiple venues for one event

**Classification:** new requirement. SPM-81's description: "New requirement. Follows on from Request Venue Booking (SPM-42, Done), which keeps its original scope."

**Stories created:** SPM-81 Request More Than One Venue for an Event (2026-10-02); SPM-90 Check Each Venue Against Its Own Requirements, split from SPM-81 on 2026-10-04 ("As written it sized at 8 on the team scale, which must be split").

**Stories reworded** (all 2026-10-02 22:06 unless noted):
- SPM-33: added AC2 "Given an event has more than one venue booking… each venue booking is listed separately with its own status".
- SPM-34: added "Given an event has more than one venue booking, when the Coordinator attempts to confirm it, then every required venue booking must be confirmed". Moved out at 22:18 to SPM-81 (now SPM-90 AC6): "the two criteria added for the Week 7 Customer Changes depend on stories that are not built yet… Both are new requirements, so under the Week 7 Guide to Managing Changes they belong in new stories."
- SPM-37, AC3: old "Cancelling an event releases its venue booking and equipment reservations…" → new "Cancelling an event releases all of its venue bookings, at every venue, and its equipment reservations…".
- SPM-38, AC3: old "Postponing releases the event's existing venue and equipment arrangements…" → new "Postponing releases all of the event's existing venue bookings, at every venue, and its equipment arrangements…".
- SPM-64: added AC4 "Given the event has more than one venue booking… they select which venue booking the capacity is measured against…".
- SPM-67: added "withdrawing or releasing one venue booking leaves the event's other venue bookings unchanged". Removed 2026-10-04 15:44 because it was duplicated: "It now lives only in SPM-81".
- SPM-68: added AC3 "…only that booking is listed and the event's other venue bookings are unaffected". Trimmed 2026-10-04 15:44 to "…then only the flagged booking is listed."

**Test cases:** SPM-81-TC01 Updated, because SPM-90 added the "What is this space for?" field (found in the Sprint 3 regression, 2026-10-18). None retired.

**Automated tests:** added and changed in PR #46 (SPM-81, 2026-10-11): `event-pages`, `event-venue-pages`, `list-pages`, `event-venue`, `venueBookingRequest`, `venueConflict` tests. Also changed in PR #53 (SPM-90, 2026-10-14): 12 test files, including `venueSuitability` and `eventConfirmation`. None archived.

**Design documents:** PR #46 changed `docs/CUSTOMER_CLARIFICATIONS.md`. PR #45 (merged 2026-10-10, kayalvizhi24, "Update BPMN and status lifecycle diagrams for the Week 7 changes") added an "Another venue needed?" gateway to the BPMN, looping back to venue search. PR #53 changed `SCHEMA_REFERENCE.md`, `UI_DESIGN.md` and `docs/CUSTOMER_CLARIFICATIONS.md`, and added migration `20261013120000_add_venue_booking_space`.

---

## Week 7 Change #4 – Tentative venue holds expire

**Classification:** new requirement. SPM-82's description: "New requirement. Touches Review Venue Booking Request (SPM-43), Detect Venue Booking Conflicts (SPM-44) and View Venue Availability (SPM-46); none of those change scope." Discussion #128 confirms it is core for release 1.

**Stories created:** SPM-82 Expire Tentative Venue Hold (2026-10-02).

**Stories reworded:** only SPM-82 itself, for #128 (see below).

**Test cases:** SPM-82-TC08 Updated, for the safety gate (Change #6). None retired.

**Automated tests:** added in PR #62 (SPM-82, merged 2026-10-16): `venue-hold-expiry`, `holdExpiry` and `holdExpiryService` tests. It also changed 12 other test files. None archived.

**Design documents:** PR #62 changed `SCHEMA_REFERENCE.md`, `UI_DESIGN.md` and `docs/PERMISSIONS.md`, and added migration `20261015130000_add_venue_hold_expiry`. PR #45 (merged 2026-10-10, kayalvizhi24, "Update BPMN and status lifecycle diagrams for the Week 7 changes") added a hold-expiry flow to the BPMN's "Changes and exceptions" (Venue Staff lane).

---

## Week 7 Change #5 – Addition of Event Coordinator Lead role

**Classification:** new requirement at first (SPM-83's description: "New requirement…"). Forum #128 and #129 then said it is the existing Event Operations Manager under a new name (see #129).

**Stories created:** SPM-83 Event Coordinator Lead Role for Assignment and SPM-84 (then "View Coordinator Assignments and Active Events"), both 2026-10-02.

**Stories reworded:**
- SPM-83 reduced on 2026-10-04 (15:44 and 15:48) from 12 ACs to 2, because it duplicated SPM-30. For example, removed AC4 "The Lead can view the unassigned queue, oldest submission first." Kept: "The Lead can view the unassigned queue and assign and reassign events, using the functions built in SPM-30." Closed on 2026-10-06 without being built (see #129).
- SPM-84 on 2026-10-06 (see #129).
- SPM-53, added AC7 (2026-10-06 22:26): "Given an event is reassigned to a different Coordinator… the newly assigned Coordinator and the Event Organiser are notified… and the previously assigned Coordinator is notified that the event is no longer theirs." Comment: "Week 7 Change #5: 'Relevant users should be notified when assignments or reassignments occur.'"

**Test cases:** SPM-84's own, `docs/test-cases/SPM-84_Test_Cases.xlsx` (9, written 2026-10-20). 29 cases of other stories that name the role on screen, or open SPM-30's renamed 'Assigned' tab, set to **Updated** with a v2 note (SPM-21, 22, 27, 28, 30, 42, 46, 52, 54, 55, 62, 64, 67, 68, 85, 86, 87; listed in DECOMMISSIONED.md).

**Automated tests:** the two tests that asserted the old role name now assert the new one, and SPM-30's Assignments tests use the 'Active events' tab and the API's `active` list (values only, listed in DECOMMISSIONED.md). New: `src/lib/__tests__/coordinatorAssignments.test.ts` and SPM-84 tests in `list-pages.test.tsx` and `lists.test.ts`.

**Design documents:** PR #45 (merged 2026-10-10, kayalvizhi24, "Update BPMN and status lifecycle diagrams for the Week 7 changes") renamed the BPMN's Event Operations Manager lane (#129) and shows the unassigned queue, with the Lead assigning and reassigning; the lifecycle's Submitted → Under review arrow reads "Lead assigns". Not recorded for the C4 model: `docs/architecture/connectsphere.dsl` still names the person "Ops Manager".

---

## Week 7 Change #6 – Operational feasibility check

**Classification:** new requirement. SPM-85 to SPM-88's descriptions: "New requirement."

**Stories created** (all 2026-10-02): SPM-85 Safety Officer Role and Access, SPM-86 Submit Event for Operational Safety Check, SPM-87 Conduct Operational Safety Check, SPM-88 Resolve Safety Check Outcome.

**Stories reworded** (2026-10-02 22:06 unless noted):
- SPM-33: added AC5 "The Operational Safety Check is displayed as a required item, showing whether it is not yet submitted, awaiting review, approved, or returned…" and AC8 "The Operational Safety Check cannot be marked as not required."
- SPM-34: added "Given the event has not been approved by the Safety Officer, when the Coordinator attempts to confirm it, then confirmation is refused…". Moved to SPM-88 at 22:18 (comment above). SPM-34 "is back to its pre-Week 7 scope".
- SPM-37: added AC6 "A pending Operational Safety Check for the event is closed and no longer appears for the Safety Officer to review."
- SPM-38: added AC4 "A pending Operational Safety Check for the event is closed, and an existing safety approval no longer applies…".
- SPM-88: old AC7 "An event that is not safety-approved cannot be confirmed (see: Confirm Event)." → new AC7 "Given the event has not been approved by the Safety Officer, when the Coordinator attempts to confirm it, then confirmation is refused…" (2026-10-02 22:18). Old AC6 "An ordinary edit that does not affect arrangements does not remove a safety approval." → new AC6/AC7 covering edits during Safety Review (2026-10-06 22:30, "Team decision to confirm").

**Test cases:** 33 Updated (SPM-33 ×14, SPM-34 ×7, SPM-64 ×3, SPM-67 ×2, SPM-68 ×3, SPM-82 ×1, SPM-90 ×3). Confirm event now waits for an approved safety check. None retired.

**Automated tests:**
- Added in PR #42 (SPM-86, 2026-10-10), #49 (SPM-85, 2026-10-13), #54 (SPM-87, 2026-10-14) and #63 (SPM-88, 2026-10-16).
- Archived on 2026-10-19: one Readiness test, "says Confirm does not wait for it yet", which tested the pre-SPM-88 behaviour.

**Design documents:**
- `docs/ConnectSphere_Status_Lifecycle.drawio`: changed in PR #42 and PR #54 (Safety review and Safety approved statuses).
- `docs/ConnectSphere_BPMN.drawio`: PR #45 (merged 2026-10-10, kayalvizhi24, "Update BPMN and status lifecycle diagrams for the Week 7 changes") added a Safety Officer lane and a "Safety review" band; "Arrangements complete?" leads to "Submit event for Operational Safety Check".
- `docs/PERMISSIONS.md` and `UI_DESIGN.md`: changed in PRs #42, #49, #54 and #63.
- `SCHEMA_REFERENCE.md`: changed in PRs #42, #54 and #63.
- Migration `20261009120000_add_safety_check` (PR #42).
- C4 model (`docs/architecture`): not recorded. It is unchanged since 2026-09-19 and has no Safety Officer.

---

## Forum #103 – Record request withdrawal

**Classification:** clarification. Discussion #103 (2026-09-07): "An Event Organiser may request the Event Coordinator, outside the system, to withdraw a submitted event request while it is under review. The Event Coordinator will process and record the withdrawal in the system. The withdrawn request should remain distinguishable from draft, submitted, approved, rejected, or other request states." Recorded in `docs/CUSTOMER_CLARIFICATIONS.md` (#103).

**Stories created:** SPM-59 Record Request Withdrawal (Sprint 4, estimate 2: "Small and well understood: one action and a new Withdrawn status."). Its creation date is not recorded here. The withdrawal itself was first built under SPM-27 (2026-10-02, "withdrawal per clarification #103": the assigned coordinator's Record withdrawal while the request is Under review); SPM-59 (PR #80, 2026-10-22) checked it against its own ACs and closed two gaps: Withdrawn in the status filter, and closed-event messages that name withdrawn events.

**Stories reworded:** not recorded.

**Test cases:** SPM-59-TC01 to TC06 (`docs/test-cases/SPM-59_Test_Cases.xlsx`, 2026-10-22). SPM-59 also changed the messages that refuse an action on a closed event to name withdrawn events ("…completed, cancelled, rejected or withdrawn event", built from `TERMINAL_EVENT_STATUSES`). Three cases quote them and are marked Updated (Forum #103): SPM-42-TC13; SPM-43-TC06; SPM-54-TC13 ([DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md)).

**Automated tests:** SPM-59's are the [SPM-59] tests in `src/lib/__tests__/statuses.test.ts`, `venueBookingRequest.test.ts`, `src/app/api/__tests__/event-detail.test.ts`, `event-coordinator.test.ts`, `src/app/__tests__/event-pages.test.tsx` and `list-pages.test.tsx`. Existing tests that quoted the old closed-event messages now expect the new wording (`event-venue`, `event-venue-pages`, `venueBookingRequest`, `event-equipment`, `equipment-pages`, `venue-booking-review`, `venueBookingReview`). None archived.

**Design documents:** none changed. The Withdrawn status and its Under review → Withdrawn move were already in `docs/PERMISSIONS.md` and the status lifecycle (SPM-27). PR #80 changed `DOCUMENTATION.md` only.

---

## Forum #125 – Who sees a review outcome

**Classification:** correction. SPM-94's description: "Fix to Review Event Request (SPM-28) and View Event Information (SPM-31). Today every internal role can open any submitted event…". Discussion #125 was answered on 2026-09-28. The Jira record of it starts on 2026-10-06.

**Stories created:** SPM-94 Limit Who Sees a Request's Review Outcome (2026-10-06, Sprint 4; built 2026-10-23).

**Stories reworded:** SPM-53, AC4 (2026-10-18 22:00, KANDASAMY KAYALVIZHI): old "Relevant users … approved or rejected" → new "The Event Organiser who owns the event is notified when the assigned Event Coordinator approves or rejects it, with the reason for a rejection. No other user is notified of the outcome." The comment cites "discussion #125".

**Test cases:** SPM-94-TC01 to TC11 (new; TC11, an event cancelled before approval, added after review of PR #86; `docs/test-cases/SPM-94_Test_Cases.xlsx`, fixtures `npm run fixtures:spm94`). SPM-31-TC02 Updated (v2 note: Venue Staff see events from Approved on). See DECOMMISSIONED.md.

**Automated tests:** new [SPM-94] tests in `permissions.test.ts`, `event-detail.test.ts`, `events.test.ts`, `event-equipment.test.ts` and `equipment-pages.test.tsx`. Values changed (403 → 404 for the three roles on an unapproved event, their list filter) in `clarifications.test.ts`, `event-coordinator.test.ts`, `event-detail.test.ts`, `event-equipment.test.ts`, `lists.test.ts`, `events.test.ts` and `permissions.test.ts`; none archived (DECOMMISSIONED.md).

**Design documents:** `docs/PERMISSIONS.md` §3 (who can see which event; the rejection reason) and §4.

---

## Forum #128 – 15-minute booking unit (Week 7 clarification)

**Classification:** a clarification of Change #1 that corrects earlier forum rulings. SPM-93's description: "Supersedes the three fixed daily slots (AM, PM, Night) and the slot rulings in discussions #108 and #123." It quotes #128 (2026-10-02): "One major change from what was clarified is the change of 3 slots to 15mins as the smallest unit of booking", and #126 (2026-10-06): "there will be no fixed lunch and dinner blackout period". #128 also confirms that Changes #1, #2 and #4 are core for release 1.

**Stories created:** SPM-93 Book Venues in 15-Minute Units (2026-10-06). Added to Sprint 3 after the sprint started: "This is scope added after the sprint started, so it goes in the velocity log separately" (comment 2026-10-06 22:57).

**Stories reworded** (all 2026-10-06; the stories still to build):
- SPM-45 AC1: old "…stating the date and slot (AM, PM or Night) it becomes unavailable…" → new "…stating the date and time it becomes unavailable and the date and time it becomes available again, on the 15-minute booking grid…" (AC2–AC5 the same way).
- SPM-67 AC4: old "…then its slots, including any setup or turnaround slots, are available for other bookings." → new "…then the period it occupied, including the venue's setup and turnaround time, is available for other bookings…".
- SPM-68 AC11: old "…pre-filled from that booking's date, slots, attendance…" → new "…pre-filled from that booking's date, start and end times, attendance…".
- SPM-80 AC1–AC3, in minutes (see Change #1).
- SPM-81 AC1 "…same date and slots" → "…same date and times"; AC4 "…in the same slot" → "…for overlapping times"; AC6 "…its venue, slots and status" → "…its venue, times and status".
- SPM-82 AC6: old "…then its slots, including setup and turnaround slots, are available…" → new "…then the period it occupied, including the venue's setup and turnaround time, is available…".
- **Left as written** in Jira (Done stories): SPM-42 AC2–AC3, SPM-44 AC2 and AC4, SPM-46 AC2. Their slot rules are superseded by SPM-93 AC1, AC5–AC7 and AC9. SPM-44 comment 2026-10-06: "This story's criteria are unchanged… SPM-93 changes the booking unit across the venue booking stories."

**Test cases:**
- 17 Retired: SPM-40-TC10; SPM-42-TC03, TC04, TC05, TC06, TC07, TC08, TC15; SPM-43-TC05, TC16; SPM-44-TC02, TC07, TC11; SPM-46-TC05, TC06, TC07, TC08.
- 33 Updated, across SPM-42, SPM-43, SPM-44, SPM-46 and SPM-54.
- Replacements are SPM-93's own cases (TC01–TC17), or the -R rewrites the team ran in the Sprint 3 regression. Two have no manual replacement: SPM-44-TC11 and SPM-46-TC07 (see DECOMMISSIONED.md).

**Automated tests:**
- In PR #41 (SPM-93, merged 2026-10-09): `src/lib/__tests__/venueSlots.test.ts` was deleted together with `src/lib/venueSlots.ts`, and `venueTime.test.ts` was added.
- 15 test files were changed in the same PR: `event-venue-pages`, `list-pages`, `venue-availability-page`, `venue-catalogue-pages`, `event-venue`, `venue-availability-search`, `venue-booking-review`, `edgeCases`, `validation`, `venueAvailability`, `venueBookingRequest`, `venueBookingReview`, `venueConflict`, `venueForm`, `venueSearch`.
- On 2026-10-19 the deleted test was restored from git into `tests/archive/venueSlots.test.ts` as the record.

**Design documents:** PR #41 changed `SCHEMA_REFERENCE.md`, `UI_DESIGN.md` and `docs/CUSTOMER_CLARIFICATIONS.md`. No migration was needed: "Bookings and unavailable periods already store real start and end times" (comment 2026-10-06 22:57).

---

## Forum #129 – Event Coordinator Lead is the renamed Operations Manager

**Classification:** a clarification of Change #5, recorded here as a change request: rename the Event Operations Manager to Event Coordinator Lead. SPM-84's description quotes #129: "There is a need of change in display name from Events Operation Manager to Events Coordinator Lead. It is the same role, just a change of name."

### Change request: rename "Event Operations Manager" to "Event Coordinator Lead"

| | |
|---|---|
| Requested by | The customer, in discussions #128 and #129 |
| Recorded in Jira | 2026-10-06 22:26 (Kristen Choong), on SPM-83, SPM-84, SPM-58 and SPM-74 |
| What changes | The display name only, "everywhere it appears in the system, including the top bar, navigation, dashboards and the Assignments screen. Existing accounts, permissions and records are unchanged." (SPM-84 AC1) |
| Stories | SPM-83 folded into SPM-84 and closed without being built ("Marked Done only because the workflow has no 'Won't Do' status"); SPM-84 renamed "Event Coordinator Lead: Rename Role and View Assignments", estimate 2 + 2 |
| Built | SPM-84, Sprint 4 (branch `SPM-84-event-coordinator-lead-rename-role-and-view-assignments`, 2026-10-20): `ROLE_LABELS.ops_manager` is "Event Coordinator Lead"; the role key `ops_manager` is unchanged |

**Stories reworded** (2026-10-06):
- SPM-84 gained new AC1 (the rename), AC2–AC3 (from SPM-83) and AC9. Old AC6 "…(see: Assign Events as Event Coordinator Lead)" → new AC9 "…using the reassignment built in SPM-30".
- SPM-58 AC1: old "The assigned Event Coordinator or an Event Operations Manager can reassign an event…" → new "The assigned Event Coordinator or the Event Coordinator Lead can reassign an event…".
- SPM-74 AC6: old "…never visible to Event Coordinators or the Event Operations Manager." → new "…never visible to Event Coordinators or the Event Coordinator Lead."
- SPM-22 AC6, SPM-30 and SPM-4 (Done) still say "Operations Manager"; not recorded as reworded.

**Test cases:** none changed yet. 28 cases name the role on screen and will need their wording updated in SPM-84's PR (listed under Pending in DECOMMISSIONED.md).

**Automated tests:** none changed yet. Two assert the old name (listed in DECOMMISSIONED.md).

**Design documents:** PR #45 (merged 2026-10-10, kayalvizhi24, "Update BPMN and status lifecycle diagrams for the Week 7 changes") renamed the Event Operations Manager lane in `docs/ConnectSphere_BPMN.drawio` and labels the lifecycle arrow "Lead assigns". Not recorded for the C4 model, `docs/PERMISSIONS.md` (13 mentions) and `UI_DESIGN.md` (4), which still say Operations Manager.

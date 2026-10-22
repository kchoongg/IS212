# ConnectSphere — Role and Permission Model

**Status:** implemented · **Code:** [`src/lib/permissions.ts`](../src/lib/permissions.ts) ·
**Tests:** [`src/lib/__tests__/permissions.test.ts`](../src/lib/__tests__/permissions.test.ts)

This document is the design; `permissions.ts` is the same design as code, and
the test file asserts it. If you change one, change all three.

Two sources govern it:

- **Customer briefing §8b** — "The system should only allow authorised users to
  access protected information. Access should depend on the user's **role and
  relationship to an event**. For example, an Event Organiser should not
  normally be able to view events belonging to unrelated clients, and an
  Attendee should not be able to view internal planning information."
- **Week 4 core feature 1** — "Users should only be able to **view or modify**
  information appropriate to their role and relationship to an event."

Both halves are required. Being a coordinator does not let you approve somebody
else's event; owning an event does not let you approve your own.

---

## 1. The roles

| Key | Label | Internal / External | Where it comes from |
| --- | --- | --- | --- |
| `organiser` | Event Organiser | External | Briefing §3 |
| `coordinator` | Event Coordinator | Internal | Briefing §3 |
| `venue_staff` | Venue Staff | Internal | Briefing §3 |
| `tech_support` | Technical Support Staff | Internal | Briefing §3 |
| `attendee` | Attendee | External | Briefing §3 |
| `ops_manager` | Event Coordinator Lead (shown as "Event Operations Manager" until SPM-84; Week 7 change #5, forum #129) | Internal | **Our addition** — see below |
| `safety_officer` | Safety Officer | Internal | Week 7 change #6 (SPM-85) — see below |

The briefing names five roles. `ops_manager` is a sixth that we added: §5 Step 3
says an event "is assigned" to a coordinator without saying by whom, and a
coordinator cannot assign themselves before they are responsible for the event.
We model that assigner as an internal admin variant of Coordinator — identical
chrome, one extra screen (`/assignments`). This is a design decision, not a
requirement; it is worth confirming at a customer Q&A.

`safety_officer` came with the Week 7 changes (change #6, clarification #128:
"a new role and requirement due to regulation"). The Safety Officer reviews the
operational safety of an event once its arrangements are made: SPM-86 submits
an event for that Operational Safety Check, SPM-85 gives the role its access,
and SPM-87 adds its decision. It reads what a review needs and changes nothing
— see `event:safety_check` below, and SPM-85 in DOCUMENTATION.md.

Roles are stored as a plain string on `users.role`. The allowed values are
listed in `ROLES` in `src/lib/roles.ts`. There is no database CHECK constraint,
which is consistent with the project-wide decision that business rules live in
route code (DOCUMENTATION.md §"Business rules live in code, not the database").

### Which roles a user may give themselves

**Only `organiser` and `attendee`** — `SELF_REGISTERABLE_ROLES` in
`src/lib/roles.ts`, enforced by `registerSchema` and mirrored in the S-02
dropdown.

This matters more than it looks. `POST /api/auth/register` takes no session, so
whatever that schema accepts is what any anonymous caller on the internet can
become. Until 2026-09-18 it accepted the full six-role enum, and registering as
`ops_manager` was enough to read every client's events — every rule in this
document enforced faithfully against a role the caller had picked for
themselves. A permission model is only as good as the weakest way of acquiring
a role.

The five internal roles are created by `npx prisma db seed` today (the Safety
Officer, Hana Yusof, also by `npm run fixtures:spm85`, which needs no reseed);
an admin screen for them is an open item (§8).

---

## 2. Permissions by role

`can(role, action)` answers this table and nothing else — it is the role half of
the model, deliberately blind to which event is involved.

| Action | Organiser | Coordinator | Coordinator Lead | Venue Staff | Tech Support | Attendee | Safety Officer |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `event:create` | ✅ | — | — | — | — | — | — |
| `event:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `event:edit_draft` | ✅ | — | — | — | — | — | — |
| `event:review` (clarify / approve / reject) | — | ✅ | — | — | — | — | — |
| `event:assign_coordinator` | — | — | ✅ | — | — | — | — |
| `event:confirm` | — | ✅ | — | — | — | — | — |
| `event:cancel` | — | ✅ | — | — | — | — | — |
| `event:safety_check` (the Operational Safety Check) | — | — | — | — | — | — | ✅ |
| `venue:view` | — | ✅ | ✅ | ✅ | — | — | — |
| `venue:manage` | — | — | — | ✅ | — | — | — |
| `venue_booking:request` | — | ✅ | — | — | — | — | — |
| `venue_booking:decide` | — | — | — | ✅ | — | — | — |
| `equipment:view` | ✅ | ✅ | ✅ | — | ✅ | — | — |
| `equipment:view_status` | — | ✅ | ✅ | — | ✅ | — | — |
| `equipment:manage` | — | — | — | — | ✅ | — | — |
| `equipment_request:manage` | — | ✅ | — | — | — | — | — |
| `equipment_request:review` | — | — | — | — | ✅ | — | — |
| `registration:create` | — | — | — | — | — | ✅ | — |
| `registration:view_list` | ✅ | ✅ | — | — | — | — | — |
| `facility:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Each row traces to the briefing's §5 process: the organiser drafts and submits
(Steps 1-2), the Ops Manager assigns (Step 3), the coordinator reviews, approves
and confirms (Steps 4-5, 10), Venue Staff decide bookings (Step 7), Technical
Support decides equipment (Step 8), attendees register (Step 11).

Three entries are worth explaining:

- **`equipment:view` includes the organiser.** The event request form (S-08)
  asks the organiser to pick the equipment they need from the catalogue, so the
  catalogue is part of making a request, not internal planning information.
- **`equipment:view_status` does not** (SPM-55). How many units are out of
  service, which kind and why is ConnectSphere's operational business: the
  Equipment page and that part of `GET /api/equipment` are for Coordinators,
  the Ops Manager and Technical Support.
- **`venue:view` excludes the organiser.** Venue selection is the coordinator's
  job (§5 Step 6). An organiser learns their venue through the confirmed event,
  not by browsing the catalogue.
- **`equipment_request:manage` is separate from `equipment_request:review`.**
  Recording what an event needs (SPM-47) is the coordinator's job; deciding
  whether it can actually be provided (SPM-48/49/50) is Technical Support's.
  Same split as `venue_booking:request` / `venue_booking:decide` above, one
  action per side of the same conversation.
- **Viewing one event's recorded equipment is not the same permission as
  `equipment:view`.** `equipment:view` (above) is the catalogue — what the
  organiser browses to make a request. Seeing what's actually been recorded
  *for a specific event* is `canViewEquipmentRequests()` (§3, below the role
  table — it's a relationship check, not a flat role permission): Technical
  Support always, the assigned Coordinator because managing it requires
  seeing it, and the owning Organiser read-only (confirmed 2026-09-19 —
  broader than AC6's literal wording, but an Organiser reasonably wants to
  see what's recorded against their own event; see `UI_DESIGN.md` §4.3).

- **`event:safety_check` is the Safety Officer's alone** (SPM-85). Today it
  opens the Safety Checks page (`/safety-checks`, the events in Safety review);
  SPM-87's decision — approve, reject, request changes — uses the same action.
  Everything else the Safety Officer reads comes through `event:view` and the
  relationship rules in §3: every event that has left Draft, its full record
  (§4 narrows only the Attendee's), and its equipment read-only
  (`canViewEquipmentRequests`). They hold no venue, equipment, registration or
  status action, so every "change" rule refuses them without naming them. Not
  `venue:view` — the catalogue and the Find a venue search are not part of a
  safety review; the rooms an event actually has are on its Overview (the
  "Venue bookings" card). Not `registration:view_list` — who registered, and
  their dietary and accessibility needs, are attendee personal details (AC6).

- **Notifications need no action** (SPM-71). They are personal: every signed-in
  user, of any role, reads and marks only their own. That is enforced in the
  query, not in this table - each notifications route scopes to
  `recipientId = <the caller>`, and marking someone else's one is 404 (the
  update's own where clause does not match), never 403. Selecting a
  notification grants nothing: the screen it opens decides access as if the
  address had been typed.

An unknown role — anything not in `ROLES` — is granted nothing.

---

## 3. Relationship to an event

Passing the table above is necessary, not sufficient. For anything involving a
specific event, the user must also be related to it.

| Relationship | Meaning |
| --- | --- |
| **Owns** | `event.organiserId === user.id` — the organiser who raised the request |
| **Same client** | `event.organisationId === user.organisationId`, both non-null |
| **Assigned** | `event.coordinatorId === user.id` — and only that; an event with no coordinator is nobody's (SPM-30) |

The user's `organisationId` is not in the JWT. `getActor()` in
[`src/lib/apiAuth.ts`](../src/lib/apiAuth.ts) loads it (and the current role,
and `isActive`) per request, so a role change or a deactivated account takes
effect immediately rather than when the eight-hour token expires.

**Assigned** used to have an "or the event has no coordinator yet" clause, so
any coordinator could pick work off the review queue before Coordinator
Assignment existed. SPM-30 removed it (confirmed 2026-09-28): the Event
Operations Manager assigns every submitted event (clarifications #94, #101),
so an unassigned event is visible to every coordinator but managed by none.

**The Event Coordinator Lead** (SPM-84) is this role under its new name: the key
stays `ops_manager`, so accounts, permissions and records are unchanged, and
"Ops Manager" below means the Lead. Besides assigning, the Lead sees every
Event Coordinator with their number of active events and every active event
(not Draft, Rejected, Withdrawn, Cancelled or Completed) on the Assignments
screen. No other role can open it, and the Lead holds none of a coordinator's
planning permissions.

**Who may assign.** `canAssignCoordinator()` — the Ops Manager only
(`event:assign_coordinator`), and only while there is something to coordinate:

| Event | Allowed | Effect |
| --- | --- | --- |
| `submitted`, no coordinator | Assign | Coordinator recorded; status → `under_review` in the same transaction |
| `under_review`, `approved`, `planning`, `safety_review`, `confirmed`, `postponed` | Reassign | Coordinator replaced; status unchanged |
| `completed`, `cancelled`, `rejected`, `draft` | Neither | 400 |

The new coordinator is notified; on reassignment the previous one is too. The
organiser is not.

### Who can see which event

| Role | Sees |
| --- | --- |
| Organiser | Their own events including drafts, plus **non-draft** events of their own client organisation |
| Attendee | Only events that are `confirmed` **and** have registration enabled — or, once registration is turned off, `confirmed` events they are registered or waitlisted for (SPM-64, #10) — and `cancelled` events they are registered or waitlisted for, with the cancellation reason (SPM-37). Browse Events lists neither of the last two. |
| Coordinator, Ops Manager, Venue Staff, Tech Support, Safety Officer | Every event that has left `draft` |
| Anyone | Never another organiser's draft |

A draft is private to the organiser who owns it — from ConnectSphere staff as
well, until it is submitted (SPM-24).

**An event you may not see returns 404, never 403.** A 403 confirms the record
exists, which is itself the leak. The same applies to writes: `PATCH` re-checks
visibility before anything else, so an id guessed from a 404 cannot be written
to.

---

## 4. Which fields an Attendee sees

Hiding a tab in the UI is not access control — the record is one request away.
So the API narrows the record itself. An attendee receives only:

`id · sequenceNumber · title · description · category · startsAt · endsAt ·
status · registrationEnabled · registrationCapacity · registrationOpensAt ·
registrationClosesAt · organisation`

The last two entries are exceptions worth naming, because both were added after
this section was first written:

- **`sequenceNumber`** is the event's public reference (EVT-000123). It is
  deliberately visible to every role — an attendee quoting a reference number
  is the point of having one (SPM-31).
- **`organisation`** is the **name only** of the client running the event, so an
  attendee can see whose event they are registering for (SPM-31, confirmed
  2026-09-28). The organiser's own name is a different question and stays
  withheld: `organiser` is not on the list, and neither is the raw
  `organisationId`.

Everything else is internal planning information and is withheld: the assigned
coordinator, the organiser's personal name, expected attendance, special
requirements, accessibility notes, rejection and cancellation reasons, facility
requirements, equipment requests, sessions (a multi-session event's per-session
times, attendance, layout and equipment), and status history. The event's own
`startsAt` / `endsAt` are still shown, and for a multi-session event they span
all its sessions.

Every other role receives the full record. An organiser's own request is not
internal information to them.

---

## 5. Who may change an event's status

`STATUS_TRANSITION_ROLES` says which role may move an event **into** each
status. The relationship rule then applies on top: an organiser must own the
event, a coordinator must be assigned to it, an Ops Manager needs neither.

| Target status | Roles | Briefing |
| --- | --- | --- |
| `submitted` | Organiser (owner) | Step 2 |
| `withdrawn` | Coordinator (assigned) | SPM-27; customer clarification #103 |
| `under_review` | Ops Manager, Coordinator | Step 3 |
| `approved` / `rejected` | Coordinator (assigned) | Step 5 |
| `planning` | Coordinator (assigned), from `approved` only, by a first venue or equipment action | Step 6 |
| `safety_review` | Coordinator (assigned), from `planning` only, through `POST /api/events/[id]/safety-check` - not in `STATUS_TRANSITION_ROLES` | Week 7 change #6; SPM-86 |
| `safety_cleared` ("Safety approved") / back to `planning` | Safety Officer, from `safety_review` only, through `POST /api/events/[id]/safety-decision` - not in `STATUS_TRANSITION_ROLES` | Week 7 change #6; SPM-87 |
| `confirmed` | Coordinator (assigned) | Step 10 |
| `completed` | Coordinator (assigned) | Step 14 |
| `postponed` | Coordinator (assigned) | §4 Rescheduling; SPM-27 AC4 |
| `cancelled` | Coordinator (assigned) only | §4 Cancellation, customer clarification #68 |

Venue Staff and Technical Support appear nowhere: they decide their own bookings
and equipment requests, not the event's status.

**Cancellation is the Event Coordinator's alone** (customer clarification,
2026-09-18). Cancelling an
event releases its venue bookings, frees its equipment reservations and closes
its registration (briefing §4, "Cancellation Management"), so it is a ConnectSphere
operational decision rather than a client-side one. An Organiser who wants their
event called off raises an Event Change Request and the assigned coordinator
acts on it; the Ops Manager assigns coordinators and does not cancel either.

**Cancel Event (SPM-37, built 2026-10-22).** Any stage that has an assigned
coordinator and is not final - Under review to Postponed - may move to
`cancelled` (#68 "any stage"; `canCancelEvent()` decides who sees the button).
In the status change's own transaction (`releaseForCancellation()` in
`src/app/api/events/[id]/route.ts`, the rules in `src/lib/eventCancellation.ts`):
Approved bookings become `released` and Pending requests `withdrawn` (SPM-67's
statuses, with "Event cancelled: <reason>"), and Venue Staff get SPM-67's
"Venue booking released" notification for each released booking; every
equipment line becomes `cancelled`; pending change requests become `withdrawn`
unapplied; a pending or approved safety check is closed. Registrations are kept
as they are (SPM-52), and an attendee holding a place can still open the
cancelled event to see why (below). Nothing moves out of `cancelled`.
Notifying the Organiser and attendees of the cancellation is SPM-53's.

**Planning is entered one way only** (SPM-54, decided 2026-10-02). There is no
"begin planning" button and the status PATCH refuses a move to `planning`. An
event moves `approved` → `planning` when its assigned coordinator first acts on
its venue or equipment: pressing Search on Find a venue, submitting a venue
booking request, or adding, saving or removing an equipment requirement. Every
one of those goes through `beginPlanningIfApproved()`
(`src/lib/beginPlanning.ts`), which only moves an Approved event and writes one
status history row; `canBeginPlanning()` is the pure form of the rule. The
coordinator is asked first ("Begin planning?"), because the move cannot be
undone and the organiser sees it.

**Safety review is entered one way only** (SPM-86, decided 2026-10-09). The
assigned coordinator submits an event in Planning for an Operational Safety
Check; `canSubmitForSafetyCheck()` decides who sees the button and
`checkSafetySubmission()` (`src/lib/safetyCheck.ts`) whether the arrangements
are ready. The status PATCH refuses `safety_review`. From Safety review the
lifecycle allows `safety_cleared` ("Safety approved" - the Safety Officer
approves, SPM-87), `planning` (they reject or request changes, SPM-87, or a
significant change, SPM-88) and `cancelled`. Only the Safety Officer decides
(`event:safety_check`, `canRecordSafetyDecision()`), once per submission. From
Safety approved the coordinator confirms; a significant change returns it to
Planning (SPM-88). The Safety Officer role itself (`safety_officer`) is SPM-85's.

**A significant change returns it to Planning** (SPM-88, decided 2026-10-15).
Not a status anyone sets: the assigned coordinator's own important information
change (SPM-62), equipment change, or venue booking requested, withdrawn or
released, while the event is in Safety review or Safety approved, closes the
check and moves the event back (`closeSafetyCheckAfterChange()`). Other roles'
actions never do. Confirm needs an approved check. After a returned check only
the assigned coordinator flags the arrangements it concerns
(`canFlagForSafetyReview()`).

**Arrangements wait for approval.** While an event is `submitted` or
`under_review`, the assigned coordinator may search venues but may not request
a booking or add, change or remove equipment (`isBeforeApproval()` in
`src/lib/statuses.ts`; refused by `checkVenueBookingRequest()` and the
equipment routes). `canManageEquipmentRequests()` and
`canRequestVenueBooking()` still answer the relationship question only — the
status is checked beside them, as it already was for closed events.

This table says **who**, not **which from → to moves are legal**. That is
`canTransition()` in `src/lib/statuses.ts` (you cannot jump `draft` →
`confirmed`), checked by the events `PATCH` route after this role check.

**The Organiser only submits** (SPM-27 AC4, "the Event Organiser
cannot manually change the event status"). Postponing is the coordinator's too;
an Organiser who wants to postpone asks through an Event Change Request, as for
cancelling. Nothing moves an event back to `draft` — a new event is created as
one.

**A withdrawal is recorded by the coordinator** (customer clarification #103).
The Organiser asks the assigned coordinator outside the system, and the
coordinator records it while the request is Under review.

---

## 6. Where it is enforced

Every route resolves an `Actor`, checks the role, then checks the relationship.

| Route | Enforcement |
| --- | --- |
| `GET /api/events` | `eventListWhere(actor)` filters in SQL; attendees get the public subset |
| `POST /api/events` | `event:create` — organiser only |
| `GET /api/events/[id]` | `canViewEvent()` → 404; `visibleEventFor()` narrows the fields |
| `GET /api/events/[id]` (safety check) | `safetyCheck` (the latest Operational Safety Check: who submitted it and when, and the decision) and `safetyHistory` (every check, newest first, SPM-88) are added for internal users only - never for the organiser or an attendee (SPM-86; SPM-88 keeps safety details internal) |
| `PATCH /api/events/[id]` (status) | `canViewEvent()` → 404, then `canSetEventStatus()` → 403. `safety_review` is refused (400): it is entered only through `POST /api/events/[id]/safety-check` (SPM-86) |
| `GET /api/events/[id]/cancellation` | `canViewEvent()` → 404, then `canSetEventStatus(…, "cancelled")` → 403 "Only the assigned Coordinator can cancel this event.", then `canTransition()` → 400. Read-only: what the Cancel event dialog lists (SPM-37) |
| `PATCH /api/events/[id]` (draft edit) | `canEditEventContent()` — owning organiser, draft only |
| `PATCH /api/events/[id]/registration` | `canViewEvent()` → 404, then `canConfigureRegistration()` → 403 (the assigned coordinator only), then `EVENT_INFORMATION_STATUSES` → 400 (Approved, Planning or Confirmed) (SPM-64) |
| `GET /api/events/[id]/registration` | Same 404 / 403 checks; the assigned coordinator's list of bookings to measure the capacity against (SPM-64) |
| `PATCH /api/events/[id]/information` | `canViewEvent()` → 404, then `canUpdateEventInformation()` → 403 (the assigned coordinator only), then `EVENT_INFORMATION_EDIT_STATUSES` → 400 (Approved, Planning, Safety review, Safety approved or Confirmed - SPM-88 added the safety statuses) (SPM-62) |
| `POST /api/events/[id]/safety-flags` | `canViewEvent()` → 404, then `canFlagForSafetyReview()` → 403 (the assigned coordinator only), then `safetyFlagsSchema` → 400, at least one arrangement → 400, then the event must be in Planning with a returned latest check (`canFlagAfterReturn()`) → 400, then each id must be one of the event's pending or approved bookings or its equipment lines that are not cancelled → 400 (SPM-88) |
| `GET /api/events/[id]/arrangements` | `canViewArrangements()` (`event:confirm` - any coordinator) → 403, then `canViewEvent()` → 404. The answer's `canManage` is true only for the assigned coordinator while the event is in Planning (SPM-33) |
| `PATCH /api/events/[id]/arrangements` | `canViewEvent()` → 404, then `canMarkArrangements()` → 403 (the assigned coordinator only), then `ARRANGEMENT_MARKING_STATUSES` → 400 (Planning only). Records who decided and when (SPM-33) |
| `POST /api/events/[id]/safety-decision` | `canViewEvent()` → 404, then `event:safety_check` → 403 (Safety Officer only), then the event must be in Safety review with a pending check (400 "This safety check has already been decided."), then `safetyDecisionSchema` → 400 for a missing reason (SPM-87) |
| `POST /api/events/[id]/safety-check` | `canViewEvent()` → 404, then `isAssignedCoordinator()` → 403, then the event must be in Planning (400; "A safety check is already pending for this event." when it is already in Safety review), then `checkSafetySubmission()` → 400 naming what is outstanding or flagged (SPM-86) |
| `PUT /api/events/[id]/coordinator` | `canViewEvent()` → 404, then `event:assign_coordinator` → 403, then `canAssignCoordinator()` → 400 (SPM-30) |
| `GET /api/assignments` | `event:assign_coordinator` — the Event Coordinator Lead (SPM-30; SPM-84 adds every active event and each coordinator's active-event count) |
| `GET /api/venues` | `venue:view` — Coordinator, Ops Manager, Venue Staff |
| `POST /api/venues` | `venue:manage` — Venue Staff |
| `GET`/`POST /api/venues/[id]/unavailability` | `venue:manage` — Venue Staff (SPM-45) |
| `PATCH`/`DELETE /api/venues/[id]/unavailability/[periodId]` | `venue:manage` — Venue Staff (SPM-45) |
| `PATCH /api/events/[id]/venue-bookings/[bookingId]` | `canViewEvent()` → 404, then `canRequestVenueBooking()` → 403 (the assigned Coordinator only), then `checkBookingChange()` → 400: withdraw a pending request or release an approved booking, not on a completed, cancelled, rejected or withdrawn event (SPM-67) |
| `GET /api/flagged-arrangements` | `event:confirm` → 403 ("Flagged arrangements are for Event Coordinators"), before anything is read. Lists only arrangements of events whose `coordinatorId` is the caller's, so a coordinator never sees a colleague's (SPM-68) |
| `POST /api/flagged-arrangements` | `event:confirm` → 403, then validation → 400, then the arrangement → 404, then its event must be assigned to the caller → 403 ("Only the assigned Coordinator can review this event's flagged arrangements."), then the event must not be completed, cancelled, rejected or withdrawn → 400, and a booking must be pending or approved, an equipment request requested, under review, reserved or partially fulfilled → 400 (the same limits `GET` lists by), then it must be flagged → 400, then it must still meet the event's requirements → 400 naming what is unmet. Clears the flag only (SPM-68) |
| `GET /api/venues/search` | `venue:view`; with `?event=`, also `canViewEvent()` on that event → 404 (SPM-40) |
| `GET /api/equipment` | `equipment:view`; the out-of-service count, type and reason only with `equipment:view_status` - never to the organiser (SPM-55) |
| `PATCH /api/equipment/[id]/out-of-service` | `equipment:manage` — Technical Support (SPM-48, SPM-55) |
| `POST /api/equipment` | `equipment:manage` — Technical Support |
| `GET /api/events/[id]/equipment` | `canViewEvent()` → 404, then `canViewEquipmentRequests()` → 403 (Technical Support for Planning, Safety review and Confirmed events only, the assigned Coordinator, or the owning Organiser read-only) |
| `POST /api/events/[id]/equipment` | `canViewEvent()` → 404, then `canManageEquipmentRequests()` — assigned Coordinator |
| `PATCH`/`DELETE /api/events/[id]/equipment/[requestId]` | Same as `POST` above, resolved from the request's own event |
| `GET /api/equipment/requests` | `canCheckEquipmentAvailability()` — Technical Support (SPM-48 queue); Planning, Safety review (SPM-86) and Confirmed events only |
| `GET /api/events/[id]/equipment/availability` | `canViewEvent()` → 404, then `canCheckEquipmentAvailability()` → 403, then 404 unless the event is Planning or Confirmed — Technical Support (SPM-48) |
| `POST /api/events/[id]/equipment/[requestId]/reserve` | `canViewEvent()` → 404, then `canReserveEquipment()` (`equipment_request:review`) → 403, then 404 unless Planning or Confirmed; reserving only in Planning — Technical Support (SPM-49) |
| `PATCH /api/events/[id]/equipment/[requestId]/fulfilment` | `canViewEvent()` → 404, then `canUpdateEquipmentFulfilment()` (`equipment_request:review`) → 403 — Technical Support; 404 unless Planning or Confirmed, updating only in Planning (SPM-50) |
| `GET /api/facilities` | `facility:view` — any signed-in user |
| `POST /api/registrations` | `registration:create` — attendee, plus `canViewEvent()` on the target event, then `registrationState()` → 400 unless the event is eligible (SPM-51) |
| `GET /api/registrations` | `registration:create` → 403 "Registrations belong to an Attendee account."; the signed-in attendee's own registrations only (SPM-51) |
| `PATCH /api/registrations/[id]` | `registration:create` → 403 "Only an Attendee can withdraw a registration", then 404 unless the registration is the caller's own (never 403, which would confirm it exists), then 400 unless it is `registered` and the event is not cancelled, completed or past its end (SPM-52) |

**Status codes.** 401 not signed in · 403 signed in, not allowed · 404 not
allowed *and* must not learn the record exists.

`useCurrentUser()` and the role-aware navigation in `src/lib/roles.ts` are
**rendering only**. They decide what a screen offers, never what the server
permits. Every route re-checks.

---

## 7. How it is tested

`permissions.ts` is pure — no Prisma, no `NextRequest` — so the whole model is
unit tested against object literals, with no database or running server. 45
tests cover the role matrix, each relationship rule, the list filter (including
that it agrees with `canViewEvent`), every status transition, field
visibility, and `canManageEquipmentRequests` / `canViewEquipmentRequests`
(SPM-47).

The two examples the briefing names have tests of their own:

- `"hides another client's event from an organiser (§8b, first example)"`
- `"withholds internal planning information from an attendee (§8b, second example)"`

**Unit tests cannot prove a route remembered to call any of this**, which is
precisely how four routes shipped without authorisation. So there is a second
layer: `npm run verify:permissions`
([`scripts/verify-permissions.ts`](../scripts/verify-permissions.ts)) signs in
as all six seeded roles against a running server and asserts the real HTTP
status of 47 refusals and permitted actions, each labelled with the acceptance
criterion it belongs to (including an `SPM-47` group covering the equipment
request routes added there, and an `SPM-30` group for coordinator assignment). Start `npm run dev` first. It creates its own
event through the API and deletes everything it made, so it is safe to re-run.

Note that two refusals answer 404 where you might expect 403: an attendee
cannot *see* a submitted event, so visibility refuses before the role check is
reached. The role check is asserted separately, on an event the attendee is
allowed to see.

---

## 8. Open items

- **Lifecycle validation.** Who may set a status is enforced; which transitions
  are legal is enforced for approve/reject (from `under_review`, SPM-28) and
  for planning (from `approved`, SPM-54) only. `approved → confirmed` in one
  step is still possible for a coordinator.
- **Resuming a postponed event** (decided 2026-10-02, not built). It goes
  `postponed` → `approved`, not straight to `planning`: the coordinator's next
  venue or equipment action then begins planning again, so
  `PLANNING_FROM_STATUSES` stays `approved` alone. Customer answer #69 backs
  this — postponing without a date releases the bookings. SPM-38 (Postpone
  Event) needs its own resume action, because a move to `approved` is
  otherwise allowed only from `under_review` (`REVIEWABLE_STATUSES`), and has
  to decide the case where the new date is already known (#69: a rescheduling
  request, arrangements reviewed rather than released).
- **`under_review` via the status PATCH.** `STATUS_TRANSITION_ROLES` still
  lets the Ops Manager set `under_review` directly, which would leave an event
  under review with no coordinator. The UI never does this (it assigns through
  `PUT /api/events/[id]/coordinator`); `canTransition()` (SPM-27) allows
  submitted → under_review, so only removing `ops_manager` from
  `STATUS_TRANSITION_ROLES.under_review` would close it.
- ~~**Venue bookings** have no routes yet.~~ Closed by SPM-42 and SPM-43:
  `venue_booking:decide` guards the Booking Requests list
  (`GET /api/venue-bookings`) and the decision itself
  (`PATCH /api/venue-bookings/[id]`). It is a role check only — Venue Staff
  are not scoped by venue (#66), so any of them may decide any request.
  SPM-82 adds `PATCH /api/venue-bookings/[id]/expiry` under the same
  action: Venue Staff move a pending hold's expiry (not past the event's
  start). An expired hold can be neither decided nor re-timed - the
  Coordinator submits a new request.
- **Equipment requests are recorded** by the assigned Coordinator (SPM-47,
  `equipment_request:manage`) and **reviewed** by Technical Support with
  `equipment_request:review`: reserving (SPM-49) and setting fulfilment status /
  technical notes (SPM-50).
- **`registration:view_list`** gives the organiser and coordinators the counts
  on the event's Registration card — places taken and withdrawn — from
  `GET /api/events/[id]` (SPM-52, AC5). It is per role, so every coordinator
  who can see the event gets them, not only the assigned one.
  It also guards the registration list (SPM-65,
  `GET /api/events/[id]/registrations`, the Attendees tab) through
  `canViewRegistrationList()`: the organiser who owns the event and the
  coordinator assigned to it - not another organiser of the same client.
  The event screens' APIs return its answer as `canViewRegistrationList`, so
  the Attendees tab is left out for everyone else rather than refused.
- **`users.role` has no database constraint.** `registerSchema` guards the
  register route; a direct database write is not guarded.
  - Corrected 2026-09-18: this entry previously read "Zod guards the register
    route" and left it there. Zod guarded that the role was one of six valid
    *strings* — it said nothing about whether an anonymous caller was entitled
    to claim it, and `POST /api/auth/register` takes no session. Anyone could
    register as `ops_manager`. Self-registration is now limited to
    `SELF_REGISTERABLE_ROLES` (organiser, attendee); see §2.
- **No admin screen for staff accounts.** The four internal roles can no longer
  be self-registered, which is right, but nothing in the app creates them
  either — `npx prisma db seed` is the only path today.
- **Event Change Requests has no endpoint**, which is how an Organiser would ask
  for a cancellation now that they cannot perform one themselves. Until it
  exists, an organiser who wants their event called off has to contact their
  coordinator outside the system.

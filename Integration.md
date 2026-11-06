# Integration Approach

**Ticket:** SPM-10 Investigate Integration Approach

ConnectSphere is a single Next.js app with one Postgres database. There is no
network boundary between domains, so "integration" here means **cross-domain
data dependencies inside the monolith**: where one domain's code reads or
writes another domain's tables, and how that is kept consistent. The C4
diagrams in [`docs/architecture/`](./docs/architecture/) show the same system
as containers and components.

Links go to whole files, not line numbers, so they stay correct as the code
changes. Story keys (SPM-n) lead to the story's test cases in
[`docs/test-cases/`](./docs/test-cases/) and its row in the
[traceability matrix](./docs/traceability/TRACEABILITY.md).

### Domains and components

The team split the code into five domains: folders inside one app, each with
an owner ([DOCUMENTATION.md § The 5 Domains](./DOCUMENTATION.md#-the-5-domains-services)).
Inside the API Server, the
[C3 API Server diagram](./docs/architecture/after-week-7/) draws each domain as
one or more route components (blue) and the business rules they call (green).
The table below follows the same boxes; [C4-code-map.md](./docs/architecture/C4-code-map.md)
points each box to its lines.

| Domain (tables) | C4 route component | Route folders (`src/app/api/`) | C4 rules component → files (`src/lib/`) |
|---|---|---|---|
| **Auth** (`User`, `Organisation`) | Auth API | [`auth/`](./src/app/api/auth/) | Request Auth → [`apiAuth.ts`](./src/lib/apiAuth.ts); Password & Token Helpers → [`auth.ts`](./src/lib/auth.ts); Permission Model → [`permissions.ts`](./src/lib/permissions.ts), [`eventVisibility.ts`](./src/lib/eventVisibility.ts) |
| **Events** (`Event`, `EventSession`, `EventStatusHistory`, `ClarificationRequest`, `EventChangeRequest`, `EventFacilityRequirement`, `SafetyCheck`) | Events API | [`events/`](./src/app/api/events/), [`events/[id]/`](./src/app/api/events/%5Bid%5D/), [`…/information/`](./src/app/api/events/%5Bid%5D/information/), [`…/clarifications/`](./src/app/api/events/%5Bid%5D/clarifications/), [`…/begin-planning/`](./src/app/api/events/%5Bid%5D/begin-planning/), [`…/postponement/`](./src/app/api/events/%5Bid%5D/postponement/), [`…/cancellation/`](./src/app/api/events/%5Bid%5D/cancellation/) | Event Lifecycle Rules → [`eventReview.ts`](./src/lib/eventReview.ts), [`clarification.ts`](./src/lib/clarification.ts), [`beginPlanning.ts`](./src/lib/beginPlanning.ts), [`eventConfirmation.ts`](./src/lib/eventConfirmation.ts), [`eventPostponement.ts`](./src/lib/eventPostponement.ts), [`eventCancellation.ts`](./src/lib/eventCancellation.ts), [`eventCompletion.ts`](./src/lib/eventCompletion.ts), [`eventCompletionService.ts`](./src/lib/eventCompletionService.ts); Event Session Rules → [`eventSessions.ts`](./src/lib/eventSessions.ts), [`sessionWrites.ts`](./src/lib/sessionWrites.ts) |
| | Assignment API | [`queue/`](./src/app/api/queue/), [`assignments/`](./src/app/api/assignments/), [`events/[id]/coordinator/`](./src/app/api/events/%5Bid%5D/coordinator/) | Coordinator Assignments → [`coordinatorAssignments.ts`](./src/lib/coordinatorAssignments.ts) |
| | Change Request API | [`change-requests/`](./src/app/api/change-requests/), [`events/[id]/change-requests/`](./src/app/api/events/%5Bid%5D/change-requests/) | Change Request Rules → [`eventChangeRequest.ts`](./src/lib/eventChangeRequest.ts), [`changeRequestDecision.ts`](./src/lib/changeRequestDecision.ts), [`eventChangeImpact.ts`](./src/lib/eventChangeImpact.ts), [`applyEventInformation.ts`](./src/lib/applyEventInformation.ts) |
| | Arrangements API | [`events/[id]/arrangements/`](./src/app/api/events/%5Bid%5D/arrangements/), [`flagged-arrangements/`](./src/app/api/flagged-arrangements/) | Arrangement Tracking Rules → [`eventArrangements.ts`](./src/lib/eventArrangements.ts), [`flaggedArrangements.ts`](./src/lib/flaggedArrangements.ts), [`flaggedArrangementsService.ts`](./src/lib/flaggedArrangementsService.ts), [`reviewFlags.ts`](./src/lib/reviewFlags.ts) |
| | Safety Check API | [`safety-checks/`](./src/app/api/safety-checks/), [`events/[id]/safety-check/`](./src/app/api/events/%5Bid%5D/safety-check/), [`…/safety-decision/`](./src/app/api/events/%5Bid%5D/safety-decision/), [`…/safety-flags/`](./src/app/api/events/%5Bid%5D/safety-flags/) | Safety Check Rules → [`safetyCheck.ts`](./src/lib/safetyCheck.ts), [`safetyDecision.ts`](./src/lib/safetyDecision.ts), [`safetyResolution.ts`](./src/lib/safetyResolution.ts), [`safetyCheckClose.ts`](./src/lib/safetyCheckClose.ts) |
| **Venues** (`Venue`, `VenueLayout`, `Facility`, `VenueFacility`, `VenueBooking`, `VenueUnavailability`) | Venues API | [`venues/`](./src/app/api/venues/) (incl. [`search/`](./src/app/api/venues/search/), [`[id]/availability/`](./src/app/api/venues/%5Bid%5D/availability/), [`[id]/unavailability/`](./src/app/api/venues/%5Bid%5D/unavailability/)), [`events/[id]/venue-suitability/`](./src/app/api/events/%5Bid%5D/venue-suitability/) | Venue Suitability Rules → [`venueSuitability.ts`](./src/lib/venueSuitability.ts), [`venueSearch.ts`](./src/lib/venueSearch.ts); Venue Change Impact Rules → [`venueImpact.ts`](./src/lib/venueImpact.ts), [`venueUnavailability.ts`](./src/lib/venueUnavailability.ts), [`venueUnavailabilityService.ts`](./src/lib/venueUnavailabilityService.ts), [`turnaroundRecheck.ts`](./src/lib/turnaroundRecheck.ts) |
| | Venue Booking API | [`events/[id]/venue-bookings/`](./src/app/api/events/%5Bid%5D/venue-bookings/), [`venue-bookings/`](./src/app/api/venue-bookings/) (incl. [`[id]/expiry/`](./src/app/api/venue-bookings/%5Bid%5D/expiry/)) | Venue Booking Rules → [`venueBookingRequest.ts`](./src/lib/venueBookingRequest.ts), [`venueBookingReview.ts`](./src/lib/venueBookingReview.ts), [`venueBookingReviewService.ts`](./src/lib/venueBookingReviewService.ts), [`venueBookingChange.ts`](./src/lib/venueBookingChange.ts); Venue Time & Conflict Rules → [`venueTime.ts`](./src/lib/venueTime.ts), [`venueConflict.ts`](./src/lib/venueConflict.ts), [`venueAvailability.ts`](./src/lib/venueAvailability.ts); Hold Expiry Rules → [`holdExpiry.ts`](./src/lib/holdExpiry.ts), [`holdExpiryService.ts`](./src/lib/holdExpiryService.ts) |
| | Facilities API | [`facilities/`](./src/app/api/facilities/) | (reference data, no rules) |
| **Equipment** (`Equipment`, `EquipmentRequest`, `EquipmentSuggestion`) | Equipment API | [`equipment/`](./src/app/api/equipment/), [`events/[id]/equipment/`](./src/app/api/events/%5Bid%5D/equipment/) | Equipment Availability Engine → [`equipment.ts`](./src/lib/equipment.ts), [`equipmentAvailability.ts`](./src/lib/equipmentAvailability.ts), [`equipmentAvailabilityLines.ts`](./src/lib/equipmentAvailabilityLines.ts), [`equipmentAvailabilityService.ts`](./src/lib/equipmentAvailabilityService.ts), [`equipmentOutOfService.ts`](./src/lib/equipmentOutOfService.ts), [`equipmentFulfilment.ts`](./src/lib/equipmentFulfilment.ts), [`equipmentReservation.ts`](./src/lib/equipmentReservation.ts), [`equipmentSuggestion.ts`](./src/lib/equipmentSuggestion.ts) |
| **Registrations** (`Registration`) | Registrations API | [`registrations/`](./src/app/api/registrations/), [`events/[id]/registration/`](./src/app/api/events/%5Bid%5D/registration/), [`events/[id]/registrations/`](./src/app/api/events/%5Bid%5D/registrations/), [`events/[id]/waiting-list/`](./src/app/api/events/%5Bid%5D/waiting-list/) | Registration & Waiting List Rules → [`registrationSettings.ts`](./src/lib/registrationSettings.ts), [`registrationEligibility.ts`](./src/lib/registrationEligibility.ts), [`waitingList.ts`](./src/lib/waitingList.ts), [`waitingListService.ts`](./src/lib/waitingListService.ts), [`manualRegistration.ts`](./src/lib/manualRegistration.ts) |
| **Notifications** (`Notification`) | Notifications API | [`notifications/`](./src/app/api/notifications/) | Notifications → [`notifications.ts`](./src/lib/notifications.ts), [`notificationView.ts`](./src/lib/notificationView.ts) |

Every route also uses Request Auth, the Permission Model, the Validation
Schemas ([`src/lib/validation/`](./src/lib/validation/)) and the Prisma Client
([`prisma.ts`](./src/lib/prisma.ts)), as the C3 Request Pipeline diagram
shows. Notifications are written by every domain through one helper (§1).

---

## 1. Required system interactions

Every interaction below is built. "Same transaction" means the write and
everything that follows from it commit together or not at all.

| From | To | Interaction | Where | Story |
|---|---|---|---|---|
| Auth | every domain | Verify the session and load the current user's role, organisation and active flag on every request, then check the action against the permission rules | [`getActor()`](./src/lib/apiAuth.ts), [`permissions.ts`](./src/lib/permissions.ts), [`eventVisibility.ts`](./src/lib/eventVisibility.ts) | SPM-85, SPM-94 |
| Events | Venues | Check a venue's capacity, layouts and facilities against each session's needs | [`venueSuitability.ts`](./src/lib/venueSuitability.ts), [`GET /api/events/[id]/venue-suitability`](./src/app/api/events/%5Bid%5D/venue-suitability/route.ts) | SPM-41, SPM-90 |
| Events | Venues | Refuse or flag a booking that clashes with another booking, a hold or an unavailability period, including the venue's setup and turnaround time | [`venueConflict.ts`](./src/lib/venueConflict.ts), [`venueTime.ts`](./src/lib/venueTime.ts), [`venueBookingReviewService.ts`](./src/lib/venueBookingReviewService.ts) | SPM-42, SPM-43, SPM-44, SPM-93 |
| Events | Equipment (write) | Creating or editing an event writes its sessions and each session's `EquipmentRequest` rows, with a window of the session's times ± 2h for load-in and load-out | [`sessionWrites.ts`](./src/lib/sessionWrites.ts), [`eventSessions.ts`](./src/lib/eventSessions.ts) | SPM-47, SPM-81 |
| Equipment | Events | Check requested quantities against every overlapping request's window, less units out of service | [`equipmentAvailabilityService.ts`](./src/lib/equipmentAvailabilityService.ts), [`equipmentAvailability.ts`](./src/lib/equipmentAvailability.ts) | SPM-48, SPM-55 |
| Venues, Equipment | Events (status) | The coordinator's first venue or equipment action moves an Approved event to Planning, in the same transaction as that action | [`beginPlanning.ts`](./src/lib/beginPlanning.ts) | SPM-54 |
| Events | Venues + Equipment + Registrations (read) | Gather every arrangement an event holds, for the Readiness tab and for Confirm, which read the same rows. Only what the event itself needs is judged: registration setup is checked only when the event takes registrations, and can be marked not required | [`eventArrangements.ts`](./src/lib/eventArrangements.ts), [`eventConfirmation.ts`](./src/lib/eventConfirmation.ts) | SPM-33, SPM-34, SPM-64 |
| Events | Venues + Equipment (read) | Submit for the Operational Safety Check only once those arrangements are held; the Safety Officer's outcome decides whether the event can be confirmed | [`safetyCheck.ts`](./src/lib/safetyCheck.ts), [`safetyDecision.ts`](./src/lib/safetyDecision.ts), [`safetyResolution.ts`](./src/lib/safetyResolution.ts) | SPM-86, SPM-87, SPM-88 |
| Events | Venues + Equipment (flag) | An important change to an event (date, time, attendance, venue or equipment needs) flags the arrangements it puts at risk for review instead of changing them, and moves a Confirmed event back to Planning | [`applyEventInformation.ts`](./src/lib/applyEventInformation.ts), [`eventChangeImpact.ts`](./src/lib/eventChangeImpact.ts), [`flaggedArrangementsService.ts`](./src/lib/flaggedArrangementsService.ts) | SPM-62, SPM-68, SPM-32 |
| Venues | Events (flag) | Editing or retiring a venue, recording unavailability, or changing setup or turnaround time flags the existing bookings it affects | [`venueImpact.ts`](./src/lib/venueImpact.ts), [`venueUnavailabilityService.ts`](./src/lib/venueUnavailabilityService.ts), [`turnaroundRecheck.ts`](./src/lib/turnaroundRecheck.ts) | SPM-39, SPM-45, SPM-80 |
| Equipment | Events (flag) | Taking units out of service lists the reservations it leaves short | [`equipmentOutOfService.ts`](./src/lib/equipmentOutOfService.ts) | SPM-55 |
| Events | Venues + Equipment + Registrations (write) | Cancelling or postponing an event releases its bookings, withdraws pending requests, cancels its equipment lines and closes its safety check, in the same transaction | [`eventCancellation.ts`](./src/lib/eventCancellation.ts), [`eventPostponement.ts`](./src/lib/eventPostponement.ts) | SPM-37, SPM-38 |
| Events | Equipment (write) | Accepting a suggested alternative item replaces the equipment line | [`equipmentSuggestion.ts`](./src/lib/equipmentSuggestion.ts) | SPM-77 |
| Registrations | Events + Venues (read) | Allow a registration only when the event is Confirmed, registration is enabled and open, and a place is free. Capacity is measured against the booked room's layout capacity | [`registrationEligibility.ts`](./src/lib/registrationEligibility.ts), [`manualRegistration.ts`](./src/lib/manualRegistration.ts) | SPM-51, SPM-57, SPM-64 |
| Registrations | Registrations | A freed place is offered to the next attendee on the waiting list | [`waitingListService.ts`](./src/lib/waitingListService.ts) | SPM-66 |
| every domain | Notifications (write) | Tell the right people about a change, in the same transaction as the change | [`notifications.ts`](./src/lib/notifications.ts) (`notifyUser()`, `notifyRole()`) | SPM-53, SPM-71 |
| every domain | Events (history) | Record status changes, and venue booking and equipment changes, in the event's history | `EventStatusHistory` | SPM-97 |

**Ownership.** Reads across domains are fine. Writes into another domain's
table go through that domain's shared helper in `src/lib/` (above), never a
second copy of the logic in a route. The rule for each write therefore lives
in one place, and the screen and the server always agree. The main exception
is deliberate: creating or editing an event writes its `EquipmentRequest`
rows directly ([`sessionWrites.ts`](./src/lib/sessionWrites.ts)), so an event
and its requirements save as one unit. Equipment screens therefore handle
requests from either source.

---

## 2. Interfaces / API

All routes are in [`src/app/api/`](./src/app/api/). Each one follows the same
pattern, in this order:

| Step | What happens | Refusal |
|---|---|---|
| 1. Who is calling | `getActor()` ([`apiAuth.ts`](./src/lib/apiAuth.ts)) verifies the token and reloads the user | 401 `unauthenticated()` |
| 2. May they know the record exists | Load the event and check it is visible to them ([`eventVisibility.ts`](./src/lib/eventVisibility.ts)) | 404 `hidden()` |
| 3. May they do this | The permission rule ([`permissions.ts`](./src/lib/permissions.ts)) | 403 `forbidden()` |
| 4. Is the input valid | Zod schema from [`src/lib/validation/`](./src/lib/validation/) (or kept with its rule, e.g. [`safetyDecision.ts`](./src/lib/safetyDecision.ts)) | 400 with field errors |
| 5. Business rule | The rule from `src/lib/`, which can refuse with a message the screen shows | 400; 409 when someone else changed the record first |
| 6. Write and respond | Prisma, in one transaction when it writes more than one row, with its history and notifications | JSON |

For example, [`events/[id]/coordinator/route.ts`](./src/app/api/events/%5Bid%5D/coordinator/route.ts)
and [`events/[id]/safety-decision/route.ts`](./src/app/api/events/%5Bid%5D/safety-decision/route.ts)
follow these steps line by line. The access rule for every route is in
[`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md).

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/register` (Organiser or Attendee only), `GET /api/auth/me` |
| Events | `GET`/`POST /api/events`; `GET`/`PATCH /api/events/[id]` (edit, submit, review, confirm, cancel, postpone); `PATCH …/information`; `POST …/begin-planning`; `POST …/clarifications`; `PUT …/coordinator`; `GET`/`PATCH …/arrangements`; `GET`/`POST …/change-requests`, `POST …/change-requests/[requestId]/decision`; `GET …/cancellation`, `GET …/postponement` |
| Event queues | `GET /api/queue`, `GET /api/assignments`, `GET /api/change-requests`, `GET`/`POST /api/flagged-arrangements` |
| Safety | `POST /api/events/[id]/safety-check`, `…/safety-flags`, `…/safety-decision`; `GET /api/safety-checks` |
| Venues | `GET`/`POST /api/venues`, `GET /api/venues/search`, `GET`/`PATCH /api/venues/[id]`, `GET /api/venues/[id]/availability`, `GET`/`POST /api/venues/[id]/unavailability`, `PATCH`/`DELETE …/unavailability/[periodId]`, `GET /api/facilities` |
| Venue bookings | `GET /api/events/[id]/venue-suitability`; `GET`/`POST /api/events/[id]/venue-bookings`, `PATCH …/venue-bookings/[bookingId]`; `GET /api/venue-bookings`, `PATCH /api/venue-bookings/[id]` (decide, release), `PATCH /api/venue-bookings/[id]/expiry` |
| Equipment | `GET`/`POST /api/equipment`, `PATCH /api/equipment/[id]/out-of-service`, `GET /api/equipment/requests`; under `/api/events/[id]/equipment`: `GET`/`POST`, `GET …/availability`, `PATCH`/`DELETE …/[requestId]`, `POST …/reserve`, `PATCH`/`DELETE …/reservation`, `PATCH …/fulfilment`, `POST`/`PATCH …/suggestion`, `GET …/suggestion/availability` |
| Registrations | `GET`/`POST /api/registrations`, `PATCH /api/registrations/[id]` (withdraw), `POST /api/registrations/[id]/offer` (accept or decline a waiting-list offer); `GET`/`PATCH /api/events/[id]/registration` (settings); `GET`/`POST /api/events/[id]/registrations` (list, add an attendee); `POST /api/events/[id]/waiting-list`, `POST …/waiting-list/offers` |
| Notifications | `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/[id]`, `POST /api/notifications/read-all` |

Events are addressed by their reference (`EVT-000123`), not the database id
([`resolveEventId()`](./src/lib/apiAuth.ts)).

---

## 3. Data exchanged

The fields one domain reads from another. Field definitions are in
[`prisma/schema.prisma`](./prisma/schema.prisma) and
[`SCHEMA_REFERENCE.md`](./SCHEMA_REFERENCE.md).

| Consumer | Reads | From |
|---|---|---|
| Venue suitability | Each session's expected attendance, layout and facility needs | `EventSession`, `EventFacilityRequirement` |
| Venue suitability | Capacity, layouts and their capacities, facilities, active flag | `Venue`, `VenueLayout`, `VenueFacility`, `Facility` |
| Venue conflict check | Start, end and status of other bookings and holds for the room; unavailability periods; the venue's setup and turnaround minutes | `VenueBooking`, `VenueUnavailability`, `Venue` |
| Equipment availability | Each request's quantity, window (session times ± 2h) and status | `EquipmentRequest` |
| Equipment availability | Total quantity, units out of service | `Equipment` |
| Readiness, Confirm, Safety Check | Booking status per session, equipment line status, registration settings and whether they were marked not required | `VenueBooking`, `EquipmentRequest`, `Event` |
| Registration | Event status, registration enabled, period and capacity; the booked layout's capacity; places taken | `Event`, `VenueBooking`, `VenueLayout`, `Registration` |
| Visibility for staff roles | Whether the event was ever approved | `EventStatusHistory` |
| Facility checkboxes on the event form and venue search | `id`, `name`, `category` (`facility` or `accessibility`) | `Facility`, via `GET /api/facilities` |
| Notifications | Who to tell: the organiser, the assigned coordinator, or every active user in a role | `Event`, `User` |

---

## 4. Validated integrations

Each integration in §1 is covered at three levels (see
[`docs/TESTING.md`](./docs/TESTING.md)):

- **Unit tests:** the rules in `src/lib/` as pure functions, and every route
  with the database mocked (`src/lib/__tests__`, `src/app/api/__tests__`).
  Coverage is 100% of lines and functions.
- **Integration tests:** [`integration/`](./integration/) runs the
  cross-domain paths against a real Postgres. It covers clarification,
  equipment reservation, registration, venue booking, and the turnaround
  re-check.
- **End-to-end tests:** [`e2e/`](./e2e/) drives the built app in Chromium
  with Playwright. It covers the event request journey, venue booking
  conflicts, rejection, withdrawal and hold expiry, the turnaround re-check,
  flagged arrangements, registration settings, the registration list, and
  adding an attendee.

CI runs all three levels on every pull request, each against its own
throwaway Postgres (`.github/workflows/ci.yml`). Separately,
[`scripts/verify-permissions.ts`](./scripts/verify-permissions.ts)
(`npm run verify:permissions`) checks that the routes of a running app
actually apply the access rules.

---

## 5. Integration risks

The risks of integrating the domains, and how each is handled.

| Risk | Impact | How it is handled |
|---|---|---|
| The database has no constraint against overlapping bookings, over-reserved equipment or an overfull event | Double-booked room, over-committed equipment, or more attendees than seats | Each check-and-write runs in one transaction that first locks the rows it checks (`SELECT … FOR UPDATE`): booking requests and decisions, equipment reservations, registrations and waiting-list offers. Two requests at the same moment cannot both take the last room, unit or place (SPM-42, SPM-43, SPM-49, SPM-111) |
| Timed sweeps run concurrently: expired holds, lapsed offers, auto-completion | One record changed twice, or one person told twice | Each sweep is a single `UPDATE … RETURNING`, so each row is claimed once ([`holdExpiryService.ts`](./src/lib/holdExpiryService.ts), [`eventCompletionService.ts`](./src/lib/eventCompletionService.ts)) |
| No scheduled job to apply time-based rules | A hold, offer or finished event read in a state it has timed out of | The sweep runs before any route reads the affected rows, and in the unread-notifications count that every page requests (SPM-36, SPM-66, SPM-82; discussion #55 sets no hard real-time requirement) |
| A change in one domain silently breaking another's arrangement | A booking or reservation that no longer fits, found only at event time | Changes that affect other domains flag the arrangements at risk for review instead of changing them (§1: SPM-62, SPM-68, SPM-80, SPM-55) |
| Registration status and withdrawal need their own endpoints | Without them, an attendee could register but not see their status or withdraw | `GET /api/registrations` lists the attendee's own registrations (SPM-51), and `PATCH /api/registrations/[id]` with `{ status: "withdrawn" }` withdraws one, keeping the row so it can be reactivated (SPM-52) |
| `EquipmentRequest` rows come from two places (the event form and the equipment screens) | A screen that assumed one source could mishandle the other's rows | Both write through the same shape ([`sessionWrites.ts`](./src/lib/sessionWrites.ts), [`equipment.ts`](./src/lib/equipment.ts)), and the Technical Support screens handle either |
| The same rule coded twice, in a screen and a route | The screen and the server disagree about what is allowed | Rules live once in `src/lib/` and both call them, e.g. Readiness and Confirm read [`eventArrangements.ts`](./src/lib/eventArrangements.ts), and the booking list and the decision route read [`venueBookingReviewService.ts`](./src/lib/venueBookingReviewService.ts) |
| A cross-domain write half-applied | An event cancelled while its booking stays held, or a change saved without its notification | The write, its knock-on changes, its history row and its notifications are one transaction |
| Role or account changes while a session token is live | A deactivated or changed account keeps old access for the token's 8 hours | The token carries only id and role; `getActor()` reloads role, organisation and active flag on every request |
| Staff seeing an event before its review outcome | Venue Staff, Technical Support or the Safety Officer see a request that was never approved | They see an event only from Approved onwards, judged from its status history (SPM-94, [`eventVisibility.ts`](./src/lib/eventVisibility.ts)) |
| Frontend and backend field names drifting | A form posts fields the API no longer accepts | TypeScript and the shared Zod schemas in [`src/lib/validation/`](./src/lib/validation/) catch a mismatch at compile time |
| Concurrent edits to `prisma/schema.prisma` | Painful merge conflicts | Schema changes are one announced PR with a migration, and CI checks the schema matches `prisma/migrations` |

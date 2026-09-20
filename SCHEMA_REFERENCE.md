# ConnectSphere - Schema Reference

What every table holds, what the values mean, and what will trip you up.
Generated from `prisma/schema.prisma` - if the two disagree, the schema wins.

**18 tables. UUID primary keys. camelCase in code, snake_case in Postgres.**

---

## How to read this

You write `prisma.venueBooking` in code; the table in Postgres is `venue_bookings`.
Prisma translates both the model name and every field name for you, so you should
only ever see camelCase unless you are writing raw SQL or looking at Prisma Studio.

| In your code | In Postgres |
|---|---|
| `prisma.venueBooking` | table `venue_bookings` |
| `booking.requestedAt` | column `requested_at` |
| `prisma.equipment` | table `equipment` |

`req` in the tables below means the field is required - Prisma rejects a create without it.

---

## Status values

These are plain strings, not database enums, so **nothing stops you writing a typo**.
Copy from here rather than typing from memory.

| Field | Allowed values |
|---|---|
| `User.role` | `organiser` `coordinator` `venue_staff` `tech_support` `attendee` `ops_manager` |
| `Event.status` | `draft` `submitted` `under_review` `approved` `planning` `confirmed` `completed` `cancelled` `rejected` `postponed` |
| `VenueBooking.status` | `pending` `approved` `rejected` `cancelled` |
| `EquipmentRequest.status` | `requested` `under_review` `reserved` `partially_fulfilled` `unavailable` `cancelled` |
| `Registration.status` | `registered` `waitlisted` `withdrawn` `attended` |
| `ClarificationRequest.status` | `open` `answered` `closed` |
| `EventChangeRequest.status` | `pending` `approved` `rejected` `withdrawn` |
| `Facility.category` | `facility` `accessibility` |
| `VenueUnavailability.reason` | `maintenance` `renovation` `safety` `internal_activity` `other` |
| layout names | `theatre` `classroom` `boardroom` `banquet` `exhibition` `u_shape` `cabaret` |

The Zod schemas in `src/lib/validation/` (one file per domain) enforce most of
these at the API boundary. If you add a value, add it in both places.

---

## Diagram

```mermaid
erDiagram
  organisations ||--o{ users : employs
  organisations ||--o{ events : "is client for"
  users ||--o{ events : organises
  users ||--o{ registrations : registers
  users ||--o{ notifications : receives
  events ||--o{ event_status_history : logs
  events ||--o{ clarification_requests : has
  events ||--o{ event_change_requests : has
  events ||--o{ event_facility_requirements : requires
  events ||--o{ event_sessions : "may split into"
  events ||--o{ venue_bookings : books
  events ||--o{ equipment_requests : requests
  events ||--o{ registrations : accepts
  event_sessions ||--o{ venue_bookings : "scopes (optional)"
  event_sessions ||--o{ equipment_requests : "scopes (optional)"
  venues ||--o{ venue_layouts : supports
  venues ||--o{ venue_facilities : provides
  venues ||--o{ venue_bookings : "booked as"
  venues ||--o{ venue_unavailability : "blocked by"
  facilities ||--o{ venue_facilities : "offered at"
  facilities ||--o{ event_facility_requirements : "required by"
  equipment ||--o{ equipment_requests : "reserved via"
```

---

## Who owns what

| Person | Domain | Tables they mostly touch |
|---|---|---|
| Jordan | auth | `User`, `Organisation` |
| Kristen | events | `Event`, `EventSession`, `EventStatusHistory`, `ClarificationRequest`, `EventChangeRequest`, `EventFacilityRequirement` |
| Kayal | venues | `Venue`, `VenueLayout`, `Facility`, `VenueFacility`, `VenueBooking`, `VenueUnavailability` |
| Janelle | equipment | `Equipment`, `EquipmentRequest` |
| Sammi | registrations | `Registration` |
| shared | - | `Notification` - any domain may create one |

Reading another domain's tables is fine and expected. **Writing** to them is not -
if the venues route needs to change an Event, that is a conversation with Kristen first.

---

## Tables

### `Organisation`

Postgres table `organisations` &middot; `prisma.organisation`

Client companies. The access boundary for external users: an Organiser should not see events belonging to an unrelated client.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `name` | String | req | Unique. The client company name. |
| `contactEmail` | String |  |  |
| `contactPhone` | String |  |  |
| `createdAt` | DateTime |  | Defaults to `now()`. |

**Relations:** `users` &rarr; User[], `events` &rarr; Event[]

### `User`

Postgres table `users` &middot; `prisma.user`

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `email` | String | req | Unique, used to log in. |
| `passwordHash` | String | req | bcrypt hash. Never store or return the raw password. |
| `fullName` | String | req | Routes send and receive this as `name`. Only the DB calls it fullName. |
| `phone` | String |  |  |
| `role` | String | req | One of six values - see Status values. |
| `organisationId` | String |  | NULL = internal ConnectSphere staff. Set = external user. This is the internal/external distinction. |
| `department` | String |  | Internal staff only. |
| `isActive` | Boolean |  | Deactivate leavers rather than deleting them. Defaults to `true`. |
| `createdAt` | DateTime |  | Defaults to `now()`. |

**Relations:** `organisation` &rarr; Organisation, `organisedEvents` &rarr; Event[], `coordinatedEvents` &rarr; Event[], `statusChanges` &rarr; EventStatusHistory[], `clarificationsRaised` &rarr; ClarificationRequest[], `changeRequestsRaised` &rarr; EventChangeRequest[], `changeRequestsReviewed` &rarr; EventChangeRequest[], `bookingsRequested` &rarr; VenueBooking[], `bookingsDecided` &rarr; VenueBooking[], `unavailabilityCreated` &rarr; VenueUnavailability[], `equipmentRequested` &rarr; EquipmentRequest[], `equipmentReviewed` &rarr; EquipmentRequest[], `registrations` &rarr; Registration[], `notifications` &rarr; Notification[]

**Watch out:**

- `fullName` in the DB, `name` in every API request and response. The routes translate between them.
- Roles are `organiser` / `coordinator` / `tech_support` - NOT `event_organiser` etc.

### `Venue`

Postgres table `venues` &middot; `prisma.venue`

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `code` | String | req | Short key staff say aloud, e.g. MAR-GH. Unique. |
| `name` | String | req |  |
| `description` | String |  |  |
| `building` | String | req | Searchable. Do not bury location in `address`. |
| `floor` | String |  |  |
| `address` | String |  |  |
| `maxCapacity` | Int | req | Absolute ceiling. The per-layout number is usually lower - use VenueLayout for suitability. |
| `opensAt` | String |  | "HH:MM" text, 24-hour. Zero-padded so string comparison works. Defaults to `"08:00"`. |
| `closesAt` | String |  | "HH:MM" text. Defaults to `"22:00"`. |
| `setupMinutes` | Int |  | Optional. Ignore unless you are handling turnaround time. Defaults to `0`. |
| `teardownMinutes` | Int |  | Optional. Defaults to `0`. |
| `isActive` | Boolean |  | Retire a venue without orphaning its past bookings. Defaults to `true`. |
| `createdAt` | DateTime |  | Defaults to `now()`. |

**Relations:** `layouts` &rarr; VenueLayout[], `facilities` &rarr; VenueFacility[], `bookings` &rarr; VenueBooking[], `unavailability` &rarr; VenueUnavailability[]

**Watch out:**

- `opensAt`/`closesAt` are strings, not DateTime. Compare them as strings.
- A booking outside opening hours is not a *clash*, but it is still not allowed - that is a separate check.

### `VenueLayout`

Postgres table `venue_layouts` &middot; `prisma.venueLayout`

Which layouts a room supports and how many fit in each. The same room seats 500 theatre-style but 250 as a classroom, so capacity belongs here, not on Venue — this is what makes suitability checking correct.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `venueId` | String | req |  |
| `layoutName` | String | req | theatre \| classroom \| boardroom \| banquet \| exhibition \| u_shape \| cabaret |
| `capacity` | Int | req | How many fit in THIS layout. The field suitability checking depends on. |

**Relations:** `venue` &rarr; Venue

**Unique:** `@@unique([venueId, layoutName])`

**Watch out:**

- Always join this for capacity questions. `Venue.maxCapacity` is the building limit, not the seating plan.

### `Facility`

Postgres table `facilities` &middot; `prisma.facility`

A named capability a room can have. One table for both search filters; `category` keeps them separate in the UI.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `name` | String | req |  |
| `category` | String | req | `facility` or `accessibility` - keeps the two search filters apart. |

**Relations:** `venues` &rarr; VenueFacility[], `eventRequirements` &rarr; EventFacilityRequirement[]

### `VenueFacility`

Postgres table `venue_facilities` &middot; `prisma.venueFacility`

| Field | Type | | Notes |
|---|---|---|---|
| `venueId` | String | req | Composite primary key with facilityId. |
| `facilityId` | String | req | Join row only - no extra data. |

**Relations:** `venue` &rarr; Venue, `facility` &rarr; Facility

### `Event`

Postgres table `events` &middot; `prisma.event`

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `title` | String |  | Nullable so a draft can be incomplete. |
| `description` | String |  |  |
| `purpose` | String |  |  |
| `category` | String |  |  |
| `organiserId` | String | req | The external user who owns the request. |
| `organisationId` | String |  | Their client company. Set from the organiser at creation, not sent by the client. |
| `coordinatorId` | String |  | NULL until assigned. This is what separates submitted from under_review. |
| `status` | String |  | Ten values - see Status values. Defaults to `"draft"`. |
| `startsAt` | DateTime |  | The agreed schedule. Proposed changes live in EventChangeRequest, never here. |
| `endsAt` | DateTime |  |  |
| `expectedAttendance` | Int |  | Nullable for drafts. |
| `preferredLayout` | String |  | Matched against VenueLayout.layoutName. |
| `accessibilityNotes` | String |  |  |
| `specialRequirements` | String |  |  |
| `registrationEnabled` | Boolean |  | Defaults to `false`. |
| `registrationCapacity` | Int |  | Seats open to the public. NOT the same as expectedAttendance. |
| `registrationOpensAt` | DateTime |  |  |
| `registrationClosesAt` | DateTime |  |  |
| `rejectionReason` | String |  | Required when rejecting - the route enforces it. |
| `cancellationReason` | String |  |  |
| `submittedAt` | DateTime |  |  |
| `confirmedAt` | DateTime |  |  |
| `createdAt` | DateTime |  | Defaults to `now()`. |
| `updatedAt` | DateTime | req |  |

**Relations:** `organiser` &rarr; User, `organisation` &rarr; Organisation, `coordinator` &rarr; User, `facilityRequirements` &rarr; EventFacilityRequirement[], `statusHistory` &rarr; EventStatusHistory[], `clarifications` &rarr; ClarificationRequest[], `changeRequests` &rarr; EventChangeRequest[], `sessions` &rarr; EventSession[], `venueBookings` &rarr; VenueBooking[], `equipmentRequests` &rarr; EquipmentRequest[], `registrations` &rarr; Registration[], `notifications` &rarr; Notification[]

**Watch out:**

- `title`, `startsAt` and `expectedAttendance` are nullable ONLY because drafts may be incomplete. The PATCH route blocks leaving draft until they are filled.
- Never write proposed changes here. That is what EventChangeRequest is for.
- `startsAt`/`endsAt`/`expectedAttendance`/`preferredLayout` describe the event as a whole. A multi-session event's individual sessions live in `EventSession` instead - no route builds or reads those yet (schema only, see below).

### `EventSession`

Postgres table `event_sessions` &middot; `prisma.eventSession`

A multi-session event's individual sessions (e.g. a two-day conference where day 1 is in one room and day 2 in another). Optional: a single-session event has zero rows here, and its `VenueBooking`/`EquipmentRequest` rows link to the `Event` directly (`sessionId` NULL) exactly as before this table existed. **No route creates, lists or edits these yet** - the table exists so venue/equipment requests can be scoped to a session once event creation supports adding them.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `label` | String |  | Display only, e.g. "Day 1 Morning". |
| `startsAt` | DateTime | req |  |
| `endsAt` | DateTime | req |  |
| `expectedAttendance` | Int |  |  |
| `preferredLayout` | String |  | Matched against VenueLayout.layoutName. |
| `createdAt` | DateTime |  | Defaults to `now()`. |

**Relations:** `event` &rarr; Event, `venueBookings` &rarr; VenueBooking[], `equipmentRequests` &rarr; EquipmentRequest[]

### `EventFacilityRequirement`

Postgres table `event_facility_requirements` &middot; `prisma.eventFacilityRequirement`

| Field | Type | | Notes |
|---|---|---|---|
| `eventId` | String | req |  |
| `facilityId` | String | req |  |
| `isMandatory` | Boolean |  | false = nice-to-have. A missing optional facility must NOT disqualify a venue. Defaults to `true`. |

**Relations:** `event` &rarr; Event, `facility` &rarr; Facility

### `EventStatusHistory`

Postgres table `event_status_history` &middot; `prisma.eventStatusHistory`

Audit trail of status changes. Event.status holds only the current value.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `fromStatus` | String |  | NULL on creation. |
| `toStatus` | String | req |  |
| `changedBy` | String |  |  |
| `changedAt` | DateTime |  | Defaults to `now()`. |
| `reason` | String |  | Free text - "Assigned to Priya", "Client postponed". |

**Relations:** `event` &rarr; Event, `user` &rarr; User

### `ClarificationRequest`

Postgres table `clarification_requests` &middot; `prisma.clarificationRequest`

The coordinator ↔ organiser review loop. Repeats, so each round is a row.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `requestedBy` | String | req |  |
| `requestedAt` | DateTime |  | Defaults to `now()`. |
| `message` | String | req |  |
| `status` | String |  | open \| answered \| closed. An open one should block confirmation. Defaults to `"open"`. |
| `responseMessage` | String |  |  |
| `respondedAt` | DateTime |  |  |

**Relations:** `event` &rarr; Event, `requester` &rarr; User

### `EventChangeRequest`

Postgres table `event_change_requests` &middot; `prisma.eventChangeRequest`

Proposed changes. NOT applied to the event until approved.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `requestedBy` | String | req |  |
| `requestedAt` | DateTime |  | Defaults to `now()`. |
| `reason` | String | req |  |
| `proposedStartsAt` | DateTime |  | NULL means 'not changing this field'. Also how the UI renders a diff. |
| `proposedEndsAt` | DateTime |  |  |
| `proposedAttendance` | Int |  |  |
| `otherChanges` | String |  |  |
| `isSignificant` | Boolean |  | true = date/time/attendance changed, so venue and equipment need re-checking. Defaults to `false`. |
| `status` | String |  | pending \| approved \| rejected \| withdrawn Defaults to `"pending"`. |
| `reviewedBy` | String |  |  |
| `reviewedAt` | DateTime |  |  |
| `reviewNotes` | String |  |  |

**Relations:** `event` &rarr; Event, `requester` &rarr; User, `reviewer` &rarr; User

### `VenueBooking`

Postgres table `venue_bookings` &middot; `prisma.venueBooking`

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `sessionId` | String |  | Set only for a multi-session event's session-specific booking. NULL means the booking applies to the whole event, as before EventSession existed. |
| `venueId` | String | req |  |
| `layoutName` | String |  | What Venue Staff physically set up. |
| `startsAt` | DateTime | req | COPIED from the event (or session) at request time. Do not read it live - changing an event must not silently move an approved booking. |
| `endsAt` | DateTime | req |  |
| `status` | String |  | pending \| approved \| rejected \| cancelled. Only `approved` blocks a venue. Defaults to `"pending"`. |
| `requestedBy` | String | req |  |
| `requestedAt` | DateTime |  | Defaults to `now()`. |
| `requirementsNote` | String |  |  |
| `decidedBy` | String |  |  |
| `decidedAt` | DateTime |  |  |
| `decisionReason` | String |  | Required when rejecting. |

**Relations:** `event` &rarr; Event, `session` &rarr; EventSession, `venue` &rarr; Venue, `requester` &rarr; User, `decider` &rarr; User

**Watch out:**

- Overlap test: `a.startsAt < b.endsAt AND a.endsAt > b.startsAt`. The same test appears in three places - write it once and reuse it.
- Only compare against `status: 'approved'`. Pending requests may legitimately compete for the same slot.

### `VenueUnavailability`

Postgres table `venue_unavailability` &middot; `prisma.venueUnavailability`

Maintenance blocks. No event, no requester, no approval step — which is why this is separate from VenueBooking.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `venueId` | String | req |  |
| `startsAt` | DateTime | req |  |
| `endsAt` | DateTime | req |  |
| `reason` | String | req | maintenance \| renovation \| safety \| internal_activity \| other |
| `notes` | String |  |  |
| `createdBy` | String | req |  |
| `createdAt` | DateTime |  | Defaults to `now()`. |

**Relations:** `venue` &rarr; Venue, `creator` &rarr; User

### `Equipment`

Postgres table `equipment` &middot; `prisma.equipment`

Tracked by quantity, not by serial number: a coordinator requests "3 projectors", never three specific units.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `name` | String | req |  |
| `category` | String |  | AV \| IT \| Staging \| Networking \| Accessibility |
| `description` | String |  |  |
| `totalQuantity` | Int | req | How many ConnectSphere owns. |
| `quantityInMaintenance` | Int |  | Out of service. Available = total - maintenance - reserved. Defaults to `0`. |
| `isActive` | Boolean |  | Defaults to `true`. |

**Relations:** `requests` &rarr; EquipmentRequest[]

### `EquipmentRequest`

Postgres table `equipment_requests` &middot; `prisma.equipmentRequest`

Request and reservation in one table: a reservation only ever comes from a request, so splitting them made two rows describe one thing.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `sessionId` | String |  | SPM-47/multi-session events: set only when this requirement is scoped to one `EventSession` rather than the whole event. NULL is the common case and means "applies to the whole event". |
| `equipmentId` | String | req |  |
| `quantityRequested` | Int | req | What the coordinator asked for. |
| `quantityReserved` | Int |  | What Tech Support could commit. NULL until reviewed - use COALESCE when summing. |
| `technicalRequirements` | String |  |  |
| `startsAt` | DateTime | req | Usually wider than the event: kit leaves the store early and comes back late. |
| `endsAt` | DateTime | req |  |
| `status` | String |  | Six values. Only `reserved` and `partially_fulfilled` count against availability. Defaults to `"requested"`. |
| `requestedBy` | String | req |  |
| `requestedAt` | DateTime |  | Defaults to `now()`. |
| `reviewedBy` | String |  |  |
| `reviewedAt` | DateTime |  |  |
| `staffNotes` | String |  |  |

**Relations:** `event` &rarr; Event, `session` &rarr; EventSession, `equipment` &rarr; Equipment, `requester` &rarr; User, `reviewer` &rarr; User

**Unique:** two Postgres *partial* indexes, not a single `@@unique` (Prisma's schema DSL has no `WHERE` clause for indexes, so these exist only in migration `20260919100000_add_partial_unique_equipment_request_session` - not in `schema.prisma`):
- `(eventId, equipmentId)` **WHERE** `sessionId IS NULL` - the original rule, for whole-event requests.
- `(eventId, sessionId, equipmentId)` **WHERE** `sessionId IS NOT NULL` - lets two different sessions of the same event each request the same equipment type.

**Watch out:**

- `quantityReserved` is NULL before review - use `COALESCE(SUM(...), 0)` or your total comes back null.
- Because the uniqueness rule isn't a plain `@@unique` in `schema.prisma`, `prisma migrate dev` won't know about it - don't add `@@unique([eventId, equipmentId])` back, it would fight the partial indexes on the next migration.

### `EventSession`

Postgres table `event_sessions` &middot; `prisma.eventSession`

A multi-session event's individual sessions (class clarification #74: different sessions may need different equipment). Schema added by SPM-25 (migration `20260918061723_add_event_sessions`); **no screen creates, lists, or edits one yet** - every event in the system has zero rows here today, so `EquipmentRequest.sessionId` is always NULL in practice until something builds that.

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `label` | String |  | e.g. "Day 1 Morning" - display only. |
| `startsAt` | DateTime | req |  |
| `endsAt` | DateTime | req |  |
| `expectedAttendance` | Int |  |  |
| `preferredLayout` | String |  |  |
| `createdAt` | DateTime |  | Defaults to `now()`. |

**Relations:** `event` &rarr; Event, `venueBookings` &rarr; VenueBooking[], `equipmentRequests` &rarr; EquipmentRequest[]
- One row per equipment type per event (`@@unique`). Asking for more means editing the quantity, not adding a row.
- The unique constraint is `(eventId, equipmentId)`, NOT `(eventId, sessionId, equipmentId)` - deliberately, because Postgres treats NULL as distinct in a unique index and a three-column version would stop deduplicating on single-session events (`sessionId` NULL), which is the common case. The tradeoff: two sessions of the SAME multi-session event can't yet each independently request the same equipment type. Needs a partial/expression index to fix properly - known limitation, not yet hit by any route since none write `sessionId` yet.

### `Registration`

Postgres table `registrations` &middot; `prisma.registration`

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `eventId` | String | req |  |
| `attendeeId` | String | req |  |
| `status` | String |  | registered \| waitlisted \| withdrawn \| attended Defaults to `"registered"`. |
| `registeredAt` | DateTime |  | Defaults to `now()`. |
| `withdrawnAt` | DateTime |  |  |
| `dietaryRequirements` | String |  | The attendee's own needs, not the event's. |
| `accessibilityRequirements` | String |  |  |

**Relations:** `event` &rarr; Event, `attendee` &rarr; User

**Unique:** `@@unique([eventId, attendeeId])`

**Watch out:**

- `@@unique([eventId, attendeeId])` means a withdrawn attendee cannot simply INSERT again - the route reactivates their existing row instead.
- Count `registered` + `attended` for seats taken. `withdrawn` frees the place.

### `Notification`

Postgres table `notifications` &middot; `prisma.notification`

| Field | Type | | Notes |
|---|---|---|---|
| `id` | String |  | Defaults to `uuid()`. |
| `recipientId` | String | req | One row per person, not per event. |
| `type` | String | req |  |
| `title` | String | req |  |
| `body` | String | req |  |
| `eventId` | String |  | Lets the notification deep-link to what caused it. |
| `isRead` | Boolean |  | Defaults to `false`. |
| `createdAt` | DateTime |  | Defaults to `now()`. |

**Relations:** `recipient` &rarr; User, `event` &rarr; Event

---

## Rules the database does NOT enforce

There are no CHECK constraints and no triggers. Postgres will happily store a
double-booked venue. These rules live in route code:

| Rule | Where it lives | What it checks |
|---|---|---|
| Draft completeness | `api/events/[id]` PATCH | title, category, startsAt, endsAt, expectedAttendance filled before leaving `draft` |
| Rejection reason | `api/events/[id]` PATCH | a reason is given when status becomes `rejected` |
| Venue suitability | venues domain (to write) | layout capacity >= attendance, all mandatory facilities present |
| Booking conflict | venues domain (to write) | no overlapping `approved` booking or unavailability |
| Equipment availability | equipment domain (to write) | requested <= total - maintenance - overlapping reservations |
| Registration | `api/registrations` POST | event confirmed, within window, not already registered, seats left |

Wrap check-and-write in `prisma.$transaction(...)`. Two people clicking at the
same moment will both pass a check that is not inside one.

The overlap test, which you need in three of these:

```ts
// two periods overlap if each starts before the other ends
startsAt: { lt: otherEnd },
endsAt:   { gt: otherStart },
```

---

## Queries you will write over and over

**Venues that fit an event and are free:**

```ts
const venues = await prisma.venue.findMany({
  where: {
    isActive: true,
    layouts: { some: { layoutName: event.preferredLayout, capacity: { gte: event.expectedAttendance } } },
    bookings: { none: { status: 'approved', startsAt: { lt: event.endsAt }, endsAt: { gt: event.startsAt } } },
    unavailability: { none: { startsAt: { lt: event.endsAt }, endsAt: { gt: event.startsAt } } },
  },
  include: { layouts: true, facilities: { include: { facility: true } } },
});
```

**Seats left on an event:**

```ts
const taken = await prisma.registration.count({
  where: { eventId, status: { in: ['registered', 'attended'] } },
});
```

**Equipment free in a window:**

```ts
const eq = await prisma.equipment.findUnique({ where: { id } });
const agg = await prisma.equipmentRequest.aggregate({
  _sum: { quantityReserved: true },
  where: { equipmentId: id, status: { in: ['reserved', 'partially_fulfilled'] },
           startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
});
const available = eq.totalQuantity - eq.quantityInMaintenance - (agg._sum.quantityReserved ?? 0);
```

---

## Demo data

`npx prisma db seed` loads a full working dataset. It **wipes every table first**,
so do not run it when you have data you care about.

| | |
|---|---|
| Organisations | 12 |
| Users | 71 (15 staff, 16 organisers, 40 attendees) |
| Venues | 16 across 5 buildings, with layouts and facilities |
| Equipment | 26 types, some units in maintenance |
| Events | 23, covering every status |
| Bookings | 19 - approved, pending, rejected and cancelled |
| Registrations | ~230 |

**Every account's password is `password123`.**

Useful logins:

- `daniel.tan@connectsphere.com` - coordinator with several events
- `grace.lim@connectsphere.com` - ops manager, sees the unassigned queue
- `marcus.wong@connectsphere.com` - venue staff
- `kenji.sato@connectsphere.com` - tech support
- organiser emails are generated from the company name; check `users` in Prisma Studio

The data deliberately contains things to find: venues that lack a hearing loop so
suitability checks can rule them out, equipment in maintenance so availability is
not just the total, an event rejected with a reason on record, and a change request
refused because the room caps at 40.


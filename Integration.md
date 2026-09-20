# Integration Approach — Research

**Ticket:** Investigate Integration Approach
**Status:** Draft — routes for venue booking are not yet built (see
[DOCUMENTATION.md § The 5 Domains](./DOCUMENTATION.md#-the-5-domains-services)),
so parts of this document describe *proposed* interfaces rather than existing
ones. That's called out explicitly below.
**Updated (SPM-7):** `POST /api/events` now creates initial equipment
requests directly (see §1 and §5) and `GET /api/facilities` is a new,
existing endpoint — both added below.
**Corrected:** `/api/registrations` has no `GET` and no withdrawal route —
see §2.

ConnectSphere is a single Next.js app with one Postgres database — there is no
network boundary between domains, so "integration" here means **cross-domain
data dependencies inside the monolith**: which domain's route code needs to
read (or eventually write) another domain's tables, and what breaks if that
dependency isn't handled carefully.

Every field/model name below links to its definition in
[`prisma/schema.prisma`](./prisma/schema.prisma); every route claim links to
the actual route file. Backlog stories are cited by name/number only (no
link) — click through the code links and check them; several of these are
how the two corrections above were actually found.

---

## 1. Required system interactions

| From domain | To domain | Interaction | Why |
|---|---|---|---|
| Events | Venues | Check capacity, layout, mandatory facilities before a booking is approved | [`Event.expectedAttendance`](./prisma/schema.prisma#L188)/[`preferredLayout`](./prisma/schema.prisma#L190) must be checked against [`Venue.maxCapacity`](./prisma/schema.prisma#L95), [`VenueLayout.capacity`](./prisma/schema.prisma#L125), [`EventFacilityRequirement`](./prisma/schema.prisma#L228) |
| Events | Venues | Detect time-conflicting bookings for the same venue | Two approved [`VenueBooking`](./prisma/schema.prisma#L313) rows for the same venue must not overlap |
| Events | Equipment | Check requested quantity against availability across overlapping time windows | [`EquipmentRequest.startsAt/endsAt`](./prisma/schema.prisma#L403) windows for the same [`Equipment`](./prisma/schema.prisma#L371) compete for [`totalQuantity`](./prisma/schema.prisma#L378) − [`quantityInMaintenance`](./prisma/schema.prisma#L380) |
| Events | **Equipment (write)** | **Create the initial `EquipmentRequest` row(s) for an event** | [`POST /api/events`](./src/app/api/events/route.ts#L97) writes [`EquipmentRequest`](./prisma/schema.prisma#L391) directly, in the same transaction as the [`Event`](./prisma/schema.prisma#L165), deriving [`startsAt/endsAt`](./src/app/api/events/route.ts#L49-L54) as the event's own times ± 2h load-in/load-out. Added in SPM-7 — see the ownership exception below. Backs `#11 Record Equipment Requirements` |
| Events | Venues (Facility read) | Populate facility/accessibility checkboxes on the event form | [`GET /api/facilities`](./src/app/api/facilities/route.ts#L15) (Kayal's domain), filtered by [`category`](./prisma/schema.prisma#L141) (`facility` vs `accessibility`) |
| Events | Registrations | Enforce registration capacity and open/close window | [`Registration`](./prisma/schema.prisma#L428) count vs [`Event.registrationCapacity`](./prisma/schema.prisma#L196), gated by [`registrationOpensAt/ClosesAt`](./prisma/schema.prisma#L197-L198) |
| Events | **Venues + Equipment + Registrations (read, aggregate)** | **Determine which arrangements are still outstanding vs complete, per event, to gate confirmation and identify what a change affects** | Backing interaction for `#12 Track Outstanding Arrangements`, `#13 Confirm Event`, and `Process Event Change Request`. Reads [`VenueBooking.status`](./prisma/schema.prisma#L326), [`EquipmentRequest.status`](./prisma/schema.prisma#L407), and (only where [`registrationEnabled`](./prisma/schema.prisma#L194)) [`Registration`](./prisma/schema.prisma#L428)/capacity setup, keyed by `eventId` (a foreign key repeated on several tables — not linked to one specific line for that reason). **Not built, and not yet even designed as an endpoint** — see the risk noted in §5 |
| Auth | every domain | Session verification + role authorization | Every route calls [`getSession()`](./src/lib/auth.ts); some actions are role-gated (e.g. only `ops_manager` assigns a coordinator — UI designed in `design/mockups/AssignmentQueue.dc.html`/`CoordinatorDashboard.dc.html`, backend not yet built). Backs `Assign Event Coordinator` |
| Events | Notifications | Notify a user on status change, clarification, or decision | [`Notification`](./prisma/schema.prisma#L459) table exists and links to [`Event`](./prisma/schema.prisma#L165), but no route currently writes to it. Backs `Receive Event Notifications` |

**Ownership note:** per [DOCUMENTATION.md:164](./DOCUMENTATION.md#L164), reads
across domains are fine, writes need the owner's involvement — a convention
([domain table](./DOCUMENTATION.md#-the-5-domains-services): Events =
Kristen, Equipment = Janelle), not a rule about who typed the commit (SPM-7
was Jordan, per `git log`). **Exception:** [`POST /api/events`](./src/app/api/events/route.ts#L97)
writes directly into Janelle's [`EquipmentRequest`](./prisma/schema.prisma#L391).
Deliberate, not a bug — an event and its requirements save as one unit, so a
half-saved request can't happen; the whole submission just fails and the
organiser retries. Trade-off: `EquipmentRequest` rows can now come from two
places, so Janelle's future review routes can't assume every row is hers
(see §5).

---

## 2. Interfaces / API requirements

| Endpoint | Status | Notes |
|---|---|---|
| [`POST /api/events`](./src/app/api/events/route.ts#L27), [`PATCH /api/events/[id]`](./src/app/api/events/%5Bid%5D/route.ts#L52) | ✅ exists | Owns [`Event`](./prisma/schema.prisma#L165) writes. **As of SPM-7, `POST /api/events` also creates the initial [`EventFacilityRequirement`](./prisma/schema.prisma#L228) and [`EquipmentRequest`](./prisma/schema.prisma#L391) rows** in the same transaction — see the ownership exception above |
| [`GET /api/facilities`](./src/app/api/facilities/route.ts#L15) | ✅ exists (new, SPM-7) | Kayal's domain. Reference data only — `{ id, name, category }`, `category` is `facility` or `accessibility`. Consumed by the event form (S-08) and, once built, venue search (S-14) |
| [`GET`](./src/app/api/venues/route.ts#L6)/[`POST`](./src/app/api/venues/route.ts#L19) `/api/venues` | ✅ exists | List + create only |
| [`GET`](./src/app/api/equipment/route.ts#L6)/[`POST`](./src/app/api/equipment/route.ts#L13) `/api/equipment` | ✅ exists | List + create only |
| [`POST /api/registrations`](./src/app/api/registrations/route.ts#L7) | ✅ exists | **Corrected — was wrongly listed as `GET/POST` before.** There is no `GET` handler in this file, and no `[id]` route at all ([confirm for yourself](./src/app/api/registrations/route.ts): the whole file is one `POST` function) |

This table now lists **only what's actually built**, each row linked to the
real file. Endpoints that don't exist yet (venue booking, equipment
requests, registration status/withdrawal, an event-readiness aggregate) are
tracked as gaps in §1 (interactions) and §5 (risks) instead, so they aren't
duplicated here as if they were interfaces.

All routes follow the existing pattern: Zod schema in
[`src/lib/validation/`](./src/lib/validation/index.ts) → route handler
validates → business rule check → `prisma` call → JSON response, per
[DOCUMENTATION.md § The Pattern to Copy](./DOCUMENTATION.md#-the-pattern-to-copy-for-a-new-endpoint).

---

## 3. Data exchanged

| Consumer | Field(s) read | Source |
|---|---|---|
| Venue booking check | [`startsAt`](./prisma/schema.prisma#L185), [`endsAt`](./prisma/schema.prisma#L186), [`expectedAttendance`](./prisma/schema.prisma#L188), [`preferredLayout`](./prisma/schema.prisma#L190) | [`Event`](./prisma/schema.prisma#L165) |
| Venue booking check | [`maxCapacity`](./prisma/schema.prisma#L95), [`layouts`](./prisma/schema.prisma#L109)`[].`[`capacity`](./prisma/schema.prisma#L125), [`facilities`](./prisma/schema.prisma#L110)`[]` | [`Venue`](./prisma/schema.prisma#L82), [`VenueLayout`](./prisma/schema.prisma#L121), [`VenueFacility`](./prisma/schema.prisma#L150) |
| Venue conflict check | [`startsAt`](./prisma/schema.prisma#L322), [`endsAt`](./prisma/schema.prisma#L323), [`status`](./prisma/schema.prisma#L326) | other [`VenueBooking`](./prisma/schema.prisma#L313) rows for the same venue, [`VenueUnavailability`](./prisma/schema.prisma#L347) |
| Equipment availability check | [`startsAt`](./prisma/schema.prisma#L185), [`endsAt`](./prisma/schema.prisma#L186) | [`Event`](./prisma/schema.prisma#L165), transformed — [`EquipmentRequest.startsAt/endsAt`](./prisma/schema.prisma#L403) = event's own times **± 2h** (load-in/load-out), computed in [`POST /api/events`](./src/app/api/events/route.ts#L49-L54), not a raw copy |
| Equipment availability check | [`quantityRequested`](./prisma/schema.prisma#L396), [`startsAt`](./prisma/schema.prisma#L403), [`endsAt`](./prisma/schema.prisma#L404), [`status`](./prisma/schema.prisma#L407) | other [`EquipmentRequest`](./prisma/schema.prisma#L391) rows for the same equipment |
| Equipment availability check | [`totalQuantity`](./prisma/schema.prisma#L378), [`quantityInMaintenance`](./prisma/schema.prisma#L380) | [`Equipment`](./prisma/schema.prisma#L371) |
| Event request form (S-08), venue search (S-14) | `id`, `name`, [`category`](./prisma/schema.prisma#L141) | [`Facility`](./prisma/schema.prisma#L137), via [`GET /api/facilities`](./src/app/api/facilities/route.ts#L15) |
| Registration check | [`registrationCapacity`](./prisma/schema.prisma#L196), [`registrationOpensAt/ClosesAt`](./prisma/schema.prisma#L197-L198), [`status`](./prisma/schema.prisma#L433) | [`Event`](./prisma/schema.prisma#L165) / [`Registration`](./prisma/schema.prisma#L428) |

---

## 4. Validated integrations

Unlike §1 (which includes interactions that are still only planned), every
integration below was confirmed by directly reading the code that implements
it — not assumed from a route's name. Each one is a real place where one
domain's route touches another domain's table right now.

**1. Auth ↔ every non-auth domain.** [`getActor()`](./src/lib/apiAuth.ts) is
used in all six non-auth route files —
[`events`](./src/app/api/events/route.ts),
[`events/[id]`](./src/app/api/events/%5Bid%5D/route.ts),
[`venues`](./src/app/api/venues/route.ts),
[`equipment`](./src/app/api/equipment/route.ts),
[`facilities`](./src/app/api/facilities/route.ts),
[`registrations`](./src/app/api/registrations/route.ts) — confirmed by
grepping for the import in every route file. The three
[`auth/*`](./src/app/api/auth/) routes don't use it, correctly: you aren't
"logged in yet" during login itself.

**2. Auth ↔ Events.** [`organisationId`](./prisma/schema.prisma#L165) is
stamped onto a new `Event` from `actor.organisationId` at
[`events/route.ts:66`](./src/app/api/events/route.ts#L66), then used by
[`src/lib/permissions.ts`](./src/lib/permissions.ts#L156) to scope what an
Organiser can see — the implementation of clarification `#81`.

**3. Events → Equipment (write).** Confirmed on **both** entry points, not
just one: [`POST /api/events`](./src/app/api/events/route.ts#L97) and
[`PATCH /api/events/[id]`](./src/app/api/events/%5Bid%5D/route.ts#L270)
both write directly into [`EquipmentRequest`](./prisma/schema.prisma#L391)
— a table Janelle's domain owns — in the same transaction as the `Event`
itself. This is the write flagged as the ownership exception above.

**4. Events → Facility (read).** Also confirmed on two entry points:
[`GET /api/events`](./src/app/api/events/route.ts#L22) (list) and
[`GET /api/events/[id]`](./src/app/api/events/%5Bid%5D/route.ts#L30)
(detail) both `include: { facilityRequirements: { include: { facility: true } } }`
— a direct Prisma join into [`Facility`](./prisma/schema.prisma#L137),
which belongs to Kayal's domain, bypassing her
[`GET /api/facilities`](./src/app/api/facilities/route.ts#L15) endpoint
entirely. This was missed on the first pass through this document and only
found by grepping every route file for `include:`.

**5. Registrations → Events (read).**
[`POST /api/registrations`](./src/app/api/registrations/route.ts#L7) reads
[`Event.status`](./prisma/schema.prisma#L182),
[`registrationEnabled`](./prisma/schema.prisma#L194),
[`registrationCapacity`](./prisma/schema.prisma#L196), and
[`registrationOpensAt/ClosesAt`](./prisma/schema.prisma#L197-L198) directly
before deciding whether to allow a registration.

---

## 5. Integration risks

| Risk | Impact | Mitigation |
|---|---|---|
| No DB constraints stop overlapping bookings or over-reserved equipment | Double-booked venue or over-committed equipment discovered only at event time | Enforce with the overlap check inside a `prisma.$transaction` (check-and-write must be atomic, not two separate calls) |
| Cross-domain writes bypassing the owning domain | Two people editing the same [`Event`](./prisma/schema.prisma#L165)/[`VenueBooking`](./prisma/schema.prisma#L313) row from different route files, causing silent state conflicts | Keep writes to a table inside its owning domain's route folder only (already the team convention — worth stating explicitly for booking routes since they're new) |
| [`POST /api/events`](./src/app/api/events/route.ts#L97) (Events domain, per convention Kristen's — actually authored by Jordan in SPM-7) already writes [`EquipmentRequest`](./prisma/schema.prisma#L391), a table Janelle owns | Equipment requests can now come from two places, not one. A review route built assuming "only my own endpoint writes here" could skip or mishandle rows created this way | Document the shape `POST /api/events` writes (unique on `(eventId, equipmentId)`, `status: "requested"`, dates = event window ± 2h) so Janelle's routes are built to handle both sources; treat any change to that shape as a cross-domain change needing both owners' sign-off |
| `/api/registrations` cannot serve #19's "view status" or #20 at all | Two backlog stories are unimplementable against the current API surface — not a design gap, a missing-endpoint gap. Someone could reasonably assume this domain is "🟢 working" (per `DOCUMENTATION.md`) and move on without checking | Add `GET /api/registrations` (or `GET /api/events/[id]` including the caller's own registration) for status, and `PATCH /api/registrations/[id]` to set `status: "withdrawn"`, before marking `#19`/`#20` done |
| Frontend/backend field-shape drift | Already happened once — [`src/app/events/page.tsx`](./src/app/events/page.tsx) posts `proposedDate`/`timeSlot`, which no longer exist after the schema rebuild | New forms for venue bookings and equipment requests should be built against the field names in this document, not older names from [`ENDPOINT_ADAPTATION_GUIDE.md`](./ENDPOINT_ADAPTATION_GUIDE.md) |
| Shared [`schema.prisma`](./prisma/schema.prisma) / [`validation.ts`](./src/lib/validation.ts) contention | Two teammates editing either file concurrently produces painful merge conflicts (per [DOCUMENTATION.md § Avoiding Merge Conflicts](./DOCUMENTATION.md#-avoiding-merge-conflicts)) | Adding the booking/request schemas should be one PR, announced in advance, same as any other schema change |
| Role/session coupling | Every domain depends on [`Auth`](./src/lib/auth.ts); a role-value change (already happened once) invalidates all existing JWTs app-wide | Treat role string values as a shared contract; changing them needs the same announce-first treatment as a schema change |
| Concurrent equipment reviewers | Two `tech_support` staff approving overlapping [`EquipmentRequest`](./prisma/schema.prisma#L391)s for the same equipment at the same time could both pass an availability check run outside a transaction | Same transaction requirement as the venue-booking risk above |
| "Outstanding arrangements" has no fixed definition per event | The customer explicitly stated there is no single fixed list of essential arrangements — some events don't need equipment, technical support, or registration at all (clarification `#80`, GitHub Discussions — not saved in this repo, cited from the conversation record only). A hardcoded "check venue + equipment + registration" rule would wrongly block confirmation for an event that never needed one of those, or wrongly allow it for one that did but was skipped | The aggregate read added to §1 must be driven by what the event *itself* declared as required (e.g. only check [`Registration`](./prisma/schema.prisma#L428) setup if [`registrationEnabled`](./prisma/schema.prisma#L194)), not a fixed checklist — this needs to be resolved before `#12`/`#13` can be built, since it's a design decision, not just a query |

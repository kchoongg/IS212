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
| `ops_manager` | Event Operations Manager | Internal | **Our addition** — see below |

The briefing names five roles. `ops_manager` is a sixth that we added: §5 Step 3
says an event "is assigned" to a coordinator without saying by whom, and a
coordinator cannot assign themselves before they are responsible for the event.
We model that assigner as an internal admin variant of Coordinator — identical
chrome, one extra screen (`/assignments`). This is a design decision, not a
requirement; it is worth confirming at a customer Q&A.

Roles are stored as a plain string on `users.role`. The allowed values are
enforced by the Zod enum in `src/lib/validation.ts` at registration and listed
in `ROLES` in `src/lib/roles.ts`. There is no database CHECK constraint, which
is consistent with the project-wide decision that business rules live in route
code (DOCUMENTATION.md §"Business rules live in code, not the database").

---

## 2. Permissions by role

`can(role, action)` answers this table and nothing else — it is the role half of
the model, deliberately blind to which event is involved.

| Action | Organiser | Coordinator | Ops Manager | Venue Staff | Tech Support | Attendee |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `event:create` | ✅ | — | — | — | — | — |
| `event:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `event:edit_draft` | ✅ | — | — | — | — | — |
| `event:review` (clarify / approve / reject) | — | ✅ | — | — | — | — |
| `event:assign_coordinator` | — | — | ✅ | — | — | — |
| `event:confirm` | — | ✅ | — | — | — | — |
| `event:cancel` | ✅ | ✅ | ✅ | — | — | — |
| `venue:view` | — | ✅ | ✅ | ✅ | — | — |
| `venue:manage` | — | — | — | ✅ | — | — |
| `venue_booking:request` | — | ✅ | — | — | — | — |
| `venue_booking:decide` | — | — | — | ✅ | — | — |
| `equipment:view` | ✅ | ✅ | ✅ | — | ✅ | — |
| `equipment:manage` | — | — | — | — | ✅ | — |
| `equipment_request:manage` | — | ✅ | — | — | — | — |
| `equipment_request:review` | — | — | — | — | ✅ | — |
| `registration:create` | — | — | — | — | — | ✅ |
| `registration:view_list` | ✅ | ✅ | — | — | — | — |
| `facility:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Each row traces to the briefing's §5 process: the organiser drafts and submits
(Steps 1-2), the Ops Manager assigns (Step 3), the coordinator reviews, approves
and confirms (Steps 4-5, 10), Venue Staff decide bookings (Step 7), Technical
Support decides equipment (Step 8), attendees register (Step 11).

Three entries are worth explaining:

- **`equipment:view` includes the organiser.** The event request form (S-08)
  asks the organiser to pick the equipment they need from the catalogue, so the
  catalogue is part of making a request, not internal planning information.
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

An unknown role — anything not in `ROLES` — is granted nothing.

---

## 3. Relationship to an event

Passing the table above is necessary, not sufficient. For anything involving a
specific event, the user must also be related to it.

| Relationship | Meaning |
| --- | --- |
| **Owns** | `event.organiserId === user.id` — the organiser who raised the request |
| **Same client** | `event.organisationId === user.organisationId`, both non-null |
| **Assigned** | `event.coordinatorId === user.id`, **or** the event has no coordinator yet |

The user's `organisationId` is not in the JWT. `getActor()` in
[`src/lib/apiAuth.ts`](../src/lib/apiAuth.ts) loads it (and the current role,
and `isActive`) per request, so a role change or a deactivated account takes
effect immediately rather than when the eight-hour token expires.

The "or unassigned" clause on **Assigned** lets any coordinator pick work off
the review queue before Coordinator Assignment is built. Once it exists, decide
whether to keep that clause.

### Who can see which event

| Role | Sees |
| --- | --- |
| Organiser | Their own events including drafts, plus **non-draft** events of their own client organisation |
| Attendee | Only events that are `confirmed` **and** have registration enabled |
| Coordinator, Ops Manager, Venue Staff, Tech Support | Every event that has left `draft` |
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

`id · title · description · category · startsAt · endsAt · status ·
registrationEnabled · registrationCapacity · registrationOpensAt ·
registrationClosesAt`

Everything else is internal planning information and is withheld: the assigned
coordinator, the organiser and client identity, expected attendance, special
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
| `draft` | Organiser (owner) | Step 1 |
| `submitted` | Organiser (owner) | Step 2 |
| `under_review` | Ops Manager, Coordinator | Step 3 |
| `approved` / `rejected` | Coordinator (assigned) | Step 5 |
| `planning` | Coordinator (assigned) | Step 6 |
| `confirmed` | Coordinator (assigned) | Step 10 |
| `completed` | Coordinator (assigned) | Step 14 |
| `postponed` | Coordinator (assigned), Organiser (owner) | §4 Rescheduling |
| `cancelled` | Coordinator (assigned) only | §4 Cancellation, customer clarification #68 |

Venue Staff and Technical Support appear nowhere: they decide their own bookings
and equipment requests, not the event's status.

This table says **who**, not **which from → to moves are legal**. The lifecycle
graph (you cannot jump `draft` → `confirmed`) belongs to Event Status
Management and is not implemented yet — see Open items.

---

## 6. Where it is enforced

Every route resolves an `Actor`, checks the role, then checks the relationship.

| Route | Enforcement |
| --- | --- |
| `GET /api/events` | `eventListWhere(actor)` filters in SQL; attendees get the public subset |
| `POST /api/events` | `event:create` — organiser only |
| `GET /api/events/[id]` | `canViewEvent()` → 404; `visibleEventFor()` narrows the fields |
| `PATCH /api/events/[id]` (status) | `canViewEvent()` → 404, then `canSetEventStatus()` → 403 |
| `PATCH /api/events/[id]` (draft edit) | `canEditEventContent()` — owning organiser, draft only |
| `GET /api/venues` | `venue:view` — Coordinator, Ops Manager, Venue Staff |
| `POST /api/venues` | `venue:manage` — Venue Staff |
| `GET /api/equipment` | `equipment:view` |
| `POST /api/equipment` | `equipment:manage` — Technical Support |
| `GET /api/events/[id]/equipment` | `canViewEvent()` → 404, then `canViewEquipmentRequests()` → 403 (Technical Support, the assigned Coordinator, or the owning Organiser read-only) |
| `POST /api/events/[id]/equipment` | `canViewEvent()` → 404, then `canManageEquipmentRequests()` — assigned Coordinator |
| `PATCH`/`DELETE /api/events/[id]/equipment/[requestId]` | Same as `POST` above, resolved from the request's own event |
| `GET /api/facilities` | `facility:view` — any signed-in user |
| `POST /api/registrations` | `registration:create` — attendee, plus `canViewEvent()` on the target event |

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
status of 44 refusals and permitted actions, each labelled with the acceptance
criterion it belongs to (including an `SPM-47` group covering the equipment
request routes added there). Start `npm run dev` first. It creates its own
event through the API and deletes everything it made, so it is safe to re-run.

Note that two refusals answer 404 where you might expect 403: an attendee
cannot *see* a submitted event, so visibility refuses before the role check is
reached. The role check is asserted separately, on an event the attendee is
allowed to see.

---

## 8. Open items

- **Lifecycle validation.** Who may set a status is enforced; which transitions
  are legal is not. `draft → confirmed` in one step is currently possible for a
  coordinator.
- **Coordinator Assignment** has no endpoint yet, which is why any coordinator
  may pick up an unassigned event.
- **Venue bookings** have no routes yet. `venue_booking:decide` is defined and
  ready for whoever builds them.
- **Equipment requests can now be recorded** (SPM-47, `equipment_request:manage`)
  but not yet reviewed. `equipment_request:review` is still defined and ready
  for whoever builds the Technical Support side (SPM-48/49/50).
- **`registration:view_list`** is defined but unused — the attendee list screen
  is not built.
- **`users.role` has no database constraint.** Zod guards the register route;
  a direct database write is not guarded.

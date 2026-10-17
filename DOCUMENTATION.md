# CONNECTSPHERE
## Developer Documentation — Living Document

**Version:** 3.3
**Architecture:** Single Next.js app — one codebase, one database, one deploy
**Status:** 🟢 Schema built — 17 tables live, all routes reconnected, demo data available
**Frontend:** 🟢 Design system + app shell built; 7 of 28 screens implemented
**Database:** Neon (hosted PostgreSQL, free tier)
**Team:** 5 members, one domain each, same codebase

> **This is a living document.** Every time someone makes a real change — a new
> table, a new endpoint, a new package, a schema redesign — add an entry to the
> [Changelog](#-changelog) at the bottom AND update whichever section above it
> describes what changed. A doc that isn't updated becomes wrong within a week;
> updating it is part of finishing the change, not an optional extra step.
>
> **Companion documents:**
> - [`SCHEMA_REFERENCE.md`](./SCHEMA_REFERENCE.md) — every table, every field,
>   every allowed status value, and the gotchas. **Read this before writing a
>   query.** It's the answer to "what's that field called again?"
> - [`ENDPOINT_ADAPTATION_GUIDE.md`](./ENDPOINT_ADAPTATION_GUIDE.md) — the route
>   code as it was before the schema rebuild. Historical now; kept for reference.
> - [`UI_DESIGN.md`](./UI_DESIGN.md) — every screen, how users move between
>   them, what each form asks for, and how errors are shown. **Read this before
>   building a screen.** It's the answer to "what goes on this page?"
> - [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md) — who may do what, and to
>   which events. **Read this before writing any route**, and check the
>   permission it needs before you write the handler.
> - [`docs/ConnectSphere_Status_Lifecycle.drawio`](./docs/ConnectSphere_Status_Lifecycle.drawio)
>   — the eleven event statuses and which moves between them are legal, the
>   lifecycle the events `PATCH` route refers to (open with
>   [diagrams.net](https://app.diagrams.net)).
> - [`docs/ConnectSphere_BPMN.drawio`](./docs/ConnectSphere_BPMN.drawio) — the
>   whole business process as one swimlane per role, showing who does what, in
>   what order, from an organiser's first draft to a completed event.
>
> **Keep the two diagrams in step with the code.** A change to the event
> lifecycle — a new status, a new transition, a changed rule — updates the
> status lifecycle diagram in the same PR, and a change to the cross-role
> process — a new step, a changed handoff between roles — updates the BPMN
> one. A diagram left to drift is worse than none, because people trust it.

---

## 📋 TABLE OF CONTENTS

1. [Quick Start](#-quick-start)
2. [Directory Structure](#-directory-structure)
3. [The 5 Domains ("Services")](#-the-5-domains-services)
4. [How a Request Flows](#-how-a-request-flows)
5. [The Pattern to Copy for a New Endpoint](#-the-pattern-to-copy-for-a-new-endpoint)
6. [The Frontend and the Design System](#-the-frontend-and-the-design-system)
7. [Working With the Database](#-working-with-the-database)
8. [Business Rules Live in Code, Not the Database](#-business-rules-live-in-code-not-the-database)
9. [Changing the Schema](#-changing-the-schema)
10. [Everyday Commands](#-everyday-commands)
11. [Avoiding Merge Conflicts](#-avoiding-merge-conflicts)
12. [Troubleshooting](#-troubleshooting)
13. [Known Gaps](#-known-gaps)
14. [Changelog](#-changelog)

---

## 🚀 QUICK START

### Prerequisites
- **Node.js 20.12 or later** — 22 LTS recommended. Vitest needs `styleText`
  from `node:util`, which landed in 20.12. Plain "Node 20" is not enough and
  fails with a confusing `SyntaxError` about `node:util`.
- A **Neon** account (free) — [neon.tech](https://neon.tech). Chosen over Supabase
  because Supabase's free tier pauses (breaking auth + API with it) after 7 days
  of inactivity — doesn't suit a project only touched in sprint bursts. Neon
  cold-starts instead — slower on the first request, never actually broken.

### First-time setup

```bash
git clone https://github.com/kchoongg/IS212.git
cd IS212
git checkout <the branch you're working on>
npm install
```

Create `.env` in the project root (it is gitignored, so you won't get one from
the clone):

```
DATABASE_URL="<Neon connection string — see the warning below>"
JWT_SECRET="<any long random string>"
```

> ⚠️ **Use the DIRECT connection string, not the pooled one.** Neon gives you
> two. The pooled one has `-pooler` in the hostname and breaks Prisma
> migrations. In the Neon Console → **Connect**, toggle **Connection pooling
> OFF** before copying. Keep `?sslmode=require` on the end.

Generate a `JWT_SECRET` with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then:

```bash
npx prisma generate      # build the typed client from schema.prisma
npx prisma db seed       # load demo data (optional, but do it)
npm run dev
```

Visit **http://localhost:3000**.

### Logging in

After seeding, **every account's password is `password123`**.

| Email | Role |
|---|---|
| `daniel.tan@connectsphere.com` | coordinator, owns several events |
| `grace.lim@connectsphere.com` | ops manager — assigns and reassigns coordinators on `/assignments` (SPM-30) |
| `marcus.wong@connectsphere.com` | venue staff |
| `kenji.sato@connectsphere.com` | tech support |

Organiser and attendee emails are generated — look them up in
`npx prisma studio` under `users`.

---

## 📁 DIRECTORY STRUCTURE

```
IS212/
├── prisma.config.ts           # Tells Prisma where the schema is + loads .env
├── prisma/
│   ├── schema.prisma           # ALL domains' tables live in this ONE file
│   ├── seed.ts                 # Demo data — run with `npx prisma db seed`
│   └── migrations/             # Auto-generated. Commit these, never edit them.
│
├── UI_DESIGN.md                # THE screen spec — read before building any screen
├── design/mockups/             # Visual mockups (.dc.html), one file per screen
├── docs/
│   ├── PERMISSIONS.md           # THE permission model — read before writing a route
│   ├── discussions/             # Customer Q&A exports (GitHub Discussions), by date
│   └── test-cases/              # Per-story test case exports (Excel + JSON)
│
├── scripts/
│   ├── verify-permissions.ts    # `npm run verify:permissions` — see Everyday Commands
│   ├── verify-login.ts          # `npm run verify:login`
│   ├── seed-spm27.ts            # `npm run fixtures:spm27` — SPM-27 test data, no reseed
│   ├── seed-spm30.ts            # `npm run fixtures:spm30` — SPM-30 test data, no reseed
│   ├── seed-spm34.ts            # `npm run fixtures:spm34` — SPM-34 test data, no reseed
│   ├── seed-spm28.ts            # `npm run fixtures:spm28` — SPM-28 test data, no reseed
│   ├── seed-spm42.ts            # `npm run fixtures:spm42` — SPM-42 test data, no reseed
│   ├── seed-spm44.ts            # `npm run fixtures:spm44` — SPM-44 test data, no reseed
│   ├── seed-spm43.ts            # `npm run fixtures:spm43` — SPM-43 test data, no reseed
│   ├── seed-spm50.ts            # `npm run fixtures:spm50` — SPM-50 test data, no reseed
│   ├── seed-spm54.ts            # `npm run fixtures:spm54` — SPM-54 test data, no reseed
│   ├── seed-spm45.ts            # `npm run fixtures:spm45` — SPM-45 test data, no reseed
│   ├── seed-spm62.ts            # `npm run fixtures:spm62` — SPM-62 test data, no reseed
│   ├── seed-spm33.ts            # `npm run fixtures:spm33` — SPM-33 test data, no reseed
│   ├── seed-spm93.ts            # `npm run fixtures:spm93` — SPM-93 test data, no reseed
│   ├── seed-spm86.ts            # `npm run fixtures:spm86` — SPM-86 test data, no reseed
│   ├── seed-spm55.ts            # `npm run fixtures:spm55` — SPM-55 test data (own "SPM55 …" items), no reseed
│   ├── seed-spm85.ts            # `npm run fixtures:spm85` — the Safety Officer account + SPM-85 test data, no reseed
│   ├── seed-spm71.ts            # `npm run fixtures:spm71` — SPM-71 test accounts, notifications and events, no reseed
│   ├── seed-spm82.ts            # `npm run fixtures:spm82` — SPM-82 hold room and events with expiring holds, no reseed
│   └── spm93-round-turnaround.ts # one-off: rounds venues' setup/turnaround up to 15-min
│                                   steps and lists bookings that then clash (dry run by default)
│
└── src/
    ├── app/
    │   ├── layout.tsx            # Fonts + the app shell that wraps every page
    │   ├── globals.css            # Base layer only. Colours live in tailwind.config.ts
    │   ├── page.tsx                # Homepage
    │   ├── login/page.tsx           # S-01
    │   ├── register/page.tsx         # S-02
    │   ├── dashboard/page.tsx         # S-03, role-aware
    │   ├── events/page.tsx             # S-07. The Ops Manager also gets a
    │   │                                "Coordinator" filter (Not yet assigned /
    │   │                                Assigned) here (SPM-30 AC2).
    │   ├── queue/page.tsx               # S-12 Review Queue (SPM-28), coordinator only:
    │   │                                the requests assigned to you that are Under
    │   │                                review. Each opens its review page.
    │   ├── events/[id]/review/page.tsx  # S-13 Event review (SPM-28): what was
    │   │                                requested, "Not provided" flags, then
    │   │                                Approve (with a confirm dialog) or Reject
    │   │                                (reason required). A task screen of its own,
    │   │                                NOT a tab of the event hub. Only the assigned
    │   │                                coordinator can use it; opened for a request
    │   │                                that's already decided, it redirects to the
    │   │                                event page.
    │   ├── assignments/page.tsx         # S-28 Coordinator Assignment (SPM-30), Ops
    │   │                                Manager only. Tabs: "Awaiting assignment"
    │   │                                (submitted, no coordinator) and "Assigned"
    │   │                                (live events, for reassignment).
    │   ├── events/new/page.tsx          # S-08, the event request form (create)
    │   ├── events/[id]/edit/page.tsx  # S-08, the same form (edit a saved draft) —
    │   │                                also the ONLY screen a draft has: opening a
    │   │                                draft's Overview address redirects straight
    │   │                                here (SPM-31, 2026-09-23), so this page has
    │   │                                no Tabs and no link back to Overview.
    │   ├── events/[id]/page.tsx         # S-06, "the hub" — Overview tab (SPM-47 built
    │   │                                the page, SPM-31 filled in what it shows).
    │   │                                The address is the event's reference, e.g.
    │   │                                /events/EVT-000123, not its id (SPM-31,
    │   │                                2026-09-23) — see eventReference() /
    │   │                                parseEventReference() in lib/format.ts.
    │   │                                An Attendee gets a curated subset (no Venue
    │   │                                requirements card, no internal-only rows);
    │   │                                every other role sees the full record.
    │   │                                The Ops Manager also gets an "Assign a
    │   │                                coordinator" / "Change coordinator" card
    │   │                                here (SPM-30). SPM-28 adds a red "This
    │   │                                request was rejected" banner with the
    │   │                                reason, and a "Review request" button for
    │   │                                the assigned coordinator while Under review.
    │   ├── events/[id]/update/page.tsx  # Edit event information (SPM-62): the assigned
    │   │                                coordinator changes an event's information after
    │   │                                approval. NOT the draft editor (../edit), which is
    │   │                                the organiser's, before submission. Reached from
    │   │                                "Edit event information" on the Overview.
    │   ├── events/[id]/equipment/page.tsx  # S-16, the Equipment tab (SPM-47)
    │   ├── events/[id]/readiness/page.tsx  # S-18, the Readiness tab (SPM-33), coordinators
    │   │                                only: every venue booking, equipment line and the
    │   │                                registration setup as Complete, Outstanding or Not
    │   │                                required, how many still block confirmation, and
    │   │                                "Mark as not required" for the assigned coordinator.
    │   │                                It decides nothing - the list comes from
    │   │                                api/events/[id]/arrangements.
    │   ├── events/[id]/booking/new/page.tsx # S-15 Venue booking request (SPM-42), from
    │   │                                "Request booking" on the Venue tab
    │   ├── bookings/page.tsx            # S-22 Booking Requests, Venue Staff. SPM-42
    │   │                                built the pending list; SPM-43 made it the
    │   │                                decision screen: one card per request, a
    │   │                                "Conflict" flag where approving would clash,
    │   │                                Approve (confirm dialog) and Reject (reason
    │   │                                required, optional suggested venue and
    │   │                                alternative arrangement)
    │   ├── venues/search/page.tsx       # S-14 "Find a venue" (SPM-40): filters on the
    │   │                                left, ONLY matching venues on the right.
    │   │                                ?event=EVT-000123 pre-fills it from that
    │   │                                event's requirements (and lets a session be
    │   │                                chosen). Reached from /venues and from the
    │   │                                event's Venue tab ("Search with filters").
    │   ├── equipment/requests/page.tsx      # S-25 queue — events with equipment
    │   │                                     requested (SPM-48). Technical Support only.
    │   ├── equipment/requests/[id]/page.tsx # S-25 detail — Check Equipment Availability
    │   │                                     (SPM-48): one chip per requested line
    │   │                                     (Available/Partial/Unavailable), the
    │   │                                     total-minus-maintenance-minus-reserved
    │   │                                     breakdown, and the shortfall banner.
    │   │                                     Reserve button (SPM-49). Per-line Status
    │   │                                     chip, the Coordinator's requirements and
    │   │                                     an Update panel - fulfilment status +
    │   │                                     technical notes (SPM-50).
    │   │
    │   └── api/                     # ← THE BACKEND. Each folder = one "service"/domain.
    │       ├── auth/                   (Jordan)
    │       ├── events/                  (Kristen) — incl. events/[id]/coordinator
    │       │                                (PUT: assign/reassign, SPM-30) and
    │       │                                events/[id]/information (PATCH: update an
    │       │                                event's information after approval, SPM-62),
    │       │                                events/[id]/safety-check (POST: submit for an
    │       │                                Operational Safety Check, SPM-86 - Janelle),
    │       │                                events/[id]/safety-decision (POST: the Safety
    │       │                                Officer's decision, SPM-87 - Janelle),
    │       │                                events/[id]/safety-flags (POST: flag the
    │       │                                arrangements a returned check concerns, SPM-88 - Janelle)
    │       ├── assignments/              (Kristen) — the S-28 queue's data (SPM-30)
    │       ├── queue/                    (Kristen) — the S-12 Review Queue's data (SPM-28)
    │       ├── venues/                   (Kayal) — incl. venues/[id]/unavailability
    │       │                                (GET, POST) and .../unavailability/[periodId]
    │       │                                (PATCH, DELETE): unavailable periods, SPM-45
    │       ├── venue-bookings/            (Sammi) — pending requests for Venue Staff (SPM-42);
    │       │                                an event's own are under events/[id]/venue-bookings.
    │       │                                venue-bookings/[id] (Kayal, SPM-43) — PATCH:
    │       │                                Venue Staff approve or reject one request
    │       ├── facilities/                (Kayal — reference data for forms + venue search)
    │       ├── equipment/                  (Janelle) — incl. equipment/[id]/out-of-service
    │       │                                (PATCH: record or return units, flag short
    │       │                                reservations and notify, SPM-48/SPM-55)
    │       └── registrations/               (Sammi)
    │
    ├── components/
    │   ├── AppShell.tsx        # Top bar + role-aware sidebar. Wraps every route.
    │   ├── SessionFields.tsx    # S-08's "Sessions" section, shared by events/new and events/[id]/edit
    │   ├── AssignCoordinator.tsx # SPM-30: the assign/reassign control, shared by
    │   │                          /assignments and the event Overview page
    │   ├── BeginPlanningDialog.tsx # SPM-54: the "Begin planning?" question, shared by Find a
    │   │                          venue, the booking form and the Equipment tab
    │   ├── VenueUnavailablePeriods.tsx # SPM-45: the venue editor's "Unavailable periods"
    │   │                          section and its Mark unavailable / Change period dialog
    │   └── ui/                  # THE component library — see §6. Import from "@/components/ui"
    │
    └── lib/
        ├── prisma.ts           # Database client — import this, don't create your own
        ├── auth.ts              # Password hashing + JWT helpers (server-side)
        ├── permissions.ts        # WHO MAY DO WHAT — pure, testable, no Prisma
        ├── apiAuth.ts             # getActor() + 401/403/404 helpers for routes, plus
        │                           resolveEventId() (an event's real id from its
        │                           reference — SPM-31, 2026-09-23)
        ├── session.ts            # Browser-side: storing/reading the login token
        ├── useCurrentUser.ts      # Who is signed in (for rendering only, never for access)
        ├── roles.ts                # Role labels + which nav/tabs each role sees
        ├── statuses.ts              # Status label + colour for EVERY status in the system
        ├── format.ts                 # Dates, capacities, venue names — one format each.
        │                              Also eventReference()/parseEventReference():
        │                              an event's user-facing id, e.g. EVT-000123
        │                              (SPM-31, 2026-09-23)
        ├── formErrors.ts              # Client validation + mapping server errors to fields
        ├── eventForm.ts                # Shared by events/new and events/[id]/edit (S-08): fields, validateForm, toFormValues, sessionsPayload
        ├── eventSessions.ts             # Multi-session events (pure): deriveEventFromSessions, equipmentWindow
        ├── eventReview.ts               # SPM-28 (pure): missingRequestFields() - what the
        │                                 review page flags "Not provided" - and the
        │                                 rejection-reason rule
        ├── sessionWrites.ts              # Writes a multi-session event's sessions + their equipment (takes the caller's transaction)
        ├── beginPlanning.ts              # SPM-54: beginPlanningIfApproved() - THE one way an event moves
        │                                   Approved -> Planning (takes the caller's transaction).
        │                                   SPM-62 adds revertConfirmationIfConfirmed():
        │                                   an equipment change moves a Confirmed event
        │                                   back to Planning.
        ├── eventConfirmation.ts           # SPM-34 + SPM-33 rules, pure: arrangementsFor() is THE
        │                                   list of an event's arrangements (each booking, each
        │                                   equipment line, registration setup) and their state;
        │                                   checkEventConfirmation() refuses on the outstanding
        │                                   ones. Its header says how to add an arrangement
        │                                   (the Operational Safety Check, SPM-86).
        ├── eventArrangements.ts           # SPM-33: loadConfirmationInput() - the only file that
        │                                   reads those arrangements from Prisma, for the
        │                                   Readiness tab AND Confirm
        ├── safetyDecision.ts             # SPM-87 (pure): the three decisions, the reason rules,
        │                                   where each leaves the event, and the wording of the
        │                                   event's "Safety check" row and the notification
        ├── safetyResolution.ts           # SPM-88 (pure): what follows a returned check (the
        │                                   flag reason, when the coordinator may flag), what
        │                                   closes a check, the history lines and the wording
        ├── safetyCheckClose.ts            # SPM-88: closeSafetyCheckAfterChange() - a significant
        │                                   change closes the check and returns the event to
        │                                   Planning, in the caller's transaction
        ├── safetyCheck.ts                # SPM-86 (pure): checkSafetySubmission() - is an event
        │                                   ready for an Operational Safety Check? Confirm's
        │                                   arrangements (eventConfirmation.ts) plus no flagged
        │                                   held booking or equipment
        ├── eventChangeImpact.ts           # SPM-62 rules, pure: which changes are important,
        │                                   which arrangements each flags, when a Confirmed
        │                                   event reverts. SPM-32/35/88 reuse it - one meaning
        │                                   of "important" everywhere.
        ├── applyEventInformation.ts       # SPM-62: applies a change and flags what it affects
        │                                   (takes the caller's transaction). SPM-32 applies
        │                                   approved change requests through it.
        ├── eventInformationForm.ts        # SPM-62 form, pure: what changed, the payload, checks
        ├── reviewFlags.ts                 # addReviewReasons(): THE way to add to a reviewReason
        │                                   column - keeps codes from other stories (SPM-39/62/...)
        ├── venueTime.ts                   # SPM-93: the 15-minute booking grid, local
        │                                   (Singapore) time, occupiedWindow() - start minus
        │                                   setup to end plus turnaround - and THE overlap
        │                                   test. Replaced venueSlots.ts (AM/PM/Night).
        ├── venueSearch.ts                 # SPM-40 filter rules, pure - no Prisma. One
        │                                   function per AC; searchVenues() keeps only
        │                                   venues passing every filter (AC7).
        ├── venueSearchForm.ts             # SPM-40 form values: pre-fill from an event,
        │                                   query string, client-side checks
        ├── venueBookingRequest.ts         # SPM-42 request rules, pure: date + start/end
        │                                   time -> booking window; grid, opening hours,
        │                                   cover the schedule, conflicts (SPM-93)
        ├── venueBookingReview.ts          # SPM-43 decision rules, pure: decided once,
        │                                   approval conflict re-check, reason required,
        │                                   what may be suggested (checkBookingDecision())
        ├── venueUnavailability.ts         # SPM-45 rules, pure: a period stated as dates and
        │                                   times <-> the stored interval, which bookings it
        │                                   overlaps (setup and turnaround included), ending
        │                                   early, the reasons, and the dialog's own checks
        ├── venueUnavailabilityService.ts  # SPM-45: flags and notifies the bookings a period
        │                                   overlaps - shared by the two unavailability routes
        ├── venueBookingReviewService.ts   # SPM-43: loads each venue's approved bookings
        │                                   and unavailability for that check - used by
        │                                   the list AND the decision route
        ├── equipment.ts                  # equipmentWindowFor() (pre-SPM-47) + checkOutOfService()/
        │                                  outOfServiceReasonFor() (SPM-48 AC7)
        ├── equipmentOutOfService.ts       # SPM-55 (pure): the three kinds of unavailability,
        │                                  an item's operational status, and which reservations
        │                                  a change leaves short (newlyShortReservations())
        ├── equipmentAvailability.ts       # SPM-48 rules, pure — no Prisma. D-1 → Return Day+1
        │                                  (Singapore calendar days), the fixed 2h transfer/prep
        │                                  time, and which requests count against stock.
        ├── equipmentAvailabilityLines.ts   # SPM-48: turns loaded rows into one result per
        │                                    requested equipment line (assembleLines())
        ├── equipmentAvailabilityService.ts  # SPM-48: the only file that queries Prisma for
        │                                     availability (loadEventAvailability())
        ├── equipmentFulfilment.ts          # SPM-50 rules, pure: which fulfilment status a
        │                                    line may move to, the Unavailable reason, the
        │                                    500-char notes cap, Approved-onwards only
        ├── cn.ts                       # Tiny class-name joiner
        ├── validation/                  # Zod schemas, one file per domain
        │   ├── auth.ts
        │   ├── events.ts
        │   ├── venues.ts
        │   ├── equipment.ts
        │   ├── registrations.ts
        │   └── index.ts                 # Barrel — import from "@/lib/validation" as before
        └── __tests__/                    # Tests go HERE, not next to the file they test
```

> Tests belong in `src/lib/__tests__/`. A test file sitting outside that folder
> still gets type-checked by `tsc` but is easy to leave stale — we had a
> duplicate `auth.test.ts` doing exactly that.

---

## 🧩 THE 5 DOMAINS ("SERVICES")

**These are folders, not separate running programs.** There is only ONE app
(`npm run dev` starts everything) and ONE database. Calling them "services" is
just a naming convention for "the 5 domains of the project" — a holdover from
an earlier microservices version of this repo that we moved away from in
favour of a monolith (better fit for an agile-focused module — one thing to
run, one thing to demo each sprint, no Docker/deployment overhead).

| Person | Folder | Domain | Tables | Status |
|---|---|---|---|---|
| **Jordan** | `src/app/api/auth/` | Login, register, sessions | `User`, `Organisation` | 🟢 working |
| **Kristen** | `src/app/api/events/` | Event requests, status | `Event`, `EventSession`, `EventStatusHistory`, `ClarificationRequest`, `EventChangeRequest`, `EventFacilityRequirement` | 🟢 working (EventSession: schema only, no routes yet) |
| **Kayal** | `src/app/api/venues/`, `src/app/api/facilities/` | Venues, bookings, facility reference data | `Venue`, `VenueLayout`, `Facility`, `VenueFacility`, `VenueBooking`, `VenueUnavailability` | 🟢 venue list + create + update + retire (with booking review flags), catalogue UI, facilities list, availability calendar (S-21, SPM-46 — read-only), venue search + filters (SPM-40), booking decision (S-22, SPM-43), unavailable periods (SPM-45, on S-20) |
| **Janelle** | `src/app/api/equipment/`, `src/app/api/events/[id]/equipment/` | Equipment catalogue, requests, availability, reservations | `Equipment`, `EquipmentRequest` | 🟢 list + create, out-of-service (SPM-48), event requests (SPM-47), availability (SPM-48), reserve (SPM-49), fulfilment status + technical notes (SPM-50), Equipment page + record/return units out of service, flagging short reservations (SPM-55); also Submit for safety check (SPM-86, `events/[id]/safety-check`, `SafetyCheck`) the Safety Officer's decision (SPM-87, `events/[id]/safety-decision`), and resolving it (SPM-88, `events/[id]/safety-flags`) |
| **Sammi** | `src/app/api/registrations/` | Attendee registration | `Registration` | 🟢 working |

Stick to your own folder for new *route* files. `prisma/schema.prisma` is
shared — see [Avoiding Merge Conflicts](#-avoiding-merge-conflicts).
`src/lib/validation/` used to be one shared file too; it's now split one file
per domain (`events.ts`, `equipment.ts`, ...), so add your schema to your own
domain's file rather than a shared one. Import path is unchanged —
`@/lib/validation` still works, via `validation/index.ts`.

**Reading another domain's tables is fine.** Writing to them isn't — if the
venues route needs to change an `Event`, talk to Kristen first.

---

## 🔄 HOW A REQUEST FLOWS

Example: creating an event.

```
Browser (src/app/events/page.tsx)
   │
   │  fetch("/api/events", { method: "POST", ... })
   ▼
src/app/api/events/route.ts   ← runs on the SERVER, never in the browser
   │
   ├─ getSession(req)          reads + verifies the JWT (src/lib/auth.ts)
   ├─ createEventSchema.parse() validates the request body (src/lib/validation/events.ts)
   ├─ [business rules]          e.g. is this event complete enough to submit?
   └─ prisma.event.create()     saves it (src/lib/prisma.ts) → Neon
   │
   ▼
Returns JSON back to the browser
```

The business-rules step is the one that's easy to forget. See
[Business Rules](#-business-rules-live-in-code-not-the-database).

---

## 🧱 THE PATTERN TO COPY FOR A NEW ENDPOINT

1. **Decide the permission** — look up (or add) the action in
   [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md). Who is allowed to do this,
   and do they need a relationship to the record?
2. **Add a Zod schema** to `src/lib/validation.ts` — what does a valid request body look like?
3. **Write the route handler** in your domain's `route.ts` — **authenticate,
   authorise**, validate, check rules, call Prisma, return JSON.
4. **Check `SCHEMA_REFERENCE.md`** for the exact field names before you write the Prisma call.

```ts
export async function POST(req: NextRequest) {
  try {
    // 1. WHO is asking? getActor() verifies the JWT and loads their current
    //    role + organisation. Never trust a role from the request body.
    const actor = await getActor(req);
    if (!actor) return unauthenticated();

    // 2. MAY THEY? The role half of the model.
    if (!can(actor.role, "myDomain:manage")) return forbidden();

    const data = mySchema.parse(await req.json());

    // 3. MAY THEY, TO THIS RECORD? The relationship half — skip only if the
    //    record has no owner (reference data). Use 404 instead of 403 when a
    //    403 would confirm the record exists.
    const record = await prisma.myModel.findUnique({ where: { id: data.id } });
    if (!record) return hidden();
    if (!canTouch(actor, record)) return forbidden();

    const result = await prisma.myModel.create({ data });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

> ⚠️ **Steps 1-3 are not optional and not someone else's job.** "Users should
> only be able to view or modify information appropriate to their role and
> relationship to an event" is core feature #1 of the release, not a
> nice-to-have. Four routes shipped without them and had to be closed
> retroactively — see the 2026-09-18 changelog entry.

**Status codes we use consistently** — the frontend depends on these:
400 validation failure or broken business rule · **401 not signed in** ·
**403 signed in, but not allowed** · **404 not found, or not allowed and must
not learn it exists** · 201 created · 200 everything else.

---

## 🎨 THE FRONTEND AND THE DESIGN SYSTEM

**Read `UI_DESIGN.md` before you build a screen.** It names all 28 screens with
stable IDs (S-01 … S-28), the route each one lives at, what its form fields
are, and which error states it has to handle. Your user story cites a screen
ID; the spec tells you the rest. If you build something that contradicts the
spec, **change the spec in the same PR** — a document nobody updates becomes a
document that lies to the next person.

### Never write a raw colour or a bare `<input>`

Three files hold the vocabulary. Using them is what keeps six people's screens
looking like one product:

| File | Holds | Use it for |
|---|---|---|
| `tailwind.config.ts` | Every colour, the two fonts, radii, shadows | `bg-surface`, `text-ink-2`, `border-line` — never `bg-white` or `text-gray-500` |
| `src/components/ui/` | Button, Field, Input, Select, Checkbox, CheckboxGroup, Card, StatusBadge, Alert, EmptyState, PageHeader, Breadcrumb, Table, Tabs, DataState, ConfirmDialog | Assembling a screen. Import from `@/components/ui` |
| `src/lib/statuses.ts` | Label + colour for every status string | Always via `<StatusBadge status={...} />`, never a hand-rolled span |

If a screen needs something the library does not have, add it to the library
and to `UI_DESIGN.md` §5.4 — not a one-off `<div>` in your page.

### The four states every data screen must handle

Loading, empty, error, loaded. `DataState` gives you all four:

```tsx
<DataState
  data={events}                       // null = still loading
  error={error}
  onRetry={load}
  empty={{ title: "No events yet", description: "…", action: <ButtonLink …/> }}
>
  {(rows) => <Table columns={columns} rows={rows} rowKey={(r) => r.id} />}
</DataState>
```

A screen that shows a blank page when the request fails is not finished.

### Forms

Copy the nearest existing one rather than starting fresh:

| You are building | Copy |
|---|---|
| A form with validation | `src/app/register/page.tsx` — blur, submit, server errors mapped back onto fields |
| A list with filters | `src/app/events/page.tsx` |
| A long, sectioned form | `src/app/events/new/page.tsx` |

Client validation mirrors `src/lib/validation/`; it is a convenience, never
the authority. **The server validates every request regardless**, and the two
must agree — a form that lets the user press Submit and then shows a server
error is the exact failure the spec exists to prevent.

### Roles change what you can reach, never how it looks

`src/lib/roles.ts` holds the sidebar items and event-detail tabs for each role.
Add a screen for a role by adding one line there — do not put `if (role === …)`
in a component. A tab a role may not see is **not rendered at all**, not
rendered-and-disabled: a greyed-out "Readiness" tells an external user that
internal planning information exists, which the briefing forbids.

> ⚠️ `useCurrentUser()` is for **rendering only**. Hiding a nav item is not
> access control — every API route must re-check the session and the user's
> relationship to the record. The server-side rules live in
> [`src/lib/permissions.ts`](./src/lib/permissions.ts), documented in
> [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md). `roles.ts` decides what a
> screen *offers*; `permissions.ts` decides what the server *permits*.

---

## 🗄️ WORKING WITH THE DATABASE

**The schema is built.** 17 tables, created by `npx prisma migrate dev --name init`.
Don't rebuild it — read [Changing the Schema](#-changing-the-schema) if you need
something different.

**[`SCHEMA_REFERENCE.md`](./SCHEMA_REFERENCE.md) is the document you actually
want day to day.** It lists every table, every field with its type, every
allowed status string, and the traps. This section is only the orientation.

### Naming: camelCase in code, snake_case in the database

| You write | Postgres stores |
|---|---|
| `prisma.venueBooking` | table `venue_bookings` |
| `booking.requestedAt` | column `requested_at` |

Prisma translates. You only see snake_case in Prisma Studio or raw SQL.

### Conventions every table follows

| Rule | Example |
|---|---|
| IDs are UUIDs | `id String @id @default(uuid())` |
| Field names camelCase | `totalQuantity`, not `total_quantity` |
| DB column snake_case via `@map` | `totalQuantity Int @map("total_quantity")` |
| Table name plural via `@@map` | `@@map("equipment_requests")` |
| Timestamps | `createdAt DateTime @default(now()) @map("created_at")` |

### Two field names that catch everyone

- **`User.fullName`** is `name` in every API request and response. The routes
  translate; don't change the API shape.
- **Roles are `organiser`, `coordinator`, `tech_support`** — not
  `event_organiser` or `tech_support_staff`. The JWT carries this value and
  `api/events` branches on it.

### Statuses are strings, not enums

Nothing stops you saving `"Confirmed"` with a capital C, and it will silently
never match anything. Copy the exact values from `SCHEMA_REFERENCE.md`.

---

## ⚖️ BUSINESS RULES LIVE IN CODE, NOT THE DATABASE

**This is the most important thing to understand about this schema.**

There are no CHECK constraints and no database triggers. Postgres will happily
store a venue booked twice at once, an event with 300 people in a 40-seat room,
or a registration past capacity. Nothing will stop you.

That was a deliberate trade-off. In a monolith, one application owns one
database, so there is no second writer to defend against — and rules written in
route code are visible in the repo, testable with Vitest, and explainable in the
Week 13 Q&A. Database triggers are stronger but invisible to Prisma and hard to
defend under questioning.

**The cost:** these rules only hold if you remember to write them.

| Rule | Where | Status |
|---|---|---|
| Draft completeness before submitting | `api/events/[id]` PATCH | ✅ done |
| Reason required when rejecting — blank or spaces-only is refused, and the reason is saved trimmed | `api/events/[id]` PATCH, `isBlankReason()` | ✅ done (trim added SPM-28) |
| **Approve and reject only from Under review** — a request is decided once; approving or rejecting an event in any other status is refused (400) | `REVIEW_OUTCOMES` / `REVIEWABLE_STATUSES`, `api/events/[id]` PATCH | ✅ done (SPM-28) |
| **An attendee can register only for an eligible event** — Confirmed, registration enabled, both registration dates set and now between them (opening and closing moments included), and a seat left (registered and attended take one; no capacity means no limit). No duplicate registration; a withdrawn attendee may register again. A full event offers the waiting list, joining it is not built | `registrationState()` in `src/lib/registrationEligibility.ts`, `POST /api/registrations` | ✅ done (SPM-51; was "confirmed, in window, no duplicate, seats left") |
| **Registration capacity is capped by the booked room's capacity in its layout** (#112), never the room's maximum. Measured against the event's only pending or approved booking, or the one the coordinator chooses when there are several (Week 7 change #3); no booking, or one with no layout, means no capacity can be set | `measuredBooking()`, `capacityError()` in `src/lib/registrationSettings.ts`; `PATCH /api/events/[id]/registration` | ✅ done (SPM-64) |
| **The registration period is separate from the event date** (#30): it closes after it opens, and no later than the event starts (exactly at the start is allowed). It can be extended or reopened (#42, #127) until the event starts, and not after | `periodErrors()`, `startedError()` | ✅ done (SPM-64) |
| **Lowering registration capacity below the attendees holding a place, or turning registration off while anyone holds one, flags the registrations and never changes them** (codes `registration_capacity_lowered`, `registration_disabled`) | `registrationReviewReasons()`, `addReviewReasons()`, `HOLDING_A_PLACE` | ✅ done (SPM-64) |
| **Registration that is enabled but incomplete is an outstanding arrangement and blocks confirmation** — no capacity, no opening or closing date, or a measured booking that is no longer active (#80). Saving an incomplete setup is never refused | `registrationGaps()` / `arrangementsFor()` in `src/lib/eventConfirmation.ts` | ✅ done (SPM-64) |
| **A venue booking request is decided once, and only while Pending** — approving or rejecting an already-decided one is refused (400) | `DECIDABLE_BOOKING_STATUSES`, `checkBookingDecision()`, `api/venue-bookings/[id]` PATCH | ✅ done (SPM-43) |
| **A booking occupies the room from its start minus the venue's setup to its end plus its turnaround** — every availability and conflict check (request, approval, search, calendar) compares these periods; periods that only meet end to start do not clash. Times are on a 15-minute grid, and the whole period must fit the opening hours | `occupiedWindow()`, `overlapping()`, `withinOpeningHours()` (`src/lib/venueTime.ts`), `checkVenueBookingRequest()` | ✅ done (SPM-93) |
| **Approval re-checks the room** — refused if another *approved* booking's occupied time (setup and turnaround included) or an unavailability period overlap, if the venue is retired, or if the event is completed, cancelled or rejected. A rival *pending* request does not block: approving one is how Venue Staff choose. The venue row is locked for the check, so two approvals cannot both pass | `approvalConflict()`, `checkBookingDecision()`, `api/venue-bookings/[id]` PATCH | ✅ done (SPM-43) |
| **Reason required when rejecting a booking**; a suggested venue must be active and not the one refused. The suggestion books nothing (#45, #110) | `checkBookingDecision()` | ✅ done (SPM-43) |
| **Confirm refuses on everything the Readiness tab shows as outstanding** - no venue, a pending venue request (each booking judged on its own), equipment that is not reserved (Reserved and Partially fulfilled both count as held, the same rule as Submit for safety check, SPM-86), a booking or equipment line flagged for review, and registration that is enabled but has no capacity or period. One rule lists and judges them | `arrangementsFor()`, `checkEventConfirmation()` (`src/lib/eventConfirmation.ts`), read by `loadConfirmationInput()` | ✅ done (SPM-34, SPM-33) |
| **An arrangement marked as not required prevents nothing, but an event always needs a venue** - any booking, equipment line or the registration setup can be waived, only while outstanding; "No venue booked" never can, and comes back when an event's only booking is waived. Who decided and when is recorded on marking and on reversing | `arrangement()`, `WAIVABLE_KINDS` (`src/lib/eventConfirmation.ts`), `PATCH /api/events/[id]/arrangements` | ✅ done (SPM-33) |
| **An unavailable period is stated in dates and times on the 15-minute grid** — stored exactly as stated, the return must be later than the start, so the shortest period is 15 minutes; off-grid times are refused (#126, #128). A period already over when saved or changed is refused | `venueUnavailabilitySchema`, `periodInterval()`, `periodOverResponse()`, `api/venues/[id]/unavailability` | ✅ done (SPM-45) |
| **A period needs a reason; "other" needs a typed one** — required, trimmed, 500 characters at most, kept in the row's `notes`; ignored for a listed reason | `venueUnavailabilitySchema`, `periodColumns()` | ✅ done (SPM-45) |
| **A period flags the bookings it covers and changes none** — approved and not finished only; a booking counts when its occupied period (its times plus the venue's setup and turnaround) overlaps the period; meeting end to start is not an overlap. Changing a period flags only what it newly overlaps; nothing clears a flag | `bookingInPeriod()`, `flagBookingsInPeriod()` | ✅ done (SPM-45) |
| **Ending a period early** — one under way ends now, rounded down to the 15-minute grid (the row is kept), one not started is deleted, one already over is refused (400) | `periodPhase()`, `endEarlyAt()`, `api/venues/[id]/unavailability/[periodId]` DELETE | ✅ done (SPM-45) |
| Venue suitability (capacity + mandatory facilities) | venues domain | ❌ to write |
| Booking conflict detection — an approved booking (with its setup and turnaround slots), another event's pending request, or an unavailability period blocks a new request; at approval only approved bookings and unavailability block. The refusal names the booking or period in the way. The same event cannot request overlapping times at a venue twice, whichever of its sessions asks (SPM-81 AC4; sessions that only meet end to start may follow each other in a room), and the request route locks the venue row so two requests at the same moment cannot both pass | `findVenueConflict()` and `findDuplicateRequest()` in `src/lib/venueConflict.ts`, called by `checkVenueBookingRequest()` (request), `approvalConflict()` (approval) and `occupancyConflict()` (venue search); the lock in `POST /api/events/[id]/venue-bookings` | ✅ done (SPM-44) |
| Equipment availability | `src/lib/equipmentAvailability.ts` | ✅ done (SPM-48) |
| **Reserved / Partially fulfilled are set only by Reserve** — never picked by hand, so a line never claims stock it doesn't hold; leaving them goes through Unavailable | `fulfilmentOptionsFor()`, `PATCH /api/events/[id]/equipment/[requestId]/fulfilment` | ✅ done (SPM-50) |
| **Unavailable needs a reason** (blank or spaces-only refused); technical notes max 500 characters, saved trimmed. Marking a reserved line Unavailable frees its units (status alone does it; `quantityReserved` is cleared too) | `checkFulfilmentUpdate()`, `fulfilmentChanges()` | ✅ done (SPM-50) |
| Event status lifecycle — which `from → to` moves are legal at all (who may make them is done; see below) | `canTransition()` in `statuses.ts`, checked by `api/events/[id]` PATCH | ✅ done (SPM-27) |

### Access rules are business rules too

Same table, same discipline — these are the ones the customer asked for in §8b
("access should depend on the user's role **and relationship to an event**").
All of them are enforced by [`src/lib/permissions.ts`](./src/lib/permissions.ts)
and documented in [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md).

| Rule | Where | Status |
|---|---|---|
| Draft privacy — only the owning organiser may view, edit, or change the status of their own draft; every other role gets a 404, never a glimpse that it exists | `api/events` GET, `api/events/[id]` GET + PATCH | ✅ done |
| A draft's content is only editable while it's still a draft — once submitted, further edits go through `EventChangeRequest` | `api/events/[id]` PATCH | ✅ done |
| An organiser sees their own events plus their client organisation's, never another client's | `eventListWhere()`, `canViewEvent()` | ✅ done |
| An attendee sees only confirmed, registerable events — and only the public fields of them | `canViewEvent()`, `visibleEventFor()` | ✅ done |
| Only the role the briefing gives a step may perform it: organiser submits, Ops Manager assigns, assigned coordinator approves/confirms, Venue Staff decide bookings, Technical Support decides equipment | `canSetEventStatus()`, `can()` | ✅ done |
| Catalogue writes belong to their owner — venues to Venue Staff, equipment to Technical Support | `api/venues` POST, `api/equipment` POST | ✅ done |
| **Only the Event Operations Manager assigns or reassigns a coordinator** (clarifications #94, #101). Assigning moves a submitted event to Under review in the same action; reassignment works on live events only, never completed, cancelled or rejected ones | `canAssignCoordinator()`, `PUT /api/events/[id]/coordinator` | ✅ done (SPM-30) |
| **A coordinator manages only the events assigned to them** — an event with no coordinator yet is managed by nobody (the old "any coordinator may pick it up" rule was removed, 2026-09-28) | `isAssignedCoordinator()` | ✅ done (SPM-30) |
| **Only the assigned coordinator reviews a request, and only while it is Under review** — another coordinator can still *view* the event (internal staff see all non-draft events) but gets "You can't review this request" | `canReviewEvent()`, `api/queue` GET | ✅ done (SPM-28) |
| **An event begins planning with the assigned coordinator's first venue or equipment action, and only from Approved** — pressing Search on Find a venue, submitting a booking request, or adding, saving or removing an equipment requirement. Nothing else moves an event to Planning; the general status PATCH refuses it | `beginPlanningIfApproved()` (`src/lib/beginPlanning.ts`), `canBeginPlanning()`, `POST /api/events/[id]/begin-planning` | ✅ done (SPM-54) |
| **Only the assigned coordinator updates an event's information after submission, and only while it is Approved, Planning, Safety review, Safety approved (SPM-88) or Confirmed** — the organiser asks through a change request instead (SPM-35, clarification #102). Organiser, coordinator, status, equipment (Equipment tab), sessions and registration settings (SPM-64) are not editable there | `canUpdateEventInformation()`, `EVENT_INFORMATION_EDIT_STATUSES`, `updateEventInformationSchema` (strict), `PATCH /api/events/[id]/information` | ✅ done (SPM-62) |
| **An important change flags the arrangements it affects and never changes them** — date or time flags the venue bookings, equipment and registrations; attendance or venue requirements flag the venue bookings only. Flags merge into what is already there (SPM-39's reasons included) | `src/lib/eventChangeImpact.ts`, `src/lib/applyEventInformation.ts` | ✅ done (SPM-62) |
| **A Confirmed event goes back to Planning when its venue or equipment is affected** — an important change on the edit form, or any equipment change on the Equipment tab, asked first in both places. Registrations alone do not revert it | `revertsConfirmation()`, `revertConfirmationIfConfirmed()` (`src/lib/beginPlanning.ts`) | ✅ done (SPM-62) |
| **Only the assigned coordinator marks an arrangement as not required, and only while the event is in Planning** — any coordinator can read the Readiness list; on a Confirmed event nothing can be marked or reversed | `canMarkArrangements()`, `ARRANGEMENT_MARKING_STATUSES`, `canViewArrangements()`, `GET` / `PATCH /api/events/[id]/arrangements` | ✅ done (SPM-33) |
| **An event is submitted for an Operational Safety Check only by its assigned coordinator, only from Planning, and only once its arrangements are held and none is flagged for review** — the same arrangements as Confirm event (an approved venue per session; recorded equipment Reserved or Partially fulfilled) plus no held booking or equipment flagged for review. The refusal names each one. Submitting moves the event to Safety review, records who and when, and notifies every Safety Officer; a second submission is refused while one is pending. Safety review is never set through the status PATCH | `checkSafetySubmission()` (`src/lib/safetyCheck.ts`), `canSubmitForSafetyCheck()`, `POST /api/events/[id]/safety-check` | ✅ done (SPM-86) |
| **Only the Safety Officer decides a safety check, only while the event is in Safety review, and once per submission** - approve moves it to Safety approved (stored as `safety_cleared`, because `safety_approved` is the Readiness tab's safety-check badge), reject or request changes returns it to Planning and needs a reason (at most 1,000 characters). The decision, who and when are saved on the SafetyCheck, the move in the status history, and the assigned coordinator is notified with the reason. A second decision on the same submission is refused | `safetyDecisionSchema` and `statusAfterDecision()` (`src/lib/safetyDecision.ts`), `canRecordSafetyDecision()`, `POST /api/events/[id]/safety-decision` | ✅ done (SPM-87) |
| **A significant change closes the safety check the event rests on** - the coordinator's important information change, equipment change, or venue booking requested, withdrawn or released, while the event is in Safety review or Safety approved, closes the check and returns the event to Planning; a Confirmed event moved back to Planning (SPM-62) has its approval closed too. Ordinary edits change nothing | `closeSafetyCheckAfterChange()` (`src/lib/safetyCheckClose.ts`), `closeReasonFor()` / `CLOSE_REASONS` (`src/lib/safetyResolution.ts`), the information, equipment and venue booking routes | ✅ done (SPM-88) |
| **Confirm needs the Safety Officer's approval** - the Operational Safety Check is always among what blocks confirmation | `safetyRow()` in `src/lib/eventConfirmation.ts` | ✅ done (SPM-88) |
| **After a returned check, only the assigned coordinator flags the arrangements it concerns, only while the event is in Planning** - flags only, with the reason `safety_check_returned`; they block resubmission until resolved (SPM-68) | `canFlagForSafetyReview()`, `canFlagAfterReturn()`, `POST /api/events/[id]/safety-flags` | ✅ done (SPM-88) |
| **Venue bookings and equipment changes wait for approval** — on a Submitted or Under review event the coordinator can search venues but cannot request a booking or add, change or remove equipment | `isBeforeApproval()` (`src/lib/statuses.ts`), `checkVenueBookingRequest()`, the equipment routes | ✅ done (SPM-54) |
| **A booking request is reviewed only once its event is approved** — a pending request whose event is still Submitted or Under review is not listed on Booking Requests and cannot be approved | `GET /api/venue-bookings`, `awaitingEventApproval()` (`src/lib/venueBookingReview.ts`) | ✅ done (SPM-43) |
| **Only the assigned Event Coordinator may cancel an event** — not the organiser who owns it, not the Ops Manager (customer clarification, 2026-09-18) | `STATUS_TRANSITION_ROLES.cancelled` | ✅ done |
| **Only the assigned coordinator configures an event's registration, and only while it is Approved, Planning or Confirmed** (#30). The organiser and every other role see the settings read-only; an attendee never sees which booking the capacity is measured against | `canConfigureRegistration()`, `EVENT_INFORMATION_STATUSES`, `PATCH`/`GET /api/events/[id]/registration` | ✅ done (SPM-64) |
| **An attendee who holds a place keeps seeing the event** — a registered or waitlisted attendee still sees a Confirmed event after its registration is turned off (#10) | `canViewEvent()` (`attendeeHoldsPlace`), `eventListWhere()` | ✅ done (SPM-64) |
| **A role cannot be self-assigned** — public registration offers the two external roles only; staff accounts are created internally | `registerSchema`, `SELF_REGISTERABLE_ROLES` | ✅ done |
| A deactivated account cannot authenticate at all, and is refused at login rather than at the first API call | `api/auth/login`, `getActor()` | ✅ done |
| A venue booking decision is Venue Staff's — any Venue Staff, not scoped by venue (#66) | `can(role, "venue_booking:decide")`, `api/venue-bookings` GET + `[id]` PATCH | ✅ done (SPM-43) |
| An equipment request decision is Technical Support's — reserving (SPM-49) and updating fulfilment status / technical notes (SPM-50) | `canReserveEquipment()`, `canUpdateEquipmentFulfilment()` | ✅ done |
| **Technical Support sees an event's equipment only in Planning and Confirmed, and works on it in Planning** — the BPMN's Technical Support lane starts after the Coordinator's "Record equipment request" ("Check equipment availability" / "Reserve equipment" in Planning, "Prepare equipment" in Confirmed). Before Planning (including Approved) and after it ends, the event is not in Equipment Requests and a direct link is 404. Confirmed is read-only (team decision, 3 Oct) | `TECH_SUPPORT_EQUIPMENT_STATUSES` / `techSupportSeesEquipment()`, `eventAllowsReserving()` (Planning only); queue, availability, reserve and fulfilment routes; `canViewEquipmentRequests()` | ✅ done |

**Wrap check-and-write in a transaction**, or two people clicking at the same
moment both pass the check:

```ts
await prisma.$transaction(async (tx) => {
  const clash = await tx.venueBooking.findFirst({ /* ... */ });
  if (clash) throw new Error("VENUE_TAKEN");
  return tx.venueBooking.update({ /* ... */ });
});
```

**The overlap test** — needed by three of these rules, so write it once:

```ts
// two periods overlap if each starts before the other ends
startsAt: { lt: otherEnd },
endsAt:   { gt: otherStart },
```

Each rule is a natural unit test, and each maps to a user story. That's the
traceability the module asks for.

---

## ✏️ CHANGING THE SCHEMA

1. **Say so in the team chat first.** Two people editing `schema.prisma` at once
   is the worst merge conflict on this project, and two migrations with the same
   parent are genuinely painful to reconcile.
2. Edit `prisma/schema.prisma`. Follow the conventions above.
3. Both sides of a relation must be declared — Prisma errors if you only write one.
4. Apply and verify:
   ```bash
   npx prisma validate
   npx prisma migrate dev --name describe_your_change
   npx prisma generate
   npx tsc --noEmit
   ```
   `tsc` is the important one: it turns "field doesn't exist" into a compile
   error rather than a runtime surprise mid-demo.
5. **Update `prisma/seed.ts` in the same change — every time, even though
   nobody is reseeding.** The seed is the only description of a working
   database that is not the shared database itself: the next reseed, a new
   Neon branch or a teammate's fresh setup is built from it. If a schema
   change is not reflected there, the seed either stops compiling, fails on a
   new required column, or silently produces data the new feature cannot be
   demonstrated on. So: a new column gets at least one seeded row that uses
   it, a new table gets seeded rows, and a renamed or removed field is
   renamed or removed in the seed too. Then run `npx tsc --noEmit` — it
   type-checks `prisma/seed.ts` against the new client without running it.
   The same goes for a story's test fixtures: whatever `scripts/seed-<story>.ts`
   creates, `prisma/seed.ts` creates too (appended **after** the last
   existing block, so no earlier event's EVT- number moves).
6. Apply it to the shared database **without reseeding**: commit the
   migration and run `npx prisma migrate deploy`, which runs only migrations
   that have not been applied yet and never resets or wipes data. Add test
   data with the story's fixture script (`npm run fixtures:<story>`), never
   with `npx prisma db seed`.
7. Update **`SCHEMA_REFERENCE.md`** and add a **Changelog** entry.
8. Commit `prisma/` and `src/` together, then tell the team to run
   `git pull && npx prisma generate` — without `generate` their editor still
   believes the old models exist.

**Don't rename or delete a field others depend on without asking.**
`migrate dev` will cheerfully drop a column everyone else's code still reads.

---

## ⚙️ EVERYDAY COMMANDS

| Command | What it does |
|---|---|
| `npm run dev` | Start the app (auto-reloads as you edit) |
| `npm run build` | Production build |
| `npm run lint` | Check code style/common mistakes (runs `eslint .` over the whole repo) |
| `npm test` | Run every test once (about 40 seconds) |
| `npm test -- src/app/__tests__/event-pages.test.tsx` | Run one test file. Add `-t "part of a test name"` to run only matching tests |
| `npm run test:watch -- event-pages` | Re-run the matching tests every time you save — the one to leave running while you write code to make failing tests pass |
| `npm run test:coverage` | Run every test and print how much of the code they cover. Fails below the minimums in `vitest.config.mts`. Open `coverage/index.html` to see uncovered lines |
| `npm run coverage:changed` | After `test:coverage`: lists the lines your branch adds or changes under `src/` that no test runs, compared with `origin/main`. CI runs the same check on every PR |
| `npm run test:e2e` | End-to-end smoke tests (`e2e/`): builds nothing itself, so run `npm run build` first; starts the app on port 3100 and drives it in Chromium. Needs `DATABASE_URL` to a **local**, migrated and seeded Postgres - it refuses any other database, because the tests change data. CI runs them on every PR with its own database |
| `npm run test:e2e:ui` | The same, in Playwright's viewer: watch each step, or replay a failed run's trace |
| `npm run test-cases:check` | Says whether the story in your branch name has its `docs/test-cases/` document. CI runs it on every PR, as a warning |
| `npm run verify:permissions` | SPM-4 acceptance check over HTTP — needs `npm run dev` running in another terminal |
| `npm run fixtures:spm27` | Adds or resets SPM-27's 14 test events ("SPM27 Bayu …", one per status, organiser Hakim Zulkifli) without reseeding — deletes and recreates only events whose `seedKey` starts with `spm27_`. Re-run before each SPM-27 test pass |
| `npm run fixtures:spm30` | Adds or resets SPM-30's 12 test events ("SPM30 …") without reseeding — touches only events whose `seedKey` starts with `spm30_`, plus the two base-seed events that start in the Assignments queue ("Nusantara Developer Summit", "Meridian Graduate Recruitment Evening"): if they have only been assigned (SPM-30-TC20), they go back to Submitted with no coordinator. If another story has moved one further it is left alone with a warning; add `-- --restore-queue` to force it. Re-run before each SPM-30 test pass |
| `npm run fixtures:spm28` | Adds or resets SPM-28's 7 test events ("SPM28 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm28_`, with their facilities and equipment, always at **EVT-000124 to EVT-000130** (the numbers a full reseed gives them, so test cases can quote addresses). Stops without changing anything if another event holds one of those numbers. Run it before and after SPM-28-TC08 (approve) and TC10/TC11 (reject, then the organiser views it), so the next tester finds those requests Under review again. The same events are in `prisma/seed.ts` |
| `npm run fixtures:spm34` | Adds or resets SPM-34's 8 test events ("SPM34 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm34_`, with the venue bookings, equipment requests and sessions that put each one in its own state (ready, venue-only, pending venue, equipment short, two-session, another coordinator's). Re-run before and after each SPM-34 test pass, since confirming is what the cases do |
| `npm run fixtures:spm42` | Adds or resets SPM-42's 14 test events ("SPM42 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm42_` (with their sessions and bookings, so every request a test pass submitted goes too), and upserts the test venue "SPM42 Plain Room" (SPM42-PLN). Re-run before each SPM-42 test pass |
| `npm run fixtures:spm44` | Adds or resets SPM-44's 16 test events ("SPM44 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm44_` (with the bookings they hold, so every request a test pass submitted goes too), upserts the test venue "SPM44 Conflict Room" (SPM44-PLN, no setup or turnaround so neighbouring slots do not clash), and replaces the one unavailability period AC8 needs. Re-run before and after each SPM-44 test pass |
| `npm run fixtures:spm43` | Adds or resets SPM-43's 14 test events ("SPM43 …") without reseeding — touches only events whose `seedKey` starts with `spm43_`. They are reset **in place**: each event row is kept, so its EVT- reference stays the same from run to run, and only its sessions and booking requests are dropped and recreated (so every decision a test pass made goes). It also upserts two test venues: "SPM43 Maintenance Room" (SPM43-MNT, reset to its one maintenance period on 14 May 2027) and "SPM43 Retire Test Room" (SPM43-RET, made active again). Run before each SPM-43 test pass and after any case that approves or rejects — it is the revert |
| `npm run fixtures:spm50` | Adds or resets SPM-50's 6 test events (Robotics Expo, Design Week, …, Aug–Sep 2027) without reseeding — deletes and recreates only events whose `seedKey` starts with `spm50_`, with their equipment lines. Needs the base seed's users and the SPM-49 equipment items. Run it again before repeating a case that saves |
| `npm run fixtures:spm54` | Adds or resets SPM-54's 10 test events ("SPM54 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm54_` (with any booking requests and equipment a test pass added), always at **EVT-000145 to EVT-000154**. Stops without changing anything if another event holds one of those numbers. Run it before a test pass and after any case that moves an event to Planning (TC01/TC02, TC04 to TC07) or adds to one (TC14). The same events are at the end of `prisma/seed.ts` |
| `npm run fixtures:spm45` | Adds or resets SPM-45's test data without reseeding — upserts six test venues ("SPM45 Dates Room", "SPM45 Period Room", "SPM45 Setup Room", "SPM45 Status Room", "SPM45 Closure Room", "SPM45 Reopened Room") and nine events whose `seedKey` starts with `spm45_`. The events are reset **in place** (EVT- references kept); the rooms' unavailable periods and the events' bookings and notifications are dropped and recreated, which removes every period and review flag a test pass left. Run it before a test pass and after any case that says so |
| `npm run fixtures:spm62` | Adds or resets SPM-62's 9 test events ("SPM62 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm62_`, with their approved venue bookings, reserved equipment, registrations and required facility. No pinned reference numbers: the cases find events by title. Stops without changing anything if one of its rooms is already booked at that time. Run it before and after any case that saves (TC03 to TC05, TC07, TC09, TC10, TC12, TC13). The same events, without their arrangements, are at the end of `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm33` | Adds or resets SPM-33's 16 test events ("SPM33 …", 12 Jul–2 Aug 2027) without reseeding — deletes and recreates only events whose `seedKey` starts with `spm33_`, with the sessions, venue bookings and equipment lines that put each one in its own state (two rooms, nothing booked, flagged, cannot be provided, another coordinator's, confirmed with a line already marked as not required). No pinned reference numbers. Stops without changing anything if one of its rooms is already booked at that time. Needs the migration `add_arrangement_not_required`. Run it before and after any case that requests a venue, marks an arrangement or confirms (TC04, TC08 to TC13). The same events, without their arrangements, are at the end of `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm93` | Adds or resets SPM-93's 18 test events ("SPM93 …") and its three test venues (SPM93 Studio, Quick Room, Settings Room) without reseeding — deletes and recreates only events whose `seedKey` starts with `spm93_`, with their bookings and sessions, and puts the three venues back to their starting values with one maintenance period. Run it before and after any case that sends, approves or edits (docs/test-cases/SPM-93_Test_Cases.xlsx). The same venues and events, without bookings, sessions or maintenance, are in `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm64` | Adds or resets SPM-64's 12 test events ("SPM64 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm64_`, with their venue bookings (approved, pending, rejected and one with no layout), the booking each capacity is measured against, the registration settings, and registered, waitlisted and withdrawn attendees. No pinned reference numbers: the cases find events by title. Stops without changing anything if one of its rooms is already held at that time. Run it before and after any case that saves. The same events, without their arrangements, are at the end of `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm85` | Creates or refreshes the Safety Officer account (Hana Yusof, `hana.yusof@connectsphere.com`, `password123`) and resets SPM-85's 3 test events ("SPM85 …") without reseeding — upserts that one user, and deletes and recreates only events whose `seedKey` starts with `spm85_`, with the Harbour forum's two sessions, their approved bookings at Marina Auditorium and Orchard Seminar Room, its reserved equipment, required facilities and pending safety check, and the Riverside launch's approved booking and two registrations. No pinned reference numbers: the cases find events by title. SPM-85's cases only read, so one run before a test pass is enough. The account is in the seed's staff list and the events, without their arrangements, are at the end of `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm51` | Adds or resets SPM-51's 8 test events ("SPM51 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm51_`, with their registration settings (open until 31 Dec 2027, not yet open, closed, no dates, off) and their registered, waitlisted and withdrawn attendees. No pinned reference numbers: the cases find events by title. Run it before and after any case that registers. The same events, without those, are at the end of `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm68` | Adds or resets SPM-68's 14 test events ("SPM68 …", 6–25 Oct 2027) without reseeding — deletes and recreates only events whose `seedKey` starts with `spm68_`, puts its five SPM68 test venues and two SPM68 equipment items back to their starting state, and writes the review flags the Flagged Arrangements page lists. Run it after each case that keeps, reviews, requests, releases or confirms (SPM-68-TC14 releases on the Venue tab). |
| `npm run fixtures:spm65` | Adds or resets SPM-65's 6 test events ("SPM65 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm65_`, with their registration settings and registrations at fixed dates: registered, waitlisted, withdrawn, attended, and one added by the organiser (`added_by_id`). No pinned reference numbers: the cases find events by title. Run it before and after SPM-65-TC04, which registers and withdraws. The same events, without those, are at the end of `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm71` | Creates or refreshes SPM-71's four test accounts (Leon Koh and Ivy Lim, Event Coordinators; Owen Teo, Venue Staff; Zara Ong, Attendee; all `password123`), deletes and recreates every notification they hold, and resets SPM-71's 4 events ("SPM71 …", Nov 2027) without reseeding - only those accounts and events whose `seedKey` starts with `spm71_` are touched. The accounts are the story's own so the unread counts the cases quote never move with other testers' work. No pinned reference numbers. Run it before and after any case that marks or opens a notification. The accounts and events, without the notifications or arrangements, are in `prisma/seed.ts`, so run it once after a full reseed |
| `npm run fixtures:spm82` | Adds or resets SPM-82's test room, SPM82 Hold Room (SPM82-HOLD, 60 minutes of setup and turnaround), and its 8 events ("SPM82 …") with their venue bookings, without reseeding. Holds already past their expiry are created pending, as real ones would be, and the app expires them (and notifies Daniel Tan) the next time bookings are read. Three things are relative to when it runs, because they are about time passing: SPM82 Short Notice Meetup starts 3 days later and SPM82 Closing Soon Forum's hold expires 12 hours later (the script prints both). Run it before and after any case that changes data. The venue and events, without bookings, are in `prisma/seed.ts`, so run it once after a full reseed |
| `npm run verify:login` | SPM-21 acceptance check over HTTP (login + role-based access) — same, needs `npm run dev` |
| `npx tsc --noEmit` | Type-check everything — run before you push |
| `npx prisma generate` | Regenerate the Prisma client after a schema change |
| `npx prisma migrate dev` | Create/apply a migration after YOU change `schema.prisma` |
| `npx prisma studio` | Browser UI to view/edit the database directly |
| `npx prisma db seed` | ⚠️ Wipes all tables, then loads the demo data. Safe to re-run — as of 2026-09-25 it also resets `Event.sequenceNumber`'s Postgres sequence, so `EVT-000005` etc. come back the same every time |
| `npx prisma migrate reset` | ⚠️ Wipes the database and replays all migrations |

> `npm run lint` was broken on Next 16 — `next lint` was removed, so the
> argument was read as a directory (`no such directory: C:\IS212\lint`). Fixed
> on 2026-09-20: the script is now `eslint .`, which lints the whole repo
> rather than just `src`.
>
> (The two `prisma` rows above used to sit *below* this note, outside the
> table, so they rendered as plain text instead of rows.)

### Neon branches

Each Neon branch is a separate copy of the database. Work on your own so a
migration doesn't rebuild tables under someone mid-session:

```bash
neon checkout <branch-name>    # creates it if it doesn't exist
neon env pull                  # refresh .env for that branch
```

Branch off a seeded branch and the data comes with it — no re-seeding.

---

## 🤝 AVOIDING MERGE CONFLICTS

- **Pull before you start work each session:** `git pull`
- **Commit and push often** — small commits, not one giant one at the end of the day
- **`prisma/schema.prisma` is a shared file** — add your section at the bottom
  rather than in the middle of someone else's, and pull/push more frequently
  on days you're editing it
- **`src/lib/validation.ts` used to be a shared file too** — as of 2026-09-17
  it's split into `src/lib/validation/<domain>.ts`, one per domain, plus an
  `index.ts` barrel so `@/lib/validation` still resolves the same as before.
  Add your schema to your own domain's file; you should no longer need to
  touch a file someone else is also editing for this
- **Stay inside your own `api/<domain>/` folder** for route files — conflicts
  almost never happen there
- **Only one person creates a migration at a time.** Two migrations with the
  same parent are the single most painful conflict on this project. Say in the
  chat when you're about to run `migrate dev`, and merge it before someone else does.
- **`package-lock.json`** — if you regenerate it on Windows and your teammates
  are on macOS (or vice versa), it can push native-binary errors onto them.
  Mention it in the chat rather than silently committing.

---

## 🛠️ TROUBLESHOOTING

**`Environment variable not found: DATABASE_URL` / `Error code: P1012`**
`prisma.config.ts` must start with `import "dotenv/config";` as its first line.
Without it, Prisma silently skips auto-loading `.env` the moment
`prisma.config.ts` exists. Also check `dotenv` is actually installed
(`npm ls dotenv`) — it's a real dependency, not a borrowed transitive one.

**`type .env` says the file doesn't exist**
There's no `.env` in the repo (it's gitignored). Create it — see
[Quick Start](#-quick-start). `neon env pull` may write `.env.local` instead;
dotenv reads `.env` by default, so copy it across.

**Migration fails, or `prepared statement already exists` mid-run**
You're on the pooled connection string. Check `DATABASE_URL` for `-pooler` in
the hostname and swap it for the direct one.

**`@prisma/client did not initialize yet`**
Run `npx prisma generate`.

**Changes to `schema.prisma` aren't showing up in code**
Run `npx prisma generate` again — required after every schema edit.

**`SyntaxError: ... does not provide an export named 'styleText'`**
Node is older than 20.12. Install Node 22 LTS.

**`Cannot find native binding` from rolldown/vitest**
npm's optional-dependency bug. Delete `node_modules` and `package-lock.json`,
then `npm install`. If it persists, `npm install @rolldown/binding-win32-x64-msvc
--save-optional` (Windows x64). Also check the project isn't inside a synced
OneDrive folder — that breaks native `.node` files.

**A test file fails to even collect (`0 test`)**
Check it isn't a stray duplicate outside `src/lib/__tests__/`.

**`P1001 Can't reach database server`**
Neon compute cold start. Wait 30 seconds and retry.

**Someone suggests upgrading Prisma to a version starting with 7 or 8**
Don't, at least not without discussing it first — Prisma 7 made a custom
client output path mandatory, which breaks the standard `import { PrismaClient }
from "@prisma/client"` pattern this whole codebase uses. Pinned to `6.19.3`
deliberately.

---

> **Customer clarifications live in GitHub Discussions, not in the brief.**
> `docs/CUSTOMER_CLARIFICATIONS.md` indexes every ruling that binds this
> codebase, with links. Check it before deciding a rule for yourself — SPM-46
> built a slot grid the customer had already specified a month earlier,
> because nothing here pointed at them.

## 🕳️ KNOWN GAPS

Open items that affect everyone. **This list, not a changelog entry, is where a
gap lives** — a changelog is history and scrolls away; a gap is a thing still
waiting. Delete a row when you close it, and say so in your changelog entry.

| Gap | Impact | Owner |
|---|---|---|
| **Other stories' manual test cases assume Confirm ignores the safety check** | Since SPM-88, Confirm needs the Safety Officer's approval (an approved check, normally from Safety approved), and the Readiness tab counts the safety check among what blocks confirmation. These cases confirm, or count blockers, on fixture events that have no approved check, so their expected results are now out of date: **SPM-34** TC01, TC03-TC09 (Kristen); **SPM-33** TC01, TC05, TC07, TC13, TC14 (Kristen; TC07's "Confirm event does not wait for it yet" is no longer shown); **SPM-64** TC16-TC18 (Kristen); **SPM-67** TC05, TC06 (Kayal); **SPM-68** TC12 (Kristen); **SPM-90** TC08-TC10 (Kayal) - refusals now add "the Operational Safety Check has not been submitted yet", and a confirm that used to succeed is refused. **SPM-62** TC08, TC09, TC13 and TC17 (Kristen) quote wording SPM-88 changed (the "Move this event back to Planning?" text, "…needs to be submitted for a safety check again.", and the status-window message). Their fixtures were not changed. | each story's owner |
| **Closing an approved safety check records who closed it, not who approved it** | A significant change closes the check (SPM-88) by writing `closed` and the closer, time and reason into the decision columns, so the history card shows "Closed after a change…" for that submission rather than the Safety Officer's approval. The approval is still in the status history (Safety review → Safety approved, by the Safety Officer). Keeping both would need separate `closed_*` columns - a migration. | Janelle (SPM-88) |
| **No question before a venue booking change closes a safety check** | Requesting, withdrawing or releasing a booking while the event is in Safety review or Safety approved closes its check and returns it to Planning (SPM-88), and the Venue tab and request form say so afterwards - but, unlike the edit page and the Equipment tab, do not ask first. | Janelle (SPM-88) |
| **No `.env.example`** | A fresh clone has no template for `DATABASE_URL` / `JWT_SECRET`. Without them `src/lib/auth.ts` throws at import and **every API route returns 500**. Flagged 2026-09-13, still open. | unclaimed |
| **Status lifecycle is only partly validated** | Who may set a status is enforced. Which `from → to` moves are legal is enforced for two of them only: approve/reject from Under review (SPM-28) and Planning from Approved (SPM-54, and never through the status PATCH). Confirmed → Planning happens only as a consequence of an important change (SPM-62), never through the status PATCH. Safety review / Safety approved → Planning likewise happens only when a significant change closes the safety check (SPM-88). Every other move is still unchecked, so `approved → confirmed` in one step is possible for a coordinator. **Resuming a postponed event goes Postponed → Approved, not straight to Planning** (decided 2026-10-02; the lifecycle diagram's "resume" arrow was redrawn to match). The coordinator's next venue or equipment action then begins planning again, through the same single route as any Approved event. This fits customer answer #69: postponing without a date releases the bookings, so a resumed event has nothing arranged. Nothing postpones or resumes an event yet — for **SPM-38 (Postpone Event)** to build: (1) a resume action of its own, since a move to Approved is otherwise allowed only from Under review; (2) what happens when the new date is already known — #69 calls that a rescheduling request where arrangements are reviewed rather than released, so Approved may understate it; (3) the "Begin planning?" dialog says "the first venue or equipment action for this event", which is not literally true for a resumed event that kept its equipment list; (4) such an event has two "moved to Planning" rows in its status history, which is accurate. Related: `STATUS_TRANSITION_ROLES` still lets the Ops Manager set `under_review` through the status PATCH, which would leave an event under review with no coordinator — no screen does this (assignment goes through `PUT /api/events/[id]/coordinator`), but the route allows it. | events |
| **Two booking requests submitted at the same moment can both pass the clash check** | `POST /api/events/[id]/venue-bookings` (SPM-42) checks and writes without a lock, so two holds on one room for overlapping times can exist. Approval is not affected: `PATCH /api/venue-bookings/[id]` (SPM-43) locks the venue row and re-checks, so only one of them can be approved and the other then shows as a Conflict on `/bookings`. | venues |
| **The Coordinator is not notified of a booking decision** | Approving or rejecting a venue booking request (SPM-43) writes no `Notification` — ruled out of the story on 2026-09-18 (Jira comment: notifications belong to SPM-53). The coordinator finds the outcome, the reason and any suggested alternative on the event's Venue tab. | SPM-53 |
| **Cancelling or postponing an event does not release its bookings** | Since SPM-67 the assigned coordinator can withdraw a pending request or release an approved booking one at a time, from the Venue tab. Releasing every booking when the event itself is cancelled or postponed without a date (#69) belongs to SPM-37 and SPM-38. Venue Staff still have no list of what they have already decided. | SPM-37 / SPM-38 |
| **`EventSession` has no routes** | Table exists (multi-session events, briefing #74) but nothing creates, lists or edits sessions yet, so `VenueBooking.sessionId` / `EquipmentRequest.sessionId` are always NULL in practice. | events |
| **Review Flagged Arrangements has no reason code for a changed setup or turnaround time** | Since SPM-68 the assigned coordinator clears a flag from the Flagged Arrangements page (`/flagged`) - keep, mark registrations as reviewed, or replace and release. SPM-68's AC2 also lists "venue setup or turnaround time changed" as a reason, but nothing writes it: that is Re-check Bookings (SPM-80). Until then no booking carries it; when SPM-80 adds its code, the page shows it in plain words (underscores removed) unless the code is added to `REASON_PROSE` in `src/lib/flaggedArrangements.ts` and its twins in `eventConfirmation.ts` and `safetyCheck.ts`. Changing or ending an unavailable period (SPM-45) still does not clear the flag it raised; the coordinator keeps the booking once the room is free again. | SPM-80 |
| **SPM-34-TC07 is out of date after SPM-33** | Its message now names the venue ("Orchard Seminar Room for this event is still awaiting a decision from Venue Staff"). | SPM-34's owner |
| **An Ops Manager can view equipment and facilities but cannot reach them** | `ops_manager` holds `equipment:view` and `facility:view` (`src/lib/permissions.ts`) but `NAV_BY_ROLE` gives them no link to either, so the only way in is to type the address. The same was true of `venue:view` until SPM-46 added the Venues link on 2026-09-27 — found because SPM-46-TC10 asks an Ops Manager to reach the availability calendar from the sidebar. Worth a sweep: a permission nothing navigates to is a permission nobody tests. | equipment |
| **Venue Staff and Technical Support can view events but have no event list link** | Both hold `event:view`, but `NAV_BY_ROLE` has no "All Events" for either. Venue Staff can reach an event only through a pending request on Booking Requests. Technical Support's Equipment Requests open their own equipment screen, never the event Overview, so for them typing `/events` is the only way in. Found while writing SPM-64-TC24 (2026-10-09), which types the address for Technical Support. | unclaimed |
| **No notifications screen** | `Notification` rows are written (venue review flags, SPM-39; a safety check submitted, SPM-86; the Safety Officer's decision, to the coordinator, SPM-87; a reservation left short by equipment out of service, SPM-55; a venue booking released, to Venue Staff, SPM-67) but nothing reads them: the top-bar bell and every sidebar "Notifications" link point at `/notifications`, which does not exist, so they 404. | unclaimed |
| **Sessions are set up on create/edit only** | Since 2026-09-20 an organiser can split an event into sessions on S-08 (`POST` / `PATCH /api/events`), and each session's own equipment is written with `EquipmentRequest.sessionId` set. Still to build: coordinator-side session-scoped **venue booking** (`VenueBooking.sessionId` is still always NULL — SPM-42), Technical Support seeing which session a request belongs to (SPM-47/50), and showing sessions to anyone but their organiser and internal roles on the Overview tab. | events / venues / equipment |
| **Two sessions of one event cannot request the same equipment item** | `equipment_requests` is unique on `(event_id, equipment_id)`, not `session_id` too, so a projector needed on Day 1 *and* Day 2 can be requested once. The form's picker prevents choosing it twice and says so; the server refuses it with a 400. Fixing it properly needs a schema change (partial unique indexes) — Janelle's table, so it needs the team chat first. | equipment |
| **Facility / accessibility requirements are per event, not per session** | `event_facility_requirements` has no session column, so "the venue must have a hearing loop" applies to every session. A session's own venue needs are its layout and attendance. Per-session facilities would need a new table. The same holds for each of an event's rooms (SPM-90, decided 2026-10-13): a breakout room is judged on its own attendance and layout, but must still have every facility the event requires. | events / venues |
| **No route-level tests outside auth/permissions** | `npm run verify:permissions` (47 checks) and `npm run verify:login` (29 checks) cover authentication and authorisation end to end. Business rules — venue suitability, booking conflicts, capacity — are unit tested only; nothing exercises those routes over HTTP. | unclaimed |
| **No admin screen for staff accounts** | Since 2026-09-18 the internal roles cannot be self-registered, which is correct — but there is now no in-app way to create a coordinator, Ops Manager, venue staff, tech support or Safety Officer account (SPM-85) either. `npx prisma db seed` is the only route today (and, for the Safety Officer, `npm run fixtures:spm85`). Fine for the Week 12 demo; name it in the Q&A rather than being surprised by it. | auth |
| **An organiser cannot call off their own event** | Cancellation is the coordinator's alone (customer clarification, 2026-09-18), and Event Change Requests — the route an organiser would use to *ask* for one — has no endpoint yet. Until it does, an organiser who wants to cancel has no in-app path at all. | events |
| **The clarification loop is not built** | The coordinator can't ask the organiser a question about a request, and nothing shows existing `ClarificationRequest` rows (they are seed data only). SPM-28 left both out on purpose (decided 2026-09-30), so the review page (S-13) has no "Ask the organiser for clarification" option, although `design/mockups/EventReview.dc.html` still shows one. Whoever builds it: keep the event Under review while a clarification is open (2026-09-22 entry). | events |
| **The organiser is not notified of a review decision** | Approving or rejecting changes the status and, for a rejection, shows the reason on the event page, but writes no `Notification` — ruled out of SPM-28 on 2026-09-30. The organiser only finds out by opening the event. | events |
| **Nobody is notified when an event's information changes** | SPM-62 moves a Confirmed event back to Planning but writes no `Notification` — the organiser ("no longer confirmed") and registered attendees ("new date and time") are told by **SPM-53**, per the BPMN and SPM-62's reworded AC6 (decided 2026-10-05). | SPM-53 |
| **A multi-session event's sessions cannot be edited after approval** | Edit event information shows a multi-session event's sessions read-only ("Session times and attendance can't be changed here yet."). The draft editor replaces sessions wholesale, which after approval would delete each session's bookings and equipment, so session edits need their own story that updates them in place. | events |
| **The organiser is not notified when planning begins** | SPM-54 shows the Planning status on the organiser's Dashboard (its own "Planning" section), on My Events and on the event page, but writes no `Notification` — decided 2026-10-01. | events |
| **Beginning planning cannot be undone, and its history is not shown** | Nothing moves an event back from Planning to Approved; the "Begin planning?" dialog is the only safeguard. The move is written to `EventStatusHistory` with the action that caused it ("Venue search started", "Venue booking requested", "Equipment requirement recorded / updated / removed"), but the History tab is not built, so who began planning and how is only visible in the database. | events |
| **Find a venue gives no feedback when a search returns the same results** | Pressing Search with unchanged filters reloads an identical list and nothing says a search ran. Found while testing SPM-54; raised as **SPM-79** (Show Venue Search Feedback), in the backlog. | venues |
| **Other stories' test cases are out of date after SPM-54** | SPM-40-TC15 needs "Click 'Search'" and "Click 'Continue'" before its "Planning has started" message. SPM-42-TC08/TC09 book for an Approved event, so their first "Submit request" now shows the "Begin planning?" dialog. SPM-21 and SPM-30 quote the coordinator Dashboard's "Awaiting your review" list, which now holds Under review events only and at most five. Any case that books a venue or changes equipment on an Under review event is now blocked. | each story's owner |
| **Other stories' test cases still describe AM / PM / Night slots (Week 7 requirement change)** | **Why:** those cases were written to the slot rules of #50, #107, #108 and #123. Week 7 Customer Changes, Change #1, and the customer's answers #126 and #128 then replaced the slots with times on a 15-minute grid and made setup and turnaround real minutes. SPM-93 built that change, so the slot checkboxes, slot columns and slot wording these cases quote are no longer on screen. **Which cases, and what now covers them:** SPM-42-TC01, TC03 to TC09, TC11, TC14 to TC16 (requesting a venue) → SPM-93-TC01 to TC12; SPM-43-TC01 to TC06, TC08 to TC10, TC12 to TC16 (Booking Requests and approval) → SPM-93-TC13, TC14; SPM-46-TC01, TC05 to TC09, TC12 to TC14 (availability calendar) → SPM-93-TC15, TC16; SPM-40-TC08 to TC14 (Find a venue's date and time filters) → SPM-93-TC17, plus the search unit tests (setup and turnaround now count towards opening hours, so SPM-40-TC11's boundary moves); SPM-54-TC04, TC14 (only their request step uses slots; beginning planning is unchanged) → SPM-93-TC01; SPM-44-TC01 to TC11 (conflict messages, now in times; a pending hold now holds its setup and turnaround) → **SPM-44 itself**, which is In Review and was written before Week 7. SPM-40, 42, 43, 46 and 54 are Done and are not reopened: per the Week 7 guide (scenario 2) the new requirement is a new story, SPM-93, and its cases replace theirs. Stories not yet built (SPM-45, 67, 68, 80, 81, 82) were reworded to times in Jira, so no case of theirs depends on slots. | SPM-44 owner; others covered by SPM-93 |
| **A full event offers the waiting list but nobody can join it** | SPM-51 shows "This event is full. You can join the waiting list instead." and "Joining the waiting list isn't available yet." Joining, the 3-day offer window (#44) and FIFO with manual override (#26) are *Join and Respond to Waiting List*. When it lands, replace that second line with its Join button in `src/app/events/[id]/RegisterPanel.tsx`. | Join and Respond to Waiting List |
| **An attendee can withdraw up to the event's end** | SPM-52's acceptance criteria set no cut-off. Withdrawing is refused once the event is cancelled, completed or past its end, so its history doesn't change; before that a Registered attendee can withdraw, even after registration has closed or while the event is running. If the team wants an earlier cut-off (when registration closes, or when the event starts), it goes in `withdrawRefusal()` in `src/lib/registrationEligibility.ts`. | SPM-52 (Sammi) |
| **Every coordinator sees the registration counts, not only the assigned one** | `registration:view_list` is per role, so any coordinator who can open the event sees "Places taken" and "Withdrawn". SPM-52's AC5 says "relevant" coordinators; whether that means the assigned one only is not decided. | SPM-52 (Sammi) |
| **Nothing marks an attendee as added by the organiser yet** | SPM-65 added `registrations.added_by_id` and the Attendees tab shows "Added by <name>" when it is set (AC4), but no screen adds an attendee on someone's behalf, so only `npm run fixtures:spm65` sets it. *Manually Add Attendee* must set it to the organiser or coordinator who adds the attendee. | Manually Add Attendee |
| **SPM-42-TC02 quotes wording SPM-90 changed** | The capacity reason on a venue card now ends "- this space expects N." (was "- your event expects N."), and a refused request says "is not suitable for this space: …", because a venue is judged against the space it is wanted for, which is not always the whole event (SPM-90). SPM-42-TC02 still quotes the old sentence; the check itself is unchanged and is covered by SPM-90-TC02 to TC04. Found 2026-10-13. | SPM-42's owner |
| **Equipment transfer time assumes one venue per event** | The equipment availability check takes "the event's venue" from its bookings and picks one (`venueFor()` in `src/lib/equipmentAvailabilityService.ts`: an approved booking first). Since SPM-81 an event may hold several rooms, and which one the equipment goes to is not defined. SPM-90 now records what each space is for (`VenueBooking.purpose`), but did not pick a rule: which space the equipment goes to is still a team decision. Found 2026-10-10. | equipment |
| **Changing a quantity after review doesn't send the line back for re-checking** | If the Coordinator edits a line Technical Support has reviewed or reserved, it keeps its status (e.g. "Reserved" with the old quantity held). Decided 2026-10-05: **SPM-69** sends it back to Technical Support as Requested, showing what was reserved (Jira reworded; SPM-75 to match). SPM-62 only moves a Confirmed event back to Planning when its equipment changes. | SPM-69 |
| **Arrangements can still change while an event is in Safety review** | The coordinator can still request a venue booking and add, change or remove equipment on an event in Safety review (those routes only refuse before approval and once final), and the pending check stays as it is. Updating the event's information (SPM-62) is refused in Safety review. What a significant change should do to a pending or approved check - close it and return the event to Planning - is **SPM-88 (Resolve Safety Check Outcome)**, which also extends SPM-62's editable statuses to Safety review (team decision to confirm, 2026-10-06). Technical Support cannot reserve or update equipment in Safety review. | SPM-88 |
| **Nothing can cancel an event in Safety review yet** | The lifecycle allows Safety review → Cancelled (decided 2026-10-09), but no screen cancels any event. **SPM-37 (Cancel Event)** builds it and should offer it in Safety review too; its owner has been told. | SPM-37 |
| **Equipment availability's cancelled/postponed filter is temporary** | Only `EquipmentRequest.status IN (reserved, partially_fulfilled)` counts against stock, and requests of cancelled/postponed/rejected/draft events are filtered out in `src/lib/equipmentAvailability.ts` (`RELEASED_EVENT_STATUSES`). This is standing in for SPM-37 (Cancel Event) and SPM-38 (Postpone Event) actually releasing the reservation when built — remove the filter once they do, and check nothing still relies on it. | equipment |
| **SPM-31's test cases describe the old Registration card** | SPM-31's attendee case says the Registration card "shows Capacity '150' and the registration window". Since SPM-64 the card shows "Registration: Enabled", then Capacity, Opens and Closes (no "Window" row). | SPM-31's owner |
| **Submitting for a safety check doesn't check registration setup** | SPM-86's `submitForSafetyCheck` rule (`src/lib/safetyCheck.ts`) calls `arrangementsFor()` without the optional `registration` input that SPM-64 added, so an event whose registration is enabled but incomplete can be submitted for its safety check, while Confirm Event refuses it. Found when merging main (SPM-86) into SPM-64, 2026-10-10; SPM-86's rule was not changed. Its owner decides whether to pass the event's registration setup there too. | SPM-86's owner |
| **Which booking registration capacity is measured against may change with SPM-81** | SPM-64 lets the coordinator pick one of an event's active bookings when it has several (Week 7 change #3), and stores it in `Event.registrationVenueBookingId`. If **SPM-81 (Request More Than One Venue for an Event)** decides capacity should come from several rooms together (e.g. a main hall plus breakout rooms), that rule and `measuredBooking()` need revisiting. | SPM-81 |
| **Registration capacity is per event, not per session** | A multi-session event's sessions may have their own attendance limits (#74), but SPM-64 sets one `registrationCapacity` for the whole event, measured against one chosen booking. Per-session capacity would need a column on `EventSession` and per-session sign-up. | events / registrations |
| **Raising registration capacity promotes nobody from the waiting list** | SPM-64 only stores the new number. Offering freed places to waitlisted attendees (FIFO with manual override, a 3-day acceptance window: #26, #44) belongs to the attendee-side waiting list story. | registrations |
| **A registration capacity change doesn't trigger a new safety check** | The Operational Safety Check (Week 7 change #6) considers attendance against the venue's capacity and layout, but it isn't built. When it is, decide whether a capacity raised after safety approval sends the event back for review. | events |
| **Equipment transfer/prep time is a flat 2h with no location UI** | `Equipment.locationVenueId` (SPM-48) lets an item be pinned to a venue — no transfer time is added for an event there — but nothing in the app sets it; only `prisma/seed.ts`'s fixtures do. The 2h figure itself, and "before the event only, nothing added after" (SPM-48 open question, not yet asked at a customer Q&A), are both team assumptions. | equipment |

---

## 📝 CHANGELOG

Add a new entry at the TOP each time you make a real change. Keep it short —
what changed, why, and the migration name if there is one.

**Format:**
```
### YYYY-MM-DD — <your name>
- What changed
- Why
- Migration: <name, if applicable>
```

---

### 2026-10-17 — Kristen Choong (regression testing)
- **End-of-sprint regression testing guide**, `docs/REGRESSION_TESTING.md`
  (Word copy `docs/Regression_Testing_Guide.docx`): which stories to retest
  after a sprint, how to pick the cases, the smoke run, and how to record
  results without touching the story workbooks.
- **Regression logs** in `docs/regression/`: Sprint 2's, and Sprint 3's
  for the run before the sprint review. Sprint 3's has one sheet per
  tester with every case's steps, a smoke run split between the team as a
  relay, and 30 cases rewritten for this run because their story's version
  is out of date.
- **Out-of-date test cases.** Sprint 3's log lists 83 story test cases that
  SPM-93 (no more booking slots) and SPM-88 (Confirm waits for the safety
  check) made out of date, with each story's owner. Updating them in
  `docs/test-cases/` is for each owner after the run.
- Why: to check before each sprint review that earlier stories still work.
- Migration: none.

---

### 2026-10-16 — Sammi Chua (SPM-52, Withdraw from Event)
- **SPM-52 (Withdraw from Event).** An Attendee withdraws a Registered
  registration from My Registrations (S-27, a Withdraw button on the row) or
  the event page's "Your registration" card (S-06). Both ask first
  (`WithdrawRegistrationDialog`): "Withdraw from <event>?", "Keep my place" /
  "Withdraw". This closes the Known Gap "Attendees can't withdraw a
  registration".
  - **New route `PATCH /api/registrations/[id]`** with
    `{ status: "withdrawn" }`. Attendee only (403); someone else's
    registration is 404; anything but Registered is 400 ("Only an active
    registration can be withdrawn"); so is an event that is cancelled,
    completed or past its end, whose history must not change. The update only
    applies while the status is unchanged, so a double click or a second tab
    can't withdraw twice. Neither screen offers Withdraw in those cases.
  - **The row is kept** (`withdrawn`, `withdrawnAt` set), so My Registrations
    still lists it and SPM-51's register route reactivates it.
  - **The place frees itself:** seats are counted from `SEAT_TAKING`, which
    `withdrawn` is not in, so a full event shows Open again.
  - **AC5:** `GET /api/events/[id]` gives roles with `registration:view_list`
    (organiser, coordinators) `registrationCounts`, shown as "Places taken"
    and "Withdrawn" on the Registration card, also after registration is
    turned off.
  - **Out of scope:** leaving the waiting list and what happens to the freed
    place when there is one (SPM-66), notifications (SPM-53).
  - Two open questions are now Known Gaps: no cut-off for withdrawing before
    the event ends, every coordinator sees the counts.
  - Rules: `withdrawRefusal()`, `canWithdraw()` and `registrationCounts()` in
    `src/lib/registrationEligibility.ts`. No migration.
  - Fixtures: `npm run fixtures:spm52` (six "SPM52 …" events and Marcus
    Yeo's registrations); the same events are appended to `prisma/seed.ts`
    after SPM-88's.
  - Test cases: `docs/test-cases/SPM-52_Test_Cases.xlsx` (10).
  - **Decision record: the withdraw rules.**
    - *Context:* AC1 says a registered attendee can withdraw, and sets no
      limit. A withdrawal changes the event's numbers (places taken, the
      Withdrawn count), and an event that is over or cancelled is history:
      who registered for it must not change afterwards.
    - *Decision:* a withdrawal needs **all** of these, checked in this order
      by `withdrawRefusal()`, and each refusal has its own message:
      1. the registration is `registered` (`WITHDRAWABLE`). Waiting list is
         SPM-66's to leave; Attended and Withdrawn have no place to give back
         → "Only an active registration can be withdrawn";
      2. the event is not `cancelled` → "This event has been cancelled, so
         there is nothing to withdraw from";
      3. the event is not finished (`TERMINAL_EVENT_STATUSES`) and its
         `endsAt` has not passed, even if it is still Confirmed → "This event
         is over, so the registration can no longer be withdrawn".

      The row is updated, never deleted (`withdrawn` + `withdrawnAt`), and
      only while its status is still the one read (`updateMany` on
      `{ id, status }`), so a second tab or a double click withdraws once.
      The freed seat needs no write: seats are counted from `SEAT_TAKING`.
    - *Why one pure function:* the route refuses with it, and My
      Registrations and the "Your registration" card hide Withdraw with it
      (`canWithdraw()`), so a button is never offered for a request the
      server would refuse.
    - *Rejected:* deleting the row (loses My Registrations' history and
      SPM-51's reactivation); a cut-off at registration close or event start
      (no AC asks for it - Known Gap); letting the waiting list move up here
      (SPM-66).
  - **Sequence: registering, then withdrawing.**

    ```mermaid
    sequenceDiagram
      actor A as Attendee
      participant UI as Event page / My Registrations
      participant Reg as POST /api/registrations
      participant Wd as PATCH /api/registrations/[id]
      participant Rules as registrationEligibility.ts
      participant DB as Postgres (Prisma)

      A->>UI: Register (dietary, accessibility)
      UI->>Reg: { eventId, ... }
      Reg->>DB: find event
      Reg->>Rules: registrationState(event, 0, now)
      Rules-->>Reg: open, or a refusal (400)
      Reg->>DB: find own registration (eventId, attendeeId)
      alt already registered / waitlisted
        Reg-->>UI: 400 "Already registered for this event"
      else none, or withdrawn
        Reg->>DB: transaction: count SEAT_TAKING
        Reg->>Rules: registrationState(event, taken, now)
        Rules-->>Reg: full → 400 "This event is full"
        Reg->>DB: create, or reactivate the withdrawn row
        Reg-->>UI: 201 registration (status registered)
      end

      A->>UI: Withdraw
      UI-->>A: "Withdraw from <event>?" Keep my place / Withdraw
      A->>UI: Withdraw
      UI->>Wd: { status: "withdrawn" }
      Wd->>DB: find registration + event (status, endsAt)
      alt not the caller's own
        Wd-->>UI: 404 "Registration not found"
      end
      Wd->>Rules: withdrawRefusal(status, event, now)
      alt refused
        Rules-->>Wd: message
        Wd-->>UI: 400 message (shown in the dialog)
      else allowed
        Wd->>DB: updateMany where { id, status } → withdrawn, withdrawnAt
        alt count = 0 (withdrawn meanwhile)
          Wd-->>UI: 400 "Only an active registration can be withdrawn"
        else
          Wd-->>UI: 200 registration (status withdrawn)
          UI-->>A: "You have withdrawn from …", reloads
        end
      end
    ```

### 2026-10-15 — Sammi Chua (SPM-65, View Registration List)
- **The Attendees tab (S-11) is built.** `/events/[ref]/attendees`, backed by
  `GET /api/events/[ref]/registrations`, lists each attendee's name, email,
  phone, status and registration date (and withdrawal date), with places taken
  against the capacity and the number on the waiting list. Statuses are the
  existing `StatusBadge` labels; `attended` ("Attended", the checked-in state)
  now has the `info` tone, so it no longer looks the same as "Registered".
- **Who may see it:** `canViewRegistrationList()` in `src/lib/permissions.ts`,
  the first use of `registration:view_list`. The organiser who owns the event
  and the coordinator assigned to it. An organiser of the same client who did
  not raise the event can open the event but gets 403 here (AC8); every other
  role is refused (AC9). The usual order: 401, 404 for an event the user
  can't see, then 403.
- **The tab is shown only to those two** (changed 2026-10-17). It used to be
  shown to every organiser and coordinator, who then got "Not authorised".
  Now `GET /api/events/[ref]`, `…/venue-bookings` and `…/arrangements` return
  `canViewRegistrationList` (the same rule), and `eventTabItemsFor()` leaves
  Attendees out unless it is true - so another organiser at the same client,
  or a coordinator not assigned to the event, has no Attendees tab, like Venue
  Staff and Technical Support. Typing the address still gets "Not authorised".
- **Manually added attendees (AC4):** new nullable `registrations.added_by_id`
  (FK to users, `ON DELETE SET NULL`). NULL means the attendee registered
  themselves. Nothing writes it yet — *Manually Add Attendee* must set it to
  the organiser (or coordinator) who added the attendee; the list then shows
  "Added by <name>".
- **"As they happen" (AC6):** the tab reads the list again every 15 seconds
  while it is in view, and as soon as it comes back into view. No push channel.
  A failed background refresh leaves the last list on screen; a 403 stops it.
- **Registration not enabled (AC7):** the tab says so instead of an empty list.
  Registrations made before it was turned off are still listed under it.
- `registrationCounts()` (SPM-52) now also returns `waitlisted`.
- Merged SPM-52 (Withdraw from Event) into the branch first, as it adds
  `registrationCounts()`. SPM-52's PR should merge before this one.
- **Test cases:** `docs/test-cases/SPM-65_Test_Cases.xlsx` (12 cases). Test data:
  `npm run fixtures:spm65` (`scripts/seed-spm65.ts`), six "SPM65 …" events.
- Migration: `20261015120000_add_registration_added_by`
- New Known Gap: nothing marks an attendee as added by the organiser until *Manually Add Attendee* sets `added_by_id`.

### 2026-10-15 — Janelle
- **SPM-88 (Resolve Safety Check Outcome).** What follows the Safety Officer's
  decision, and what undoes one.
  - **Safety check history** (AC1): a card on the event's Overview, staff
    only, with every submission and decision, newest first. `GET
    /api/events/[id]` now returns every check as `safetyHistory`; the latest
    is still `safetyCheck`.
  - **Flag arrangements for review** (AC3): after a check is returned
    (changes requested or rejected) the assigned coordinator ticks the venue
    bookings and equipment it concerns. New route `POST
    /api/events/[id]/safety-flags` - assigned coordinator only (403), event in
    Planning with a returned latest check (400), at least one arrangement
    (400). Flags only, nothing changed: reason code `safety_check_returned`
    ("the Safety Officer returned the safety check"). The flags block
    resubmission (SPM-86) until cleared in Flagged Arrangements (SPM-68).
  - **A significant change closes the check** (AC5, AC6): the coordinator's
    important information change (SPM-62), equipment change, or venue booking
    requested, withdrawn or released, while the event is in Safety review or
    Safety approved, closes the check (`closed`, with who, when and what
    changed) and returns the event to Planning, in the same transaction. A
    Confirmed event that SPM-62 moves back to Planning has its approval closed
    too. Ordinary edits change nothing. Update Event Information is now
    allowed in Safety review and Safety approved, and asks first.
  - **Confirm needs the Safety Officer's approval** (AC8, AC9): the safety
    check always blocks confirmation (`SAFETY_CHECK_BLOCKS_CONFIRMATION`
    removed - it is now always on). Confirm is still offered in Planning and
    refused naming the safety check.
  - **Changed in other people's code:** `eventConfirmation.ts` (Kristen) - the
    gate on, the comment, the new flag reason; `applyEventInformation.ts`,
    the information route and the edit page (Kristen, SPM-62) - the safety
    statuses, closing the check, the dialog and message wording;
    `flaggedArrangements.ts` (Kristen, SPM-68) - the new flag reason;
    `permissions.ts` - `EVENT_INFORMATION_EDIT_STATUSES` (the registration
    window is unchanged) and `canFlagForSafetyReview()`; the equipment routes
    and Equipment tab (shared); the venue booking request route and form
    (Kayal, SPM-42) and withdraw/release route and Venue tab (Kayal, SPM-67) -
    closing the check and a notice afterwards. Tests changed on purpose:
    `event-detail` and `event-arrangements` (an approved check is now
    needed to confirm), `eventConfirmation`, `event-information`,
    `event-information-pages`, `equipment-pages`, `event-safety-check`
    (all checks are read).
  - **Rules:** `src/lib/safetyResolution.ts` (pure) and
    `src/lib/safetyCheckClose.ts` (the transaction).
  - **Migration:** none - `closed` was already a SafetyCheck status (SPM-86).
  - **Test data:** `npm run fixtures:spm88` - its own venue, SPM88 Harbour
    Studio, and eight events; appended to `prisma/seed.ts` after SPM-68's.
  - **Tests:** written first. New: `safetyResolution.test.ts`,
    `safetyCheckClose.test.ts`, `safety-flags.test.ts`; extended: the event,
    equipment, venue and edit page tests. Manual cases:
    `docs/test-cases/SPM-88_Test_Cases.xlsx` (13).
  - **Docs:** `docs/PERMISSIONS.md`, `SCHEMA_REFERENCE.md`, `UI_DESIGN.md`.
    Known Gaps: three SPM-88 rows deleted (the confirm gate twice, approval
    not voided by a change); three added (other stories' out-of-date cases,
    closing overwrites the approver, no question before a booking change).

### 2026-10-15 — Jordan
- **SPM-82 (Expire Tentative Venue Hold, Week 7 change #4).** A pending venue
  booking request is a tentative hold (#41): it now expires unless Venue Staff
  approve it in time, and the room is then free for other requests.
  - **The expiry:** set on request to 7 days later, or the event's start if
    that is sooner (`defaultHoldExpiry()`, `src/lib/holdExpiry.ts`). Shown on
    the Coordinator's Venue tab ("Hold expires …") and on Venue Staff's
    Booking Requests card ("Hold expires" row), where **Change expiry** moves
    it - not into the past, not past the event's start, only while pending
    (`PATCH /api/venue-bookings/[id]/expiry`).
  - **How it expires - no scheduled job (the story's "real unknown").**
    `expireDueHolds()` (`src/lib/holdExpiryService.ts`) runs before every read
    of venue bookings: the Venue tab, Booking Requests, a new request, a
    decision, the availability calendar, venue search, Readiness, Confirm,
    Submit for safety check - and the unread-notifications count, which every
    page asks for. Each step is one `UPDATE … RETURNING` statement, so two
    requests sweeping at once never claim the same hold and each Coordinator
    is told once. In the two routes that lock the venue first it runs after
    the lock. #55: notifications have no hard real-time requirement.
  - **Expired** is a new booking status (grey). An expired hold holds nothing
    (conflicts, search and the calendar read only pending and approved), stays
    on the event's Venue tab as "Expired - Hold expired on …", and cannot be
    approved, rejected or re-timed ("This hold has expired. The Coordinator must
    submit a new request.").
  - **Readiness and Confirm (AC10):** an expired hold is an outstanding
    arrangement - "the hold on <room> for this event expired on … - submit a new
    request" - until a newer pending or approved request exists for the same
    space (session and purpose; a hold with no purpose recorded is replaced by
    any newer request for its session), or it is marked as not required.
  - **Notifications (AC9):** "Venue hold expires soon" a configurable period
    before (`VENUE_HOLD_WARNING_HOURS` in `.env`, default 24 - there is no
    settings screen) and "Venue hold expired" when it does, to the event's
    coordinator; both open the event's Venue tab.
  - An approved booking never expires (AC11). Bookings made before this
    story have no expiry and never expire - including other stories' pending
    test bookings, which fixture scripts create without one.
  - **Migration `20261015130000_add_venue_hold_expiry`:** adds
    `hold_expires_at` and `expiry_warning_sent_at` (both nullable) and an index
    on (`status`, `hold_expires_at`). Only adds columns.
  - **Test data:** `npm run fixtures:spm82`;
    `docs/test-cases/SPM-82_Test_Cases.xlsx` (11 cases).

### 2026-10-15 — Kristen (end-to-end tests)
- **End-to-end smoke tests added** (`e2e/`, Playwright). The production build,
  driven through real Chromium, against a real migrated and seeded Postgres -
  no test doubles, unlike the unit tests, which stub the database and the
  network. Ten tests: every role logs in and gets its own sidebar (taken from
  `NAV_BY_ROLE`), a logged-out visitor is sent to log in and brought back, a
  wrong password is refused, and one journey across three browser sessions -
  the organiser submits a request, the Ops Manager assigns a coordinator, the
  coordinator approves it, and the organiser sees it Approved.
- **New CI check: End-to-end.** Runs them on every PR with its own throwaway
  Postgres; a failure attaches the report, with a replayable trace and a
  screenshot of each failed test, as `e2e-report`. No retries: a test that
  only passes on a second try is flaky, and needs fixing, not hiding.
- **CI's Postgres is now 18**, the version Neon runs, in the Migrations job too.
- Locally, `npm run test:e2e` only runs against a database on your own
  machine (it refuses the shared Neon one). Nobody needs to set that up: CI
  runs them for every PR.

### 2026-10-13 — Kristen
- **SPM-68 (Review Flagged Arrangements).** The coordinator has a new page,
  **Flagged Arrangements** (`/flagged`, S-30, in the sidebar after Review
  Queue): every venue booking, equipment reservation and registration list on
  their own events that a change has flagged for review, with why, and how it
  stands against the event **now**. This closes the Known Gap "A review flag
  cannot be cleared".
  - **One tab per kind** - Venue bookings, Equipment reservations,
    Registrations - each with a count and its own address (`/flagged?tab=venue`,
    `?tab=equipment`, `?tab=registrations`). Opened from the sidebar, the page
    shows the first tab with something flagged.
  - **Keep booking / Keep reservation / Mark as reviewed** clear the flag and
    change nothing else. A booking or reservation that no longer meets the
    event's requirements cannot be kept, and **is not offered Keep**: its
    item lists what is unmet and says "This booking can't be kept while it
    doesn't meet the event's requirements." The server refuses as well
    ("SPM68 Hall no longer meets this event's requirements: Theatre capacity
    is 100 - this space expects 150."), for a page showing an older result.
    AC7 is worded as an attempt to keep; the attempt is no longer possible
    from the screen, and its outcome - flag kept, requirement named - holds.
  - **Replacing a booking:** "Find a replacement venue" opens the venue search
    as `/venues/search?event=<ref>&booking=<id>`, filled in from that booking
    (its date, times and layout; the event's present attendance and mandatory
    requirements), with **Request booking** on each result. Requesting
    never changes the event or the flagged booking. Since SPM-90 the link
    carries the space along - what the flagged booking was for, and the
    attendance and layout searched for - and the request form now takes
    `purpose` from its address, as it took `attendance` and `layout`.
  - **The page clears flags; it never changes an arrangement** (decided
    2026-10-13). There is no Release or Withdraw button on it: each flagged
    booking has **Open Venue tab**, and the booking is released where every
    other change to an event's bookings is made (SPM-67). AC12 asks only that
    the flagged booking stays until it is released. Likewise an equipment
    item has **Open Equipment tab** and a registrations item **Open
    Overview**, where "Change registration settings" is (SPM-64).
  - **Routes:** `GET /api/flagged-arrangements` (the three lists) and `POST
    /api/flagged-arrangements { kind: "venue_booking" | "equipment_request" |
    "registrations", id }`. 403 for any role without `event:confirm` and for a
    coordinator the event is not assigned to; 404 for an arrangement that does
    not exist; 400 when it is not flagged or no longer fits, and 400 for
    anything the list would never show - an event that is over or called off,
    a booking that is not pending or approved, an equipment request that is
    cancelled or could not be provided - so a request made without the page
    cannot clear those flags either.
  - **What "still meets the event's requirements" means** (decided
    2026-10-13, `src/lib/flaggedArrangements.ts`, pure):
    - Venue booking: SPM-41's suitability check for the attendance and layout
      of the **space** it is for, and the event's mandatory facilities. Since
      SPM-90 (decided 2026-10-15, `spaceNeeds()`): the main programme - purpose
      "Main programme", or none on a booking made before SPM-90 - follows the
      event's (or session's) present attendance and layout; any other space,
      e.g. a breakout room, is held to its own attendance and layout as booked,
      so an event that grew does not make it too small. A main room named
      anything else is held to its own figures too; the Coordinator judges it
      from the flag reason. The replacement search is filled the same way. The
      venue is not retired; the booking's own times still cover the event's
      present time (the rule a new request must pass, SPM-93); and nothing
      else holds or blocks the room (SPM-44's conflict check).
    - Equipment: SPM-48's availability for the event's present dates, not
      counting the line's own units, covers what it has reserved - or what it
      asks for, while nothing is reserved yet.
  - **Keeping never changes the event's status.** A Confirmed event that
    SPM-62 moved back to Planning stays there until it is confirmed again.
    `flaggedAt` is left as history; only `needsReview` and `reviewReason` (or
    `Event.registrationReviewReason`) are written.
  - **A withdrawn or released booking keeps its flag columns** but is never
    listed or counted: only pending and approved bookings are.
  - **The Readiness tab can keep too; Confirm needed no change.** A flagged
    booking or equipment line was already Outstanding on the Readiness tab
    (SPM-33), and flagged registrations never blocked confirmation. Its row
    now gives the assigned coordinator **Keep booking** / **Keep reservation**
    under the same rule as the page - only while it still fits, otherwise what
    is unmet and that it can't be kept - and a **Review in Flagged
    Arrangements** link (`/flagged?tab=venue` or `?tab=equipment`) for finding
    a replacement. The tab reads `GET /api/flagged-arrangements` for the live
    result, so both screens always show the same verdict, and keeps through
    the same `POST`. `GET /api/events/[id]/arrangements` adds `canReviewFlags`
    for it: the assigned coordinator of an event still going ahead, at any
    status, unlike `canManage`.
  - **Left out, and labelled:** an event that is completed, cancelled,
    rejected or withdrawn is not listed. A flagged arrangement marked as not
    required on Readiness is still listed - waiving it does not clear the flag
    - with "Marked as not required for this event, so it does not block
    confirmation."
  - **Standalone page, not the Readiness tab:** Readiness is one event at a
    time, and the story asks for the list across events.
  - **Test data:** `npm run fixtures:spm68` - five "SPM68 …" rooms, two
    equipment items and 14 events, dated October 2027 (the app writes
    September as "Sept"). It writes the flags directly; what the page shows
    for each is worked out live. The rooms and events are in `prisma/seed.ts`
    after SPM-67's; run the script once after a full reseed.
  - **Tests:** written first, then the code. New `flaggedArrangements.test.ts`,
    `flagged-arrangements.test.ts` and `flagged-arrangements-page.test.tsx`;
    extended `venueSearchForm.test.ts`, `venue-search-page.test.tsx` and
    `roles.test.ts`. Manual cases:
    `docs/test-cases/SPM-68_Test_Cases.xlsx` (16), all passed, run by hand
    against the fixtures: TC01-TC15 on 2026-10-13, and TC13 again with TC16
    (each booking's own space, SPM-90) on 2026-10-15.
  - **Docs:** `UI_DESIGN.md` (S-30, the coordinator's sidebar),
    `docs/PERMISSIONS.md`, `SCHEMA_REFERENCE.md`. Known Gaps: the flag row is
    narrowed to SPM-80's missing reason code.
  - **Still open** (in `docs/test-cases/SPM-68_test_cases.json`): no screen
    lists an event's registrations, so "no registration is changed" is checked
    only by the route test; SPM-68-TC12 needs an approved safety check once
    SPM-88 makes Confirm wait for one.
  - Merged main (SPM-51, SPM-67) into the branch.
- Migration: none.

---

### 2026-10-15 — Kristen
- **Coverage gaps filled.** 113 tests for branches no test reached: requests
  that fail with something other than an Error, untitled or partly filled-in
  events, server answers with no body or a missing field. 3,894 tests;
  coverage 99.8% statements / 99.2% branches. The CI minimums in
  `vitest.config.mts` go from 95/92/95/95 to 99/98.5/99/99.
- **Dead code removed.** The log-in redirects inside `/venues` and the event
  Venue tab (`RequirePermission` already sends anonymous visitors to log in),
  the Venue tab's "My Events" breadcrumb (an organiser cannot open the tab),
  and two fallbacks in `AppShell`'s `initials()`.
- **New CI check: changed lines are tested.** On a pull request, the Unit
  tests check now also fails if any line the PR adds or changes under `src/`
  never runs in a test, and marks each one on the PR's diff. The whole-app
  minimums alone let a story add untested code as long as the total stayed
  above them. Run it before pushing with `npm run test:coverage` then
  `npm run coverage:changed`. A line no test can reach is marked
  `// v8 ignore next -- <why>` instead.
- **New CI check: Test cases.** Warns (never fails) when a PR whose title or
  branch starts with a Jira key has no `docs/test-cases/<key>_Test_Cases.xlsx`.
  `npm run test-cases:check` runs it locally.
- **Claude Code checks it too.** A Stop hook in `.claude/settings.json`
  (`scripts/claude-stop-coverage.mts`) runs the same changed-lines check when
  Claude finishes a turn on a branch whose `src/` code has changed, and sends
  it back to write tests for any untested line. It skips turns that changed
  nothing, stays quiet while tests fail (test-first, code not written yet),
  and never asks twice for the same code. A check takes about a minute. Turn
  it off for yourself in `/hooks`.
- **Migrations job does more.** After replaying the migrations it now checks
  that `schema.prisma` matches them (a schema change with no migration fails)
  and runs `prisma/seed.ts` on the result, so a seed that no longer fits the
  schema fails the PR instead of the next teammate's `npx prisma db seed`.
  Then it runs every `fixtures:*` script, twice each, so a story's test data
  script broken by a later schema change fails the PR (naming the script)
  instead of a tester's next test pass.
- **New CI check: Dependency audit.** Warns when production dependencies have
  high or critical advisories. On 2026-10-15 it would warn: `next` 16.3.4 has
  a critical one (fixed in 16.4.1; the app does not use `next/og`, where it
  is), plus high ones in `prisma`, `sharp` and `source-map-js`.
- `tsconfig.json` now includes `*.mts`, so Type-check covers the new scripts.
- Still not enforced: GitHub cannot require checks to pass before merging on
  a private repo on the free plan, so a red check is a rule the team keeps,
  not a lock. Making the repo public, or a paid plan, would allow it.
- Bug found while filling the gaps: SPM-100 (booking request refused with no
  reason shows no message). A note for SPM-32 on resuming a Postponed event
  is on that story.

### 2026-10-13 — Kayal (SPM-90)
- **SPM-90 (Check Each Venue Against Its Own Requirements).** Week 7 Change #3,
  split from SPM-81. Each venue booking now records the **space** it is for:
  what it is for ("Main programme", "Breakout room"), and that space's own
  expected attendance and room layout. A venue is judged against the space, not
  the event's total attendance, so a 20-seat breakout room can be booked for a
  150-person conference.
  - **Venue tab:** a new card, **The space you need** (Expected attendance for
    this space, Room layout, **Check venues**). It starts on the event's own
    values (the session's, for a multi-session event). Checking again judges
    every venue for that space, and "Request booking" carries it to the form.
  - **Request form:** three new fields - **What is this space for?** (required,
    up to 100 characters), **Expected attendance for this space** (whole
    number, at least 1) and **Room layout**. The purpose starts as "Main
    programme" for the event's (or session's) first pending or approved
    booking and empty for a further one. The read-only Layout row is gone.
  - **Where the purpose is shown (AC5):** the Venue tab's Booking requests card
    ("Breakout room · 7 Sep 2027, 09:00–17:00 · Classroom · 20 attendees"),
    Venue Staff's Booking Requests page (a **Space** row; Expected attendance
    is now the space's own), the Overview's Venue bookings card, and the
    Readiness tab ("Space: Breakout room · Booking status: Pending").
  - **Confirming (AC6):** already enforced since SPM-33 - every pending or
    approved booking is its own arrangement and Confirm waits for each one that
    is still required. SPM-90 adds the purpose to the reason, e.g. "SPM90
    Breakout Room (Breakout room) for this event is still awaiting a decision
    from Venue Staff". The Known Gap that said otherwise was out of date and is
    removed.
  - **Decided 2026-10-13 (AC3): facilities and accessibility stay the
    event's.** AC3 mentions the "accessibility and facilities recorded for that
    space", but AC1 has the Coordinator record only purpose, attendance and
    layout, and no customer document asks for per-room facilities (Week 7
    Change #3, the briefings and the discussion board were checked). So every
    space must have the facilities the event requires, as every session already
    does. Per-room facility lists would be their own story.
  - **Wording changed:** "… - your event expects N." is now "… - this space
    expects N.", and "is not suitable for this event: …" is now "… for this
    space: …". SPM-42-TC02 quotes the old sentence (Known Gaps).
  - **Routes:** `POST /api/events/[id]/venue-bookings` takes `purpose`
    (required), `expectedAttendance` and `layoutName` (both optional; left out,
    the session's or event's own). `GET` of the same returns each booking's
    `purpose` and `expectedAttendance`, and the event's `expectedAttendance`.
    `GET /api/events/[id]/venue-suitability` takes `?attendance=&layout=`
    (400 "Enter a whole number of at least 1."). `GET /api/venue-bookings` and
    `GET /api/events/[id]` return each booking's `purpose`.
  - **Venue edits (SPM-39):** a booking is re-checked against its own space's
    attendance first, then the session's, then the event's.
  - **Not here, on purpose:** per-room facilities (above); a cap on a space's
    attendance, or adding the spaces up against the event's total; which room
    equipment transfer time is measured to (Known Gaps); "Search with filters"
    still filters by the event's own requirements.
  - **Migration:** `20261013120000_add_venue_booking_space` - two nullable
    columns on `venue_bookings`, `purpose` and `expected_attendance`. It fills
    `expected_attendance` on existing bookings from their session or event and
    leaves `purpose` empty. Apply with `npx prisma migrate deploy`; no reseed.
  - **Test data:** `npm run fixtures:spm90` - three "SPM90 …" rooms and six
    events, dated September 2027. The events and their "Step-free access"
    requirement are appended to `prisma/seed.ts` after SPM-87's; the seed's
    own bookings now carry "Main programme" and the event's attendance.
  - **Tests:** written first. Extended `event-venue.test.ts`,
    `venue-booking-review.test.ts`, `venues.test.ts`, `event-detail.test.ts`,
    `eventConfirmation.test.ts`, `venueSuitability.test.ts`,
    `validation.test.ts`, `event-venue-pages.test.tsx`,
    `event-readiness-page.test.tsx`, `event-pages.test.tsx` and
    `list-pages.test.tsx`. Manual cases:
    `docs/test-cases/SPM-90_Test_Cases.xlsx` (11), all passed when run by hand
    on 2026-10-13 (kayalvizhi24). Migration applied to the shared database; no reseed.

### 2026-10-13 — Janelle
- **SPM-87 (Conduct Operational Safety Check).** The Safety Officer approves,
  rejects or requests changes on an event in Safety review.
  - **New status "Safety approved"** (stored as `safety_cleared`: the key
    `safety_approved` is already the Readiness tab's safety-check badge,
    SPM-33). Safety review → Safety approved (approve, AC7) or → Planning
    (reject / request changes, AC8); Safety approved → Confirmed, → Planning
    (a significant change, SPM-88) or → Cancelled. Added wherever Safety review
    is: dashboards ("Safety approved" list for organiser and coordinator),
    Venue Staff and Technical Support "Upcoming events", the status filter,
    Technical Support's equipment view (read-only, with its own message) and
    coordinator reassignment.
  - **New route** `POST /api/events/[id]/safety-decision` - Safety Officer
    only (403), event in Safety review with a pending check, else "This safety
    check has already been decided." (AC11), reason required to reject or
    request changes (AC6). In one transaction: the SafetyCheck gets the
    decision, who, when and the note (guarded on "pending", so two tabs cannot
    both decide); the event moves on; the status history; and the assigned
    coordinator is notified (`safety_check_decided`) with the reason (AC9).
  - **Screens:** a "Record safety decision" button on the event for the Safety
    Officer, opening a dialog with Approve / Request changes / Reject and a
    "Changes required" or "Reason for rejecting" box. The event's "Safety
    check" row now says who decided and when, with the note (staff only).
  - **Changed in SPM-85's code (Jordan):** the Safety Checks list is sorted by
    event date, earliest first (AC1; was oldest submission); the event's
    "Venue bookings" card adds each venue's opening hours and its unavailable
    periods on the event's dates (AC2's "venue restrictions"). Two of his list
    tests were updated for the new order. `GET /api/events/[id]` adds the
    decision fields and the venue restrictions for staff (one extra query,
    only when something is booked).
  - **Rules:** `src/lib/safetyDecision.ts` (pure). SPM-86's "Safety check" row
    wording moved there from the event page.
  - **Migration:** none - SPM-86's `safety_checks` table already had the
    decision columns.
  - **Test data:** `npm run fixtures:spm87` - its own venue, SPM87 Hillside
    Studio (with a maintenance period), and six events; appended to
    `prisma/seed.ts`.
  - **Tests:** written first. New: `safetyDecision.test.ts`,
    `safety-decision.test.ts`; extended: `statuses`, `permissions`,
    `equipmentAvailability`, `event-pages`, `list-pages`; changed on purpose:
    `safety-checks.test.ts` (sort), `event-detail.test.ts` (venue fields),
    `event-safety-check.test.ts` (decision fields), `lists.test.ts`. Manual
    cases: `docs/test-cases/SPM-87_Test_Cases.xlsx` (12; TC12 Blocked by
    SPM-71).
  - **Docs:** `docs/PERMISSIONS.md`, `SCHEMA_REFERENCE.md`, `UI_DESIGN.md`,
    the status lifecycle diagram (a "Safety approved" box between Safety review
    and Confirmed; nothing else moved). Known Gaps: one new row (approval not
    yet voided by a change, SPM-88); the confirm-gate and notifications rows
    updated.

### 2026-10-13 — Jordan
- **SPM-71 (View Notifications), S-04 built.** The Notifications page lists
  the signed-in user's own notifications, newest first, each with what
  happened, the event and its reference, and when. Unread ones are bold with
  an "Unread" label and a "Mark as read" button; "Mark all as read" sits in
  the header while any is unread; "No notifications" when there are none.
  - **Unread count in the navigation:** on the top-bar bell (as UI_DESIGN.md
    §4.1 always specified) and on the sidebar's Notifications link, "99+" past
    99, nothing at zero. Recounted on every page change and as soon as the page
    marks something read (`NOTIFICATIONS_CHANGED`). If the count can't load,
    the shell carries on without a number.
  - **Selecting a notification** marks it read and opens what it is about -
    `notificationHref()` in `src/lib/notificationView.ts`: a booking that needs
    review opens the event's Venue tab, equipment that needs review its
    Equipment tab, anything else the Overview (including types only the base
    seed writes). Access is the target screen's own decision, so someone who
    has lost access sees that screen's refusal (AC6).
  - **New routes**, signed-in only, every one scoped to the caller:
    `GET /api/notifications`, `GET /api/notifications/unread-count`,
    `PATCH /api/notifications/[id]` (`{ isRead: true }`; someone else's is
    404) and `POST /api/notifications/read-all`.
  - **A stale-list bug found in the browser and fixed:** React's development
    mode loads a page twice, and a slower, older answer could overwrite a
    notification just marked read. Only the latest load may now update the
    page, and marking retires older loads; a unit test reproduces it.
  - **Test data:** `npm run fixtures:spm71` - four test accounts of the
    story's own and 4 "SPM71 …" events, no reseed.
    `docs/test-cases/SPM-71_Test_Cases.xlsx` (11 cases, all run in a browser).
  - Retired the "not built yet" placeholder test for Notifications in
    `public-pages.test.tsx` - it was the last unbuilt sidebar screen.
  - Closes two Known Gaps: "No notifications screen", and the Safety
    Officer not seeing safety-check notifications. **SPM-86-TC13** (the Safety
    Officer is notified) is no longer blocked.
  - Migration: none - the `notifications` table already existed.
### 2026-10-13 — Kayal
- **SPM-67 (Withdraw or Release Venue Booking).** On the event's Venue tab the
  assigned coordinator can **Withdraw request** on a Pending booking or
  **Release booking** on an Approved one, each behind a confirmation with an
  optional reason. The booking stays on the event as **Withdrawn** or
  **Released** (grey badges, new label "Released"), with "Reason for
  withdrawal/release: …".
  - **Route:** `PATCH /api/events/[id]/venue-bookings/[bookingId]`,
    `{ action: "withdraw" | "release", reason? }`. 404 for an event the user
    can't see, 403 for anyone but the assigned coordinator, 400 for the wrong
    status (e.g. "This request has already been approved, so it can no longer
    be withdrawn. Release the booking instead.") or a closed event. Locks the
    venue row like Venue Staff's decision, so a withdrawal and an approval
    can't both succeed. Never changes the event or its other bookings.
  - **A release notifies every active Venue Staff user** ("Venue booking
    released"); a withdrawal notifies no one - the request just leaves
    Booking Requests. Not visible until the Notifications screen (SPM-71).
  - **Nothing else needed changing:** availability, conflicts, duplicates,
    Readiness (SPM-33), Confirm (SPM-34) and registration capacity (SPM-64)
    already count only pending and approved bookings, so the freed period -
    setup and turnaround included - is free again, and an event left with no
    booking shows "No venue booked" as Outstanding.
  - **Rules:** `src/lib/venueBookingChange.ts` (pure). `GET
    /api/events/[id]/venue-bookings` adds `canChangeBookings` and each
    booking's `cancellationReason`.
  - **Also fixed:** `DetailList` (`src/components/ui/Card.tsx`) keyed rows by
    label, so the Overview's Venue bookings card (SPM-85) warned about a
    duplicate key for two rooms both booked for the "Whole event".
  - **Migration:** `20261011120000_add_venue_booking_withdrawal` - three
    nullable columns on `venue_bookings`: `cancelled_by`, `cancelled_at`,
    `cancellation_reason`. Applied to the shared database; no reseed.
  - **Test data:** `npm run fixtures:spm67` - three "SPM67 …" rooms and eight
    events, dated November 2027 (the app writes September as "Sept"). The
    events are appended to `prisma/seed.ts` after SPM-51's.
  - **Tests:** written first. New `venueBookingChange.test.ts` and
    `venue-booking-change.test.ts`; extended `event-venue.test.ts`,
    `event-venue-pages.test.tsx`, `statuses.test.ts`, `ui.test.tsx`. Manual
    cases: `docs/test-cases/SPM-67_Test_Cases.xlsx` (10), all passed
    2026-10-13. They include SPM-81's AC7 checks for withdrawing and releasing
    (TC01-TC03).
  - **Docs:** `docs/PERMISSIONS.md`, `SCHEMA_REFERENCE.md`, `UI_DESIGN.md`
    (S-15, S-22). Known Gaps: "A decided booking cannot be undone or released"
    narrowed to cancelling and postponing (SPM-37, SPM-38).

### 2026-10-13 — Sammi Chua (bug found while testing SPM-51)
- **An Attendee who types `/events` is taken to Browse Events.** The events
  list had no role check, so an Attendee saw "All events", "Every event across
  client organisations." and a filter of internal planning statuses. No data
  leaked (`GET /api/events` already limits them to the public subset). Now
  `src/app/events/page.tsx` sends an Attendee to `/browse` without loading or
  showing the list. Their event page `/events/<reference>`, where they
  register, is unchanged, and so is `/events` for every other role. 1 more
  page test in `list-pages.test.tsx`.
- Migration: none.

### 2026-10-12 — Jordan
- **SPM-85 (Safety Officer Role and Access, Week 7 change #6).** A new internal
  role, `safety_officer` ("Safety Officer"), for the person who reviews the
  operational safety of planned events. SPM-86 already notified users with
  that key; now one can log in. Not self-registerable — the Create an account
  form still offers only Event Organiser and Attendee.
  - **Sidebar:** Dashboard · Safety Checks · All Events · Notifications.
  - **New screen, Safety Checks** (`/safety-checks`, S-29) and
    `GET /api/safety-checks`: the events in Safety review, with Client, When,
    Expected attendance and who submitted each for its check and when, oldest
    first. The Dashboard's "Awaiting your safety check" list links to it.
  - **New permission, `event:safety_check`**, held by the Safety Officer alone.
    It opens Safety Checks today; SPM-87's decision (approve, reject, request
    changes) should use the same action. Every other role is refused the page
    and the API (403) - that is what "other roles cannot perform Safety Officer
    actions" means until SPM-87.
  - **What they read:** every event that has left Draft (like the rest of the
    staff), its Overview and its Equipment tab, read-only. They hold no venue,
    equipment, registration or status action, so every existing "change" rule
    refuses them without naming them, and no Attendees tab and no
    `registration:view_list` - attendee details are personal.
  - **The Overview gained two staff-only cards**, because AC3 needs them and
    nothing showed them before: **Sessions** (each session's time, attendance
    and layout) and **Venue bookings** (each approved booking's room, layout,
    and the seats that layout holds). `GET /api/events/[id]` now selects each
    approved booking's `layoutName` and the room's layouts with capacities.
    The coordinator sees both cards too; the organiser does not.
  - **The Venue tab's address now refuses every role without `venue:view`
    before loading** (`RequirePermission`), instead of loading and then
    showing an error - the Safety Officer, Technical Support, an organiser or
    an attendee typing it see "You do not have access to this". Nobody loses
    anything: the tab was never offered to those roles.
  - **`prisma/seed.ts`:** Hana Yusof joins the staff list; SPM-85's three events
    are appended last; `CHAIN` and `REASONS` gain `safety_review`, which no
    seeded event had needed before (a full reseed would have crashed on one).
  - **Test data:** `npm run fixtures:spm85` - the Safety Officer account and
    three "SPM85 …" events, no reseed. Test cases:
    `docs/test-cases/SPM-85_Test_Cases.xlsx` (15 cases). SPM-86-TC13, Blocked
    until a Safety Officer could log in, is now unblocked on that side (it
    still needs the Notifications page, SPM-71).
  - Migration: none (`users.role` is a plain string).
### 2026-10-12 — Kristen
- **SPM-33: the Operational Safety Check is on the Readiness tab** (AC6,
  AC9), now that SPM-86 and SPM-81 are on main. It is the last item, from
  the event's latest `SafetyCheck`: Not submitted, Awaiting review,
  Approved, Changes requested or Rejected, with who submitted it and when.
  It can never be marked as not required. It stops Confirm only while it is
  awaiting review (the event is then in Safety review); otherwise SPM-88
  adds that gate (`SAFETY_CHECK_BLOCKS_CONFIRMATION`), and until then its
  item says "Confirm event does not wait for it yet." Read by
  `loadConfirmationInput()`; worded in `src/lib/eventConfirmation.ts`.
- **Merged with SPM-64 (Configure Event Registration).** Both stories added
  a registration item to the confirmation rule; SPM-64's rule and wording are
  kept inside SPM-33's item. Registration that is off now shows as
  "Registration setup - Not required" on the Readiness tab, with no button.
- **Test data:** `npm run fixtures:spm33` now has 16 events - a second
  venue to request through SPM-81's Venue tab, and the safety check's four
  states - appended to `prisma/seed.ts` too.
- **Tests:** 17 manual cases (four new, TC01 and TC02 updated); new unit,
  route and page tests for the safety check.
- Migration: none.

### 2026-10-11 — Janelle
- **SPM-55 (Record Equipment Unavailability).** Technical Support record how
  many of an item's units are unavailable, damaged or under maintenance, and
  return them; a reservation that leaves short is flagged, never cancelled.
  - **New screen:** the sidebar's **Equipment** page (`/equipment`, was "not
    built yet") - every item with Total units, Out of service, a status badge
    (Available / Partly out of service / Out of service) and the reason (AC6).
    Technical Support get "Record unavailability" (units, Type, Reason
    (optional)) and "Return all to available" (AC1, AC2, AC5). After a save
    that flags anything, an amber panel lists each reservation ("… 4 reserved,
    3 available") and says the coordinators were notified (AC4).
  - **Route:** `PATCH /api/equipment/[id]/out-of-service` (SPM-48's) now takes
    a `type` - unavailable / damaged / under_maintenance, required while any
    unit is out ("Choose a type."). In one transaction it flags every Reserved
    or Partially fulfilled request of an event that has not ended which the
    units left can no longer cover - but could before this change (so no
    repeat flags or notifications) - and notifies the event's coordinator (or
    the requester). When several share the same days and cannot all be
    covered, all are flagged (decided 2026-10-11). The request's status and
    quantities never change. Answers the item plus `flaggedReservations`.
  - **The rule** (pure, `src/lib/equipmentOutOfService.ts`):
    `newlyShortReservations()` reuses SPM-48's `checkAvailability()`, so a
    reservation is short on exactly the days the availability check would say.
    Flag reason code `equipment_unavailable`, merged with any already there via
    `addReviewReasons()`; SPM-86's safety check refusal words it.
  - **Permissions:** new action `equipment:view_status` (Coordinator, Ops
    Manager, Technical Support). The organiser keeps `equipment:view` for the
    request form, but `GET /api/equipment` no longer sends them the
    out-of-service count, type or reason (AC6).
  - **Wording:** Technical Support's availability line reads "… out of
    service …" instead of "… in maintenance …".
  - **No return date or pre-booking** - customer #23: not specified.
  - **Migration:** `20261011120000_add_equipment_out_of_service_type` - one
    nullable column, `equipment.out_of_service_type`. Units recorded before it
    show their reason alone.
  - **Test data:** `npm run fixtures:spm55` - four dedicated "SPM55 …" items
    and 7 events, so no other story's equipment changes. The events are
    appended to `prisma/seed.ts`.
  - **Tests:** written first, then the code to them. New:
    `equipmentOutOfService.test.ts`, `equipment-catalogue-page.test.tsx`;
    extended: `equipment.test.ts`, `validation.test.ts`,
    `permissions.test.ts`, `safetyCheck.test.ts`. Changed on purpose:
    `equipment-pages.test.tsx` ("out of service") and `public-pages.test.tsx`
    (Equipment is no longer a "not built yet" screen). Manual cases:
    `docs/test-cases/SPM-55_Test_Cases.xlsx` (11).
  - **Docs:** `docs/PERMISSIONS.md`, `SCHEMA_REFERENCE.md`, `UI_DESIGN.md`
    (S-24), `docs/CUSTOMER_CLARIFICATIONS.md` (new Equipment section: #9, #23,
    #86), and the BPMN's equipment exception now starts from any unavailable,
    damaged or maintenance unit and flags short reservations (labels only).
    Known Gaps: "No equipment catalogue screen" closed; review-flag and
    notifications rows updated.

### 2026-10-10 — Sammi Chua (SPM-51, Register for Event)
- **SPM-51 (Register for Event): decisions before any code.** An Attendee
  finds the events open for registration, registers for an eligible one, and
  sees their registration status. Agreed with Sammi Chua, 2026-10-10.
  Customer clarification numbers are in brackets.
  - **Built on SPM-64**, which isn't in `main` yet: its branch is merged into
    `SPM-51-Register-for-Event` (main untouched). SPM-64's PR should merge
    first, and SPM-51's PR will then show only SPM-51's own changes.
  - **Already there:** `POST /api/registrations` checks Confirmed, enabled,
    the window, duplicates (re-registering after withdrawing reuses the row)
    and capacity, inside a transaction. SPM-51 reuses it, moving its checks
    into one pure rule.
  - **Eligible (AC3):** Confirmed, registration enabled, **both** dates set,
    and now between them. The opening moment counts, and so does the closing
    moment itself, as the route already did. **No registration period means
    not eligible** ("Registration dates haven't been set for this event.").
    This is a change: the route used to allow missing dates.
  - **Capacity (AC9):** seats are taken by `registered` and `attended`
    attendees. Waitlisted and withdrawn ones don't take a seat. A capacity
    that isn't set means no limit (unchanged; SPM-64 shows it as incomplete
    setup).
  - **Waiting list (AC10): offer only.** A full event shows "This event is
    full. You can join the waiting list instead." where the Register form
    would be, with a note that joining comes with *Join and Respond to Waiting
    List*. There's no dead button (UI_DESIGN: hide, don't disable), and no
    waitlisted rows are created. Offers, the 3-day acceptance window (#44) and
    FIFO with manual override (#26) are that story's.
  - **Form:** optional Dietary requirements and Accessibility requirements
    (UI_DESIGN S-26, #22). The route already stores them.
  - **Re-registering:** a withdrawn attendee can register again (existing
    behaviour). Withdrawing is a separate story (#20).
  - **Screens:** Browse Events (S-26, `/browse`) lists the Confirmed events
    open to registration with their state (Open, Opens …, Closed, Full). The
    event page gets a Register panel for attendees that shows the period
    (AC4). My Registrations (S-27, `/registrations`) lists the attendee's
    registrations and their status (AC6, through a new
    `GET /api/registrations`).
  - **Out of scope:** withdrawing, the waiting list itself, check-in (#38),
    VIPs (#99), notifications (SPM-53).
  - **Order of work:** as for SPM-64. The Excel test cases come first, then
    slices that are each tested first. No duplicate testing.
- **Test cases written first:** `docs/test-cases/SPM-51_Test_Cases.xlsx` (12
  cases across AC1–AC10; the role checks are only in TC12). The screen
  wording and the 8 fixture events (`npm run fixtures:spm51`, not built yet)
  are in the JSON's open questions, all now RESOLVED.
- **Slice 1 (AC3, AC8, AC9): one eligibility rule.** New pure module
  `src/lib/registrationEligibility.ts`: `registrationState()` says `open` or
  why not (not_confirmed, disabled, no_period, not_open, closed, full).
  `REGISTRATION_REFUSALS` gives each refusal's message and `SEAT_TAKING`
  (registered, attended) says who holds a seat. `POST /api/registrations` now
  uses it instead of its own checks. Its messages are unchanged, plus
  "Registration dates haven't been set for this event" for an event with no
  period, which is now refused (AC3). The route's test event was given an
  open period and a fixed clock on purpose. 21 unit tests, 2 more route tests.
- **Slice 2 (AC1, AC4): Browse Events and each event's registration state.**
  - **Event APIs:** for an attendee, `GET /api/events` and
    `GET /api/events/[id]` now return `registrationState` (added to
    `ATTENDEE_EVENT_FIELDS`). The list also returns the company name. The
    list counts seats for all its events in one `registration.groupBy`, the
    single event with one count. Both only do this for attendees.
  - **Browse Events (S-26, `/browse`)** replaces the placeholder. It lists
    Event, When, Company and a Registration badge, soonest first, and a row
    opens the event. Events whose registration is off are left out: an
    attendee holding a place can still see those (#10), but they belong in My
    Registrations.
  - **Badges:** new keys in `statuses.ts` (`registration_open`,
    `registration_not_open`, `registration_closed`, `registration_full`,
    `registration_no_period`), because `StatusBadge` is the only way a status
    is shown. A not-yet-open event's badge reads "Not open yet" with "Opens
    <date, time>" beside it, so SPM-51-TC01's wording was updated.
  - **Tests:** 13 page tests in `browse-page.test.tsx` and 4 more route
    tests. The attendee tests in `events.test.ts` and `event-detail.test.ts`
    were updated on purpose. Browse was removed from the "not built yet"
    placeholder tests.
- **Slice 3 (AC2, AC5, AC7): the "Your registration" card.** New
  `src/app/events/[id]/RegisterPanel.tsx`, shown on the event page to an
  Attendee only, below the Registration card.
  - **Open event:** optional "Dietary requirements" and "Accessibility
    requirements" fields and "Register", which sends `POST /api/registrations`
    (empty fields left out). It then shows "You're registered for this
    event." and reloads the event.
  - **Already holding a place:** shows the status badge with "You registered
    on <date>." or "You're on the waiting list." instead of Register. A
    withdrawn attendee is offered Register again.
  - **Otherwise:** a message instead of the button ("Registration opens …",
    "Registration closed on …", "Registration dates haven't been set for this
    event."). A refusal shows the server's message.
  - **Data:** `GET /api/events/[id]` now also gives an attendee
    `myRegistration` (`{ status, registeredAt } | null`, added to
    `ATTENDEE_EVENT_FIELDS`). This was moved forward from Slice 4, because
    the card needs it to stop a second registration.
  - **Tests:** 16 page tests in `register-panel-pages.test.tsx`, plus 2 more
    route tests.
- **Slice 5 (AC10, built before Slice 4): the full event's waiting-list
  offer.** A full event's card says "This event is full. You can join the
  waiting list instead." and "Joining the waiting list isn't available yet.",
  with no Register button and no dead control. The register route already
  refused a full event ("This event is full"). Its test now also checks that
  no registration is written, so nobody is waitlisted by this story. 2 more
  page tests.
- **Slice 4 (AC6): My Registrations.**
  - **API:** new `GET /api/registrations` returns the signed-in attendee's
    own registrations, newest first, with each event's reference, title and
    times. Withdrawn ones are included. It's 401 without a session, and 403
    "Registrations belong to an Attendee account." for any other role. This
    closes the "cannot serve view status" gap in Integration.md §5.
  - **Page:** My Registrations (S-27, `/registrations`) replaces the
    placeholder. It shows Event, When and a Status badge, and a row opens the
    event. With none: "You haven't registered for any events yet.". There is
    no Withdraw button yet (#20).
  - **Tests:** 8 more route tests and 12 page tests in
    `my-registrations-page.test.tsx`. My Registrations was removed from the
    "not built yet" placeholder tests.
- **Final step: fixtures, docs, test cases re-checked.**
  - **Fixtures:** `npm run fixtures:spm51` (`scripts/seed-spm51.ts`) adds or
    resets the 8 "SPM51 …" events, mirrored at the end of `prisma/seed.ts`
    after SPM-64's block.
  - **Checked on the real database:** the server side of every manual case
    was run against the fixtures through the running app's API, all 21
    checks as expected. The fixtures were reset after.
  - **Test cases:** `code_references` filled in, wording unchanged (apart from
    Slice 2's "Not open yet" badge). Nobody has clicked through them in a
    browser yet.
  - **Known Gaps:** the "No Browse Events screen" row is deleted (built, and
    SPM-31-TC19 can now run end to end). New rows: joining the waiting list,
    and withdrawing (#20).
  - **Other docs:** `docs/PERMISSIONS.md` (`GET /api/registrations`, the
    eligibility rule on `POST`) and `UI_DESIGN.md` (S-26, S-27, the "Your
    registration" card).
- Migration: none.

### 2026-10-10 — Kristen
- **Each test case sheet now carries its own summary.** The test case
  template (`.claude/skills/generate-test-cases/Test_Case_Template.xlsx`)
  has a **Summary** row under Test Case ID, and `fill_template.py` fills it
  from the case's `title` - the same words as the Summary sheet's Title
  column - so a tester reading one sheet knows what it checks. Applies to
  workbooks built from now on; the existing ones are left as they are
  (rebuilding one would add the row but wipe any recorded execution
  results). `SKILL.md` says how to write the summary.
- Migration: none.

### 2026-10-10 — Kristen
- **Commit messages get their Jira key automatically** —
  `.githooks/prepare-commit-msg` puts the key from the branch name at the
  front of each commit message (`SPM-33: fix the readiness count`), so a
  commit stays linked to its ticket after the branch is merged and deleted.
  It skips branches with no key, messages that already have it, and merge,
  squash and amended commits, and it never blocks a commit. Switched on by
  `npm install`, like the pre-push hook - run it once after pulling.
  `contributing.md` section 3 updated. Existing commits are not rewritten.
- Migration: none.

### 2026-10-10 — Kayal
- **SPM-81 (Request More Than One Venue for an Event).** Week 7 Change #3.
  Most of it already worked: a request is checked against the one venue asked
  for, and the event's own bookings never count as a clash, so nothing
  stopped a second venue for the same event, session and times (SPM-42,
  SPM-44, SPM-93). No schema change, no new screen, no new route.
  - **The one rule that changed (AC4):** the same venue cannot be requested
    twice for the same EVENT at overlapping times, whichever session asks.
    Before, `findDuplicateRequest()` (`src/lib/venueConflict.ts`) also needed
    the same session, so two sessions could hold one room at the same time
    (SPM-44, PR #37). Sessions that only meet end to start may still follow
    each other in a room, and the event's own setup and turnaround still
    never get in its own way.
  - **Wording:** when another session holds the room the refusal reads "This
    event already has a pending request for … on …"; the same session asking
    twice is still named ("Day 1 already has …").
  - **Kept on purpose:** a request must still cover the event's (or
    session's) whole time. Change #3 and the story both say "at the same
    time"; a room needed for part of the day is a session.
  - **Where the bookings are shown together (AC6):** the Venue tab's "Booking
    requests" card and the Overview's "Venue" row, both unchanged.
  - **Not here:** per-space purpose, attendance and layout, and "every venue
    approved before confirming" are SPM-90 - until then an event with one
    approved and one pending venue can still be confirmed. Withdrawing or
    releasing one booking is SPM-67 (comment left there: its cases must check
    the event's other booking is unchanged). The equipment availability check
    still picks one venue per event for transfer time (`venueFor()`), which
    is undefined with two rooms - for the team to settle.
  - **Test data:** `npm run fixtures:spm81` (11 events, three SPM81 venues).
    The same venues and events are appended to `prisma/seed.ts`.
  - **Tests:** manual cases `docs/test-cases/SPM-81_Test_Cases.xlsx` (11),
    written before the code; all 11 passed when run by hand on 2026-10-11.
    Three automated tests that asserted "two sessions may share a room"
    now assert the new rule. No other story's test case relied on it.
  - Known Gaps: two new rows (confirming with a venue still pending,
    SPM-90; equipment transfer time with several venues).
- **BPMN and status lifecycle diagrams brought in line with the Week 7
  Customer Changes** (`docs/ConnectSphere_BPMN.drawio`,
  `docs/ConnectSphere_Status_Lifecycle.drawio`). Diagrams only; no code.
  - **#1 Setup and turnaround:** the venue search and Venue Staff's review
    say that availability and conflicts include setup and turnaround time.
  - **#2 Venue becomes unavailable:** the exception start reads "Venue
    retired, marked unavailable or attributes changed" (SPM-45's wording),
    and its "no longer suitable" end returns to venue search for a
    replacement.
  - **#3 Several venues for one event:** a new "Another venue needed?"
    gateway after a booking is approved loops back to venue search, so each
    venue is searched for, requested and decided on its own, and the venue
    branch joins only when every venue is approved.
  - **#4 Tentative holds expire:** a new start in "Changes and exceptions"
    (Venue Staff lane): hold expiry reached, the venue is released, the
    coordinator is notified, and the hold was never a booking.
  - **#5 Event Coordinator Lead:** the Event Operations Manager lane is
    renamed (#129), a submitted request enters the unassigned queue, and the
    Lead assigns (and can reassign) the coordinator, who is notified.
  - **#6 Operational Safety Check:** a new Safety Officer lane and a "Safety
    review" status band. "Arrangements complete?" now leads to "Submit event
    for Operational Safety Check", then the Safety Officer's check; approve
    goes on to "Confirm event", reject or request changes goes back to
    Planning. Everything from "Confirm event" rightwards moved 320 to the
    right and the exceptions section 160 down to make room.
  - **Lifecycle:** the Submitted to Under review arrow reads "Lead assigns",
    and a second notes block covers assignment and venues. The Safety review
    status itself was added by SPM-86.
- Migration: none.

### 2026-10-09 — Kayal
- **SPM-45 (Record Venue Unavailability): Venue Staff can mark a venue
  unavailable for a period** (Week 7 Change #2). The last missing piece of the
  unavailability work: the table, the calendar (SPM-46), venue search (SPM-40)
  and the booking checks (SPM-42, SPM-43, SPM-44) already read
  `VenueUnavailability`, but nothing in the app could write to it.
  - **In times, not slots.** The story was written before Week 7 and first
    built on AM / PM / Night slots (2026-10-06, never merged). It was reworded
    in Jira and rebuilt on the 15-minute grid (Week 7 Change #1, #126, #128;
    SPM-93): a period is stated as the date and time the venue becomes
    unavailable and the date and time it is available again, and stored
    exactly so (`periodInterval()`). Times off the grid are refused, the
    return must be later than the start, and the shortest period is 15
    minutes. A period is not limited to opening hours. One that is already
    over when it is saved or changed is refused ("This period is already
    over."): it would never be listed and could flag nothing. One that began
    in the past and is still under way is allowed.
  - **No schema change, no migration.** A period is a `VenueUnavailability`
    row. The venue stays active and in the catalogue - it is closed for the
    period only, which is what separates this from retiring.
  - **Routes.** `GET`/`POST /api/venues/[id]/unavailability` and
    `PATCH`/`DELETE /api/venues/[id]/unavailability/[periodId]`, all
    `venue:manage`. The body is `{ fromDay, fromTime, untilDay, untilTime,
    reason, otherReason? }`. GET lists only periods that are not over yet.
    DELETE is "end early": a period under way has its end brought forward to
    now, rounded down to the 15-minute grid (`endEarlyAt()`), and the row is
    kept so the calendar still shows the time it really covered; one that has
    not started (or began within the last 15 minutes) is deleted.
  - **Bookings in the period are flagged, never changed** (Week 7 Change #2;
    #120, #122), with the same candidates as SPM-39 - approved and not
    finished - and the same writes: `needsReview` and a notification to the
    assigned coordinator (type `booking_venue_unavailable`), which says
    alternative arrangements are needed. The reason code is
    `venue_unavailable`, kept apart from `venue_retired` because SPM-68 lists
    them separately. A booking counts when its occupied period - its times
    plus the venue's setup and turnaround (`occupiedWindow()`) - overlaps the
    unavailable period; periods that only meet end to start do not
    (`bookingInPeriod()`). Flagging is per booking, so an event with several
    venues (Week 7 Change #3) has only the booking at this venue flagged.
    Changing a period flags only the bookings it newly overlaps. **Nothing
    clears a flag** when a period is shortened or ended - that is the
    Coordinator's call in SPM-68.
  - **"Available again without any action" (AC4) is not a job.** A period that
    has passed simply no longer overlaps anything.
  - **Reason.** A picker is required: Week 7's list plus the Week 1
    briefing's "internal activities" (`UNAVAILABILITY_REASONS`).
    `equipment_failure` is a new stored value; the column is free text.
    Choosing **Other** asks for a typed reason, required, kept in the row's
    `notes`.
  - **Screen.** An "Unavailable periods" section on the venue editor (S-20)
    with "Mark unavailable", "Change period" and "End period"
    (`src/components/VenueUnavailablePeriods.tsx`) - not the separate Block
    venue page (S-23) UI_DESIGN.md sketched. Fields: Unavailable from, From
    time, Available again on, Available again at, Reason, Other reason. The
    editor's result banner reports what a period flagged, as it does for a
    save.
  - **Fixtures.** `npm run fixtures:spm45` (`scripts/seed-spm45.ts`): six
    dedicated "SPM45" rooms and nine bookings (one room with 30 min setup and
    45 min turnaround; one pending and one finished booking), mirrored at the
    end of `prisma/seed.ts`.
  - **Tests.** Test cases rewritten first, then the automated tests, then the
    code: `docs/test-cases/SPM-45_Test_Cases.xlsx` (19 cases, all 6 ACs; all 19
    passed when run by hand on 2026-10-10);
    `venueUnavailability.test.ts`, `venue-unavailability.test.ts` and the
    SPM-45 block of `venue-catalogue-pages.test.tsx`.
  - **Not done here:** the Coordinator's list of flagged bookings and the
    replacement-venue search (SPM-68); showing the notification (SPM-71).
  - Migration: none.

### 2026-10-09 — Sammi Chua (SPM-64, Configure Event Registration)
- **SPM-64 (Configure Event Registration): decisions before any code.** The
  assigned coordinator sets up attendee registration for an event: on or off,
  capacity, and an opening and closing date. Agreed with Sammi Chua,
  2026-10-09. Customer clarification numbers are in brackets.
  - **The story has 11 ACs.** The pasted draft's AC12 ("settings are changed
    only here, not in Update Event Information") is dropped. SPM-62's strict
    `updateEventInformationSchema` already refuses the registration fields.
  - **Order of work:** the Excel test cases (`docs/test-cases/SPM-64_*`) come
    first, then unit tests and code one slice at a time. There are no
    regression tests of existing behaviour, and each behaviour is tested once,
    at the lowest layer that shows it.
  - **Who:** only the assigned coordinator changes the settings
    (`canConfigureRegistration()` = `isAssignedCoordinator()`), and only while
    the event is Approved, Planning or Confirmed (`EVENT_INFORMATION_STATUSES`,
    the same window as SPM-62; Postponed is excluded). The organiser sees the
    settings read-only on the Overview. Everyone else gets 403, or 404 for an
    event they can't see. Route: `PATCH /api/events/[id]/registration`.
  - **Capacity:** a whole number of at least 1, no higher than the room's
    capacity **for the booking's layout** (`VenueLayout.capacity`, #112).
    `Venue.maxCapacity` is never used as a fallback. Pending and approved
    bookings count; rejected and cancelled ones don't. With no booking, or a
    booking with no layout, a capacity is refused with a field error.
  - **Several bookings (AC4, Week 7 change #3):** whenever an event has more
    than one pending or approved booking (multi-session events included), the
    coordinator picks the one the capacity is measured against. With one
    booking it's picked automatically. Stored in the new
    `Event.registrationVenueBookingId` (FK, `ON DELETE SET NULL`). The
    migration is not yet applied.
  - **Period (#30):** separate from the event date. Opening must be before
    closing (equal is refused), and closing may be no later than the event
    start (equal is allowed, matching SPM-62's guard on moving the start).
  - **Extend or reopen (#42, #127):** an ordinary edit of the dates, allowed
    even after the close date has passed, but refused once the event has
    started.
  - **Outstanding arrangement (AC8, #80):** registration setup is incomplete
    when registration is enabled and the capacity, the opening date or the
    closing date is missing, or the measured booking is no longer pending or
    approved. The last case covers an expired tentative hold (Week 7 change
    #4). An incomplete setup is a `registration` arrangement in
    `arrangementsFor()` (`src/lib/eventConfirmation.ts`), and it blocks
    Confirm Event. It is never a reason to refuse a save. A Confirmed event
    that becomes incomplete stays Confirmed (no revert).
  - **Flag, don't change (AC9):** lowering capacity below the number of
    registered and waitlisted attendees (`HOLDING_A_PLACE`), or disabling
    registration while anyone holds a place, sets
    `Event.registrationReviewReason` (`registration_capacity_lowered`,
    `registration_disabled`, merged through `addReviewReasons()`). Lowering to
    exactly that number is not flagged. Registration rows are never written.
    Clearing the flag is SPM-68's job.
  - **Disabling keeps the settings,** so turning registration back on restores
    them.
  - **Attendees keep seeing an event they hold a place in (#10):** a
    registered or waitlisted attendee still sees a Confirmed event after its
    registration is disabled. Withdrawn attendees don't. `canViewEvent()` and
    `eventListWhere()` change together.
  - **One capacity per event (#74):** per-session capacity is not built (see
    Known Gaps).
  - **Out of scope, judged against the discussions:** VIPs added over
    capacity (#99, #33) and the waiting list (#26, #44) belong to the
    attendee-side stories. There's no rule linking expected attendance to
    registration capacity (#119), and no derived "Open / Closed / Full" label
    (#127): the hub shows the raw settings. A capacity change doesn't re-run
    the Safety Officer check (Week 7 change #6, not built).
- **Screen wording settled** (every open question in
  `SPM-64_test_cases.json` is RESOLVED, so the workbook has no Open Questions
  sheet). The settings are edited on the existing Registration card on the
  Overview, behind a "Change registration settings" button. Two messages are
  reused from the event request form: "Enter a whole number, at least 1." and
  "Registration closes at must be after it opens.". Closing late is worded
  "Registration must close no later than the event starts.", because closing
  exactly at the start is allowed. The flag line follows SPM-62's format.
  Unlike the request form, **an empty capacity is not an error** (AC8 needs an
  incomplete setup to save), and **an attendee never sees which booking the
  capacity is measured against**: it stays off `ATTENDEE_EVENT_FIELDS`.
- **Test cases written first:** `docs/test-cases/SPM-64_Test_Cases.xlsx`
  (25 cases across AC1–AC11, each behaviour checked once; the role checks are
  only in TC23–TC25). The wording chosen for the screen and the fixture
  events needed (`npm run fixtures:spm64`, not built yet) are in the JSON's
  open questions. No code yet.
- **Slice 1 (AC1, AC11): turning registration on and off.** New
  `PATCH /api/events/[id]/registration` (`registrationEnabled` only for now),
  `canConfigureRegistration()` in `permissions.ts`, and
  `configureRegistrationSchema` (strict) in `validation/registrations.ts`.
  23 route tests in `src/app/api/__tests__/event-registration.test.ts`; that
  file is the only place the role checks are tested.
- **Slice 2 (AC2, AC3): capacity.** `registrationCapacity` on the same PATCH
  (a whole number of at least 1). New pure module `src/lib/registrationSettings.ts`:
  `liveBookings()` keeps pending and approved bookings, and `capacityError()`
  checks the capacity against the booked layout's `VenueLayout.capacity`, reusing
  `layoutLabel()` from `venueSuitability.ts`. A layout the room no longer offers
  counts the same as no layout. Bookings are read only when the capacity
  changes. 7 unit tests in `registrationSettings.test.ts`, plus 6 route tests.
- **Slice 3 (AC4): which booking the capacity is measured against.** New
  `Event.registrationVenueBookingId` (FK to `venue_bookings`, `ON DELETE SET
  NULL`). The PATCH takes `registrationVenueBookingId` and stores the measured
  booking whenever the capacity or the booking changes. `measuredBooking()`
  works like this:
  - the only active booking is used automatically;
  - a booking chosen earlier is kept while it's still active;
  - with several active bookings and none chosen, the save is refused with
    "Choose which venue booking the capacity is measured against.";
  - a chosen id that is rejected, cancelled or another event's is refused with
    "That venue booking isn't an active booking for this event." (only reachable
    through the API; the form lists active bookings only).

  Changing only the booking re-checks the saved capacity against the new room.
  `capacityError()` now takes the one chosen booking. The existing Event ↔
  VenueBooking relation is now named `EventVenueBookings`, as Prisma requires
  when two models are related twice; no database change and no code change.
  The unit tests are now 16 (the "no booking" check moved into
  `measuredBooking()`), with 4 more route tests.
- **Slice 4 (AC5, AC6): the registration period.** `registrationOpensAt` and
  `registrationClosesAt` on the same PATCH (ISO date-times). `periodErrors()`
  checks the period with what is sent applied over what is saved, so a new
  closing date is checked against the saved opening date. Closing at or
  before opening is refused ("Registration closes at must be after it
  opens."), and so is closing after the event's start ("Registration must
  close no later than the event starts."). Closing exactly at the start is
  allowed. An event with no start yet skips the start check. Either date can
  be saved alone (the setup is then incomplete, AC8). The event's own date is
  never written. 7 more unit tests, 3 more route tests.
- **Slice 5 (AC7): extend or reopen.** No separate action: moving the closing
  date later is an ordinary edit, allowed even after the old date has passed.
  `startedError()` refuses any change to the dates from the moment the event
  starts ("The event has started, so the registration period can't be
  changed.", under the date being changed). The capacity and the on/off switch
  are not covered by this rule. The route tests now fix the clock (9 Oct 2026),
  so they don't depend on the day they run. 4 more unit tests, 2 more route
  tests.
- **Slice 6 (AC9): flag, don't change.** A save that lowers the capacity below
  the attendees holding a place, or turns registration off while anyone holds
  one, writes `Event.registrationReviewReason`. The codes are
  `registration_capacity_lowered` and `registration_disabled`
  (`REGISTRATION_REASONS` in `registrationSettings.ts`), added through
  `addReviewReasons()`, so SPM-62's codes are kept. Attendees holding a place
  are counted with SPM-62's `HOLDING_A_PLACE` (now exported from
  `applyEventInformation.ts`), and only for a change that could take
  someone's place. Lowering to exactly that number flags nothing. The response's
  `flagged` holds one line in SPM-62's style, e.g. "Registrations: 15 attendees
  – the registration capacity was lowered below the number registered or
  waitlisted". No Registration row is ever written. 8 more unit tests, 4 more
  route tests.
- **Slice 7 (AC8): incomplete setup is outstanding and blocks confirmation.**
  `arrangementsFor()` (`src/lib/eventConfirmation.ts`) gains a third kind,
  `registration`, after the venue and equipment. It's required only while
  registration is enabled (a disabled one is listed with `required: false`),
  and complete once there is a capacity, an opening date and a closing date,
  and the measured booking is still pending or approved.
  - **Wording:** the confirm refusal reuses SPM-34's message: "…registration
    setup is incomplete (still needed: opening date, closing date)." or
    "…registration capacity is measured against a venue booking that is no
    longer active."
  - **Shared helper:** `registrationGaps()` is what the hub alert will show in
    Slice 8, so the two can't disagree. It reuses `liveBookings()`, so there's
    no second "active booking" list.
  - **Optional input:** `ConfirmationInput.registration` is optional, so other
    callers are unchanged. The confirm branch of `PATCH /api/events/[id]` now
    passes the settings and selects booking ids.
  - **Decided:** a capacity with *no* measured booking (e.g. one the organiser
    typed on the request form before any booking existed) isn't "lost", so it
    doesn't block. Only a stored booking that stopped being active does.

  8 more unit tests in `eventConfirmation.test.ts`, 1 more route test in
  `event-detail.test.ts`.
- **Slice 7b (#10): attendees keep seeing an event they hold a place in.**
  - **The rule:** a registered or waitlisted attendee still sees a Confirmed
    event after its registration is turned off. A withdrawn attendee doesn't,
    and an event that isn't Confirmed stays hidden.
  - **Where:** `canViewEvent()` takes an optional `attendeeHoldsPlace`, and
    `eventListWhere()` adds the matching `registrations: { some: … }` clause
    (the two stay in step). `GET /api/events/[id]` counts the attendee's place
    only for an attendee.
  - **Moved:** `HOLDING_A_PLACE` now lives in `registrationSettings.ts`
    (pure), because `permissions.ts` also runs in the browser.
    `applyEventInformation.ts` (SPM-62) imports it from there.
  - **Tests:** the `eventListWhere` attendee tests in `permissions.test.ts`
    and `events.test.ts` were updated on purpose, because the rule changed.
    3 more unit tests, 1 more route test.
- **Slice 8 (AC10, UI): the Registration card.** New
  `src/app/events/[id]/RegistrationCard.tsx` replaces the Overview's read-only
  Registration card.
  - **Read-only view, for everyone who can see the event:** Registration
    (Enabled / Not enabled for this event), then Capacity, Measured against
    (not shown to an attendee), Opens and Closes. Opens and Closes replace the
    old single "Window" row, so two attendee assertions in
    `event-pages.test.tsx` were updated on purpose.
  - **Outstanding alert:** "Registration setup is incomplete", built from the
    same `registrationGaps()` as the confirm refusal. Not shown to an attendee.
  - **The coordinator's form:** only the assigned coordinator, in Approved,
    Planning or Confirmed, gets "Change registration settings". The form sends
    only what changed, checks nothing itself (the server's messages show under
    their fields), and lists the "Flagged for review" lines after a save.
  - **Data:** `GET /api/events/[id]` now includes `registrationVenueBooking`
    (with its room's layouts), so the card names the measured booking without
    another request. A new `GET /api/events/[id]/registration` gives the form
    the active bookings, each with its layout capacity. It's asked for only
    when the form opens, and only the assigned coordinator may call it.
  - **Test cases corrected:** the app formats September as "Sept" (en-GB), so
    the SPM-64 test cases now say "30 Sept 2026".

  26 page tests in `src/app/__tests__/event-registration-pages.test.tsx`, plus
  3 route tests for the GET and 1 for the include.
- **Final step: fixtures, a form fix and the test cases re-checked.**
  - **Fixtures:** `npm run fixtures:spm64` (`scripts/seed-spm64.ts`) adds or
    resets the 12 "SPM64 …" events, mirrored at the end of `prisma/seed.ts`.
    Their rooms and dates were checked free on the shared database first:
    Orchard Data Forum is on 18 Mar 2027 (SPM62 Harbour Leadership Summit holds
    Orchard Seminar Room on the 17th), and Attendee Open Day is on 13 May 2027
    (SPM34 Partially Fulfilled holds it on the 12th).
  - **Form fix:** when the measured booking was lost and one active booking
    remains, the form now preselects that booking, so pressing Save
    re-measures against it. Without this, TC18's Save sent nothing and the
    setup stayed incomplete. Found while writing the fixture, and covered by
    a page test (27 page tests in total).
  - **Checked on the real database:** the server side of every manual case was
    run against the fixtures through the running app's API, all 29 checks as
    expected. Each save stored its reason code, and no Registration row
    changed. The fixtures were reset afterwards.
  - **Test cases corrected:** dates moved to 18 Mar and 13 May as above, the
    rejected room is Marina Grand Hall (no "Marina Bay Ballroom" is seeded),
    and TC01 lists the "Measured against" row and the incomplete-setup alert.
    `code_references` are filled in. No "Code" cases were added: everything
    built traces to an AC case.
  - **Not yet done:** nobody has clicked through the cases in a browser.
- **Slow-machine timeouts are not failures.** On a busy laptop (OneDrive
  syncing the repo, back-to-back runs), `npm test` timed out at random in the
  page tests and `auth.test.ts`. That happened on `main` without SPM-64's
  changes too. `npx vitest run --maxWorkers=2` passes everything.
- Migration: `20261009120000_add_registration_venue_booking`, written by hand
  and checked against `prisma migrate diff` (identical SQL). Applied to the
  shared Neon database on 2026-10-09 with `npx prisma migrate deploy` (no reset,
  no reseed; one nullable column, so existing rows and other branches are
  unaffected). After pulling, run `npx prisma generate`.

### 2026-10-09 — Janelle
- **SPM-86 (Submit Event for Operational Safety Check).** Week 7 Change #6:
  the assigned coordinator submits an event in Planning for the Safety
  Officer's Operational Safety Check once its arrangements are in place.
  - **New status `safety_review` ("Safety review").** Planning → Safety review
    (this story); Safety review → Planning (the Safety Officer's decision,
    SPM-87, or a significant change, SPM-88) or → Cancelled (decided
    2026-10-09). Not → Confirmed and not → Postponed. Added to the lifecycle
    diagram (`docs/ConnectSphere_Status_Lifecycle.drawio`).
  - **New route:** `POST /api/events/[id]/safety-check` - 401 / 404 / 403 /
    400 in the usual order. Refuses: a check already pending ("A safety check
    is already pending for this event."), an event not in Planning, and
    arrangements that are not ready, naming each (`{ error, outstanding }`).
    In one transaction: the event moves to Safety review (re-checked with
    `updateMany`, so two tabs cannot both submit), a `SafetyCheck` row records
    who and when, the status history gets a row, and every active
    `safety_officer` is notified.
  - **The rule** (pure, `src/lib/safetyCheck.ts`): Confirm event's
    `arrangementsFor()` - an approved venue per session, recorded equipment
    Reserved or Partially fulfilled (decided 2026-10-09, so Submit and Confirm
    never disagree) - plus no held booking or equipment flagged for review
    (SPM-39's and SPM-62's flags, worded with their reasons).
  - **Screens:** a "Submit for safety check" button on the Overview for the
    assigned coordinator in Planning, with a "Submit for safety check?"
    dialog; a "Safety check" row under Status in Details ("Awaiting review ·
    submitted by Daniel Tan, 9 Oct 2026, 14:30") for staff only - the organiser
    sees the Safety review status, not who submitted it (SPM-88: safety
    details are internal). A "Safety review" list on the organiser's and
    coordinator's Dashboard; Safety review in Venue Staff's and Technical
    Support's "Upcoming events" and in the All Events / My Events status filter.
  - **Changed outside this story (additive):** `GET /api/events/[id]` returns
    `safetyCheck` to internal users (Kristen's events route); the status PATCH
    accepts and then refuses `safety_review`; Technical Support keep seeing an
    event's equipment in Safety review (`TECH_SUPPORT_EQUIPMENT_STATUSES`) but
    cannot reserve or update it, with its own message; the Ops Manager can
    still reassign the coordinator (`REASSIGNABLE_STATUSES`). Two expectations
    in `lists.test.ts` were updated for the last two.
  - **Migration:** `20261009120000_add_safety_check` - new table
    `safety_checks` (one row per submission; the decision columns are for
    SPM-87). No existing table changes.
  - **Test data:** `npm run fixtures:spm86` (8 events, late July 2027). The
    same events are appended to `prisma/seed.ts`.
  - **Tests:** written first, then the code to them. New:
    `safetyCheck.test.ts`, `event-safety-check.test.ts`; extended:
    `statuses.test.ts`, `permissions.test.ts`, `equipmentAvailability.test.ts`,
    `event-pages.test.tsx`, `list-pages.test.tsx`. Manual cases:
    `docs/test-cases/SPM-86_Test_Cases.xlsx` (13; TC12 is Blocked until SPM-33
    adds "not required", TC13 until SPM-85 and SPM-71 let a Safety Officer
    see the notification).
  - **Docs:** `docs/PERMISSIONS.md`, `SCHEMA_REFERENCE.md`, `UI_DESIGN.md`.
    Known Gaps: four new rows (Safety Officer role, changes during Safety
    review, confirm not yet gated, cancelling), and the review-flag and
    notifications rows updated.

### 2026-10-08 — Kayal
- **SPM-93 (Book Venues in 15-Minute Units).** Week 7 Change #1, #126 and
  #128 replace the AM / PM / Night slots with times on a 15-minute grid, and
  make setup and turnaround real durations. No schema change: bookings,
  holds and unavailable periods always stored real times; the slots only
  lived in `src/lib/venueSlots.ts`, now replaced by `src/lib/venueTime.ts`.
  - **The rule** (AC6, AC7): a booking occupies the room from its start minus
    the venue's setup to its end plus its turnaround (`occupiedWindow()`), and
    two bookings clash when those periods overlap - meeting end to start is
    fine. Used by the request (SPM-42), approval (SPM-43), venue search
    (SPM-40) and the calendar (SPM-46). A pending request holds its setup and
    turnaround too (decided 2026-10-08, from #41 and Week 7 Change #1).
  - **Request form (S-15)**: Date, Start time, End time instead of slot
    checkboxes, defaulting to the event's or session's times widened to the
    grid (`defaultTimes()`); off-grid or inverted times are named under their
    field (AC3); the setup, turnaround and room-in-use times are shown. The
    room-in-use period must fit the opening hours (AC4 - decided 2026-10-08;
    our question #131 is still open). `POST /api/events/[id]/venue-bookings`
    takes `startTime`/`endTime` and returns `{ error, field }` for a refused time.
  - **Booking Requests (S-22)** show the times, setup, turnaround and room in
    use, in the card, the approve dialog and the conflict message (AC8).
  - **Calendar (S-21)**: one row per day listing Setup / Booked / Requested /
    Turnaround / Unavailable entries at their actual times (AC9). The response
    has `days[].entries` instead of `days[].slots`.
  - **Venue form**: "Setup time (minutes)" and "Turnaround time (minutes)", in
    15-minute steps, zero included (AC5), checked on screen and by the API.
    `scripts/spm93-round-turnaround.ts` rounds venues saved before this up
    (CBP-MTG1 and CBP-MTG2 had 20 min of setup; `prisma/seed.ts` now says 30)
    and lists bookings that then clash - flagging them is SPM-80.
  - **Seed**: SPM93 venues and events added at the end of `prisma/seed.ts`;
    `EventSeed` gained an optional `startMinute`, and event durations are
    rounded to the millisecond (no existing event moves).
  - **SPM-44's conflict module, in times.** `src/lib/venueConflict.ts` stays
    the one place that decides a clash and says what it is with; it now
    reports the minutes both need ("…is already booked for EVT-… Title on
    8 Jun 2027, 09:30–09:45.") instead of shared slot cells, and a pending
    request holds its setup and turnaround too. Its tests were rewritten for
    times; SPM-44's own test cases still quote slot wording - for its owner.
  - Test cases: `docs/test-cases/SPM-93_Test_Cases.xlsx` (17), written before
    the code; all 17 passed when run by hand. SPM-42, SPM-43 and SPM-46 are Done and not reopened: SPM-93 is
    the new story for the change (Week 7 guide, scenario 2).

### 2026-10-09 — Kristen
- **SPM-33 (Track Outstanding Arrangements).** A coordinator can see
  everything that has to be in place before an event is confirmed, and
  the assigned one can mark an arrangement as not required.
  - **New screen:** the Readiness tab (`/events/[id]/readiness`, S-18),
    coordinators only. One item per venue booking, equipment line and
    (where enabled) the registration setup, each Complete, Outstanding or
    Not required, with a count of what still blocks confirmation.
  - **New route:** `GET` / `PATCH /api/events/[id]/arrangements`. PATCH
    marks one arrangement as not required or as required again: the
    assigned coordinator only, in Planning only, and only an outstanding
    one. Who decided and when is stored and shown (briefing 8f, #14).
  - **One rule for the list and for Confirm**
    (`src/lib/eventConfirmation.ts`): each booking is judged on its own,
    so an event with several (SPM-81) lists them separately; an event or
    session with no booking still required shows "No venue booked", which
    can never be waived. `src/lib/eventArrangements.ts` reads the rows for
    both callers.
  - **Confirm is stricter** (decided 2026-10-08). It now also refuses on
    a flagged booking or equipment line and on registration that is enabled
    but incomplete - until the coordinator marks it as not required (#90,
    #106). A pending booking is named in the refusal. Partially fulfilled
    equipment still counts as held: SPM-86's rule (decided 2026-10-09), which
    SPM-33 follows since the merge on 2026-10-10, so Submit and Confirm agree.
    Submit for safety check (`src/lib/safetyCheck.ts`) in turn leaves out
    anything marked as not required.
  - **Not here, on purpose:** the Operational Safety Check (AC6, AC9)
    waits for SPM-86; clearing a flag is SPM-68; registration settings
    are SPM-64. See Known Gaps.
- **Migration:** `20261010100000_add_arrangement_not_required` -
  `not_required` / `not_required_by` / `not_required_at` on
  `venue_bookings` and `equipment_requests`, and
  `registration_not_required` (+ `_by`, `_at`) on `events`. Additive.
  Applied to the shared Neon database on 2026-10-10.
- **Test data:** `npm run fixtures:spm33` (11 events), appended to
  `prisma/seed.ts`. Not yet run.
- **Tests:** written first, then the code to them. 2,764 tests pass. New:
  `event-arrangements.test.ts`, `event-readiness-page.test.tsx`; extended:
  `eventConfirmation.test.ts`, `event-detail.test.ts`, `statuses.test.ts`,
  `client.test.tsx`, `event-pages.test.tsx`. Manual cases:
  `docs/test-cases/SPM-33_Test_Cases.xlsx` (14), not yet walked through
  the running app.
- **Docs:** `docs/PERMISSIONS.md` (the two routes), `SCHEMA_REFERENCE.md`
  (the new columns), `UI_DESIGN.md` (S-18 built).

### 2026-10-06 — Jordan
- **SPM-44 review fixes (PR #37, raised by kayalvizhi24).** Both gaps predate
  SPM-44 (they came with SPM-42's request route); neither allowed an actual
  double booking, because approval was already locked.
- **A repeat request is refused.** `findVenueConflict()` exempts the
  requesting event's own bookings, so two sessions of one event can share a
  room — but that also let one event submit the same request twice and get two
  pending rows. `findDuplicateRequest()` in `src/lib/venueConflict.ts` refuses
  the same event and session asking again for overlapping slots at the same
  venue while the first is pending or approved: "This event already has a
  pending request for … on 5 Apr 2027 · AM (07:00–12:00)." The exemption
  stays. `SearchBooking` gained an optional `sessionId`, and
  `checkVenueBookingRequest()` now takes the request's `sessionId`.
- **Requests made at the same moment.** `POST /api/events/[id]/venue-bookings`
  read the venue and ran the check before its transaction, so two coordinators
  could both pass before either row was written. It now takes
  `SELECT … FOR UPDATE` on the venue row inside the transaction, then reads
  the bookings, checks and creates — the same lock the approval route
  (`PATCH /api/venue-bookings/[id]`) already takes. No rule or wording changed.
- **SPM-44's room, bookings and maintenance period are in `prisma/seed.ts`.**
  They existed only in `scripts/seed-spm44.ts`, so after a full reseed the
  conflict cases had nothing to collide with. SPM44-PLN is now in `venueData`
  beside SPM-42's and SPM-43's rooms, and the holder bookings and the AC8
  block are created after SPM-43's bookings. No event's EVT- reference moves.
- SPM-44-TC03 now submits the repeat request instead of only checking that the
  button is shown.
- Migration: none.

### 2026-10-06 — Kristen
- **SPM-62 (Update Event Information).** The assigned coordinator can change
  an event's information after approval, and a change that affects existing
  arrangements flags them for review instead of changing them.
  - **New screen:** Edit event information (`/events/[id]/update`), from an
    "Edit event information" button on the Overview (assigned coordinator;
    Approved, Planning or Confirmed). Same labels and messages as the draft
    form. As the form is edited, an amber "These changes affect existing
    arrangements" alert names the important changes. A Confirmed event asks
    "Move this event back to Planning?" first. After saving, the page shows
    what was flagged, with a "Back to event" link.
  - **New route:** `PATCH /api/events/[id]/information` — only what changed,
    strict schema, 401 / 404 / 403 / 400 as the endpoint pattern. Refuses a
    start before registration closes, and schedule changes on a multi-session
    event.
  - **Rules** (pure, `src/lib/eventChangeImpact.ts`): date or time flags venue
    bookings, equipment and registrations; attendance and venue requirements
    flag venue bookings only; a Confirmed event reverts when a venue booking
    or equipment request is flagged. Writing them is
    `src/lib/applyEventInformation.ts`, which SPM-32 will reuse.
  - **Equipment tab:** adding, saving or removing equipment on a Confirmed
    event asks first, then moves it back to Planning. The equipment routes
    return `confirmationReverted`.
  - **Not here, on purpose** (overlap check against open Jira stories,
    2026-10-05): registration settings (SPM-64), notifications (SPM-53),
    reviewing and clearing flags (SPM-68), a changed reservation going back
    to Technical Support (SPM-69). Jira updated for SPM-32, SPM-62, SPM-64,
    SPM-68, SPM-69 and SPM-75.
- **Fixed (review on PR #40):** a venue edit (SPM-39) dropped review reasons
  it did not recognise, so it wiped an event-change reason SPM-62 had put on
  the same booking. Every writer of a `reviewReason` column now adds through
  `addReviewReasons()` (`src/lib/reviewFlags.ts`), which keeps all codes.
- **Migration:** `20261005120000_add_event_change_review_flags` —
  `equipment_requests.needs_review` / `review_reason` / `flagged_at` (+ index)
  and `events.registration_review_reason`. Applied to the shared Neon database
  on 2026-10-05.
- **Test data:** `npm run fixtures:spm62` (9 events). The same events are
  appended to `prisma/seed.ts`.
- **Tests:** written first, then the code to them. 2,558 tests pass. New:
  `eventChangeImpact.test.ts`, `event-information.test.ts`,
  `event-information-pages.test.tsx`; extended: `event-equipment.test.ts`,
  `equipment-pages.test.tsx`, `event-pages.test.tsx`. Manual cases:
  `docs/test-cases/SPM-62_Test_Cases.xlsx` (20), walked through the running
  app on 2026-10-05.
- **Docs:** `docs/PERMISSIONS.md` (the route), `SCHEMA_REFERENCE.md` (the new
  columns, and the event reason codes sharing `VenueBooking.reviewReason`),
  `UI_DESIGN.md` (implementation status). Known Gaps: review-flag gap widened
  (owner SPM-68), quantity re-check now SPM-69's, two new rows
  (notifications, session edits).

### 2026-10-04 — Jordan
- **SPM-43 merged into SPM-44, and the duplicated conflict rule is gone.**
  `approvalConflict()` in `src/lib/venueBookingReview.ts` carried a second copy
  of the confirm-time rule, with a comment saying it should call SPM-44's
  `checkVenueBookingApproval()` once that branch landed. It now calls
  `findVenueConflict()` with `scope: "approved"`, so a rival PENDING request
  still does not block a decision. Its wording is unchanged: Venue Staff read
  "This overlaps an approved booking: …", a coordinator making a request reads
  "the room is already booked" — the rule is shared, the sentence belongs to
  the screen. SPM-43's own tests pass unmodified.
- `findVenueConflict()` now takes **`ConflictVenue`** — name, turnaround,
  bookings, unavailability — rather than `SearchableVenue`, which also carries
  layouts, facilities and opening hours the rule never reads. That is what
  lets the review side call it. `SearchableVenue` satisfies it structurally,
  so the search and request callers are untouched.
- **SPM-44 AC6 is no longer blocked.** SPM-44-TC10 runs against the real
  Booking Requests screen: a pending request whose slot an approved booking
  holds shows a **Conflict** chip, names the booking in the way, and its
  Approve button is disabled. Its fixture pair is seeded rather than made
  through the app, because the request-time check refuses the second request —
  it is the state Venue Staff inherit when two requests arrive for one slot.
- **`checkVenueBookingApproval()` removed.** It was written before SPM-43
  existed, for that story to call; SPM-43's `approvalConflict()` calls
  `findVenueConflict()` directly instead, so nothing in the app used it. Its
  three unit tests now exercise `findVenueConflict()` with the approval scope.
- **SPM-44's events moved to the end of `prisma/seed.ts`,** after SPM-43's.
  They had been pushed before the SPM-54 block, which would have moved
  SPM-54's pinned EVT-000145 to EVT-000154 (and every later fixture's
  reference) by 16 on a full reseed. No data changed.
- Two Excel lock files (`~$SPM-44…`, `~$SPM-50…`) had been committed by
  accident and are now untracked; `~$*` added to `.gitignore`.
- Migration: none (SPM-43's `add_venue_booking_suggestion` was already applied).

### 2026-10-04 — Kristen
- **Tests brought up to date with `main`** (SPM-27, SPM-34, SPM-43, SPM-50,
  SPM-54). 2,363 tests in 53 files; coverage 99.5% statements / 97.4%
  branches, above the CI minimums. No application code changed.
  - New route tests: `venue-booking-review.test.ts` (Venue Staff's list and
    approve/reject), `event-planning-fulfilment.test.ts` (begin planning,
    Technical Support's fulfilment update).
  - Updated route tests for the enforced lifecycle, withdrawal, confirmation,
    `planningStarted`, and Technical Support seeing equipment only from
    Planning on.
  - UI tests rewritten for the redesigned Dashboard (one list per stage, top
    five) and Booking Requests (approve / reject cards), and extended for the
    "Begin planning?" question, Record withdrawal, Confirm event, the Venue
    row, rejected-booking details and the equipment Update panel.
- **`prisma/seed.ts` repaired** — the SPM-34 merge left an `eventData.push(`
  unclosed, so lint failed with `')' expected` and the pre-push hook blocked
  every push. The same break is on `main` (PR #36).
- **Found while testing, not fixed** (tests do not lock these in):
  - A postponed event cannot be resumed. `EVENT_TRANSITIONS` allows
    postponed → approved, but `PATCH /api/events/[id]` refuses every
    `approved` that is not from Under review ("Only a request that is under
    review can be approved or rejected").
  - Every `ConfirmDialog` uses the same `id="confirm-dialog-title"`. Pages
    with two or three dialogs (event overview, event equipment) therefore
    announce each one to a screen reader under the first dialog's title.
  - The organiser and coordinator dashboards show a load failure once per
    list - four identical alerts and Retry buttons for an organiser.
  - An organiser's Submitted request is on none of their dashboard lists
    (Drafts, Under review, Approved, Planning) until a coordinator is
    assigned.

### 2026-10-02 — Kristen
- **CI pipeline added** — `.github/workflows/ci.yml`, GitHub Actions. Runs on
  every pull request and on each push to `main`; five checks in parallel:
  - **Lint** (`npm run lint`), **Type-check** (`npx tsc --noEmit`),
    **Unit tests** (`npm run test:coverage`).
  - **Build** (`npm run build`). Sets a placeholder `JWT_SECRET`, because
    `src/lib/auth.ts` throws at import time without one and the build imports
    every route. No `DATABASE_URL` is needed — the build never connects.
  - **Migrations** — `prisma validate`, then `prisma migrate deploy` against a
    Postgres container that exists only for that job, so a migration that
    does not apply cleanly to an empty database fails the PR.
  - No secrets, no deploy step, and the shared Neon database is never touched.
- **Fixed `prisma/seed.ts`, which did not parse.** The merge of `main` into
  SPM-28 (`27f8a74`) dropped the `);` closing the SPM-28 `eventData.push(` and
  the opening rule of the SPM-42 comment block, so `npm run lint`,
  `tsc --noEmit` and `npx prisma db seed` all failed on `main`. Restored both
  lines; no seed data changed. This is the kind of break the pipeline now
  catches before merge.
- **Coverage reporting added.** New dev dependency `@vitest/coverage-v8`
  (pinned to `5.0.0` — it must match the `vitest` version exactly, so bump the
  two together) and a `npm run test:coverage` script. Every file under `src/`
  counts, tested or not. Locally it prints a table and writes
  `coverage/index.html` (gitignored); in CI the table is in the Unit tests log
  and the HTML report is attached to the run as `coverage-report`.
  - Report only at first; a minimum was added later the same day (see
    "Coverage minimum" below).
  - First measurement: **25% of statements overall**. `src/lib/validation`
    100%, `src/lib` 81%; the API routes, pages and components were at 0%
    because nothing tested them.
- **API route tests added — all 24 `route.ts` files**, plus `src/lib/apiAuth.ts`.
  550 new tests (580 -> 1130); coverage is now **46% overall, 99.6% of the
  API routes, 88% of `src/lib`**. Pages and components are still at 0%.
  - Tests live in `src/app/api/__tests__/`, one file per group of routes.
    Each calls the exported handler directly - no server, no database.
  - Only Prisma is faked (`src/lib/__mocks__/prisma.ts`, switched on by
    `vi.mock("@/lib/prisma")` at the top of a test file). Sessions,
    permissions and Zod validation are the real code, so a test fails if a
    route stops refusing what it should.
  - `src/test/kit.ts` is the shared setup: `signIn(user("coordinator"))`
    returns a real session token, `req()` builds the request, `db` is the
    mocked client. Copy any existing test file to start a new one.
  - `vitest.config.mts` sets a test-only `JWT_SECRET`, which `src/lib/auth.ts`
    needs at import time.
  - Two things the tests could not reach, both left as they are:
    `api/registrations/route.ts` lines 35-40 (the "not open for registration
    yet" / "not enabled" messages - `canViewEvent()` already answers 404 for
    those events, so an attendee never gets that far) and the defensive
    `if (!booking) continue` in `api/venues/[id]/route.ts`.
  - `eslint.config.mjs` now ignores `coverage/`, so `npm run lint` does not
    lint the generated report.
- **UI tests added — every page and component.** 827 more tests (1130 ->
  1957); coverage is now **99.5% of statements overall** (routes 99.6%,
  `src/lib` 99.3%, pages 99.7%, components 99.3%). The full suite takes about
  40 seconds.
  - New dev dependencies: `@testing-library/react`, `@testing-library/dom`,
    `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`.
  - Tests live in `src/app/__tests__/` (pages) and `src/components/__tests__/`.
    A UI test file starts with `// @vitest-environment jsdom`, renders the
    real page, and drives it by its labels, buttons and text.
  - `src/test/ui.tsx` is the shared setup: `mockApi({ "GET /api/queue": [] })`
    fakes the network (a request with no route fails the test),
    `signedInAs("coordinator")` signs a role in, `router` and `setRoute()`
    stand in for `next/navigation` (`src/test/navigation.ts`, aliased in
    `vitest.config.mts`). Copy any existing test file to start a new one.
  - The two event forms (new request, edit draft) share one set of tests run
    against both, so they cannot drift apart unnoticed.
  - What these tests are not: they do not start the app or touch a database.
    A page test proves the screen behaves given an API answer; a route test
    proves the API answers given database rows. Nothing yet checks the two
    together end to end.
  - Found while writing them, left unchanged:
    - Venue search (`venues/search/page.tsx`): after a search fails outright
      (a 500), Retry reloads the page's data and clears the filters, because
      the failure also discards the previous results. After a refusal (403 /
      404) it repeats the same search, as intended.
    - Venue search: the attendance box is a native number input with `min=1`
      and the form does not set `noValidate`, so the browser blocks 0 or a
      fraction before the page's own "Enter a whole number of people" message
      can show.
    - Booking request (`events/[id]/booking/new`): opened with no `?venue=`,
      it requests `/api/venues/null` and shows "This event or venue could not
      be found" rather than its own "Choose a venue ... first" message.
    - Venue availability: the venue list is requested before a 403 on the
      calendar arrives, so a refused role still triggers one `/api/venues`
      call (which the server also refuses).
- **Pre-push hook added** — `.githooks/pre-push` runs `npm run lint` and
  `npm test` before every `git push`. A lint failure cancels the push.
  Failing tests are listed but do not: the team works test-first, so a
  branch is expected to have failing tests until its code is written, and
  CI is what stops those reaching `main`. Switched on by `npm install` (the
  `prepare` script). Skip it in an emergency with `git push --no-verify`.
- **Test-first workflow** — `/generate-test-cases <KEY>` (and
  `/write-unit-tests <KEY>` on its own) now work before the code exists:
  they write the manual cases and failing automated tests from the
  acceptance criteria and the design documents, with a "contract" comment
  in each test file listing what has to be built. Run again once the code
  is written to check the tests and fill gaps. See `contributing.md`,
  "Tests come first".
- **Coverage minimum** — `npm run test:coverage` now fails below 95%
  statements / lines / functions and 92% branches (`vitest.config.mts`), so
  the CI Unit tests check goes red when code is added without tests.
- **`.claude/settings.json` added** — lets Claude Code run the test, lint,
  type-check and read-only git commands the two test commands use without
  asking each time. Nothing that writes or pushes is on the list.
- Not included yet: marking the checks as required in the repo's branch
  protection settings.
### 2026-10-03 — Jordan
- **SPM-34 (Confirm Event): an event can only be confirmed once the
  arrangements it actually needs are in place (#80).** The rule is
  `src/lib/eventConfirmation.ts`, pure and unit tested (15 tests); the PATCH
  status route calls it for `confirmed` and returns the outstanding list, and
  the event hub gained a **Confirm event** button and dialog for the assigned
  coordinator.
- **What counts as required is DERIVED, not stored.** A venue is always
  required — per session for a multi-session event — and equipment only where
  the coordinator recorded a requirement. AC2's "marked as not required"
  belongs to Track Outstanding Arrangements, which is not built; when it lands
  it should set `required: false` in that module rather than add a second rule.
- **Complete means approved and reserved.** A pending venue request is not an
  arrangement, and the refusal says so in different words from having no venue
  at all. Equipment counts as arranged at `reserved` or `partially_fulfilled` —
  the same statuses that take stock from other events.
- **The organiser can now see WHICH room.** `GET /api/events/[id]` returns the
  approved bookings and the Overview shows a Venue row, because the Venue tab
  is the coordinator's planning screen and is not offered to an organiser —
  before this they could see an event was Confirmed but never where it was.
  `EventGlance` showed a hardcoded "Not booked yet" with a comment saying venue
  booking was not built; it is, since SPM-42, so it reads the real value now.
- **Fixed two breaks already on this branch**, neither related to SPM-34:
  `src/lib/__tests__/statuses.test.ts` was missing a comma in its import list,
  so the whole file failed to transform and 16 tests never ran; and
  `prisma/seed.ts` had an `eventData.push(` for the SPM-28 fixtures that was
  never closed, so the file did not compile and `npx prisma db seed` would have
  failed. Same class of merge artefact as the one fixed on 2026-10-02.
- `npm run fixtures:spm34` adds SPM-34's 8 events and their arrangements
  without reseeding.
- Migration: none.
### 2026-10-03 — Kayal
- **Merged main (SPM-54, SPM-27) into SPM-43.** Both sides kept. In
  `prisma/seed.ts` the SPM-43 events now come after SPM-54 and SPM-27, so
  SPM-54 keeps EVT-000145 to EVT-000154. Fixed two things that did not
  compile on main: the SPM-54 `eventData.push(` in `prisma/seed.ts` was never
  closed, and `statuses.test.ts` was missing a comma in its import.
- **Merged main again (SPM-50).** Both sides kept. In `prisma/seed.ts` the
  SPM-43 events now come last, after SPM-50's block, which asks for new events
  to be added after it; nothing before them moves.
- **A booking request is not shown to Venue Staff, and cannot be approved,
  while its event is Submitted or Under review.** SPM-54 already stops such a
  request being made; this covers ones that exist from before.
  `GET /api/venue-bookings` leaves them out of Booking Requests until the
  event is approved (decided 2026-10-03: a card nobody can approve is noise),
  and `checkBookingDecision()` refuses the approval as a backstop
  (`awaitingEventApproval()` in `src/lib/venueBookingReview.ts`). The request
  still holds its slot against other requests meanwhile. SPM-43-TC15, on the
  new fixture event "SPM43 Policy Briefing" (`spm43_under_review`).
- **SPM-43 test cases: three boundary cases now** (16 cases). New TC16, the
  other side of TC05: a request in the first slot clear of an approved
  booking's turnaround is not in conflict (new fixture event "SPM43 Alumni
  Lecture", `spm43_after_turnaround`, Marina Auditorium 8 May 2027 PM). TC07
  (blank or spaces-only reason) is relabelled Boundary. 14 SPM-43 fixture
  events now.
- **Base seed: two pending requests for events that are not approved yet are
  gone** from `prisma/seed.ts`, for the same reason — "Straits Medical Journal
  Club" (Under review) at Changi Meeting Room 1, and "Nusantara Developer
  Summit" (Submitted) at Orchard Seminar Room. Hidden from Booking Requests,
  they would have held their rooms with nobody able to clear them.
  `scripts/remove-pre-approval-bookings.ts` removes the copies in a database
  seeded earlier — no reseed; it shows the rows and changes nothing unless run
  with `--apply`. **Already run on the shared database (2026-10-03)**; only
  needed again on your own Neon branch. No test case in any story used either
  request.
- **Kept**: the summit's *rejected* request at Marina Auditorium (1 Nov 2026).
  SPM-46-TC13 uses it, and it carries the seed's one suggested-venue example.
- **"SPM43 Two-Day Forum" now starts as Planning, not Approved** (fixture
  script, seed and SPM-43-TC02): since SPM-54 an event with a booking request
  has always begun planning, so every SPM-43 fixture request now belongs to a
  Planning event (or the cancelled / under-review ones kept for TC06 and
  TC15).
- **SPM-43 fixtures re-run on the shared database** (`npm run
  fixtures:spm43`): the 12 existing events keep their EVT- references and
  "SPM43 Policy Briefing" was added at the end. SPM-28's and SPM-54's pinned
  references are unchanged.

### 2026-10-02 — Jordan
- **SPM-44 (Booking Conflict Detection): the conflict rules moved into one
  module, `src/lib/venueConflict.ts`, and now say WHAT is in the way.**
  `findVenueConflict()` returns the clashing booking or unavailability period
  and the slots actually contested, and `describeVenueConflict()` turns that
  into the message a coordinator reads. `occupancyConflict()` in
  `venueSearch.ts` now delegates to it, so the search screen and the booking
  check can no longer disagree about whether a room is free.
- **Refusal wording changed (AC9).** "Marina Auditorium is already booked for
  this time." is now "… is already booked for EVT-000042 Product Showcase on
  21 Oct 2026, AM–PM." Unavailability gives its reason and the whole closure,
  not just the slot asked for. **SPM-42's recorded test cases (TC14, TC15)
  still quote the old wording** — their unit tests were updated, the workbook
  was not, because that is Sammi's to re-record.
- **Confirm-time checking is written but has no caller.**
  `checkVenueBookingApproval()` enforces AC6 and differs from request time in
  one way that matters: a rival *pending* request must not block a
  confirmation, because approving one request is how Venue Staff choose
  between two. Whoever builds SPM-43 should call it rather than write the rule
  again. SPM-44-TC10 is recorded Blocked until then.
- `overlapping()` and `NO_TURNAROUND` moved from `venueSearch.ts` to
  `venueSlots.ts`, where `Interval` and `Turnaround` already live, so two
  modules can share them without a cycle.
- **Fixed a merge artefact in `prisma/seed.ts`:** the `eventData.push(` opened
  for the SPM-28 fixtures was never closed, so the file did not compile and
  `npx prisma db seed` would have failed. One `);` added; no data changed.
- **Boundary coverage.** Two unit tests pin the half-open overlap rule at a
  slot edge (a block filling AM exactly does not reach PM) and the dead time
  between slots (12:00-13:00 belongs to no slot, so a booking inside one blocks
  nothing). SPM-44-TC11 walks the day-crossing case by hand: a Night booking's
  turnaround takes the NEXT morning's AM (#123), and the refusal spans both
  days.
- `npm run fixtures:spm44` adds SPM-44's 14 events, the SPM44-PLN test room
  and one unavailability period, without reseeding.

---

### 2026-10-02 — Kayal
- **SPM-43 (Review Venue Booking Request): built end to end.** Venue Staff
  decide the pending requests on **Booking Requests** (`/bookings`, S-22) —
  the BPMN's "Review booking & check conflicts" and the gateway after it.
  - **The list** shows each request as a card: venue, date and slots (with
    its setup and turnaround slots), the event's reference, title, client
    and status, and the session's own time, attendance and layout where the
    request is for one. A request that could not be approved because the room
    is taken or unavailable carries a **Conflict** flag naming what is in the
    way, a link to the calendar, and a disabled Approve.
  - **Approve** (confirm dialog) makes the request `approved` — that *is*
    the booking: the calendar (SPM-46) shows its slots Booked and conflict
    detection blocks on it. The event's status does not change; confirming
    the event stays the coordinator's step (#80).
  - **Reject** needs a reason and may carry a suggestion: another venue
    and/or an alternative arrangement in words. The suggestion books nothing
    (#45, #110). The coordinator sees the reason and suggestion on the
    event's **Venue** tab, with "Request this venue" opening the normal
    request form for the suggested room.
  - **Server**: `PATCH /api/venue-bookings/[id]`. Rules are pure and unit
    tested in `src/lib/venueBookingReview.ts`; the venue row is locked while
    an approval is checked, so two requests for one slot cannot both be
    approved.
- **Decisions**
  - **The booking badge reads "Approved", not "Confirmed"** (2026-10-02),
    as in the BPMN. AC7's "Confirmed booking" is that approved booking;
    "Confirmed" stays an event status only.
  - **No notification** to the coordinator — out of the story since
    2026-09-18 (Jira comment: SPM-53 owns notifications). New Known Gaps row.
  - **Suggestion = optional venue picker + optional free text**, offered
    only when rejecting. The mockup's separate "Suggest another room" button
    and its "Tight turnaround — Approve anyway" warning are both out of date:
    overlapping a setup or turnaround slot is a clash, not a warning (#108,
    #123).
- **Schema**: `VenueBooking.suggestedVenueId` (→ `Venue`, set null on delete)
  and `VenueBooking.suggestedAlternative`, both nullable. Applied with
  `npx prisma migrate deploy` — **no reseed**. The `Venue` ↔ `VenueBooking`
  relation is now named (`BookingVenue`) because there are two.
  - Migration: `20261002100000_add_venue_booking_suggestion`
  - The shared database already has the two columns. After pulling, run
    `npx prisma generate` so your local Prisma client knows about them. Only
    if you work on your **own** Neon branch do you also need
    `npx prisma migrate deploy` first, to add the columns there.
- **New rule in [Changing the Schema](#-changing-the-schema): every database
  change is reflected in `prisma/seed.ts` in the same change, even though
  nobody is reseeding**, and is applied with `migrate deploy`, not a reseed.
  Done here: the seed now carries the two SPM-43 test venues, its 12 events,
  their sessions, booking requests and maintenance period, and one base
  rejected booking (Nusantara Developer Summit at Marina Auditorium) with a
  suggested venue and arrangement, so the new columns hold something on a
  fresh database. Type-checked, **not run** — running it wipes the shared
  database.
- **Fixed `prisma/seed.ts` not compiling**: the `eventData.push(` opened for
  the SPM-28 fixtures was never closed (a merge artefact), so `npx tsc
  --noEmit` failed and a reseed would have too. The same three lines as the
  fix on the SPM-44 branch, so the two merge cleanly.
- **Conflict checking at approval is a small copy of the slot rules**
  (`approvalConflict()`), because SPM-44's `src/lib/venueConflict.ts` is not
  on main yet. Once it is, `approvalConflict()` should call its
  `checkVenueBookingApproval()` instead — and `prisma/seed.ts` will need its
  SPM-43 and SPM-44 fixture blocks kept one after the other.
- Test cases: `docs/test-cases/SPM-43_Test_Cases.xlsx` (14 cases, all 7 ACs).
  Test data comes from **`npm run fixtures:spm43`** (`scripts/seed-spm43.ts`),
  which is also the reset after any case that approves or rejects — those
  cases say so in their Preconditions.
- Closed Known Gaps row: "Venue booking approval not built".

---

### 2026-10-02 — Janelle
- **SPM-50 (Review and Update Equipment Request): built.** Technical Support
  sets each equipment line's fulfilment status and records technical notes.
  - **Equipment request page** (`/equipment/requests/[id]`, S-25): each line now
    shows its own **Status** chip (beside Requested / Reserved / Availability),
    the Coordinator's technical requirements, Technical Support's notes and
    "Last updated by …". An **Update** button opens a panel with *Fulfilment
    status* (Requested / Under review / Cannot be provided) and *Technical notes*.
  - **Rules** (`src/lib/equipmentFulfilment.ts`, unit tested): Reserved and
    Partially fulfilled come only from Reserve; a reserved line can only stay
    as it is or become Cannot be provided; Cannot be provided needs a reason;
    notes max 500 characters. Marking a reserved line Cannot be provided frees
    its units (only
    reserved / partially fulfilled lines count against stock) and clears
    `quantityReserved`.
  - **New route:** `PATCH /api/events/[id]/equipment/[requestId]/fulfilment`
    (`canUpdateEquipmentFulfilment()`, the existing `equipment_request:review`
    action). Saves only if the line still has the status it was checked
    against - a Reserve or another update in between gets **409** "changed by
    someone else" rather than being overwritten (same code the coordinator
    route uses for a lost race).
  - **Equipment tab** (S-16): Technical Support's notes are shown read-only to
    the Coordinator and the owning Organiser.
  - `GET .../equipment/availability` lines now also carry
    `technicalRequirements`, `staffNotes`, `reviewedByName`, `reviewedAt`.
  - **Reserve (SPM-49) on a line marked Cannot be provided clears its old
    reason** (`reserveClearsStaffNotes()`), so a line never reads "Reserved"
    next to "cannot be provided because…". Reserve stays offered on those lines.
  - **Labels:** the request status `unavailable` now reads **"Cannot be
    provided"**, and the availability chip's `unavailable` reads **"None
    available"** (new `none_available` key in `src/lib/statuses.ts`, mapped by
    `availabilityStatusKey()`). Both used to say
    "Unavailable" on the same line with different meanings. Display only - the
    stored value is still `unavailable`. Differs from the S-25 mockup's wording.
    SPM-48/49 test cases' expected results updated; their recorded actual
    results were left as run.
- **Test data:** 6 SPM-50 events at the end of `prisma/seed.ts` (after SPM-42, so
  no earlier EVT- number moves) and `npm run fixtures:spm50`
  (`scripts/seed-spm50.ts`). Test cases: `docs/test-cases/SPM-50_Test_Cases.xlsx`
  (14 cases).
- **Fixed `prisma/seed.ts` not compiling on main** - the SPM-28 / SPM-42 merge
  dropped the `);` closing the SPM-28 `eventData.push(`.
- Known Gaps: removed "Check Equipment Availability is read-only" (SPM-49 built
  Reserve); added "Reserve still works before an event is approved" and
  "Changing a quantity after review doesn't send the line back for re-checking".
- **Technical Support follows the BPMN (3 Oct, Kristen):** they see an event's
  equipment only once it is in **Planning** (the Coordinator has recorded it)
  or **Confirmed** (read-only, to prepare it), and check, reserve and update it
  in Planning only. Before that - including Approved - the event is not in
  Equipment Requests and a direct link is a 404 ("not found, or its equipment
  is not ready for Technical Support yet"). `TECH_SUPPORT_EQUIPMENT_STATUSES`
  in `permissions.ts`; `eventAllowsReserving()` is now Planning only, and
  SPM-50's update uses the same rule. Applies to SPM-48's queue and
  availability check, SPM-49's Reserve and SPM-50's Update. SPM-49's seeded
  events moved from Under review to Planning; SPM-50 fixtures: Cancelled
  Hackathon replaced by Confirmed Launch (Confirmed), plus Approved Briefing
  (Approved). Known Gap "Reserve still works before an event is approved"
  removed.
- **Sidebar fix:** on `/equipment/requests` both "Equipment" and "Equipment
  Requests" were highlighted, because a link counted as active for any page
  under it. Now only the most specific match is lit (`activeNavHref()` in
  `src/lib/roles.ts`, used by `AppShell.tsx`, unit tested).
- Migration: none (`staff_notes`, `reviewed_by`, `reviewed_at` already existed).

### 2026-10-02 — Kristen
- **SPM-54 (Begin Event Planning): built end to end.** An Approved event moves
  to Planning with the assigned coordinator's **first venue or equipment
  action** — there is no "Begin planning" button.
  - **What begins planning**: pressing **Search** on Find a venue, **Submit
    request** on the booking form, and **Add**, **Save** or **Remove** on the
    Equipment tab. Opening a page (including "Search with filters" and
    "Request booking"), the automatic first search, "Clear filters" and
    "Cancel" do not.
  - **"Begin planning?" dialog** (`src/components/BeginPlanningDialog.tsx`):
    shown before any of those actions on an Approved event, once per event.
    "Continue" carries out the action and moves the event; "Cancel" does
    neither. Remove adds the same notice to its existing confirmation instead
    of asking twice.
  - **"Planning has started" alert** afterwards on all three screens; the
    Equipment tab's status badge updates without a reload.
  - **One way in on the server**: `beginPlanningIfApproved()`
    (`src/lib/beginPlanning.ts`) re-checks the status in the database and
    writes the status history row, inside the same transaction as the booking
    or equipment write. Find a venue calls it through the new
    `POST /api/events/[id]/begin-planning`. The status PATCH
    (`/api/events/[id]`) now **refuses** a move to Planning.
    `canBeginPlanning()` and `PLANNING_FROM_STATUSES` are in `permissions.ts`.
  - **Before approval** (Submitted, Under review): "Request booking" and
    every equipment change are unavailable, with a message saying why; the
    server refuses them too (`isBeforeApproval()` in `statuses.ts`). Venue
    search still works there and changes nothing. Equipment the organiser
    requested on the request form stays visible, read-only.
  - `DELETE /api/events/[id]/equipment/[requestId]` now answers **200 with
    `{ planningStarted }`** (was 204), and the booking and equipment
    `POST`/`PATCH` responses carry the same field.
    `GET /api/events/[id]/venue-bookings` adds `willBeginPlanning`.
- **Dashboard (S-03) is now a per-status overview for two roles.**
  - **Organiser**: "Drafts", "Under review", "Approved", "Planning"
    (replacing "Needs your attention") — SPM-54 AC4, the organiser can see
    their event has entered planning.
  - **Coordinator**: "Awaiting your review" (Under review), "Approved",
    "Planning", their own events only. The first heading is kept because
    SPM-21 and SPM-30 test cases quote it.
  - Each section shows the **five most recently updated** events
    (`OVERVIEW_LIMIT`) and, when there are more, "Showing the 5 most recently
    updated of N. View all in …". Other roles' dashboards are unchanged.
- **Decisions** (2026-10-01 and 2026-10-02, recorded as RESOLVED entries in
  `docs/test-cases/SPM-54_test_cases.json`):
  - Planning begins with the first venue or equipment action. This **replaced**
    the 2026-10-01 decision to block bookings and equipment until Planning.
  - The venue-search trigger moved from **page load** (SPM-40's behaviour) to
    the **Search click**, so opening the page no longer changes the status.
  - The dialog says "The organiser and ConnectSphere staff will see this
    status", not "everyone": an Attendee only sees Confirmed events.
  - AC3 "track outstanding arrangements" is met by the statuses on the Venue
    and Equipment tabs; the Readiness screen is SPM-33.
  - **No notification** to the organiser, and **no test case** for the status
    history (no History tab).
  - An Approved event can already list equipment: the organiser requests it
    on the request form. Kept as is.
- **Closes part of a Known Gap**: "Status lifecycle is not validated" is now
  "only partly validated" — Planning is held to Approved. Four new rows added
  (no notification, no undo/history, search feedback → SPM-79, other stories'
  test cases).
- **Fixed `prisma/seed.ts`**, which did not compile on main: the SPM-28
  fixture block lost its closing `);` in the merge with SPM-42, so a full
  reseed would have failed.
- Test cases: `docs/test-cases/SPM-54_Test_Cases.xlsx` (14 cases, all 4 ACs),
  all passed in the browser on 2026-10-02. Test data comes from
  **`npm run fixtures:spm54`** (`scripts/seed-spm54.ts`): 10 "SPM54 …" events
  at **fixed references EVT-000145 to EVT-000154**, mirrored at the end of
  `prisma/seed.ts` — **add new seed events after them**, or their numbers
  move. Unit tests added for `canBeginPlanning()`, `isBeforeApproval()` and
  the booking refusal; one SPM-42 test changed (an Under review event no
  longer accepts a booking request).
- `generate-test-cases` skill: `fill_template.py` now leaves **RESOLVED**
  entries out of the workbook's Open Questions sheet and writes **no sheet**
  when nothing is still open. They stay in the JSON as the decision record.
- Jira: **SPM-79** (Show Venue Search Feedback) created under Venue
  Management and linked to SPM-40 and SPM-54; comments on all three explain
  the links.
- `docs/ConnectSphere_Status_Lifecycle.drawio`: the Approved → Planning edge
  is relabelled from "search" to "first venue / equipment action", and the
  "resume" edge now runs **Postponed → Approved** instead of Postponed →
  Planning.
- **Decision for SPM-38 (Postpone Event), 2026-10-02**: a resumed event goes
  back to **Approved**; planning then begins again with the coordinator's next
  venue or equipment action. Planning keeps its single way in. No code for
  this yet — the points SPM-38 has to settle are in the "Status lifecycle is
  only partly validated" Known Gap.
### 2026-10-02 — Sammi Chua (SPM-27, withdrawal per clarification #103)
- **Withdrawing is now the assigned coordinator's, from Under review only.**
  Customer clarification #103: the organiser asks the coordinator outside the
  system and the coordinator records it. Replaces the organiser
  self-withdraw from the entries below.
  - `STATUS_TRANSITION_ROLES.withdrawn` is `coordinator`; `canTransition()`
    drops Submitted → Withdrawn.
  - Event page (S-06): the header button is "Record withdrawal", shown to the
    assigned coordinator while the event is Under review; the dialog is
    "Record this withdrawal?", success says "The withdrawal has been
    recorded."
  - Fixtures: both withdrawn events now come from Under review, and the
    history credits `withdrawn` to the coordinator. SPM-27 test cases
    TC03–TC07 rewritten for the coordinator.
  - Diagrams: main's redrawn BPMN and lifecycle (Kayal, below) already show
    this, so this branch's own diagram edits were dropped in the merge.
    main's lifecycle also has Confirmed → Planning ("significant change"),
    which `canTransition()` does not allow yet; not part of SPM-27.
- **Resuming a postponed event goes back to Approved, not Planning**
  (decision Sammi Chua, 2026-10-02): Postponed → Approved → Planning, so
  Planning is only ever entered from Approved. `canTransition()` and
  `docs/ConnectSphere_Status_Lifecycle.drawio` ("resume" now points at
  Approved) updated.

---

### 2026-10-01 — Sammi Chua (SPM-27, test data)
- **`npm run fixtures:spm27`** (`scripts/seed-spm27.ts`): 14 "SPM27 Bayu …"
  events for Hakim Zulkifli (hakim.zulkifli@bayuenergypa.com), one per
  status plus spares for the withdraw cases; Hui Shan Neo coordinates from
  Under review on. Dates are seed anchor + n days. Only touches `spm27_`
  events; re-run to reset after a test pass.
- `prisma/seed.ts` mirrors them, appended last. `EventSeed` gains an
  optional `chain` (a withdrawn event's history depends on where it was
  withdrawn from) and the history loop credits `withdrawn` to the organiser.

---

### 2026-10-01 — Sammi Chua (SPM-27, withdraw request)
- **"Withdraw request" on the event page (S-06).** Shown in the page header
  only to the owning organiser while the event is Submitted or Under review,
  decided by the new pure `canWithdrawEvent()` in `permissions.ts` (the
  route's own two checks, `canSetEventStatus` + `canTransition`). Goes through
  `ConfirmDialog` ("Keep request" / "Withdraw request"); success shows "Your
  request has been withdrawn.", a refusal shows the route's message.
- `UI_DESIGN.md` §5.2 gains the `withdrawn` event badge (neutral) and §7.5
  lists withdrawing a request as a confirm-first action.
  `docs/ConnectSphere_BPMN.drawio`: Organiser lane gains "Withdraw request"
  → "Request withdrawn", from Submit, before approval.

---

### 2026-10-01 — Sammi Chua (SPM-27, lifecycle enforced)
- **The events `PATCH` route now refuses illegal status moves.**
  `handleStatusChange` calls `canTransition()` after the role check and
  returns 400 with `transitionError()`'s message, e.g. "This event is
  Withdrawn and can't be moved to Withdrawn." `withdrawn` added to
  `updateEventStatusSchema`. Closes the "Status lifecycle is not validated"
  Known Gap.
- `docs/ConnectSphere_Status_Lifecycle.drawio`: new Withdrawn box with
  "withdraw" from Submitted and Under review, a new Approved → Cancelled
  arrow, and the Planning → Cancelled arrow is now attached to Planning (it
  had no source).

---

### 2026-10-01 — Sammi Chua (SPM-27, transition rules)
- **The lifecycle as code, not yet enforced.** `canTransition(from, to)` and
  `transitionError()` in `src/lib/statuses.ts` hold the moves listed in the
  entry below; `withdrawn` joins `TERMINAL_EVENT_STATUSES`.
  `STATUS_TRANSITION_ROLES` (`src/lib/permissions.ts`) gains `withdrawn`
  (organiser), loses `draft`, and `postponed` is coordinator-only — the old
  test "still lets the owning organiser postpone" now asserts the opposite.
  The events `PATCH` route does not call `canTransition()` yet (next slice),
  and `withdrawn` is not yet in its Zod enum. `docs/PERMISSIONS.md` §5
  updated.

---

### 2026-10-01 — Sammi Chua
- **SPM-27 (View Event Status): test cases and lifecycle decisions.**
  `docs/test-cases/SPM-27_Test_Cases.xlsx` (7 cases). No code yet. Decisions agreed with Sammi Chua, 2026-10-01,
  to be built in the next slices:
  - **Legal moves only.** A pure transition table in `src/lib/statuses.ts`,
    checked by the events `PATCH` route on top of the existing role check.
    Allowed: draft → submitted; submitted → under_review, withdrawn;
    under_review → approved, rejected, withdrawn; approved → planning,
    cancelled; planning → confirmed, postponed, cancelled; confirmed →
    completed, postponed, cancelled; postponed → planning, cancelled.
    Completed, rejected, cancelled and withdrawn are final. Closes the
    "Status lifecycle is not validated" Known Gap once built.
  - **New `withdrawn` event status** (AC3 lists it, nothing had it). The
    owning organiser may withdraw their own request while it is Submitted or
    Under review, via a "Withdraw request" button on the event page. Final,
    so it joins `TERMINAL_EVENT_STATUSES`.
  - **Approved → Cancelled added** (not on the original lifecycle diagram).
  - **Organiser can no longer postpone** (AC4: the organiser cannot manually
    change the status). `STATUS_TRANSITION_ROLES.postponed` becomes
    coordinator-only, and the `draft` entry goes (nothing moves an event back
    to draft). An organiser asks for a postponement or cancellation through a
    change request (`EventChangeRequest`), not built yet.
  - **Rules only.** Confirm, Complete, Postpone, Resume and Cancel actions
    stay with their own stories (SPM-37 Cancel, SPM-38 Postpone, …); they only
    need to send the status once the rules are in. Auto-complete after 7 days
    (clarification #71) is not built here.

---

### 2026-10-01 — Kayal
- **Both diagrams brought in line with the customer clarifications**
  (`docs/discussions/`). Diagrams only — no code changed, so several of these
  are the intended design, not current behaviour (see the last bullet).
  - `docs/ConnectSphere_BPMN.drawio` — redrawn. The main flow keeps the same
    lanes and steps up to approval, then:
    - Planning is a **parallel split** into venue, equipment and registration
      branches. Equipment and registration each start with a "required?" /
      "enabled?" gateway, because not every event needs them (#80). Equipment
      no longer follows the venue booking request.
    - An equipment **shortfall** goes to the coordinator, who decides with
      Technical Support whether it is essential: revise the request, or carry
      on without it (#90, #106).
    - The branches **join** before a coordinator gateway, "Essential
      arrangements complete?", and only then "Confirm event" (#80, #98).
      Venue approval and equipment reservation no longer lead straight to
      Confirmed.
    - "Record withdrawal" from Under review (#103), and a 7-day
      auto-complete timer beside "Mark event completed" (#71).
    - A second block, **Changes and exceptions**, holds what can start at any
      time after submission: change requests with a coordinator review and
      partial acceptance (#102, #104, #105, #115), postponement with or
      without a new date (#69, #121), cancellation at any stage with bookings
      released (#68), a venue being retired, blocked or changed (#54, #120,
      #122), and returned equipment found damaged (#86, #114). Each ends in
      an event that names where it rejoins the main flow.
  - `docs/ConnectSphere_Status_Lifecycle.drawio` — new **Withdrawn** status
    (from Under review); new **Confirmed → Planning** edge, "significant
    change"; the Planning → Cancelled arrow is now attached at both ends;
    notes added for cancel-at-any-stage and auto-completion.
  - **Not built yet, and now on the diagrams:** the confirm guard, the
    Withdrawn status, releasing bookings and reservations on cancel or
    postpone, change requests, and Venue Staff's booking decision. The events
    `PATCH` route still checks who may set a status, not which move is legal.

---

### 2026-09-30 — Kristen
- **SPM-28 (Review Event Request): built end to end.** The assigned Event
  Coordinator reviews a request and approves it for planning or rejects it.
  - **Review Queue** (`/queue`, S-12): the requests assigned to you that are
    Under review, longest-waiting first. Fed by the new `GET /api/queue`
    (coordinators only).
  - **Review page** (`/events/[id]/review`, S-13): everything that was
    requested, with a "Not provided" marker on each empty field and a yellow
    summary of what's missing (`missingRequestFields()` in
    `src/lib/eventReview.ts`). Then **Approve** (confirm dialog, → Approved)
    or **Reject** (reason required, → Rejected). A coordinator who isn't
    assigned gets "You can't review this request"; a request that's already
    decided redirects to its event page.
  - **Event page**: a red "This request was rejected" banner with the reason,
    and a "Review request" button for the assigned coordinator.
  - **Server**: approve/reject only from Under review (`canReviewEvent()`,
    `REVIEW_OUTCOMES`); rejection reasons saved trimmed. `GET /api/events/[id]`
    now includes each equipment request's item name.
- **Decisions confirmed 2026-09-30** (Q&A in `docs/discussions/`: #72, #80):
  - The review page shows **Under review**, not the mockup's "Submitted"
    (SPM-30 moves an event there on assignment).
  - Approving moves the event to **Approved**; SPM-54 moves it on to Planning.
  - Missing information is **flagged, never blocking** — approval means
    "sufficient information for planning" and that's the coordinator's call
    (#80); no mandatory field list exists (#72).
  - **Clarifications are out of scope** — no "Ask the organiser" option and
    no list of existing ones. **No notification** to the organiser on either
    outcome. Both are new Known Gaps rows.
  - The organiser sees the rejection reason as a **banner on the event page**.
  - Approve has a **confirm dialog**; Reject has the reason step instead.
  - The review page stays a **separate task screen**, not an event tab (S-13).
- `design/mockups/EventReview.dc.html` is now out of date: it still shows a
  "Submitted" badge and the clarification option.
- Test cases: `docs/test-cases/SPM-28_Test_Cases.xlsx` (15 cases, all 6 ACs).
  Test data comes from **`npm run fixtures:spm28`** (`scripts/seed-spm28.ts`):
  7 "SPM28 …" events, deleted and recreated on each run so it doubles as the
  reset — **run it after TC08 (approve) and TC10/TC11 (reject), never
  `npx prisma db seed`**. They're recreated at **fixed references
  EVT-000124 to EVT-000130** with fixed dates, so test cases quote exact
  addresses. The same events are in `prisma/seed.ts`, appended after SPM-30's —
  **add new seed events after them**, or their numbers move.
- `generate-test-cases` skill: new rules for test steps (results tied to step
  numbers, typed addresses written out, sidebar labels per role, fixture-based
  test data), now also checked by `fill_template.py`.
### 2026-10-01 — Sammi Chua
- **SPM-42 (Request Venue Booking), slice 1: test cases and slot rules.**
  - `src/lib/venueBookingRequest.ts`: `requestedWindow()` and
    `coversSchedule()`, built on SPM-46's `venueSlots.ts`.
    `canRequestVenueBooking()` in `permissions.ts`.
  - Test cases: `docs/test-cases/SPM-42_Test_Cases.xlsx` (17 cases, all 8 ACs;
    open questions in the JSON).
  - No migration: `VenueBooking` already has every field needed.
- **SPM-42 slices 2–3: request rules and schema.**
  `checkVenueBookingRequest()` applies every decision below in one pure
  function and returns the window to store or the refusal message;
  `defaultSlots()` pre-fills the form. `createVenueBookingSchema` in
  `src/lib/validation/venues.ts`.
- **SPM-42 slice 4: test data.** `npm run fixtures:spm42`
  (`scripts/seed-spm42.ts`), mirrored at the end of `prisma/seed.ts`. Adds one
  venue, SPM42-PLN, because no seeded venue has zero setup and zero teardown.
- **SPM-42 slice 5: routes.** `GET`/`POST /api/events/[id]/venue-bookings`
  (the event's requests; create a pending one) and `GET /api/venue-bookings`
  (pending requests, Venue Staff). `GET .../venue-suitability` takes an
  optional `?session=<id>` so a session is judged on its own attendance and
  layout; without it, unchanged.
- **SPM-42 slice 6: screens.** The Venue tab gets a session picker, a
  "Request booking" button on suitable venues and the event's requests with
  their status. S-15 (`/events/[id]/booking/new`) is the request form. S-22
  (`/bookings`) is now a read-only list of pending requests for Venue Staff.
  UI_DESIGN.md S-15 and §7.4 updated to match. Requests are shown as their
  date and slots (`requestSlotsLabel()`), e.g. "10 Mar 2027 · PM, Night
  (13:00–24:00)", not raw times: Night ends at 24:00, stored as the next
  day's midnight.
- **SPM-42 decisions** (customer clarification numbers in brackets):
  - A request is one date plus one or more **contiguous** AM/PM/Night slots
    (#50) that cover every slot the event's, or the session's, own time
    touches (#107). Extra slots are allowed.
  - Setup and turnaround come from the venue and take one adjacent slot each,
    across days (#108, #123). They are **shown but not stored**:
    `startsAt`/`endsAt` hold the chosen slots only, and `occupiedCells()` adds
    the rest, so the calendar never counts setup twice.
  - Only the **assigned coordinator** can request (existing SPM-30 rule), and
    not for a completed, cancelled or rejected event (existing SPM-47 rule,
    `isTerminalEventStatus()`). Nothing beyond the AC was added: no extra
    status restriction and no limit on requests per event.
  - **Clashes are blocked** at submission through `occupancyConflict()`
    (#35, #41): unavailability, an approved booking (setup and turnaround
    included), or another event's pending hold. Cancelled and rejected bookings
    never block.
  - An **unsuitable venue is refused**. SPM-41's greyed list is unchanged, and
    an incomplete check (no attendance or layout yet) does not block.
  - A session request uses the session's date, time, attendance and layout,
    and the event's facilities. 'Venue requirements' is free text in
    `requirementsNote`.
  - Venue Staff will see requests in a **read-only `/bookings` list**, which
    replaces the S-22 placeholder. Approve and Reject stay with the Venue
    Booking Approval story.
  - 'Venue requirements' is optional; layout is always sent.
  - Opening hours are not checked on a request. Night (19:00–24:00) runs past
    most venues' closing time, so checking would make Night unbookable almost
    everywhere; Venue Staff see the slots and judge it when they review (AC7).
  - A single-session event spanning several days cannot be booked in one
    request: the form pre-fills nothing and submitting says the slots do not
    cover the event's time. Such an event needs sessions (AC4).
  - A Pending request is not re-checked when the event's attendance or layout
    changes later. Not in the AC; Venue Staff review it before approving.
  - Test cases that create requests use `spm42_` fixture events
    (`npm run fixtures:spm42`, not built yet), so a test pass can be repeated
    without a reseed.

---

### 2026-09-28 — Kristen
- **SPM-30 (Assign Event Coordinator): built end to end.** The Ops Manager
  assigns a coordinator to a submitted event, or reassigns a live one, from the
  new Assignments screen (`/assignments`, S-28) or the event's Overview page.
  - `PUT /api/events/[id]/coordinator` does both. A first assignment also moves
    the event `submitted → under_review` and writes a status-history row; a
    reassignment leaves the status alone. Refused (400) for completed,
    cancelled, rejected or draft events, for anyone who isn't an active
    coordinator, and for the coordinator the event already has. The update is
    conditional, so two Ops Managers acting at once get a 409, not a silent
    overwrite.
  - Notifies the new coordinator, and on reassignment the previous one. The
    organiser is not notified. Nothing displays these yet (Known Gaps).
  - `GET /api/assignments` feeds the screen: unassigned submitted events, live
    assigned events, and the active coordinators.
- **Behaviour change — check your own features:** `isAssignedCoordinator()`
  no longer lets *any* coordinator act on an event with no coordinator. Only
  the assigned one can approve, confirm, cancel or manage its equipment.
  Knock-on fixes: the coordinator dashboard's "Awaiting your review" now shows
  only their own events (it showed every event in those statuses); the
  Equipment tab tells a non-assigned coordinator why they can't see it rather
  than showing a load error; `verify-permissions.ts` now has the Ops Manager
  assign before the coordinator approves (47 checks, all passing).
- Also: a "Coordinator" filter on All Events for the Ops Manager (AC2).
- **Decisions confirmed 2026-09-28** (Q&A in `docs/discussions/`: #92–#95,
  #101, #117): Ops Manager only; reassignable while Under review, Approved,
  Planning, Confirmed or Postponed; the owning organiser and same-company
  organisers see the coordinator; the mockup's "Coordinator workload" panel is
  out of scope (#93: choosing a coordinator is the Ops Manager's own SOP).
- Test cases: `docs/test-cases/SPM-30_Test_Cases.xlsx` (20 cases, all 6 ACs).
  Test data is **added without a reseed** by `npm run fixtures:spm30`
  (`scripts/seed-spm30.ts`): 12 "SPM30 …" events, deleted and recreated on
  each run, so it doubles as the reset. SPM-30-TC20 (empty queue) needs every
  submitted event assigned, so run it on a Neon branch, not the shared database.
  The same 12 events are also in `prisma/seed.ts` (pushed last, so no existing
  EVT- number shifts; no registrations), so a full reseed includes them. The
  seed also gains a `postponed` status-history chain.
- Removed the "Coordinator Assignment has no endpoint" Known Gaps row.

---

### 2026-09-28 — Janelle
- **SPM-48: two fixes to the equipment availability check.**
  - "Reserved elsewhere" is now the most units held on any **single day** the
    event needs, not the sum of every overlapping hold. Units are pooled, so two
    holds that never share a day can use the same units; adding them up
    reported shortages that weren't there on multi-day windows.
  - A session is now checked against its **own event's other sessions** too,
    not only other events - previously two same-day sessions could both be
    shown (and, with SPM-49, reserved) the same units.
- Changes one seeded result: SPM-48-TC21's Streaming Encoder is now 'Available'
  (2 reserved elsewhere, 1 available) - test case updated, re-run it.

---

### 2026-09-28 — Kayal
- **SPM-40 (Search and Filter Suitable Venues): built.** S-14 "Find a venue"
  at `/venues/search`, backed by `GET /api/venues/search` (`venue:view`, so
  Coordinator, Ops Manager and Venue Staff). Filters: date and time, expected
  attendance, location (building), room layout, accessibility requirements,
  required facilities. **Only venues passing every filter are returned (AC7)**
  — the difference from SPM-41's Venue tab, which grades every venue and keeps
  the failures visible. The customer draws the same line (#83).
- **Rules** (all in `src/lib/venueSearch.ts`, pure, unit tested):
  - Attendance is checked against the chosen **layout's** capacity (#112);
    with no layout chosen, some layout must seat everyone. `maxCapacity` is
    never used, and a venue with no layouts never passes an attendance filter.
  - Date/time uses **SPM-46's slot rules** (#50/#107/#108/#123): a clash is an
    overlap of occupied windows, and the searched event's *own* setup and
    turnaround slots must be free too. Approved bookings and maintenance blocks
    hide a venue; so does another event's **pending** request (#41, one active
    hold per venue and time). Rejected/cancelled requests never block. The
    searched-for event's own bookings never count against it.
  - The time must fall inside the venue's opening hours (#46), checked on the
    first day's start and the last day's end.
  - Times are typed and sent as **Singapore wall-clock** (`2026-12-09T09:00`)
    and converted on the server (#36), so a laptop set to another zone still
    searches the morning that was typed.
- **`?event=EVT-000123` pre-fills the form** from that event: its times,
  attendance, layout and **mandatory** facility/accessibility requirements
  (nice-to-haves are left unticked so they don't hide venues). A multi-session
  event can pick one session instead (#74).
- **`src/lib/venueSlots.ts` (+ its tests) and the `TIME_ZONE` export in
  `format.ts` are byte-for-byte copies from the unmerged SPM-46 branch**, so
  the date filter follows the same rules as the availability calendar and the
  two branches merge without conflict. Edit them on one branch only until both
  are merged.
- **Approved → Planning now happens.** When the event's *assigned*
  coordinator opens Find a venue for an **Approved** event, the page moves it
  to Planning through the existing `PATCH /api/events/[id]` (history reason
  "Venue search started", the seed's own wording). That is the lifecycle
  diagram's "search" edge; the BPMN and the seed history already said so.
  Guarded client-side by `shouldStartPlanning()` because the status route
  checks *who* may move a status, not *from where* — without the guard a
  Confirmed event would drop back to Planning on every search. The route
  itself is unchanged.
- Entry points: "Find a venue" on `/venues`; "Search with filters" on the
  event's Venue tab (a header button only - SPM-41's own logic is untouched).
- Diagrams: **no change needed.** The code now matches both: the BPMN's
  "Search venues & check suitability" step, and the lifecycle's Approved →
  Planning "search" edge.
- Seed: one fixture appended, `spm40_approved` ("SPM40 Approved Workshop",
  Daniel Tan) - the only Approved event, since nothing in the app can approve
  one yet (S-13). Pushed last, after SPM-48/49's fixtures, so no existing EVT-
  reference shifts; the
  status-history table gained its missing `approved` chain. **Not applied to
  the shared database** - reseed when convenient.
- Tests: 56 new unit tests (`venueSearch.test.ts`, `venueSearchForm.test.ts`,
  `venueSearchQuerySchema` in `validation.test.ts`), plus SPM-46's slot tests
  carried over. Manual cases: `docs/test-cases/SPM-40_*` — 16 cases covering
  all seven ACs; the rulings behind each decision are listed in the JSON's
  `open_questions` with their discussion numbers.
- No schema change, no migration.
- **`prisma/seed.ts` dates no longer move when someone reseeds.** Every seeded
  date used to be *today* + n days, so each reseed of the shared database slid
  every event, booking and block by however many days had passed, and the
  dates in `docs/test-cases/` stopped matching. The suites on `main` had each
  been written against a different seed day (SPM-47 on 16 Sep, SPM-39 on
  20 Sep, SPM-41 on 23 Sep). `day(n)` is now a fixed anchor, **2026-09-26**,
  + n days, built as Singapore wall-clock time so the seeder's own time zone
  doesn't matter either. Reseed on any day and you get the same data.
- Re-based the seed-dependent dates in SPM-39 (+6 days), SPM-41 (+3) and
  SPM-47 (+10), JSON and xlsx, onto that anchor. SPM-21/23/24/25/31 only use
  dates the tester types in, so they're unchanged.
- **Writing test cases:** quote dates against 2026-09-26 + n. Don't change
  the anchor unless you re-base every date in `docs/test-cases/` by the same
  number of days. `SEED_ANCHOR=YYYY-MM-DD npx prisma db seed` still overrides
  it for a one-off local run — never on the shared database.
- Branches not yet merged: merge `main` in, then re-base your own test cases
  onto 2026-09-26 if they were written against another seed day.
- **SPM-40 and SPM-46 test data, ahead of the features** (same approach as
  SPM-48's test-data PR). `seed.ts` gains Jurong Expo Floor's two overlapping
  unavailable periods (days 40-44 and 42-46, for SPM-46-TC09) and "SPM40
  Approved Workshop" (day 180, the only Approved event, for SPM-40-TC15; pushed
  last so no EVT- number shifts), plus the `approved` status-history chain.
- **Added to the shared database without a reseed** by
  `npx tsx prisma/topup-spm40-46.ts`, which writes the same rows on the same
  dates and deletes nothing else. Re-run it to put the workshop back to
  Approved before re-running SPM-40-TC15.
- **SPM-46 test cases: 15 → 14**, re-checked against the shared database on
  2026-09-28 (every data-dependent expectation matches the live API). The old
  TC08 (a period covers every slot) was a subset of TC09 (a period stops on its
  last day); they are now one TC08 on Jurong Expo Floor, 16–25 Oct, which also
  checks the period's *first* day - neither case did. TC10–TC15 became
  TC09–TC14. Preconditions no longer say the dates move with the seed.
- **SPM-40 test cases re-checked** against the shared database on 2026-09-28:
  all 16 expected results match the live search API, no case overlaps another,
  so none were added or removed. Preconditions no longer ask for a fresh
  reseed; TC15 says how to reset its event; TC16 names Evelyn Chen's login.

---

### 2026-09-27 — Janelle
- **SPM-48 (Check Equipment Availability): built end to end.** Rules live in
  `src/lib/equipmentAvailability.ts` (pure, unit tested — see the file list
  above), loaded by `equipmentAvailabilityService.ts` and turned into one
  result per line by `equipmentAvailabilityLines.ts`. Screens: `/equipment/requests`
  (queue) and `/equipment/requests/[id]` (detail, following the S-25 mockup),
  both Technical Support only — a result names the *other* events holding the
  equipment, which would leak them to an Organiser via `canViewEquipmentRequests`.
  Also built AC7's recording side: `PATCH /api/equipment/[id]/out-of-service`.
- **Decisions the team should sanity-check, none yet confirmed by the customer:**
  equipment is busy from D-1 through its Return Day (the event's own end date)
  and free again *from* Return Day+1 — matches the customer Q&A, not the Jira
  AC text ("through Return Day+1"), which should be corrected; the 2h transfer/
  prep time (`EQUIPMENT_TRANSFER_PREP_MS`) applies before the event only, never
  after; only `reserved`/`partially_fulfilled` requests count, and cancelled/
  postponed/rejected/draft events are filtered out as a stand-in for SPM-37/38
  actually releasing the reservation (see Known Gaps).
- **Schema, both additive, already applied to the shared `is212-dev` database**
  (not just committed — teammates on an un-rebased branch will see `prisma
  migrate status` mention a migration their own `prisma/migrations/` doesn't
  have; that's expected until this merges, and `prisma migrate dev` should be
  avoided meanwhile since it may offer to reset the database):
  - Migration `20260926160000_add_equipment_location`:
    `Equipment.locationVenueId` (nullable → `Venue`; NULL = ConnectSphere
    storage).
  - Migration `20260926170000_add_equipment_out_of_service_reason`:
    `Equipment.outOfServiceReason` (nullable text).
- Also: retired (`isActive: false`) equipment is now excluded from
  `GET /api/equipment` and refused by both add-equipment routes — previously
  a retired item stayed pickable forever (matches SPM-39's rule for retired
  venues). New Known Gaps rows for what this leaves open: the equipment
  catalogue screen, SPM-49 (reserve), and the location/transfer assumptions.
- Test cases: `docs/test-cases/SPM-48_Test_Cases.xlsx` (30 cases, all 8 ACs),
  with fixture events/equipment added to `prisma/seed.ts` so every case has
  real data to run against. Fixture events are pinned to real calendar dates
  via `daysUntil()`, so cases stay reusable across reseeds.

---

### 2026-09-26 — Kayal
- **SPM-46 (View Venue Availability): `GET /api/venues/[id]/availability` and
  the availability calendar (S-21).** One venue, a range of local calendar
  days, and for each day the AM / PM / Night slots with whatever occupies them.
  Reached from a "View availability" link on every row of the Venues list and a
  button on the venue edit page — the list link is the one that matters, because
  an Event Coordinator holds the calendar permission but cannot open the edit
  page.
  - **"Confirmed booking" means `VenueBooking.status = "approved"`, not
    `Event.status = "confirmed"`** (AC3/AC7). Reading it by event status hid a
    real approved booking whose event was still in `planning` — Marina Grand
    Hall in the seed — and would have let someone book the same room twice. The
    event's status travels along for display only and never decides
    availability.
  - **Slot derivation and turnaround live in `src/lib/venueSlots.ts` and
    `src/lib/venueAvailability.ts`** as pure functions over plain data, no
    Prisma and no `NextRequest`, the same arrangement as `venueImpact.ts`. The
    route only loads rows. A cell is `unavailable` > `booked` > `turnaround` >
    `closed` > `free`, first match wins; a slot never claims two things clash,
    because slots are hours wide — real clashes are reported on the bookings
    and periods themselves via `overlaps` / `hasOverlaps` (AC5).
  - **The slot grid and the setup rule come from the customer, not from us.**
    An earlier version of this branch set its own boundaries and its own
    minute-based buffers, and said in a code comment that nothing in the
    project defined them. That was wrong, and it was wrong because **nothing in
    this repo points at the clarification discussions**. Corrected here:
    - **Slots are AM 07:00–12:00, PM 13:00–18:00, Night 19:00–24:00**
      (#50, 2026-08-25), with 12:00–13:00, 18:00–19:00 and 24:00–07:00
      deliberately uncovered. Those gaps are changeover time and nothing is
      lost to them: a booking running through one still holds the slots either
      side (#107), and the setup rule claims the adjacent slot anyway.
    - **A slot touched at all is consumed in full** (#107). Two approved
      bookings in one slot are therefore a clash, even when their own minutes
      never meet — which is the point of the calendar.
    - **Setup and turnaround each take one WHOLE adjacent slot, across days**
      (#108, #123): an AM event's setup takes the previous day's Night, a Night
      event's turnaround takes the next day's AM. `Venue.setupMinutes` /
      `teardownMinutes` are now read as yes/no rather than as a duration — 20
      minutes and 240 minutes cost the same one slot. **No schema change**:
      Venue Staff still record the real minutes on the venue form, which is
      what #43 asks them to maintain.
    - `hiddenMinutes()` replaces the old "minutes outside the grid" warning,
      which would otherwise have fired on every ordinary event that runs
      through lunch. It warns only when a booking touches no slot at all and
      would vanish from the calendar.
    - Checked against every seeded venue over eight months: **no clashes
      introduced and no booking falls into a gap**, so the seed needed no
      changes and no reseed.
  - A **retired** venue's slots all read `closed`, never `free`.
  - Tests: `vitest` 325/325 (`venueSlots.test.ts` + `venueAvailability.test.ts`
    added, 647 lines), `tsc --noEmit` and `eslint` clean. `verify:permissions`
    45/45 and `verify:login` 29/29 against a live server after merging main.
  - Test cases: `docs/test-cases/SPM-46_*` — **15 cases covering all seven AC**,
    consolidated from an initial 22 that overlapped each other. Merged: opening
    the calendar, the default range, switching venue and the three column
    headings are one flow, not four; "an organiser cannot open it" and "Technical
    Support cannot open it" are one case with two accounts; pending, rejected and
    cancelled bookings are one case, not two. Dropped: a case asserting a *single*
    unavailable period is not flagged as overlapping (it only asserted the absence
    of something nothing can create yet), and a booking-details case already
    proven by TC13.
    Executed against a live server on 2026-09-26: **15/15 pass**, including
    TC10 — AC5 was previously untestable by hand, and `prisma/seed.ts` now
    carries the one overlapping pair it needs (Jurong Expo Floor, days 40–44
    and 42–46). They were also inserted into the shared dev database directly,
    additively, so the case runs there without waiting for a reseed. Nothing
    else reads `VenueUnavailability`, so no other story is affected.
    Their dates were **re-based +6 days onto the current seed**, which every
    case now names in its preconditions. (Since 2026-09-28 the anchor is fixed
    at 2026-09-26, so these dates no longer go stale on a reseed.)
  - The generated workbook is **Summary + one sheet per case**. The generator
    also writes an "Open Questions" sheet; it was removed from this workbook
    (`del wb['Open Questions']`) because its contents had become three different
    things — real questions, decisions already recorded here, and testing notes.
    The script itself is untouched, so other stories still get that sheet.
  - **Still open for the team, from that sheet:** is excluding Technical Support
    from the calendar intended (AC6 says "authorised internal users" without
    naming roles, and the calendar reuses `venue:view`, which they do not hold)?
    Is "Free" with a "Limited hours" note the right thing for a partly-open
    slot, given the AC say nothing about opening hours? Is the S-21 mockup
    (`design/mockups/VenueCalendar.dc.html`, an hour-by-hour grid with pending
    requests and "tentative holds") superseded by AC2's three slots? And how
    should the screen warn about a booking whose room time falls entirely
    between 23:00 and 06:00, which no slot covers?
  - Merged `main` after SPM-31 landed. SPM-31's new event URL scheme needed no
    change here: the availability payload carries `eventId` for display
    grouping only and never builds an `/events/...` link or looks an event up
    by route segment. Only `src/lib/format.ts` overlapped, and cleanly — this
    story exported `TIME_ZONE` from it so slot derivation and display cannot
    drift apart.

---

### 2026-09-25 — Kristen
- **Fixed `prisma/seed.ts` leaking event reference numbers across reseeds.**
  A teammate running SPM-31's test cases (TC01, TC09, TC17) got `EVT-000200`
  for "Meridian Wealth Management Forum" instead of the `EVT-000005` the test
  data expects. `Event.sequenceNumber` is a Postgres `autoincrement()` column
  (see `prisma/schema.prisma`'s note on `id` vs `seedKey`), and the seed script
  clears tables with `deleteMany()`, not `TRUNCATE ... RESTART IDENTITY` — that
  note explained why `id` churns on every reseed but missed that
  `sequence_number`'s underlying Postgres sequence *isn't* reset either, so it
  keeps climbing every time `npx prisma db seed` is re-run instead of
  restarting at 1. Fixed by adding `ALTER SEQUENCE "events_sequence_number_seq"
  RESTART WITH 1` right after `event.deleteMany()`. Verified: after reseeding,
  "Meridian Wealth Management Forum" is `sequenceNumber: 5` again.
- Also found, while triaging the same test cases: TC19 404s because the
  Attendee's "Browse Events" nav link (`src/lib/roles.ts`) points at `/browse`,
  and `src/app/browse/page.tsx` doesn't exist. Not fixed here — logged under
  Known Gaps.

---

### 2026-09-23 — Kristen
- **SPM-31 (View Event Information): filled in the Overview tab (S-06) that
  SPM-47 built the shell of, and gave every event a durable, user-facing
  identity along the way.** The page already existed (`src/app/events/[id]/page.tsx`,
  built as scaffolding for SPM-47's Equipment tab) but the "❌ NOT BUILT YET"
  line in this doc's own Directory Structure was stale — the page has worked
  since 2026-09-19. Fixed here, and see Known Gaps (that row is now gone).
  - **Every event gets an auto-generated reference number**, e.g.
    `EVT-000123` (`Event.sequenceNumber`, `eventReference()` in
    `src/lib/format.ts`), shown next to the title for every role including an
    Attendee. Distinct from `id` (opaque, changes on every reseed) and from
    the new `Event.seedKey` (below).
  - **`Event.seedKey` persists `prisma/seed.ts`'s own natural key** (e.g.
    `"confirmed_claims"`) — previously an in-memory label only, per this
    doc's own note under Watch Out in `SCHEMA_REFERENCE.md`
    ("`Event` has no unique identifier at all"). Nullable; NULL for every
    event raised through the app itself, which has no equivalent concept and
    doesn't need one since production is never reseeded.
  - **Event URLs now use the reference, not the id** —
    `/events/EVT-000123`, not `/events/<uuid>`. `GET`/`PATCH
    /api/events/[id]` resolve the route segment via `parseEventReference()` +
    a lookup by `sequenceNumber`; the equipment sub-routes and a new
    `resolveEventId()` (`src/lib/apiAuth.ts`) do the same. Every
    internal link-building site was updated to match: the events list, the
    dashboard, the redirect after creating an event, and both
    `scripts/verify-permissions.ts` / `scripts/verify-login.ts`. **This is a
    bigger, cross-cutting change than SPM-31's own scope** — it touches the
    shared event route and `prisma/schema.prisma`, which other in-progress
    branches (venue suitability, equipment availability) also touch — flagged
    to the team before merging, not pushed yet.
  - **The Overview tab now names the organiser, their company, and the
    coordinator** — previously only the Equipment tab's "Event at a glance"
    sidebar named the coordinator, and nothing showed the organiser at all
    (the API didn't even fetch it). An Attendee sees the **company** only,
    never the organiser's personal name — a deliberate, narrow exception to
    `docs/PERMISSIONS.md`'s "organiser/client identity is withheld from an
    Attendee" rule, resolved via the event's own `organisation` relation kept
    separate from `organiser.organisation` (the two can differ — see the
    schema's note on `Event.organisationId`).
  - **Category and Preferred layout render capitalised** (`"conference"` →
    `"Conference"`), reusing `statuses.ts`'s existing `humanise()` (now
    exported) instead of showing the raw stored value.
  - **A draft has no Overview view at all** — only a submitted event does.
    Found because a test case's precondition (an info banner on Overview for
    a draft) didn't match what "My Events" actually does: it routes a draft
    straight to `events/[id]/edit`, which has no tabs and no link back to
    Overview, so that banner was only ever reachable by typing the address
    directly. Fixed by redirecting Overview to `/edit` whenever the fetched
    event's status is `draft`, and removed the now-dead banner code.
  - **Fixed a real crash, found while writing SPM-31's test cases, not
    invented for them:** an Attendee viewing the one event they're actually
    authorised to see (confirmed + registration open) got a broken page.
    `ATTENDEE_EVENT_FIELDS` (`src/lib/permissions.ts`) has never included
    `facilityRequirements` — it's internal planning information — so the
    field is simply absent from an Attendee's response, but the page
    unconditionally read `.length` off it. Fixed by treating it (and
    `expectedAttendance`, `preferredLayout`, `accessibilityNotes`,
    `specialRequirements`, `organiser`, `coordinator`) as optional and
    rendering each row only when present, rather than blank.
  - **An Attendee's Overview is now a genuinely curated subset**, not the
    same three-card layout as every other role with most fields showing
    "—". The whole "Venue requirements" card, and the "Expected attendance" /
    "Preferred layout" rows, are omitted entirely for an Attendee rather than
    shown empty — none of it is relevant to deciding whether to register.
  - Migrations: `20260922210000_add_event_seed_key`,
    `20260922213000_add_event_sequence_number`.
  - Tests: `vitest` 258/258, `tsc --noEmit` and `eslint` clean.
    `npm run verify:permissions` 45/45, `npm run verify:login` 29/29 (both
    updated for the new URL scheme and re-run against a live server, not just
    patched and assumed). Manually walked through every role in a real
    browser (Chromium) for both the URL change and the curated Attendee view;
    a throwaway test draft used for one of those checks was deleted
    afterwards.
  - Test cases: `docs/test-cases/SPM-31_*` — 19 cases covering viewing rights
    across every role, the reference number, the URL scheme, the draft
    redirect, and the curated Attendee view. Split off from an earlier
    combined "View and Update Event Information" story; the update/edit half
    moved to a new story, SPM-62, left in the backlog.
  - **Decisions confirmed for SPM-31 (2026-09-22/23):** an Attendee sees the
    company running an event but never the organiser's own name; the
    coordinator's name belongs on Overview itself, not only the Equipment
    tab's sidebar; assigning a coordinator should also move status
    `submitted` → `under_review` in the same action (an SPM-30 decision,
    recorded here because it changes `isAssignedCoordinator()`'s "or
    unassigned" clause that SPM-31's tests also touch) — an unassigned event
    can be approved or rejected by nobody, not "any coordinator," once
    SPM-30 ships.

---
### 2026-09-22 — Kayal
- **Clarification no longer sends an event anywhere — it stays in review, with
  the same coordinator, in both diagrams.** Asking the organiser a question
  pauses the review; it does not restart it. There is no reason to take the
  event away from a coordinator who already has its context, or to send it back
  through the assignment queue.
  - `docs/ConnectSphere_Status_Lifecycle.drawio` — "clarification needed" is
    now a loop on **Under review**: the event stays in that status while the
    organiser answers. It previously went back to **Draft**. The arrow is now
    attached to Under review at both ends rather than drawn loose. No other
    status or transition changed.
  - `docs/ConnectSphere_BPMN.drawio` — "Amend request per clarification" now
    leads to the coordinator's **Review event request**, labelled "back to
    coordinator". It previously went back to the organiser's **Submit event
    request**, labelled "resubmit". Three nearby shapes were nudged to make
    room for it; layout only.
  - No route writes `ClarificationRequest` yet, so this is the intended design,
    not current behaviour. Whoever builds the clarification loop should keep
    the event in `under_review` while a clarification is open.
- Linked both diagrams from the Companion documents list at the top of this
  file — until now only a code comment pointed at the lifecycle and nothing
  pointed at the BPMN — with a note to update the relevant diagram in the same
  PR as any change to the event lifecycle or the cross-role process.

### 2026-09-20 — Kayal
- **`PATCH /api/venues/[id]` — update a venue, or retire it** (SPM-39). The
  route had only GET and POST: there was no way to change a venue at all, and
  no way to retire one. Retiring is `isActive: false`, never a delete —
  `VenueBooking.venueId` has no cascade, so deleting a booked venue fails at
  the database, and past bookings must keep pointing at the room they were held
  in. A *present* `layouts` / `facilityIds` array replaces that relation
  outright (absent means "leave it alone"), which is how a layout or facility
  gets removed. `GET /api/venues` now returns active venues only unless you
  pass `?includeRetired=true` — a retired room must not reach a suitability
  check. `GET /api/venues/[id]` added for the edit screen.
- **New AC from Kristen (discussion board #120 and #122): affected bookings are
  flagged, never changed.** `VenueBooking` gains `needsReview` /
  `reviewReason` / `flaggedAt`, and the assigned Coordinator is notified.
  Nothing about the booking itself is touched — not its venue, layout, times or
  status — and `Event` is not written to at all. Which bookings count as
  affected lives in `src/lib/venueImpact.ts` as pure functions (34 tests, no
  database): the reasons are the difference between the problems the venue has
  *after* the edit and the problems it had *before*, which is what makes an
  unrelated edit, an already-broken booking, and the same form saved twice all
  stay quiet without extra bookkeeping. Candidates are `approved` bookings that
  have not yet finished — a pending booking is not a commitment, so there is
  nothing to protect by flagging it.
  - Migration: `20260919165337_add_venue_booking_review_flag` — three additive
    columns plus a `[needsReview, flaggedAt]` review-queue index.
  - **Not** covered yet: narrowed `opensAt`/`closesAt`. Those are wall-clock
    strings and `booking.startsAt` is a DateTime; the timezone convention for
    comparing them does not exist in this codebase yet, and guessing it would
    produce false flags on every edit. Deferred deliberately.
- **Venue catalogue UI (S-19, S-20)** — `/venues`, `/venues/new`,
  `/venues/[id]/edit`. Fields and validation are shared via
  `src/lib/venueForm.ts` and the *markup* via `src/components/VenueForm.tsx`,
  so create and edit cannot drift — the events screens share only their logic
  and duplicate ~200 lines of JSX, which this avoids inheriting. One route
  serves two audiences, gated on `can(role, "venue:manage")`: Venue Staff get
  Add venue, clickable rows and retired venues in the list; a coordinator gets
  the same list read-only, with the "Retired only" filter option hidden because
  they never receive retired rows (the same reasoning `/events` uses to hide
  "Draft" from a coordinator). Retire uses `ConfirmDialog` and names its real
  consequence (§7.5); the reason typed there is not stored on the venue, it goes
  into each coordinator's notification. The edit screen deliberately does **not**
  navigate away on save — the flagged bookings in the response are the only
  place a person is told the AC happened.
- **`notifyUser(tx, recipientId, {...})` added to `src/lib/notifications.ts`**,
  beside Kristen's `notifyRole`, sharing a `NotificationContent` type so the two
  cannot drift on fields. "The assigned Coordinator is notified" is one named
  person per affected booking, not a role queue — fanning it out would notify
  four coordinators about a room three of them are not responsible for.
  `notifyRole`'s parameter type now references that shared interface: same
  fields, same optionality, no caller changes.
- **Session-aware attendance.** After merging SPM-25 a booking may be
  session-scoped, so the impact check resolves
  `session.expectedAttendance ?? event.expectedAttendance` — a 20-person
  breakout is not affected by a room that no longer seats the whole conference.
  `EventFacilityRequirement` is still event-scoped, so the facility rule needs
  no fallback; noted at the query in case sessions ever gain their own.
- **Fixed `npm run lint` — closes that known gap.** `next lint` was removed in
  Next 16, so npm passed "lint" to `next` as a project directory and the script
  errored for everyone. Now `eslint .`, verified both ways: exit 1 with a real
  `react-hooks/rules-of-hooks` violation present, exit 0 on a clean tree.
  Deleted `.eslintrc.json`, which ESLint 9 was already ignoring in favour of
  `eslint.config.mjs`. Also gitignored and untracked `tsconfig.tsbuildinfo` —
  TypeScript's build cache was versioned, so it appeared as a machine-specific
  blob in unrelated diffs.
- **Opening hours fields**: the hint read "24-hour, e.g. 08:00." while the
  native time picker renders in the viewer's own locale, which is a 12-hour
  AM/PM face in some. The stored value was never wrong —
  `<input type="time">` reports 24-hour `HH:mm` whatever it displays — so the
  hint was the defect, not the input. Both times are now required, which fixes a
  second bug in the same fields: an emptied one was sent as `undefined`, which
  PATCH reads as "leave this alone", so the old value came back silently with
  nothing shown to the user.
- **Seed**: Jurong Training Room's classroom layout reduced 60 → 40 seats, so
  the one pre-flagged booking in the demo data is *justified* by the venue's own
  state rather than asserted — the Harbourline claims training expects 55. This
  changes a shared fixture, so it may affect another domain's demo.
- 24 manual test cases in `docs/test-cases/SPM-39_Test_Cases.xlsx` covering all
  seven of SPM-39's acceptance criteria, with 11 open questions recorded for
  Kristen. The two that block sign-off: there is no notifications screen to
  verify "the assigned Coordinator is notified" from, and no way to see or clear
  a flag once the save confirmation clears (see Known Gaps).
- `tsc --noEmit`, `eslint .` and `vitest` (162/162) all clean.

---
### 2026-09-20 — Kristen
- **Implemented SPM-23's new acceptance criterion: multi-session events**
  ("an event can be organised into multiple sessions, each with its own
  timing, expected attendance, venue and equipment requirements" — class
  clarification #74). The `EventSession` table has existed since 2026-09-18
  but nothing wrote to it; this is the application code on top. **No
  migration** — the schema already had everything the form needs.
  - **S-08 (both `events/new` and `events/[id]/edit`)** gets a *Sessions*
    section: a "This event has multiple sessions" checkbox that reveals a card
    per session — name (optional), starts/ends, expected attendance, preferred
    room layout, and that session's own equipment. Starts at two sessions;
    "Add session" / "Remove session" (disabled at two — one session is just an
    event). Ticking the box while event-level Schedule/Attendance are filled
    in moves those values into Session 1 rather than dropping them. While
    ticked, the event-level Schedule, Attendance and Equipment sections are
    hidden outright rather than shown and ignored. The section lives in one
    shared component, `src/components/SessionFields.tsx`, so create and edit
    can't drift.
  - **The event's own `startsAt` / `endsAt` / `expectedAttendance` are derived
    from its sessions** by `deriveEventFromSessions()` (`src/lib/eventSessions.ts`):
    earliest start, latest end, and the *largest* session's attendance (a venue
    holds one session at a time; summing would overstate it). They are never
    taken from the body alongside sessions. This keeps My events, the dashboard
    and the coordinator queue working untouched, and matches Kayal's SPM-39
    rule that session data wins and event data is the fallback
    (`api/venues/[id]`). "Registration must open/close before the event
    starts" is measured against the *first* session.
  - **Backend.** `sessions` added to `createEventSchema` and
    `updateEventDraftSchema` (≥2, or `[]` on an edit to switch it off; each
    session needs its own start and end even in a draft, because
    `event_sessions.starts_at`/`ends_at` are NOT NULL). `POST /api/events` now
    runs in one real transaction (the old comment said so; it wasn't) and
    writes sessions + their equipment via `writeSessions()` in two `createMany`
    statements regardless of session count. `PATCH` replaces sessions
    wholesale. Each session's equipment reservation window is *its own* times
    ±2h, not the event's. `GET /api/events/[id]` returns `sessions`, and each
    `equipmentRequests` row carries its `sessionId`. Submitting checks every
    session has an attendance ("Missing: session 2 expectedAttendance") — the
    event-level figure is non-null as soon as any one session has one, which
    would otherwise let an incomplete session through.
  - **Fixed a latent bug this made reachable:** replacing an event's
    event-wide equipment (`PATCH { equipment: [...] }`) ran
    `deleteMany({ eventId })`, which would have deleted every *session's*
    equipment along with it. Now scoped to `sessionId: null`. Verified: a
    `PATCH { equipment: [] }` leaves both session equipment rows in place.
  - **Known limits, both from the current schema and both deliberate — see
    Known Gaps:** the same equipment item can be requested once per *event*,
    not per session (`equipment_requests` is unique on event + item); and
    facility/accessibility ticks stay event-wide (`event_facility_requirements`
    has no session column). Fixing either is a migration on a table another
    domain owns, so it needs the team chat first. The form says so beside the
    equipment picker, and its picker hides items another session already
    chose (the same prevent-don't-reject approach as 2026-09-18).
  - **Also changed:** `LOAD_WINDOW_MS` was duplicated in both events routes;
    now `EQUIPMENT_LOAD_WINDOW_MS` / `equipmentWindow()` in one place.
    A `P2002` (unique-constraint) backstop on both routes turns a stray
    duplicate-equipment collision into a 400 instead of a 500.
  - **Reconciled with the team's updates:** Janelle's SPM-47 (equipment tab,
    session-aware `GET`) was merged then reverted on 2026-09-20, so it isn't
    on this branch — nothing here depends on it, but if it comes back its
    `GET /api/events/[id]` `sessions` include will collide with this one
    (trivially: same shape, `SESSION_SELECT` here also carries attendance and
    layout). Kayal's unmerged SPM-39 already reads `EventSession` for its
    attendance fallback; this is the first code that writes it.
  - **Fixed a raw "Invalid uuid" shown to users.** Adding an equipment row,
    leaving "Choose an item" unselected and clicking **Save draft** displayed
    Zod's default message, because `validateForm` skips everything but the
    title for a draft while the server still refuses a row with no item. Two
    changes: `equipmentItemSchema` (`src/lib/validation/events.ts`) now words
    both the item and quantity rules for the person at the form, and a shared
    `equipmentRowError()` (`src/lib/eventForm.ts`) runs the empty-row and
    quantity checks on a draft as well as a submit, for event-level rows and
    each session's. Verified in a browser: Save draft with an empty row stays
    on the form with "Choose an item for every equipment row, or remove the
    empty ones.", saves once an item is chosen, and a request that bypasses
    the form gets the same words back from the API.
  - Tests: `vitest` 175/175 (was 114) — new `eventSessions.test.ts` and
    `eventForm.test.ts`, plus session cases in `validation.test.ts`. `tsc
    --noEmit` and `eslint` clean. Verified against `next dev` + the seeded
    Neon branch: 38 HTTP checks (create, read-back, validation refusals,
    edit-replace, submit completeness, switching sessions off, a plain
    single-session event unchanged) and a 38-step Chromium walkthrough of the
    form (toggle, carry-over into Session 1, per-session errors and focus,
    cross-session equipment exclusion, add/remove, save and reopen, back to
    single-session, phone width). Both scripts cleaned up after themselves and
    were not kept.
  - Test cases: `docs/test-cases/SPM-23_*` regenerated. The Jira AC list now
    numbers the multi-session AC as **AC6**, which pushes "validates required
    information" to AC7 and "identifiable as a draft" to AC8; existing cases
    keep their IDs and were relinked, new ones are TC22–TC35. Cases log in as
    the seeded organiser (`rachel.ng@…`) but no case relies on any seeded
    *event* or draft: every event name carries the tester's initials so testers
    sharing that one account can tell their drafts apart. The few cases that
    request equipment or tick facilities use the seeded catalogue — there is no
    screen to create catalogue items. SPM-23-TC13 was also rewritten; it still
    described a rejection message the picker made unreachable on 2026-09-18.
    TC04/07/09/18 now check the result from My events, and TC10/11/14 save a
    draft and reopen it, because the request's own page (`/events/[id]`)
    still 404s; TC11 and TC14 also had no login or event name and couldn't
    have been run as written.
  - **Decisions confirmed for SPM-23 (2026-09-20):** a multi-session event's
    own attendance is the *largest* session, not the sum; a session's own venue
    requirements are its layout and attendance, with facility/accessibility
    ticks staying event-wide; one equipment item per *event* is accepted for
    now (see Known Gaps); "Save draft" needing each session's times is
    acceptable; a multi-session event has a minimum of two sessions; the
    seeded equipment/facility catalogue is acceptable for the cases that use it.

---
### 2026-09-19 — Janelle
- **AC6 visibility clarified: the Organiser keeps read-only access.** AC6
  ("Technical Support Staff can view the requirements") names one role, and
  an initial pass this same day removed the Organiser's existing read-only
  view on the reading that AC6 didn't ask for it. Reconsidered and confirmed
  the opposite: an Organiser reasonably wants to see what's been recorded
  against the event they raised, even though it's broader than AC6's literal
  wording — so the Organiser keeps read-only access, scoped to the event they
  own (never another client's). New `canViewEquipmentRequests()`
  (`src/lib/permissions.ts`) is the single source of truth for this: Technical
  Support always, the assigned Coordinator (because managing it already
  requires seeing it — not a second, independent viewing right), and the
  owning Organiser read-only. `UI_DESIGN.md` §4.3 and `docs/PERMISSIONS.md`
  updated to match.
- **Fixed the `EquipmentRequest` uniqueness gap flagged in the previous
  entry.** Two sessions of the same event can now each independently request
  the same equipment type. The single `@@unique([eventId, equipmentId])`
  couldn't express "dedupe whole-event requests, but not across sessions" in
  one index — Postgres treats NULL as distinct in a unique index, so a naive
  3-column version would have stopped deduplicating whole-event requests
  entirely (`sessionId` NULL, the common case). Replaced it with two Postgres
  **partial** indexes instead, one per case — see `SCHEMA_REFERENCE.md`. Not
  expressible via `schema.prisma`'s `@@unique` (no `WHERE` clause support), so
  they exist only in the raw migration SQL; `schema.prisma` has a comment
  warning not to add `@@unique([eventId, equipmentId])` back.
  - Verified live against the real database, not just reasoning about it:
    same equipment type on two different sessions of one event → now
    succeeds (was 400); same session twice → still correctly rejected; no
    session (whole event) twice → still correctly rejected, unchanged from
    before this fix.
  - Migration: `20260919100000_add_partial_unique_equipment_request_session`
- Regenerated `docs/PERMISSIONS.md`'s and `scripts/verify-permissions.ts`'s
  affected sections to match (`GET /api/events/[id]/equipment` enforcement
  row, the SPM-47 live-check group). All 45 live checks and 136 unit tests
  pass.

### 2026-09-18 — Janelle
- **SPM-47 (Record Equipment Requirements) gained a new AC mid-implementation**
  ("for a multi-session event, equipment requirements can be recorded per
  session"), added by Kristen per class clarification #74, alongside her
  schema-only multi-session groundwork on the separate SPM-25 branch
  (`EventSession` model, `EquipmentRequest.sessionId` /
  `VenueBooking.sessionId`, migration `20260918061723_add_event_sessions`).
  Cherry-picked just that schema + migration onto this branch (not the rest
  of SPM-25's unrelated, unreviewed application code) and built the session
  side of SPM-47 on top of it:
  - `POST /api/events/[id]/equipment` accepts an optional `sessionId`,
    validated to actually belong to the event it's posted against.
  - The Equipment tab shows a "Session" picker in Add equipment, but only
    for an event that actually has sessions - which is none of them today,
    since nothing creates an `EventSession` yet (SPM-25's own job). Every
    existing event behaves exactly as before.
  - Existing rows show their session as a small label when one is set.
- **Integrated with SPM-4's permission model properly rather than leaving my
  own bespoke role check.** `docs/PERMISSIONS.md` had anticipated Technical
  Support's future review action (`equipment_request:review`, still unused -
  SPM-48/49/50) but nothing for the Coordinator's own recording action, so I
  added `equipment_request:manage` + `canManageEquipmentRequests()`
  (assigned-coordinator relationship, same shape as `canEditEventContent`).
  This closed a real gap my routes had: previously *any* coordinator could
  edit *any* event's equipment, not just the one they're assigned to.
- **Known limitation surfaced, not hidden:** `EquipmentRequest`'s unique
  constraint is `(eventId, equipmentId)`, not `(eventId, sessionId,
  equipmentId)` - documented on the model itself and in
  `SCHEMA_REFERENCE.md`. Two sessions of the same event can't yet each
  independently request the same equipment type. Confirmed this live: adding
  the same item to two different sessions of one event correctly gets
  rejected today (see `docs/test-cases/SPM-47_test_cases.json`,
  `SPM-47-TC19`).
- Verified end to end against a real running server, not just reasoning
  about it: created real `EventSession` rows directly (no route does this
  yet), exercised session-scoped add / cross-event session rejection /
  the known-limitation rejection, all via the actual API, then cleaned up.
  `tsc --noEmit`, `eslint`, all 130 unit tests, and `next build` all pass.
- Migration: `20260918061723_add_event_sessions` (brought in from
  `origin/SPM-25-Submit-Event-Request`, not authored here).

### 2026-09-18 — Kristen
- **Fixed the "Filter by status" control on `/events` (S-07) for every
  non-organiser role** (coordinator, ops manager) — reported as "the filter
  does not work and still contains a draft option." Two separate bugs in
  `src/app/events/page.tsx`:
  - The filtered/unfiltered split only ever applied to the organiser's own
    view: `<DataState data={isOrganiser ? submitted : events} .../>` passed
    the *raw, unfiltered* `events` array for every other role, so changing
    the dropdown never changed what a coordinator or ops manager saw. Now
    uses the same `filtered` list (derived from `statusFilter`) the
    organiser's view already used.
  - `STATUS_FILTER_OPTIONS` was one flat, role-blind list including "Draft"
    for everyone, even though a non-organiser role never receives draft
    events from the API (`docs/PERMISSIONS.md` — drafts stay private to
    their owning organiser) — so selecting it always produced zero results.
    `statusFilterOptions` is now derived per role and drops "Draft" for
    anyone but the organiser.
  - Updated SPM-25-TC07, which explicitly selected the "Draft" filter as the
    coordinator — that option no longer exists, so the test now checks it
    isn't offered at all, then confirms the draft is absent from the
    unfiltered ("All statuses") view instead. Also strengthened TC06 to
    assert every row still visible after filtering to "Submitted" actually
    shows that status, since the original wording would not have caught
    this bug (the event was always present regardless of the filter, just
    for the wrong reason).
  - Verified in a real browser (Playwright, logged in as
    daniel.tan@connectsphere.com): the filter dropdown no longer lists
    "Draft," and selecting "Confirmed" narrowed the table from 28 rows to
    7, all showing a "Confirmed" badge. `tsc --noEmit`, `eslint` and
    `vitest` (114/114) all clean.
- **The equipment picker no longer lets an organiser select the same
  catalogue item twice**, instead of letting them and then rejecting it.
  Found while checking SPM-24-TC13 against the code: that test expects the
  message *"Each item can only be requested once — change the quantity
  instead of adding a second row."* (from `validateForm` in
  `src/lib/eventForm.ts`), but TC13's steps click "Save draft" — and
  `validateForm` skips every check past the title for `intent === "draft"`
  (by design, UI_DESIGN.md §6.2), so that client message can never actually
  appear there. What TC13's exact steps produce is the *other* copy of this
  rule, the Zod `.refine()` in `src/lib/validation/events.ts` ("Each piece of
  equipment can only be requested once — change the quantity instead") —
  two hand-written copies of one rule had quietly drifted into different
  wording depending on which button was clicked.
  - Rather than reconciling the wording, removed the error case entirely:
    new `availableEquipmentOptions()` in `src/lib/eventForm.ts` filters each
    row's dropdown to exclude items already chosen in another row, so a
    duplicate can no longer be picked through the picker on either page
    (`events/new`, `events/[id]/edit`). Once every catalogue item is already
    in the request, "Add equipment" disables itself with a line saying so,
    rather than adding a row whose dropdown would have nothing left to
    offer.
  - The two rejection messages above still exist in the code (the Zod rule
    is an unchanged safety net for anything that reaches the API directly)
    but are no longer reachable by clicking through the app, so
    SPM-24-TC13 was rewritten to test the prevention instead of the
    rejection, and a TC13b added for the "every item already used" edge
    case — see `docs/test-cases/SPM-24_test_cases.json`.
  - Verified in a real browser (Playwright against `next dev`): picked an
    item in row one, added a second row, and confirmed that item was absent
    from the second row's option list. `tsc --noEmit`, `eslint` and
    `vitest` (114/114) all clean.
- **`focusFirstError()` (`src/lib/formErrors.ts`) now scrolls to a form-level
  error too, not just a field-level one.** It already scrolled a specific
  field into view when a server rejection was attributable to one; when it
  wasn't (a network failure, or a rejection with no field to blame), the
  function silently did nothing, leaving the top-of-form `Alert` off-screen
  and invisible on any form long enough to scroll — exactly UI_DESIGN.md
  §7.3's "never a blank page" failure, just for a banner instead of a whole
  screen. Since that `Alert` always renders as the form's first child, the
  fix is to scroll the `<form>` itself to `block: "start"` when there's no
  field key, which brings the banner into view the same way scrolling to a
  field already did.
  - Wired the same call into the network-failure `catch` blocks on
    `register`, `events/new` and `events/[id]/edit`, which set `formError`
    but never called `focusFirstError` at all before this — so "Could not
    reach the server" had the identical invisible-banner problem on every
    form that can show it, independent of the field-attribution fix above.
  - `login` intentionally left unchanged: its form is two fields and always
    fits above the fold, so there's nothing to scroll past.
  - Verified in a real browser (Playwright against `next dev`): filled the
    long S-08 form, scrolled to the bottom, forced the create request to
    fail, and confirmed the page auto-scrolled back up to reveal the "Could
    not reach the server" alert.
- **Fixed a field-attribution bug in `handleDraftEdit`** (`api/events/[id]/route.ts`,
  found via SPM-24-TC11 failing manual QA): saving a draft with, say, `endsAt`
  before the already-saved `startsAt` returned a bare `{ error: "..." }`, which
  `readServerError()` (`src/lib/formErrors.ts`) can only render as a top-of-form
  Alert — it has no field to attach the message to. UI_DESIGN.md §7.2 expects
  this specific rule inline under "Ends at", not as a banner, since it's
  attributable to one field. All six of this handler's hand-rolled cross-field
  checks (`endsAt`/`startsAt`, registration capacity/open/close, equipment
  needing dates) had the same bug, not just the one TC11 caught — all six now
  return `details.fieldErrors` in the same shape Zod's `flatten()` already
  produces elsewhere in this file, so the existing client mapping picks them up
  with no frontend change. Message wording also brought in line with the
  equivalent client-side messages in `src/lib/eventForm.ts` (e.g. "Ends at must
  be after starts at.") rather than the raw camelCase field names the old
  messages used. Verified against the running app: reproduced TC11's exact
  steps (PATCH `endsAt` alone to before the saved `startsAt`) and confirmed the
  response now carries `details.fieldErrors.endsAt`. `vitest` 114/114,
  `tsc --noEmit` and `eslint` both clean.
- **Restricted Cancel Event to the assigned Coordinator only.** Audited the
  Jira backlog against the class clarification Q&A and found
  `STATUS_TRANSITION_ROLES.cancelled` in `src/lib/permissions.ts` granted
  cancellation to the Organiser and Ops Manager too, contradicting the actual
  answer (#68: "only the event coordinator in-charge can set it"). Narrowed
  the role list, updated the matching unit test and `docs/PERMISSIONS.md`'s
  table. All 34 permission tests still pass.
- **New: `EventSession` model** (multi-session events — briefing #74:
  "sessions may have different timings and operational requirements,
  including different venues, equipment requirements and attendance limits").
  Additive only: `VenueBooking.sessionId` and `EquipmentRequest.sessionId` are
  nullable, so every existing single-session event keeps working unchanged
  (`sessionId` NULL = "applies to the whole event"). No route reads or writes
  `EventSession` yet — see Known Gaps. `EquipmentRequest`'s unique constraint
  stays `(eventId, equipmentId)` rather than including `sessionId`, since
  Postgres treats NULL as distinct in a unique index and a three-column
  version would silently stop deduplicating requests on the common
  (single-session) case — noted as a limitation in `SCHEMA_REFERENCE.md`.
  - Migration: `20260918061723_add_event_sessions`
- **Implemented SPM-25 (Submit Event Request).** All four of its acceptance
  criteria were already true of the existing code once SPM-4's role checks
  landed — verified, not rebuilt: a complete draft submits and moves
  `draft → submitted` (`canSetEventStatus` + the draft-completeness check in
  `handleStatusChange`), a submitted request 400s out of `handleDraftEdit`
  (draft-only), and the assigned/coordinator role can `GET` it once it has
  left `draft` (`canViewEvent`).
- **Moved the "relevant users receive a notification" AC off this story and
  onto SPM-53** (*Receive Event Notifications*, epic SPM-20 *Notification
  System*), whose first AC already names the exact same behaviour and which
  also owns the still-unbuilt S-04 screen needed to actually see one. Keeping
  it on SPM-25 made "done" here depend on unscheduled infrastructure outside
  the submission workflow's own scope — removed from the Jira description,
  with the two stories cross-linked and the reasoning left as comments on
  both.
- **New: `src/lib/notifications.ts`** (`notifyRole`) anyway, as a head start
  on SPM-53 rather than as this story's own deliverable. `Notification` has
  existed in the schema since the original build but nothing in the codebase
  ever wrote a row to it. Kept as a transaction helper (takes the `tx` from
  the caller's `prisma.$transaction`) rather than a standalone write, so a
  notification can never be created for a status change that then fails to
  commit.
- Wired into `handleStatusChange` in `api/events/[id]/route.ts`: submitting
  an event (`draft → submitted`) notifies every active Ops Manager, not the
  organiser's own coordinator — no coordinator is assigned yet at this point
  in the briefing's §5 process (assignment is Step 3, the Ops Manager's job),
  so the Ops Manager queue (S-28) is who actually needs to act next. SPM-53
  reuses this helper for its other eight triggers rather than rewriting it.
- Verified against the running app (`next dev` + the seeded Neon branch, real
  HTTP requests): created a draft as an organiser, submitted it, confirmed
  the 400 on a further draft-edit, confirmed a coordinator can `GET` it, and
  confirmed one `Notification` row per active Ops Manager was written with
  `type: "event_submitted"` and `eventId` set. `vitest` 114/114 (unchanged —
  no existing rule was touched), `tsc --noEmit` and `eslint` both clean.
- Not done here, and not this story's scope: an S-04 notifications
  screen/endpoint to read them back. The top-bar bell already links to
  `/notifications`, but the route and a `GET /api/notifications` endpoint
  don't exist — tracked on SPM-53.

### 2026-09-18 — Jordan (SPM-21, later the same day)
Audited the four acceptance criteria of **SPM-21 (User Login)** against the
running app. AC1 (valid credentials authenticate) and AC2 (invalid credentials
are refused with a message) already held. AC3 and AC4 held at the route layer —
`verify:permissions` was 36/36 — but both were reachable around the side:

- **Anyone could self-assign an internal role.** `POST /api/auth/register` takes
  no session and passed `role` from the request body straight to
  `prisma.user.create`, accepting all six roles. An anonymous request created an
  `ops_manager`, which then read every client's events with `organiserId`,
  `organisationId` and `coordinatorId` attached — the exact case briefing §8b
  names. The permission model was being enforced perfectly against a role the
  caller had chosen for themselves. Registration is now limited to the two
  external roles via `SELF_REGISTERABLE_ROLES` (`src/lib/roles.ts`), enforced in
  `registerSchema` and mirrored in the S-02 dropdown, which had been offering
  "Operations Manager" to the public.
  - Note for whoever reads `docs/PERMISSIONS.md` §8: the open item there said
    "Zod guards the register route". Zod guarded that the role was one of six
    valid *strings*, not that the caller was entitled to it. Corrected.
- **A deactivated account could log in.** `POST /api/auth/login` never checked
  `isActive`, and `/api/auth/me` was the one route not going through
  `getActor()`, so it skipped the check too. The result was a user who logged in
  "successfully", saw the signed-in chrome, and then had every data route 401 and
  bounce them back to `/login` — a loop, not a refusal. Login now refuses with a
  403 that says why, and `me` uses `getActor()` like everything else.
- **Cancellation narrowed to the Event Coordinator** (customer clarification,
  2026-09-18). `STATUS_TRANSITION_ROLES.cancelled` was
  `["coordinator", "organiser", "ops_manager"]` and is now `["coordinator"]`;
  `event:cancel` dropped off the organiser and Ops Manager role lists to match.
  Cancelling releases the venue, frees the equipment and drops the attendee
  list, so it is ConnectSphere's call rather than the client's. **Postponement
  was deliberately left alone** — an organiser may still postpone their own
  event. A new test asserts `can()` and `STATUS_TRANSITION_ROLES` agree about
  `event:cancel`, so the two halves cannot drift apart again.
- **New: `scripts/verify-login.ts`** (`npm run verify:login`) — SPM-21's
  acceptance check against a running server, 29 checks labelled AC1-AC4 so the
  output goes straight into the test evidence. Includes the cancellation rule
  end to end and an assertion that a wrong password and an unknown email are
  refused *identically* (no account enumeration). Creates its own throwaway
  account and event and deletes both; safe to re-run.
- **Tests: 123 passing (was 114).** `loginSchema` had no unit test at all —
  AC1 and AC2 were the two criteria with nothing traceable to them. Added those
  plus the self-registration guard and the cancellation rule.
- **Verified:** `vitest` 123/123, `verify:login` 29/29, `verify:permissions`
  36/36 (unchanged), `tsc --noEmit` and `eslint src scripts` clean.
- ⚠️ **Knock-on effects, both now in Known Gaps:** there is no in-app way to
  create a staff account any more (seed only), and an organiser has no way to
  request cancellation until Event Change Requests has an endpoint.

### 2026-09-18 — Jordan
- **SPM-4 (role and permission model) implemented end to end.** Closes the
  "role-based authorisation is largely unimplemented" gap I flagged on
  2026-09-13.
- **New: [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md)** — the model in prose:
  the six roles, a role × action matrix, the three relationship rules, which
  fields an attendee may see, who may set each status, where each rule is
  enforced, and what is still open. Every row traces to the customer briefing
  (§8b, §5 Steps 1-14) rather than to our own guesswork.
- **New: `src/lib/permissions.ts`** — the same model as code. Pure functions
  over plain data (no Prisma, no `NextRequest`), so the whole thing unit tests
  without a database: `can(role, action)` for the role half,
  `canViewEvent` / `canEditEventContent` / `canSetEventStatus` for the
  relationship half, `eventListWhere()` for list queries, and
  `visibleEventFor()` for field-level narrowing.
- **New: `src/lib/apiAuth.ts`** — `getActor(req)` plus `unauthenticated()`,
  `forbidden()` and `hidden()`. `getActor` loads the user's *current* role,
  `organisationId` and `isActive` per request rather than trusting the
  eight-hour-old JWT, so a role change or a deactivated account takes effect
  immediately. `organisationId` is not in the token at all, and is what makes
  client scoping possible.
- **Holes closed** (each one read out of the route code, then covered by a unit
  test against the permission model — see the verification note at the end of
  this entry):
  - `PATCH /api/events/[id]` had **no role check on status transitions**. Once
    an event left `draft`, any signed-in user — an attendee — could drive it to
    `confirmed`, `rejected` or `completed`, writing `rejectionReason` and an
    `EventStatusHistory` row under their own id. Now gated by
    `canSetEventStatus()`: the organiser submits their own request, the Ops
    Manager assigns, the assigned coordinator decides.
  - `POST /api/venues` and `POST /api/equipment` accepted **unauthenticated**
    requests — anyone on the internet could add a venue or equipment. Both GETs
    were open too. Now `venue:manage` / `equipment:manage` and their view
    permissions.
  - `GET /api/events/[id]` returned the **whole** record — `coordinatorId`,
    `rejectionReason`, `specialRequirements`, equipment and facility
    requirements — to any signed-in user, including an attendee. Briefing §8b
    names that exact case. `visibleEventFor()` now narrows it to the public
    subset; hiding the tab in the UI never did anything to the API.
  - An organiser could read **another client's** events, the other case §8b
    names. `Event.organisationId` was being written on create and never read
    by any query; `eventListWhere()` / `canViewEvent()` now use it.
  - `POST /api/registrations` accepted a registration from any role.
- **Tests: 114 passing (was 80).** 34 new in
  `src/lib/__tests__/permissions.test.ts`, including one named for each of the
  two examples the briefing spells out in §8b, so the acceptance criteria trace
  to a test by name. `tsc --noEmit` and `eslint` both clean.
- **Docs:** the "pattern to copy for a new endpoint" now starts with
  authenticate + authorise and lists 403 — it previously showed a handler with
  no session check at all, which is a fair part of why four routes shipped
  without one. Access rules are now tracked in the business-rules table
  alongside the others, and open items have moved out of dated changelog
  entries into a new [Known Gaps](#-known-gaps) section.
- **New: `scripts/verify-permissions.ts`** (`npm run verify:permissions`) — the
  acceptance check for this story against a **running** server. Unit tests
  prove the rules are right; they cannot prove a route remembered to call them,
  which is exactly how the original gap happened. 36 checks sign in as all six
  seeded roles and assert the real HTTP status of each refusal and each
  permitted action, labelled by acceptance criterion so the output can go
  straight into the test evidence. It creates its own event through the API and
  deletes everything it made, so it is safe to re-run and never touches seeded
  data.
- **Verified:** `vitest` 114/114, `verify:permissions` 36/36 against
  `next dev` + the seeded Neon branch, `tsc --noEmit` and `eslint` clean.
  Two of those 36 refusals come back 404 rather than 403 — an attendee cannot
  *see* a submitted event, so visibility refuses before the role check is
  reached. That is the stronger answer and it is the documented rule; the role
  check is asserted separately on an event the attendee *can* see.
- ⚠️ **Not done here:** lifecycle validation (which `from → to` moves are
  legal, as opposed to who may make them), the Coordinator Assignment
  endpoint, and route-level integration tests. All three are in Known Gaps.
### 2026-09-17 — Janelle
- **Split `src/lib/validation.ts` into `src/lib/validation/<domain>.ts`**
  (`auth.ts`, `events.ts`, `venues.ts`, `equipment.ts`, `registrations.ts`),
  plus an `index.ts` barrel re-exporting all five.
- Why: this file was called out in
  [Avoiding Merge Conflicts](#-avoiding-merge-conflicts) as one of only two
  shared files everyone eventually edits, and it was the more avoidable of the
  two — unlike `schema.prisma`, nothing about Zod schemas actually requires
  one file. Splitting it by domain means adding a schema for your own
  endpoint no longer touches a file someone else is also mid-edit on.
- Every existing `@/lib/validation` and `../validation` import — all 10 of
  them, across routes, pages, and tests — resolves unchanged via the barrel;
  none needed editing. No schema, type, or validation rule was added, removed,
  or changed. Verified with `tsc --noEmit`, `eslint`, the full test suite, and
  `next build`, all passing identically to before the split.
- Migration: none — no schema/database change.

### 2026-09-16 — Kristen
- **Implemented SPM-24 (Save Draft Event Request) end to end.**
  - Backend: added `updateEventDraftSchema` (`src/lib/validation.ts`, every
    field optional — an edit may only be touching one thing) and a
    content-edit path on `PATCH /api/events/[id]` (`handleDraftEdit`),
    dispatched by body shape alongside the existing status-transition path
    (`handleStatusChange`): a body with `status` transitions the lifecycle,
    anything else edits the draft's own fields. Content edits are restricted
    to the owning organiser and to events still in `draft` status — once
    submitted, changes belong to `EventChangeRequest`, not this endpoint.
    Cross-field rules (e.g. `endsAt` after `startsAt`) are checked against the
    *merged* record, not just the payload, since a partial edit might only
    touch one side of a two-field rule.
  - `GET /api/events/[id]` now requires auth (previously had no session check
    at all) and 404s a draft for anyone but its organiser, matching the
    scoping `GET /api/events` already applied to the list.
  - Frontend: extracted the create form's fields, options, `validateForm` and
    `toIso` into `src/lib/eventForm.ts`, plus a new `toFormValues()` that maps
    a fetched draft back into form state. Both `events/new/page.tsx` and the
    new `events/[id]/edit/page.tsx` (S-08's edit route, per `UI_DESIGN.md`)
    import from there, so create and edit can't drift apart. The edit screen
    loads the draft, shows a Draft badge, and offers the same Save draft /
    Submit request / Cancel actions as create — its payload builder
    deliberately differs from create's, though: it always sends text fields,
    `facilityIds` and `equipment` as their literal current value (even
    empty), because on this endpoint `undefined` means "don't touch this
    field" — collapsing an intentionally-cleared field to `undefined` the way
    the create form does would silently fail to clear it.
- **Closed a draft-privacy gap that predates this story.** `GET /api/events`
  (list) only scoped results by `organiserId` for the `organiser` role —
  every other role (coordinator, venue_staff, tech_support, ops_manager,
  attendee) got `where: {}` and could see every organiser's drafts. Non-
  organiser roles now get `status: { not: "draft" }`. This is the
  events-specific slice of the "role-based authorisation... largely
  unimplemented" gap Jordan flagged 2026-09-13 — narrowed here, not closed
  project-wide (venues/equipment routes are still open).
- **Closed a second, more serious hole in the same area:** the
  status-transition path (`handleStatusChange`) had no ownership check at
  all, so someone who got a 404 from `GET` on a draft could still
  `PATCH {"status":"submitted"}` on that same id and force a change on a
  draft they could never see or edit. Added an ownership check there too —
  verified exploitable before the fix, closed after, with the legitimate
  owner's submit flow re-verified unaffected.
- **Fixed a real bug found while testing the above, not caused by it:**
  `PATCH /api/events/[id]` did `return handleStatusChange(...)` /
  `return handleDraftEdit(...)` **without `await`**. Returning a promise from
  inside a `try` block doesn't let that block's `catch` see a later
  rejection, so *any* `ZodError` on this endpoint — bad status enum, invalid
  uuid, blank title, anything — was escaping as an unhandled rejection and
  crashing with a 500 instead of the intended 400. This affected every
  validation path on the endpoint, not just the new draft-edit code. Fixed by
  awaiting both calls.
- **Event titles can no longer be just whitespace.** `title` in both
  `createEventSchema` and `updateEventDraftSchema` is now
  `z.string().trim().min(1, "Title cannot be blank")` — previously `" "`
  passed `min(1)`'s length check and could be saved as a name. `.trim()` also
  strips incidental leading/trailing whitespace from a valid title before
  it's stored.
- **Fixed a session bug:** after logging in, the sidebar stayed empty until a
  manual refresh. `useCurrentUser()` fetches `/api/auth/me` once on mount,
  and `AppShell` (which renders the sidebar) stays mounted across
  client-side navigations — the App Router doesn't remount a layout just
  because `router.push` fires. `LoginPage` doesn't call `useCurrentUser()`
  itself, so `AppShell`'s already-mounted instance never learned a token now
  existed. `saveToken`/`clearToken` (`src/lib/session.ts`) now notify
  subscribers, and `useCurrentUser` re-fetches on that notification instead
  of only on mount.
- `.gitignore`: added `AGENTS.md`/`CLAUDE.md` — Next.js 16 (`next dev`)
  regenerates these itself on every run as AI-assistant guidance for
  breaking API changes in this Next version; they're build output, not
  project source.
- **Fixed a dashboard routing bug found while writing SPM-24 test cases:**
  every event card on `/dashboard` (`src/app/dashboard/page.tsx`) linked to
  `/events/{id}`, but no route matches that — `src/app/events/` only has
  `new/page.tsx`, `page.tsx` (the list) and `[id]/edit/page.tsx`. `draft` is
  one of the two statuses an organiser's dashboard surfaces ("Needs your
  attention"), so clicking any draft card there landed on Next's default 404.
  Draft cards now link to `/events/{id}/edit` instead. Non-draft cards still
  point at `/events/{id}`, which stays 404 until a general event-detail
  screen is built — noted in the directory tree above as a known gap, not
  fixed here.
- Everything above was verified against the running app (`next dev` + the
  seeded Neon branch, real HTTP requests with seeded users across roles), not
  just unit tests. Added coverage for the new schema behaviour in
  `src/lib/__tests__/validation.test.ts`. 80/80 tests passing (was 77);
  `tsc --noEmit` and `eslint` both clean.

### 2026-09-14 — Kristen
- Reconciled SPM-23 with Jordan's SPM-7 merge, which independently rebuilt the
  same "create event request" backend around structured `facilityIds` +
  `equipment` (see his 2026-09-13 entry) — that design is a deliberate,
  documented improvement over my original `facilityRequirements`/
  `equipmentNotes` free-text approach and is kept as-is.
- **Restored** `registrationOpensAt`/`registrationClosesAt` in
  `createEventSchema` and the `POST /api/events` handler — these were dropped
  as incidental merge fallout (unrelated to Jordan's facility/equipment
  redesign) rather than a decision anyone made. Also restored the missing
  `facilityRequirements` include on `GET /api/events` (list), matching
  `GET /api/events/[id]`.
- **Removed** `Event.equipmentNotes` (nullable String) — fully superseded by
  Jordan's structured `EquipmentRequest` creation, so the column was dead.
  Migrations: `20260914022334_drop_event_equipment_notes`.
- Fixed two tests in `src/lib/__tests__/validation.test.ts` that were silently
  passing/failing against removed fields (Zod ignores unknown keys by
  default, so a "rejects" assertion against a dead field just returns
  `success: true` instead of failing loudly) — the suite was red before this
  fix. Added coverage for the restored registration-window fields.
- Wired the restored registration window into S-08 (`src/app/events/new/page.tsx`)
  per `UI_DESIGN.md` §6.2: "Registration opens" / "Registration closes"
  datetime fields, hidden until "Attendees need to register" is ticked (same
  pattern as capacity), with client-side validation mirroring the server
  (closes after opens, both before the event start). Added the "both before
  event start" rule to `createEventSchema` itself too — it was in the design
  spec but missing from the Zod schema.
- Verified in a real browser (Playwright against `next dev` + the seeded
  Neon branch): full form renders, the two fields correctly show/hide with
  the checkbox, and an end-to-end submit persists `registrationOpensAt`/
  `registrationClosesAt` on the created draft.

### 2026-09-13 — Jordan
- **SPM-7 (design the user interface).** Added `UI_DESIGN.md`: 28 screens with
  stable IDs, the navigation map, the role/tab permission matrix, form field
  specs, and 17 domain error states. Visual mockups for all five roles are in
  `design/mockups/` (one `.dc.html` per screen). **Read the spec before
  building a screen** — see the new [Frontend and Design System](#-the-frontend-and-the-design-system)
  section.
- Added the shared component library (`src/components/ui/`) and the role-aware
  app shell (`src/components/AppShell.tsx`), plus `roles.ts`, `statuses.ts`,
  `format.ts`, `formErrors.ts` and `cn.ts` in `src/lib/`. Rebuilt the homepage,
  login, register, dashboard and events screens on top of them; added S-08, the
  event request form.
- Applied the ConnectSphere theme: deep teal on a warm ivory ground, Geist for
  body text (vendored, no network) and Source Serif 4 for titles. **All colours
  now live in `tailwind.config.ts` as semantic tokens** — `bg-surface`,
  `text-ink-2`, `border-line`. No screen should contain a raw Tailwind grey
  again.
- **Facility and equipment requirements are now rows, not prose.** Added
  `GET /api/facilities` and extended `createEventSchema` with `facilityIds`
  and `equipment`; `POST /api/events` writes `event_facility_requirements` and
  `equipment_requests` in the same create. This is what makes venue suitability
  (story 11) buildable — free text cannot be matched against what a venue has.
  No migration: the tables already existed.
  - ⚠️ **Janelle:** the events route now writes `EquipmentRequest`, which is
    your table. It only ever inserts rows for the event being created, with
    `status: "requested"` for you to review. Shout if you would rather this
    moved behind an equipment endpoint.
  - Equipment needs event dates (`EquipmentRequest.starts_at/ends_at` are NOT
    NULL), so that section of the form stays hidden until the event has a start
    and an end. The reservation window is the event times ±2 hours for load-in
    and load-out.
- Tests: 64 passing (was 48). New suites for `roles`, `statuses`, `format` and
  `formErrors`, plus schema tests for the new requirement rules.
- ⚠️ `npm run lint` is broken on Next 16 — use `npx eslint src --ext .ts,.tsx`.
  Noted in [Everyday Commands](#-everyday-commands).
- ⚠️ **Known gap, not fixed here:** there is still no `.env.example`, so a fresh
  clone has no template for `DATABASE_URL` / `JWT_SECRET`. Without them
  `src/lib/auth.ts` throws at import and **every API route returns 500**.
- ⚠️ **Known gap:** role-based *authorisation* is largely unimplemented.
  `PATCH /api/events/[id]` has no role check, `GET /api/events/[id]` has no
  session check, and `POST /api/venues` and `POST /api/equipment` have no auth
  at all. Non-organiser roles currently see every event. Needs its own story.

### 2026-09-12 — Kristen
- Implemented the "Create Event Request" backend (SPM-23): `POST /api/events`
  now accepts `facilityRequirements` (structured venue/accessibility links to
  the `Facility` catalogue), `equipmentNotes` (free text), and
  `registrationOpensAt`/`registrationClosesAt`, alongside the existing name,
  purpose, description, date/time, attendance and registration fields.
  Unknown `facilityId`s are rejected with a 400 instead of a raw FK error.
  `GET /api/events` and `GET /api/events/[id]` now include
  `facilityRequirements`. A new event is still created with `status: "draft"`
  (identifiable as a draft) and only `title` is required at creation —
  completeness is enforced at submission time, unchanged, in
  `api/events/[id]` PATCH.
- Added `Event.equipmentNotes` (nullable String). Migration:
  `add_event_equipment_notes`.
- Added Zod tests for the new `createEventSchema` fields in
  `src/lib/__tests__/validation.test.ts`.
### 2026-09-10 — Kristen
- Added `prisma/seed.ts` and a `prisma.seed` entry in `package.json`; run with
  `npx prisma db seed`. 12 organisations, 71 users, 16 venues, 26 equipment
  types, 23 events, 19 bookings, ~230 registrations. All accounts use
  `password123`.
- Added `SCHEMA_REFERENCE.md` — per-table field reference, allowed status
  values, and the common queries. Regenerate it if you change the schema.
- Rewrote this document to version 3.0: schema is built, business rules now
  live in route code, new troubleshooting entries, Neon branch workflow.
- Dependencies: added `dotenv` (was missing, broke `prisma.config.ts`) and
  `tsx` (needed to run the TypeScript seed). Regenerated `package-lock.json`.
- Node requirement corrected from "20+" to **20.12+** — Vitest needs
  `styleText` from `node:util`.
- Deleted stray `src/lib/auth.test.ts` — a duplicate of the real file in
  `src/lib/__tests__/`, whose assertions checked the token string instead of
  the decoded payload, so it passed while testing nothing.

### 2026-09-10 — Kayal
- Built the full schema: **17 tables** covering all 20 core features.
  Migration: `init`
- Reconnected all 8 API routes and `src/lib/validation.ts` to the new schema.
  Notable renames: `User.name` → `fullName` (still `name` in the API),
  `Event.proposedDate`/`timeSlot` → `startsAt`/`endsAt`,
  `Event.accessibilityNeeds` → `accessibilityNotes`,
  `EventStatusHistory.oldStatus`/`newStatus` → `fromStatus`/`toStatus`,
  `prisma.equipmentItem` → `prisma.equipment`,
  `Registration.dietaryNeeds` → `dietaryRequirements`.
- **Role values changed** to `organiser` / `coordinator` / `venue_staff` /
  `tech_support` / `attendee` / `ops_manager`. These are carried in the JWT —
  anyone with an old token must log in again.
- `Registration` has `@@unique([eventId, attendeeId])`. Withdrawn attendees
  can't re-INSERT, so the route reactivates their existing row instead.
- ⚠️ **Frontend still to update:** `src/app/events/page.tsx` posts
  `proposedDate`/`timeSlot`, which no longer exist. The venue form posts
  `location`/`capacity`, now `building`/`maxCapacity`.
- Business rules (venue suitability, booking conflicts, equipment availability)
  are NOT enforced by the database — see
  [Business Rules](#-business-rules-live-in-code-not-the-database).

### 2026-09-09 — Kayal
- Reset `prisma/schema.prisma` to blank (generator + datasource only) and
  deleted `prisma/migrations/`
- Ran `npx prisma db push --force-reset` to drop all 20 existing tables in
  the shared Neon database
- Reason: starting the database design over from scratch, built by hand this
  time domain by domain instead of using the earlier generated base

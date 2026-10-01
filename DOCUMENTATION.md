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
│   ├── seed-spm30.ts            # `npm run fixtures:spm30` — SPM-30 test data, no reseed
│   └── seed-spm28.ts            # `npm run fixtures:spm28` — SPM-28 test data, no reseed
│   └── seed-spm42.ts            # `npm run fixtures:spm42` — SPM-42 test data, no reseed
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
    │   ├── events/[id]/equipment/page.tsx  # S-16, the Equipment tab (SPM-47)
    │   ├── events/[id]/booking/new/page.tsx # S-15 Venue booking request (SPM-42), from
    │   │                                "Request booking" on the Venue tab
    │   ├── bookings/page.tsx            # S-22 Booking Requests, Venue Staff. SPM-42:
    │   │                                read-only pending list; no Approve/Reject yet
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
    │   │
    │   └── api/                     # ← THE BACKEND. Each folder = one "service"/domain.
    │       ├── auth/                   (Jordan)
    │       ├── events/                  (Kristen) — incl. events/[id]/coordinator
    │       │                                (PUT: assign/reassign, SPM-30)
    │       ├── assignments/              (Kristen) — the S-28 queue's data (SPM-30)
    │       ├── queue/                    (Kristen) — the S-12 Review Queue's data (SPM-28)
    │       ├── venues/                   (Kayal)
    │       ├── venue-bookings/            (Sammi) — pending requests for Venue Staff (SPM-42);
    │       │                                an event's own are under events/[id]/venue-bookings
    │       ├── facilities/                (Kayal — reference data for forms + venue search)
    │       ├── equipment/                  (Janelle)
    │       └── registrations/               (Sammi)
    │
    ├── components/
    │   ├── AppShell.tsx        # Top bar + role-aware sidebar. Wraps every route.
    │   ├── SessionFields.tsx    # S-08's "Sessions" section, shared by events/new and events/[id]/edit
    │   ├── AssignCoordinator.tsx # SPM-30: the assign/reassign control, shared by
    │   │                          /assignments and the event Overview page
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
        ├── venueSlots.ts                  # AM/PM/Night slots, setup/turnaround as whole
        │                                   adjacent slots (#50/#107/#108/#123). Written
        │                                   for SPM-46; SPM-40 carries an identical copy
        │                                   so the two branches merge cleanly - change it
        │                                   on ONE branch only.
        ├── venueSearch.ts                 # SPM-40 filter rules, pure - no Prisma. One
        │                                   function per AC; searchVenues() keeps only
        │                                   venues passing every filter (AC7).
        ├── venueSearchForm.ts             # SPM-40 form values: pre-fill from an event,
        │                                   query string, client-side checks
        ├── venueBookingRequest.ts         # SPM-42 request rules, pure: chosen slots ->
        │                                   booking window, does it cover the schedule
        ├── equipment.ts                  # equipmentWindowFor() (pre-SPM-47) + checkOutOfService()/
        │                                  outOfServiceReasonFor() (SPM-48 AC7)
        ├── equipmentAvailability.ts       # SPM-48 rules, pure — no Prisma. D-1 → Return Day+1
        │                                  (Singapore calendar days), the fixed 2h transfer/prep
        │                                  time, and which requests count against stock.
        ├── equipmentAvailabilityLines.ts   # SPM-48: turns loaded rows into one result per
        │                                    requested equipment line (assembleLines())
        ├── equipmentAvailabilityService.ts  # SPM-48: the only file that queries Prisma for
        │                                     availability (loadEventAvailability())
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
| **Kayal** | `src/app/api/venues/`, `src/app/api/facilities/` | Venues, bookings, facility reference data | `Venue`, `VenueLayout`, `Facility`, `VenueFacility`, `VenueBooking`, `VenueUnavailability` | 🟢 venue list + create + update + retire (with booking review flags), catalogue UI, facilities list, availability calendar (S-21, SPM-46 — read-only), venue search + filters (SPM-40); booking decision routes and Block venue (S-23) to build |
| **Janelle** | `src/app/api/equipment/` | Equipment catalogue | `Equipment`, `EquipmentRequest` | 🟢 list + create; request routes to build |
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
| Registration: confirmed, in window, no duplicate, seats left | `api/registrations` POST | ✅ done |
| Venue suitability (capacity + mandatory facilities) | venues domain | ❌ to write |
| Booking conflict detection | venues domain | ❌ to write |
| Equipment availability | equipment domain | ❌ to write |
| Event status lifecycle — which `from → to` moves are legal at all (who may make them is done; see below) | events domain | ❌ to write |

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
| **Only the assigned Event Coordinator may cancel an event** — not the organiser who owns it, not the Ops Manager (customer clarification, 2026-09-18) | `STATUS_TRANSITION_ROLES.cancelled` | ✅ done |
| **A role cannot be self-assigned** — public registration offers the two external roles only; staff accounts are created internally | `registerSchema`, `SELF_REGISTERABLE_ROLES` | ✅ done |
| A deactivated account cannot authenticate at all, and is refused at login rather than at the first API call | `api/auth/login`, `getActor()` | ✅ done |
| A venue booking decision is Venue Staff's; an equipment request decision is Technical Support's | venues / equipment domains | ⏳ actions defined, routes not built |

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
5. Update **`SCHEMA_REFERENCE.md`** and add a **Changelog** entry.
6. Commit `prisma/` and `src/` together, then tell the team to run
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
| `npm test` | Run tests once |
| `npm run verify:permissions` | SPM-4 acceptance check over HTTP — needs `npm run dev` running in another terminal |
| `npm run fixtures:spm30` | Adds or resets SPM-30's 12 test events ("SPM30 …") without reseeding — touches only events whose `seedKey` starts with `spm30_`, plus the two base-seed events that start in the Assignments queue ("Nusantara Developer Summit", "Meridian Graduate Recruitment Evening"): if they have only been assigned (SPM-30-TC20), they go back to Submitted with no coordinator. If another story has moved one further it is left alone with a warning; add `-- --restore-queue` to force it. Re-run before each SPM-30 test pass |
| `npm run fixtures:spm28` | Adds or resets SPM-28's 7 test events ("SPM28 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm28_`, with their facilities and equipment, always at **EVT-000124 to EVT-000130** (the numbers a full reseed gives them, so test cases can quote addresses). Stops without changing anything if another event holds one of those numbers. Run it before and after SPM-28-TC08 (approve) and TC10/TC11 (reject, then the organiser views it), so the next tester finds those requests Under review again. The same events are in `prisma/seed.ts` |
| `npm run fixtures:spm42` | Adds or resets SPM-42's 14 test events ("SPM42 …") without reseeding — deletes and recreates only events whose `seedKey` starts with `spm42_` (with their sessions and bookings, so every request a test pass submitted goes too), and upserts the test venue "SPM42 Plain Room" (SPM42-PLN). Re-run before each SPM-42 test pass |
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
| **No `.env.example`** | A fresh clone has no template for `DATABASE_URL` / `JWT_SECRET`. Without them `src/lib/auth.ts` throws at import and **every API route returns 500**. Flagged 2026-09-13, still open. | unclaimed |
| **Status lifecycle is not validated** | Who may set a status is enforced; which `from → to` moves are legal is not, so `draft → confirmed` in one step is possible for a coordinator. Related: `STATUS_TRANSITION_ROLES` still lets the Ops Manager set `under_review` through the status PATCH, which would leave an event under review with no coordinator — no screen does this (assignment goes through `PUT /api/events/[id]/coordinator`), but the route allows it. | events |
| **Venue booking approval not built** | SPM-42 creates Pending requests and lists them on `/bookings`, but nothing approves or rejects one, so `venue_booking:decide` only guards that read-only list. Two requests submitted at the same moment can both pass the clash check (no database lock). | venues |
| **`EventSession` has no routes** | Table exists (multi-session events, briefing #74) but nothing creates, lists or edits sessions yet, so `VenueBooking.sessionId` / `EquipmentRequest.sessionId` are always NULL in practice. | events |
| **Nothing can create a venue unavailability period** | `GET /api/venues/[id]/availability` (SPM-46) reads `VenueUnavailability` and reports overlapping periods (AC5), but the **Block venue** screen (S-23) is not built and no route writes to that table — every row in it is seeded. AC5 itself is no longer blocked: `prisma/seed.ts` now carries the one overlapping pair, at Jurong Expo Floor (days 40–44 and 42–46), so SPM-46-TC09 runs by hand. What is still missing is any way for Venue Staff to block a venue in the app at all. | venues |
| **No way to clear a booking's review flag** | `PATCH /api/venues/[id]` sets `VenueBooking.needsReview` when a venue change affects a booking, but nothing clears it and no screen lists flagged bookings — so the flag is only visible in the database, and any demo that sets one leaves permanent state until the next reseed. | venues |
| **An Ops Manager can view equipment and facilities but cannot reach them** | `ops_manager` holds `equipment:view` and `facility:view` (`src/lib/permissions.ts`) but `NAV_BY_ROLE` gives them no link to either, so the only way in is to type the address. The same was true of `venue:view` until SPM-46 added the Venues link on 2026-09-27 — found because SPM-46-TC10 asks an Ops Manager to reach the availability calendar from the sidebar. Worth a sweep: a permission nothing navigates to is a permission nobody tests. | equipment |
| **No notifications screen** | `Notification` rows are written (venue review flags, SPM-39) but nothing reads them: the top-bar bell and every sidebar "Notifications" link point at `/notifications`, which does not exist, so they 404. | unclaimed |
| **Sessions are set up on create/edit only** | Since 2026-09-20 an organiser can split an event into sessions on S-08 (`POST` / `PATCH /api/events`), and each session's own equipment is written with `EquipmentRequest.sessionId` set. Still to build: coordinator-side session-scoped **venue booking** (`VenueBooking.sessionId` is still always NULL — SPM-42), Technical Support seeing which session a request belongs to (SPM-47/50), and showing sessions to anyone but their organiser and internal roles on the Overview tab. | events / venues / equipment |
| **Two sessions of one event cannot request the same equipment item** | `equipment_requests` is unique on `(event_id, equipment_id)`, not `session_id` too, so a projector needed on Day 1 *and* Day 2 can be requested once. The form's picker prevents choosing it twice and says so; the server refuses it with a 400. Fixing it properly needs a schema change (partial unique indexes) — Janelle's table, so it needs the team chat first. | equipment |
| **Facility / accessibility requirements are per event, not per session** | `event_facility_requirements` has no session column, so "the venue must have a hearing loop" applies to every session. A session's own venue needs are its layout and attendance. Per-session facilities would need a new table. | events / venues |
| **No route-level tests outside auth/permissions** | `npm run verify:permissions` (47 checks) and `npm run verify:login` (29 checks) cover authentication and authorisation end to end. Business rules — venue suitability, booking conflicts, capacity — are unit tested only; nothing exercises those routes over HTTP. | unclaimed |
| **No admin screen for staff accounts** | Since 2026-09-18 the four internal roles cannot be self-registered, which is correct — but there is now no in-app way to create a coordinator, Ops Manager, venue staff or tech support account either. `npx prisma db seed` is the only route today. Fine for the Week 12 demo; name it in the Q&A rather than being surprised by it. | auth |
| **An organiser cannot call off their own event** | Cancellation is the coordinator's alone (customer clarification, 2026-09-18), and Event Change Requests — the route an organiser would use to *ask* for one — has no endpoint yet. Until it does, an organiser who wants to cancel has no in-app path at all. | events |
| **The clarification loop is not built** | The coordinator can't ask the organiser a question about a request, and nothing shows existing `ClarificationRequest` rows (they are seed data only). SPM-28 left both out on purpose (decided 2026-09-30), so the review page (S-13) has no "Ask the organiser for clarification" option, although `design/mockups/EventReview.dc.html` still shows one. Whoever builds it: keep the event Under review while a clarification is open (2026-09-22 entry). | events |
| **The organiser is not notified of a review decision** | Approving or rejecting changes the status and, for a rejection, shows the reason on the event page, but writes no `Notification` — ruled out of SPM-28 on 2026-09-30. The organiser only finds out by opening the event. | events |
| **No "Browse Events" screen for Attendee** | The Attendee sidebar links to `/browse` (`src/lib/roles.ts`), but `src/app/browse/page.tsx` doesn't exist, so it 404s. Blocks SPM-31-TC19 from being run end to end. Flagged 2026-09-25. | unclaimed |
| **No equipment catalogue screen** | The sidebar's "Equipment" link (Coordinator + Technical Support) points at `/equipment`, which doesn't exist — no story in the backlog builds it, so it 404s. The catalogue exists as data (`prisma/seed.ts`) and is read by every equipment picker; only *editing* it (or an item's location/status) has no screen. Candidate owner is SPM-55 (Record Equipment Unavailability), whose ACs need a status screen anyway. Flagged 2026-09-27. | unclaimed |
| **Check Equipment Availability is read-only** | SPM-48 built the check (`GET /api/events/[id]/equipment/availability`, the `/equipment/requests` screens) and `PATCH /api/equipment/[id]/out-of-service` for AC7, but nothing *reserves* what the check finds available — that's SPM-49, not built. The mockup's "Reserve what is available" button is intentionally absent. | equipment |
| **Equipment availability's cancelled/postponed filter is temporary** | Only `EquipmentRequest.status IN (reserved, partially_fulfilled)` counts against stock, and requests of cancelled/postponed/rejected/draft events are filtered out in `src/lib/equipmentAvailability.ts` (`RELEASED_EVENT_STATUSES`). This is standing in for SPM-37 (Cancel Event) and SPM-38 (Postpone Event) actually releasing the reservation when built — remove the filter once they do, and check nothing still relies on it. | equipment |
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

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
| `grace.lim@connectsphere.com` | ops manager, sees the unassigned queue |
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
│   └── test-cases/              # Per-story test case exports (Excel + JSON)
│
└── src/
    ├── app/
    │   ├── layout.tsx            # Fonts + the app shell that wraps every page
    │   ├── globals.css            # Base layer only. Colours live in tailwind.config.ts
    │   ├── page.tsx                # Homepage
    │   ├── login/page.tsx           # S-01
    │   ├── register/page.tsx         # S-02
    │   ├── dashboard/page.tsx         # S-03, role-aware
    │   ├── events/page.tsx             # S-07
    │   ├── events/new/page.tsx          # S-08, the event request form (create)
    │   ├── events/[id]/edit/page.tsx  # S-08, the same form (edit a saved draft)
    │   ├── events/[id]/page.tsx         # ❌ NOT BUILT YET — general event detail.
    │   │                                    Dashboard and the events list both link
    │   │                                    here for non-draft events; until this
    │   │                                    exists those links 404.
    │   │
    │   └── api/                     # ← THE BACKEND. Each folder = one "service"/domain.
    │       ├── auth/                   (Jordan)
    │       ├── events/                  (Kristen)
    │       ├── venues/                   (Kayal)
    │       ├── facilities/                (Kayal — reference data for forms + venue search)
    │       ├── equipment/                  (Janelle)
    │       └── registrations/               (Sammi)
    │
    ├── components/
    │   ├── AppShell.tsx        # Top bar + role-aware sidebar. Wraps every route.
    │   └── ui/                  # THE component library — see §6. Import from "@/components/ui"
    │
    └── lib/
        ├── prisma.ts           # Database client — import this, don't create your own
        ├── auth.ts              # Password hashing + JWT helpers (server-side)
        ├── permissions.ts        # WHO MAY DO WHAT — pure, testable, no Prisma
        ├── apiAuth.ts             # getActor() + 401/403/404 helpers for routes
        ├── session.ts            # Browser-side: storing/reading the login token
        ├── useCurrentUser.ts      # Who is signed in (for rendering only, never for access)
        ├── roles.ts                # Role labels + which nav/tabs each role sees
        ├── statuses.ts              # Status label + colour for EVERY status in the system
        ├── format.ts                 # Dates, capacities, venue names — one format each
        ├── formErrors.ts              # Client validation + mapping server errors to fields
        ├── eventForm.ts                # Shared by events/new and events/[id]/edit (S-08): fields, validateForm, toFormValues
        ├── cn.ts                       # Tiny class-name joiner
        ├── validation.ts                # ALL Zod schemas live in this ONE file
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
| **Kristen** | `src/app/api/events/` | Event requests, status | `Event`, `EventStatusHistory`, `ClarificationRequest`, `EventChangeRequest`, `EventFacilityRequirement` | 🟢 working |
| **Kayal** | `src/app/api/venues/`, `src/app/api/facilities/` | Venues, bookings, facility reference data | `Venue`, `VenueLayout`, `Facility`, `VenueFacility`, `VenueBooking`, `VenueUnavailability` | 🟢 venue list + create, facilities list; booking routes to build |
| **Janelle** | `src/app/api/equipment/` | Equipment catalogue | `Equipment`, `EquipmentRequest` | 🟢 list + create; request routes to build |
| **Sammi** | `src/app/api/registrations/` | Attendee registration | `Registration` | 🟢 working |

Stick to your own folder for new *route* files. `prisma/schema.prisma` and
`src/lib/validation.ts` are shared — see [Avoiding Merge Conflicts](#-avoiding-merge-conflicts).

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
   ├─ createEventSchema.parse() validates the request body (src/lib/validation.ts)
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

Client validation mirrors `src/lib/validation.ts`; it is a convenience, never
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
| Reason required when rejecting | `api/events/[id]` PATCH | ✅ done |
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
| `npx eslint src --ext .ts,.tsx` | Check code style/common mistakes |
| `npm test` | Run tests once |
| `npm run verify:permissions` | SPM-4 acceptance check over HTTP — needs `npm run dev` running in another terminal |
| `npx tsc --noEmit` | Type-check everything — run before you push |
| `npx prisma generate` | Regenerate the Prisma client after a schema change |
| `npx prisma migrate dev` | Create/apply a migration after YOU change `schema.prisma` |
| `npx prisma studio` | Browser UI to view/edit the database directly |
| `npx prisma db seed` | ⚠️ Wipes all tables, then loads the demo data |
| `npx prisma migrate reset` | ⚠️ Wipes the database and replays all migrations |

> ⚠️ `npm run lint` is **broken** on Next 16 — `next lint` was removed and the
> argument is read as a directory (`no such directory: C:\IS212\lint`). Use the
> `npx eslint` command above until someone updates the script in `package.json`.
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
- **`prisma/schema.prisma` and `src/lib/validation.ts` are shared files** — add
  your section at the bottom rather than in the middle of someone else's, and
  pull/push more frequently on days you're editing them
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

## 🕳️ KNOWN GAPS

Open items that affect everyone. **This list, not a changelog entry, is where a
gap lives** — a changelog is history and scrolls away; a gap is a thing still
waiting. Delete a row when you close it, and say so in your changelog entry.

| Gap | Impact | Owner |
|---|---|---|
| **No `.env.example`** | A fresh clone has no template for `DATABASE_URL` / `JWT_SECRET`. Without them `src/lib/auth.ts` throws at import and **every API route returns 500**. Flagged 2026-09-13, still open. | unclaimed |
| **No general event detail screen** (`src/app/events/[id]/page.tsx`) | The dashboard and events list link here for non-draft events; those links 404. | unclaimed |
| **Status lifecycle is not validated** | Who may set a status is enforced; which `from → to` moves are legal is not, so `draft → confirmed` in one step is possible for a coordinator. | events |
| **Coordinator Assignment has no endpoint** | `Event.coordinatorId` is never set by the app, so any coordinator may pick up any unassigned event (deliberate interim rule — see `docs/PERMISSIONS.md` §3). | events |
| **Venue booking + equipment request routes not built** | `venue_booking:decide` and `equipment_request:review` are defined in the permission model and unused. | venues / equipment |
| **`npm run lint` is broken on Next 16** | Use `npx eslint src --ext .ts,.tsx`. | unclaimed |
| **No route-level tests outside permissions** | `npm run verify:permissions` covers authorisation end to end (36 checks). Business rules — venue suitability, booking conflicts, capacity — are unit tested only; nothing exercises those routes over HTTP. | unclaimed |

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

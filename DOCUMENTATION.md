# CONNECTSPHERE
## Developer Documentation — Living Document

**Version:** 3.0
**Architecture:** Single Next.js app — one codebase, one database, one deploy
**Status:** 🟢 Schema built — 17 tables live, all routes reconnected, demo data available
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

---

## 📋 TABLE OF CONTENTS

1. [Quick Start](#-quick-start)
2. [Directory Structure](#-directory-structure)
3. [The 5 Domains ("Services")](#-the-5-domains-services)
4. [How a Request Flows](#-how-a-request-flows)
5. [The Pattern to Copy for a New Endpoint](#-the-pattern-to-copy-for-a-new-endpoint)
6. [Working With the Database](#-working-with-the-database)
7. [Business Rules Live in Code, Not the Database](#-business-rules-live-in-code-not-the-database)
8. [Changing the Schema](#-changing-the-schema)
9. [Everyday Commands](#-everyday-commands)
10. [Avoiding Merge Conflicts](#-avoiding-merge-conflicts)
11. [Troubleshooting](#-troubleshooting)
12. [Changelog](#-changelog)

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
└── src/
    ├── app/
    │   ├── page.tsx              # Homepage
    │   ├── login/page.tsx         # Login page
    │   ├── register/page.tsx       # Register page
    │   ├── events/page.tsx          # Events list page
    │   │
    │   └── api/                     # ← THE BACKEND. Each folder = one "service"/domain.
    │       ├── auth/                   (Jordan)
    │       ├── events/                  (Kristen)
    │       ├── venues/                   (Kayal)
    │       ├── equipment/                 (Janelle)
    │       └── registrations/              (Sammi)
    │
    └── lib/
        ├── prisma.ts           # Database client — import this, don't create your own
        ├── auth.ts              # Password hashing + JWT helpers (server-side)
        ├── session.ts            # Browser-side: storing/reading the login token
        ├── validation.ts          # ALL Zod schemas live in this ONE file
        └── __tests__/             # Tests go HERE, not next to the file they test
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
| **Kayal** | `src/app/api/venues/` | Venues, bookings | `Venue`, `VenueLayout`, `Facility`, `VenueFacility`, `VenueBooking`, `VenueUnavailability` | 🟢 list + create; booking routes to build |
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

1. **Add a Zod schema** to `src/lib/validation.ts` — what does a valid request body look like?
2. **Write the route handler** in your domain's `route.ts` — validate, check rules, call Prisma, return JSON.
3. **Check `SCHEMA_REFERENCE.md`** for the exact field names before you write the Prisma call.

```ts
export async function POST(req: NextRequest) {
  try {
    const data = mySchema.parse(await req.json());
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

**Status codes we use consistently** — the frontend depends on these:
400 validation failure or broken business rule · 401 not logged in ·
404 not found · 201 created · 200 everything else.

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
| `npm run lint` | Check code style/common mistakes |
| `npm test` | Run tests once |
| `npx tsc --noEmit` | Type-check everything — run before you push |
| `npx prisma generate` | Regenerate the Prisma client after a schema change |
| `npx prisma migrate dev` | Create/apply a migration after YOU change `schema.prisma` |
| `npx prisma studio` | Browser UI to view/edit the database directly |
| `npx prisma db seed` | ⚠️ Wipes all tables, then loads the demo data |
| `npx prisma migrate reset` | ⚠️ Wipes the database and replays all migrations |

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

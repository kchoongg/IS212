# CONNECTSPHERE
## Developer Documentation — Microservices Backend

**Version:** 1.0 (base structure)
**Architecture:** 5 independent microservices, each with its own database
**Status:** 🟡 Base structure — one working example endpoint per service, ready to build on
**Team:** 5 members, one service each

---

## 📋 TABLE OF CONTENTS

1. [Quick Start](#quick-start)
2. [Directory Structure](#directory-structure)
3. [The 5 Services at a Glance](#the-5-services-at-a-glance)
4. [How a Request Flows](#how-a-request-flows)
5. [The One Rule: Calling Another Service](#the-one-rule-calling-another-service)
6. [Database](#database)
7. [Everyday Commands](#everyday-commands)
8. [Troubleshooting](#troubleshooting)

---

## 🚀 QUICK START

### Prerequisites
- **Node.js 20+**
- **Docker Desktop** (runs Postgres for you — no manual database install needed)

### First-time setup

```bash
# 1. Clone the repo
git clone https://github.com/kchoongg/IS212.git
cd IS212

# 2. Start Postgres (creates all 5 databases automatically)
docker run --name connectsphere-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
docker exec -it connectsphere-db psql -U postgres -c "CREATE DATABASE identity_db;"
docker exec -it connectsphere-db psql -U postgres -c "CREATE DATABASE event_db;"
docker exec -it connectsphere-db psql -U postgres -c "CREATE DATABASE venue_db;"
docker exec -it connectsphere-db psql -U postgres -c "CREATE DATABASE equipment_db;"
docker exec -it connectsphere-db psql -U postgres -c "CREATE DATABASE registration_db;"

# 3. Set up YOUR service (repeat only for the one you own)
cd services/event-service
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Your service is now running — check it worked:
```bash
curl http://localhost:4002/health
# → {"status":"ok","service":"event-service"}
```

> **Everything at once instead?** `docker compose up --build` from the repo root starts all 5 services + Postgres together.

---

## 📁 DIRECTORY STRUCTURE

```
IS212/
├── docker-compose.yml          # Runs all 5 services + Postgres together
├── db/init/                    # Auto-creates the 5 databases on first Docker run
│
└── services/
    ├── identity-service/        (port 4001 — auth, users, roles)
    ├── event-service/           (port 4002 — event requests, status)
    ├── venue-service/           (port 4003 — venues, bookings)
    ├── equipment-service/       (port 4004 — equipment, reservations)
    └── registration-service/    (port 4005 — attendee registration)
```

**Every service has the exact same 9 files** — learn one, you know all five:

```
<service-name>/
├── src/
│   ├── app.ts          # Everything: routes, validation, database calls
│   ├── app.test.ts      # A couple of example tests
│   └── index.ts          # 3 lines — starts app.ts on its port
├── prisma/
│   └── schema.prisma      # This service's own tables (its own database only)
├── package.json
├── tsconfig.json
├── .env.example
└── Dockerfile
```

No `controllers/`, `routes/`, `middleware/` subfolders on purpose — for a service this small,
one readable `app.ts` beats hunting across eight folders. Split it up once a service
actually gets big enough to need it.

---

## 🧩 THE 5 SERVICES AT A GLANCE

| Service | Port | Owns | Key endpoints |
|---|---|---|---|
| **identity-service** | 4001 | Users, roles, login | `POST /users/register`, `POST /users/login`, `GET /users/:id` |
| **event-service** | 4002 | Event requests & status | `POST /events`, `GET /events/:id`, `PATCH /events/:id` |
| **venue-service** | 4003 | Venues & bookings | `GET/POST /venues`, `POST /venues/bookings` |
| **equipment-service** | 4004 | Equipment catalogue | `GET/POST /equipment` |
| **registration-service** | 4005 | Attendee registration | `POST /registrations` |

Each one is a separate Node process with its own database — you can run just yours
without anyone else's running.

---

## 🔄 HOW A REQUEST FLOWS

Example: an Organiser registers, logs in, and creates an event.

```
1. POST identity-service:4001/users/register
     → creates a User row in identity_db, returns the user

2. POST identity-service:4001/users/login
     → checks password, returns a JWT token

3. POST event-service:4002/events   (Authorization: Bearer <token>)
     → event-service verifies the JWT itself (shared JWT_SECRET —
       no call back to identity-service needed just to check who's logged in)
     → creates an Event row in event_db, status = "draft"
```

No API gateway yet — the frontend calls each service's port directly.

---

## 🔗 THE ONE RULE: CALLING ANOTHER SERVICE

Each service has its **own separate database**. There is no foreign key stopping
`venue-service` from saving a booking for an `event_id` that doesn't actually
exist — that's the trade-off of separate databases. So: **before saving a
reference to something owned by another service, ask that service if it's real.**

`venue-service/src/app.ts` has the reference example — read it before adding
your own cross-service field:

```ts
const eventCheck = await fetch(`${EVENT_URL}/events/${data.eventId}`);
if (eventCheck.status === 404) {
  return res.status(400).json({ error: "eventId does not match a real event" });
}
```

`registration-service` has a second example that also checks the event's
*status* (not just that it exists) before allowing a registration.

---

## 🗄️ DATABASE

- **PostgreSQL**, one database per service (`identity_db`, `event_db`, `venue_db`,
  `equipment_db`, `registration_db`) — all on the same local Postgres server.
- **Prisma** is the ORM. Each service's `prisma/schema.prisma` only defines its
  own tables — never another service's.
- Changed a schema? Run `npx prisma migrate dev` inside that service, then commit
  the new folder it creates under `prisma/migrations/`.

---

## ⚙️ EVERYDAY COMMANDS

Run these inside whichever service folder you're working in:

| Command | What it does |
|---|---|
| `npm run dev` | Start the service (auto-restarts as you edit) |
| `npm test` | Run that service's tests |
| `npm run build` | Compile TypeScript to `dist/` |
| `npx prisma generate` | Regenerate the Prisma client after a schema change |
| `npx prisma migrate dev` | Create/apply a migration after YOU change `schema.prisma` |
| `npx prisma studio` | Opens a browser UI to view/edit your database directly |

---

## 🛠️ TROUBLESHOOTING

**`@prisma/client did not initialize yet`**
Run `npx prisma generate` inside that service — this has to be re-run any time
`schema.prisma` changes, including right after you first clone the repo.

**`ECONNREFUSED` calling another service**
That other service isn't running. Either start it (`cd services/<name> && npm run dev`)
or use `docker compose up` to bring everything up together.

**Migration fails to connect**
Check `DATABASE_URL` in that service's `.env` — it needs the exact database name
for THAT service (e.g. `event_db` for event-service), not a shared name.

**Port already in use**
Another process (maybe an old `npm run dev`) is still bound to that port. Find and
stop it, or change `PORT` in `.env` — just remember to update the URL wherever
another service calls it.

# CONNECTSPHERE — Endpoint Adaptation Guide

**Purpose of this document:** the routes below were written against an earlier
database design. The schema is being rebuilt from scratch by a teammate, with
her own (more thought-through) table structure. This document gives you
everything needed to update the routes to match HER schema — the actual
current code for every database-touching file, plus the pattern to follow.

**How to use this in a fresh Claude conversation:** upload this file alongside
your `schema.prisma` (or paste it in) and ask Claude to update the routes
below to match your schema. Claude has everything it needs in this one
document — the exact current code, the validation layer, and the update
procedure — without needing any other context from elsewhere.

---

## 1. The pattern every route follows

Every API route in this app does the same 3 things, in order:

1. **Validate the request body** with a Zod schema from `src/lib/validation/` (one file per domain, e.g. `events.ts`)
2. **Call Prisma** using the validated data
3. **Return JSON** — success data, or a clear error with the right HTTP status

```ts
export async function POST(req: NextRequest) {
  try {
    const data = mySchema.parse(await req.json());        // 1. validate
    const result = await prisma.myModel.create({ data }); // 2. save
    return NextResponse.json(result, { status: 201 });     // 3. respond
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

Updating a route to match a new schema almost always means editing ONE of:
- the Zod schema in the matching `src/lib/validation/<domain>.ts` file (if a field was renamed/added/removed)
- the `prisma.<model>.<method>({ ... })` call itself (if the model or field name changed)

It essentially never means restructuring the route's logic or its response shape.

---

## 2. Shared files (rarely need changes, but this is what they do)

### `src/lib/prisma.ts` — the database client
```ts
import { PrismaClient } from "@prisma/client";

// A single shared Prisma client. In dev, Next.js hot-reloads modules, which
// would otherwise create a new PrismaClient on every edit and exhaust your
// database's connection limit - stashing it on `global` avoids that.
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```
No changes needed here regardless of schema — this file just connects to
whatever `DATABASE_URL` points at.

### `src/lib/auth.ts` — password hashing + JWT
```ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("Missing JWT_SECRET environment variable");
}

export interface SessionPayload {
  id: string;
  role: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: "8h" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the session from the Authorization header
 * (`Authorization: Bearer <token>`) of an incoming API route request.
 * Returns null if there's no valid session - callers decide what to do
 * (usually: return a 401).
 */
export function getSession(req: NextRequest): SessionPayload | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifySession(header.slice("Bearer ".length));
}
```
No changes needed here either — it never touches the database directly, it
just hashes passwords and signs/verifies tokens. `getSession(req)` is called
by several routes below to check who's logged in.

---

## 3. Current validation schemas — `src/lib/validation/`

**This is usually the first place to update** — if a field is renamed, added,
or removed in the new schema, the matching Zod schema needs the same change.
As of 2026-09-17 this used to be one file (`src/lib/validation.ts`); it's now
split by domain into `src/lib/validation/<domain>.ts`, re-exported from
`index.ts` so `@/lib/validation` still resolves the same way. The snapshot
below is frozen from before that split — it's still accurate content-wise,
just no longer the actual file layout; find the same schemas in their
domain's file now (e.g. `registerSchema`/`loginSchema` → `auth.ts`).

```ts
import { z } from "zod";

// ---- Auth ----

export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["organiser", "coordinator", "venue_staff", "tech_support", "attendee", "ops_manager"]),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---- Events ----

export const createEventSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  purpose: z.string().optional(),
  description: z.string().optional(),
  proposedDate: z.string().datetime().optional(),
  timeSlot: z.enum(["AM", "PM", "Night"]).optional(),
  expectedAttendance: z.number().int().positive().optional(),
  accessibilityNeeds: z.string().optional(),
  registrationEnabled: z.boolean().optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventStatusSchema = z.object({
  status: z.enum([
    "draft", "submitted", "under_review", "rejected", "approved",
    "planning", "postponed", "confirmed", "completed", "cancelled",
  ]),
  reason: z.string().optional(),
});
export type UpdateEventStatusInput = z.infer<typeof updateEventStatusSchema>;

// ---- Venues ----

export const createVenueSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
  capacity: z.number().int().positive(),
  accessibilityFeatures: z.string().optional(),
});
export type CreateVenueInput = z.infer<typeof createVenueSchema>;

// ---- Equipment ----

export const createEquipmentSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  totalQuantity: z.number().int().nonnegative(),
  location: z.string().optional(),
});
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

// ---- Registrations ----

export const createRegistrationSchema = z.object({
  eventId: z.string().uuid(),
  dietaryNeeds: z.string().optional(),
  accessibilityNeeds: z.string().optional(),
});
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
```

---

## 4. Every route, with its current full code

For each one below: compare the `prisma.<model>` calls against your actual
schema. If a model/field name matches, leave it. If it doesn't, that's the
line to change.

### `src/app/api/auth/register/route.ts`
Touches: `User` — creates a user, checks email uniqueness first.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { registerSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = registerSchema.parse(body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 400 });
    }

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, passwordHash, role: data.role },
    });

    return NextResponse.json(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### `src/app/api/auth/login/route.ts`
Touches: `User` — finds by email, verifies password, issues a JWT.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
    }

    const valid = await verifyPassword(data.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
    }

    const token = signSession({ id: user.id, role: user.role });
    return NextResponse.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### `src/app/api/auth/me/route.ts`
Touches: `User` — returns the logged-in user's own profile.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role });
}
```

### `src/app/api/events/route.ts`
Touches: `Event` — lists events (filtered by organiser), creates a new one.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createEventSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Organisers see their own events; everyone else sees everything for now -
  // tighten this per role as the access model gets built out further.
  const where = session.role === "organiser" ? { organiserId: session.id } : {};
  const events = await prisma.event.findMany({ where, orderBy: { createdAt: "desc" } });
  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = createEventSchema.parse(body);

    const event = await prisma.event.create({
      data: {
        organiserId: session.id,
        title: data.title,
        category: data.category,
        purpose: data.purpose,
        description: data.description,
        proposedDate: data.proposedDate ? new Date(data.proposedDate) : undefined,
        timeSlot: data.timeSlot,
        expectedAttendance: data.expectedAttendance,
        accessibilityNeeds: data.accessibilityNeeds,
        registrationEnabled: data.registrationEnabled ?? false,
        status: "draft",
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### `src/app/api/events/[id]/route.ts`
Touches: `Event` AND `EventStatusHistory` — the PATCH handler writes to BOTH
in a single transaction (updates the event's status, and logs the change).
If your schema doesn't have a status-history table, the `tx.eventStatusHistory.create(...)`
block should be deleted, not just renamed.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateEventStatusSchema } from "@/lib/validation";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json(event);
}

/**
 * Updates an event's status - this is the one endpoint that has to respect
 * the BPMN status lifecycle, not just accept any value. See
 * docs/ConnectSphere_Status_Lifecycle.drawio for the full set of valid
 * transitions; this is a minimal starting guard, not the full rule set yet.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = updateEventStatusSchema.parse(body);

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const e = await tx.event.update({ where: { id }, data: { status: data.status } });
      await tx.eventStatusHistory.create({
        data: {
          eventId: id,
          oldStatus: event.status,
          newStatus: data.status,
          changedBy: session.id,
          reason: data.reason,
        },
      });
      return e;
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### `src/app/api/venues/route.ts`
Touches: `Venue` — lists venues, creates a new one.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createVenueSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET() {
  const venues = await prisma.venue.findMany();
  return NextResponse.json(venues);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createVenueSchema.parse(body);
    const venue = await prisma.venue.create({ data });
    return NextResponse.json(venue, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### `src/app/api/equipment/route.ts`
Touches: `EquipmentItem` — lists equipment, creates a new item.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createEquipmentSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET() {
  const items = await prisma.equipmentItem.findMany();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createEquipmentSchema.parse(body);
    const item = await prisma.equipmentItem.create({ data });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### `src/app/api/registrations/route.ts`
Touches: `Event` (read-only, to check status) AND `Registration` (create).
Relies on a **database-level unique constraint** on `(eventId, attendeeId)` —
the catch block detects "already registered" by matching a Postgres unique-
constraint error message, not by checking first in application code. If your
`Registration` table doesn't have `@@unique([eventId, attendeeId])`, add it,
or this duplicate-detection silently stops working.
```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createRegistrationSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = createRegistrationSchema.parse(body);

    const event = await prisma.event.findUnique({ where: { id: data.eventId } });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (event.status !== "confirmed") {
      return NextResponse.json({ error: "Event is not open for registration yet" }, { status: 400 });
    }
    if (!event.registrationEnabled) {
      return NextResponse.json({ error: "Registration is not enabled for this event" }, { status: 400 });
    }

    const registration = await prisma.registration.create({
      data: {
        eventId: data.eventId,
        attendeeId: session.id,
        dietaryNeeds: data.dietaryNeeds,
        accessibilityNeeds: data.accessibilityNeeds,
        status: "registered",
      },
    });

    return NextResponse.json(registration, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    // Unique constraint = already registered for this event
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

---

## 5. Step-by-step procedure to follow

1. **Get the new schema and the new database in place first** —
   `npx prisma migrate dev` should already have been run against the real
   (new) `schema.prisma` before touching any route.
2. **Go file by file** through Section 4 above, in this order (matches
   dependency order — Identity first, since almost everything needs a user):
   `register` → `login` → `me` → `events` → `events/[id]` → `venues` →
   `equipment` → `registrations`.
3. **For each file:** find every `prisma.<model>.<field>` reference, check it
   against the actual schema, fix mismatches.
4. **Check the matching `src/lib/validation/<domain>.ts` file alongside each
   route** — if the route expects a field the new schema doesn't have (or
   vice versa), fix the Zod schema to match what the route/schema should
   actually accept.
5. **After all files are updated, verify:**
   ```bash
   npx prisma generate
   npx tsc --noEmit
   ```
   TypeScript will catch any remaining mismatches — a property that doesn't
   exist on the Prisma model shows up as a compile error here, not a runtime
   surprise later.
6. **Then actually test the flow:** register → login → create an event →
   view `/events`. This confirms it's not just compiling, but working.

---

## 6. What NOT to change

- **Response shapes and HTTP status codes** — 400 for validation errors, 401
  for not logged in, 404 for not found, 201 for created. These are
  conventions the frontend pages already rely on.
- **The overall route structure** (GET/POST/PATCH functions, the try/catch
  pattern) — only the Prisma calls and Zod schemas inside them should change.
- **`getSession(req)` calls** — these read the JWT, unrelated to the database
  schema entirely.

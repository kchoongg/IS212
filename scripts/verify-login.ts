/**
 * SPM-21 acceptance check — user login and role-based access, against a
 * RUNNING server.
 *
 *   Terminal 1:  npm run dev
 *   Terminal 2:  npm run verify:login
 *
 * Companion to scripts/verify-permissions.ts (SPM-4). That one proves the
 * permission MODEL is applied by the routes; this one proves the four
 * acceptance criteria of the login story itself:
 *
 *   AC1  valid credentials    -> authenticated
 *   AC2  invalid credentials  -> denied, with a message
 *   AC3  signed in            -> the role is identified
 *   AC4  unauthorised action  -> denied
 *
 * Each check prints the criterion it belongs to, so the output can be pasted
 * straight into the test evidence for the story.
 *
 * Safe to re-run: it creates its own throwaway account and its own event
 * through the API, and deletes both in a finally block. It never modifies
 * seeded data.
 */

import { PrismaClient } from "@prisma/client";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "password123";
// Namespaced so a half-finished run is obvious in the users table and so it
// can never collide with a seeded account.
const TEMP_EMAIL = "spm21-verify-throwaway@example.invalid";

const prisma = new PrismaClient();

type Check = { ac: string; name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(ac: string, name: string, ok: boolean, detail: string) {
  results.push({ ac, name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}\n        ${detail}`);
}

async function expectStatus(ac: string, name: string, expected: number, res: Response) {
  const body = await res.text();
  const hint = body.slice(0, 120).replace(/\s+/g, " ");
  record(ac, name, res.status === expected, `expected ${expected}, got ${res.status} — ${hint}`);
  return body;
}

function post(path: string, body: unknown, token?: string) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function authed(token: string | null) {
  return (path: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
}

async function login(email: string): Promise<string> {
  const res = await post("/api/auth/login", { email, password: PASSWORD });
  if (!res.ok) throw new Error(`Could not sign in as ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

async function main() {
  const pick = async (role: string) =>
    prisma.user.findFirstOrThrow({ where: { role }, select: { id: true, email: true } });
  const organiser = await prisma.user.findFirstOrThrow({
    where: { role: "organiser", organisationId: { not: null } },
    select: { id: true, email: true },
  });
  const coordinator = await pick("coordinator");
  const opsManager = await pick("ops_manager");
  const attendee = await pick("attendee");

  console.log(`\nServer: ${BASE}\n`);

  let createdEventId: string | null = null;

  try {
    // -----------------------------------------------------------------------
    console.log("AC1 — valid credentials authenticate the user");

    const okRes = await post("/api/auth/login", { email: organiser.email, password: PASSWORD });
    const okBody = await okRes.text();
    record("AC1", "a seeded account can log in", okRes.status === 200,
      `expected 200, got ${okRes.status}`);
    if (okRes.status !== 200) throw new Error(`Cannot continue: ${okBody}`);

    const parsed = JSON.parse(okBody) as { token?: string; user?: { role?: string } };
    record("AC1", "…and the response carries a session token", Boolean(parsed.token),
      parsed.token ? `token of ${parsed.token.length} chars` : "no token in the response body");

    // A token that is not accepted by a real route is not authentication.
    await expectStatus("AC1", "…that the API actually accepts", 200,
      await authed(parsed.token ?? null)("/api/auth/me"));

    // -----------------------------------------------------------------------
    console.log("\nAC2 — invalid credentials are denied, with a message");

    const wrongPw = await post("/api/auth/login", {
      email: organiser.email, password: "definitely-not-the-password",
    });
    const wrongPwBody = await expectStatus("AC2", "a wrong password is refused", 400, wrongPw);
    record("AC2", "…with an error message the form can display",
      Boolean(JSON.parse(wrongPwBody).error),
      `error: ${JSON.parse(wrongPwBody).error ?? "(none)"}`);

    const unknown = await post("/api/auth/login", {
      email: "no-such-person@example.invalid", password: PASSWORD,
    });
    const unknownBody = await expectStatus("AC2", "an unknown email is refused", 400, unknown);

    // Both refusals must read identically, or the endpoint becomes a way to
    // discover which email addresses have accounts.
    record("AC2", "…and the two refusals are indistinguishable (no account enumeration)",
      JSON.parse(wrongPwBody).error === JSON.parse(unknownBody).error,
      `"${JSON.parse(wrongPwBody).error}" vs "${JSON.parse(unknownBody).error}"`);

    await expectStatus("AC2", "a malformed email never reaches the database", 400,
      await post("/api/auth/login", { email: "notanemail", password: PASSWORD }));
    await expectStatus("AC2", "an empty password is refused", 400,
      await post("/api/auth/login", { email: organiser.email, password: "" }));

    // A deactivated account has valid credentials and must still be refused.
    await post("/api/auth/register", {
      name: "SPM-21 Verification", email: TEMP_EMAIL, password: PASSWORD, role: "organiser",
    });
    await prisma.user.update({ where: { email: TEMP_EMAIL }, data: { isActive: false } });
    await expectStatus("AC2", "a DEACTIVATED account cannot log in, correct password or not", 403,
      await post("/api/auth/login", { email: TEMP_EMAIL, password: PASSWORD }));

    // -----------------------------------------------------------------------
    console.log("\nAC3 — the signed-in user's role is identified");

    for (const user of [organiser, coordinator, opsManager, attendee]) {
      const dbRole = (await prisma.user.findUniqueOrThrow({
        where: { id: user.id }, select: { role: true },
      })).role;
      const me = await authed(await login(user.email))("/api/auth/me");
      const body = (await me.json()) as { role?: string };
      record("AC3", `/api/auth/me reports the role for ${dbRole}`, body.role === dbRole,
        `expected "${dbRole}", got "${body.role}"`);
    }

    await expectStatus("AC3", "an anonymous caller is told it is not signed in", 401,
      await authed(null)("/api/auth/me"));
    await expectStatus("AC3", "a forged token is not accepted", 401,
      await authed("not.a.real.token")("/api/auth/me"));

    // -----------------------------------------------------------------------
    console.log("\nAC4 — a role cannot reach what it is not authorised for");

    const asOrganiser = authed(await login(organiser.email));
    const asCoordinator = authed(await login(coordinator.email));
    const asOpsManager = authed(await login(opsManager.email));
    const asAttendee = authed(await login(attendee.email));

    await expectStatus("AC4", "anonymous cannot list events", 401, await authed(null)("/api/events"));
    await expectStatus("AC4", "an attendee cannot browse the venue catalogue", 403,
      await asAttendee("/api/venues"));
    await expectStatus("AC4", "an organiser cannot add a venue (Venue Staff's)", 403,
      await asOrganiser("/api/venues", { method: "POST", body: JSON.stringify({ name: "x" }) }));
    await expectStatus("AC4", "a coordinator cannot add equipment (Tech Support's)", 403,
      await asCoordinator("/api/equipment", { method: "POST", body: JSON.stringify({ name: "x" }) }));

    // The role a caller HOLDS has to be beyond their gift, or every rule above
    // is decorative: they would simply register as the role that is allowed.
    for (const role of ["ops_manager", "coordinator", "venue_staff", "tech_support"]) {
      await expectStatus("AC4", `a stranger cannot self-register as ${role}`, 400,
        await post("/api/auth/register", {
          name: "Mallory", email: `spm21-mallory-${role}@example.invalid`,
          password: PASSWORD, role,
        }));
    }

    // --- Cancellation: the Event Coordinator's alone (customer clarification,
    //     2026-09-18). Needs a real event, in a real state, to test against.
    console.log("\nAC4 — only the Event Coordinator may cancel an event");

    const in30Days = new Date(Date.now() + 30 * 864e5);
    const createRes = await asOrganiser("/api/events", {
      method: "POST",
      body: JSON.stringify({
        title: "SPM-21 verification event",
        category: "workshop",
        startsAt: in30Days.toISOString(),
        endsAt: new Date(in30Days.getTime() + 2 * 36e5).toISOString(),
        expectedAttendance: 20,
      }),
    });
    const createBody = await createRes.text();
    if (createRes.status !== 201) throw new Error(`Cannot continue: ${createBody}`);
    createdEventId = JSON.parse(createBody).id as string;

    // Out of draft, so the refusals below are the CANCELLATION rule talking and
    // not draft privacy (which would answer 404 for everyone but the owner).
    await asOrganiser(`/api/events/${createdEventId}`, {
      method: "PATCH", body: JSON.stringify({ status: "submitted" }),
    });
    await asCoordinator(`/api/events/${createdEventId}`, {
      method: "PATCH", body: JSON.stringify({ status: "under_review" }),
    });

    await expectStatus("AC4", "the OWNING ORGANISER cannot cancel their own event", 403,
      await asOrganiser(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "cancelled", reason: "changed our minds" }),
      }));
    await expectStatus("AC4", "the OPS MANAGER cannot cancel an event either", 403,
      await asOpsManager(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "cancelled", reason: "tidying the queue" }),
      }));
    await expectStatus("AC4", "an attendee cannot cancel an event", 404,
      await asAttendee(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "cancelled" }),
      }));
    await expectStatus("AC4", "the assigned COORDINATOR can cancel it", 200,
      await asCoordinator(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "cancelled", reason: "Venue withdrawn" }),
      }));

    const finalStatus = (await prisma.event.findUniqueOrThrow({
      where: { id: createdEventId }, select: { status: true },
    })).status;
    record("AC4", "…and the event really is cancelled afterwards", finalStatus === "cancelled",
      `status is "${finalStatus}"`);
  } finally {
    // Leave the database as we found it.
    if (createdEventId) {
      await prisma.eventStatusHistory.deleteMany({ where: { eventId: createdEventId } });
      await prisma.equipmentRequest.deleteMany({ where: { eventId: createdEventId } });
      await prisma.eventFacilityRequirement.deleteMany({ where: { eventId: createdEventId } });
      await prisma.registration.deleteMany({ where: { eventId: createdEventId } });
      await prisma.event.delete({ where: { id: createdEventId } }).catch(() => {});
    }
    // The throwaway account, plus the "Mallory" accounts that only exist at
    // all if the self-registration guard has regressed — in which case we very
    // much want them gone.
    await prisma.user.deleteMany({
      where: {
        OR: [{ email: TEMP_EMAIL }, { email: { startsWith: "spm21-mallory-" } }],
      },
    }).catch(() => {});
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"-".repeat(64)}`);
  for (const ac of ["AC1", "AC2", "AC3", "AC4"]) {
    const group = results.filter((r) => r.ac === ac);
    const bad = group.filter((r) => !r.ok).length;
    console.log(`${ac}: ${group.length - bad}/${group.length} passed`);
  }
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - [${f.ac}] ${f.name} — ${f.detail}`);
    process.exit(1);
  }
  console.log("All SPM-21 login checks passed.");
}

main().catch(async (err) => {
  console.error("\nVerification could not run:\n", err instanceof Error ? err.message : err);
  console.error("\nIs the dev server running? `npm run dev`, then re-run this.");
  await prisma.$disconnect();
  process.exit(1);
});

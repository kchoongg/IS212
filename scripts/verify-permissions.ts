/**
 * SPM-4 acceptance check — the permission model against a RUNNING server.
 *
 *   Terminal 1:  npm run dev
 *   Terminal 2:  npm run verify:permissions
 *
 * The unit tests in src/lib/__tests__/permissions.test.ts prove the rules are
 * right. This proves the routes actually apply them - the half a unit test
 * cannot reach, because a route that simply forgets to call can() still passes
 * every test of can().
 *
 * Each check prints the acceptance criterion it belongs to, so the output can
 * be pasted into the test evidence for the story.
 *
 * Safe to re-run: it creates its own event through the API and deletes
 * everything it made in a finally block. It never modifies seeded data.
 */

import { PrismaClient } from "@prisma/client";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "password123";

const prisma = new PrismaClient();

type Check = { ac: string; name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(ac: string, name: string, ok: boolean, detail: string) {
  results.push({ ac, name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}\n        ${detail}`);
}

/** Assert a request comes back with the status we expect. */
async function expectStatus(
  ac: string,
  name: string,
  expected: number,
  res: Response
) {
  const body = await res.text();
  const hint = body.slice(0, 120).replace(/\s+/g, " ");
  record(ac, name, res.status === expected, `expected ${expected}, got ${res.status} — ${hint}`);
  return body;
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Could not sign in as ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
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

async function main() {
  // --- fixtures: two organisers at DIFFERENT clients, one of each staff role
  const [organiserA, organiserB] = await prisma.user.findMany({
    where: { role: "organiser", organisationId: { not: null } },
    distinct: ["organisationId"],
    take: 2,
    select: { id: true, email: true, organisationId: true },
  });
  const pick = async (role: string) =>
    prisma.user.findFirstOrThrow({ where: { role }, select: { id: true, email: true } });
  const coordinator = await pick("coordinator");
  const attendee = await pick("attendee");
  const venueStaff = await pick("venue_staff");
  const techSupport = await pick("tech_support");

  if (!organiserA || !organiserB) {
    throw new Error("Need two organisers at different organisations — run `npx prisma db seed`.");
  }

  // A confirmed, registerable event: the one an attendee is allowed to see.
  const confirmed = await prisma.event.findFirstOrThrow({
    where: { status: "confirmed", registrationEnabled: true },
  });

  console.log(`\nServer:      ${BASE}`);
  console.log(`Organiser A: ${organiserA.email}  (client ${organiserA.organisationId?.slice(0, 8)})`);
  console.log(`Organiser B: ${organiserB.email}  (client ${organiserB.organisationId?.slice(0, 8)})`);
  console.log(`Staff:       ${coordinator.email} · ${venueStaff.email} · ${techSupport.email}`);
  console.log(`Attendee:    ${attendee.email}\n`);

  const anon = authed(null);
  const asA = authed(await login(organiserA.email));
  const asB = authed(await login(organiserB.email));
  const asCoordinator = authed(await login(coordinator.email));
  const asAttendee = authed(await login(attendee.email));
  const asVenueStaff = authed(await login(venueStaff.email));
  const asTechSupport = authed(await login(techSupport.email));

  let createdEventId: string | null = null;
  let createdEquipmentId: string | null = null;

  try {
    // -----------------------------------------------------------------------
    console.log("AC4 — authentication is required at all (routes that had none)");
    await expectStatus("AC4", "anonymous cannot list venues", 401, await anon("/api/venues"));
    await expectStatus("AC4", "anonymous cannot create a venue", 401,
      await anon("/api/venues", { method: "POST", body: JSON.stringify({ code: "X1", name: "X" }) }));
    await expectStatus("AC4", "anonymous cannot list equipment", 401, await anon("/api/equipment"));
    await expectStatus("AC4", "anonymous cannot create equipment", 401,
      await anon("/api/equipment", { method: "POST", body: JSON.stringify({ name: "X", totalQuantity: 1 }) }));

    // -----------------------------------------------------------------------
    console.log("\nAC2/AC4 — each role is held to its documented permissions");
    await expectStatus("AC2", "an organiser cannot add a venue (Venue Staff's)", 403,
      await asA("/api/venues", { method: "POST", body: JSON.stringify({ code: "X1", name: "X" }) }));
    await expectStatus("AC2", "a coordinator cannot add equipment (Tech Support's)", 403,
      await asCoordinator("/api/equipment", { method: "POST", body: JSON.stringify({ name: "X", totalQuantity: 1 }) }));
    await expectStatus("AC2", "an attendee cannot browse the venue catalogue", 403, await asAttendee("/api/venues"));
    await expectStatus("AC2", "an organiser CAN read the equipment catalogue (the request form needs it)", 200,
      await asA("/api/equipment"));
    await expectStatus("AC2", "venue staff CAN read the venue catalogue", 200, await asVenueStaff("/api/venues"));
    await expectStatus("AC2", "a coordinator cannot register as an attendee", 403,
      await asCoordinator("/api/registrations", { method: "POST", body: JSON.stringify({ eventId: confirmed.id }) }));

    // Technical Support may write its own catalogue — the positive case.
    const equipRes = await asTechSupport("/api/equipment", {
      method: "POST",
      body: JSON.stringify({ name: `SPM-4 check ${Date.now()}`, category: "audio", totalQuantity: 1 }),
    });
    const equipBody = await equipRes.text();
    record("AC2", "technical support CAN add equipment", equipRes.status === 201,
      `expected 201, got ${equipRes.status}`);
    if (equipRes.status === 201) createdEquipmentId = JSON.parse(equipBody).id;

    // -----------------------------------------------------------------------
    console.log("\nAC3 — access depends on the relationship to the event (briefing §8b)");

    // Organiser A raises a complete request, so it can be submitted later.
    const in30Days = new Date(Date.now() + 30 * 864e5);
    const createRes = await asA("/api/events", {
      method: "POST",
      body: JSON.stringify({
        title: "SPM-4 verification event",
        category: "workshop",
        startsAt: in30Days.toISOString(),
        endsAt: new Date(in30Days.getTime() + 2 * 36e5).toISOString(),
        expectedAttendance: 20,
      }),
    });
    const createBody = await createRes.text();
    record("AC3", "an organiser CAN raise an event request", createRes.status === 201,
      `expected 201, got ${createRes.status}`);
    if (createRes.status !== 201) throw new Error(`Cannot continue: ${createBody}`);
    createdEventId = JSON.parse(createBody).id as string;

    await expectStatus("AC3", "the owning organiser can read their own draft", 200,
      await asA(`/api/events/${createdEventId}`));
    await expectStatus("AC3", "an organiser at ANOTHER client cannot see the draft", 404,
      await asB(`/api/events/${createdEventId}`));
    await expectStatus("AC3", "even a coordinator cannot see someone's unsubmitted draft", 404,
      await asCoordinator(`/api/events/${createdEventId}`));
    await expectStatus("AC3", "an attendee cannot see the draft", 404,
      await asAttendee(`/api/events/${createdEventId}`));
    await expectStatus("AC3", "a coordinator cannot reach the draft through PATCH either", 404,
      await asCoordinator(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "submitted" }),
      }));
    await expectStatus("AC3", "an organiser at another client cannot edit the draft", 404,
      await asB(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ title: "hijacked" }),
      }));
    await expectStatus("AC3", "the owner CAN edit their own draft", 200,
      await asA(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ purpose: "Verifying SPM-4" }),
      }));

    // -----------------------------------------------------------------------
    console.log("\nAC3/AC4 — who may move an event through the lifecycle (briefing §5)");
    await expectStatus("AC4", "the owner CAN submit their own request (Step 2)", 200,
      await asA(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "submitted" }),
      }));
    // 404, not 403: an attendee cannot SEE a submitted event, so the
    // visibility gate refuses before the role gate is reached. That is the
    // stronger of the two refusals - a 403 here would confirm the event
    // exists. The role gate itself is exercised below, on an event the
    // attendee IS allowed to see.
    await expectStatus("AC4", "an ATTENDEE cannot confirm a submitted event", 404,
      await asAttendee(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "confirmed" }),
      }));
    await expectStatus("AC4", "an attendee cannot reject it either", 404,
      await asAttendee(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "rejected", reason: "no" }),
      }));
    // The role gate on its own: this event IS visible to the attendee, so the
    // only thing standing between them and completing it is their role.
    await expectStatus("AC4", "an attendee cannot change the status of an event they CAN see", 403,
      await asAttendee(`/api/events/${confirmed.id}`, {
        method: "PATCH", body: JSON.stringify({ status: "completed" }),
      }));
    await expectStatus("AC4", "an organiser cannot complete another client's event", 404,
      await asB(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "completed" }),
      }));
    await expectStatus("AC4", "venue staff cannot drive the event lifecycle", 403,
      await asVenueStaff(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "approved" }),
      }));
    await expectStatus("AC4", "the organiser cannot approve their OWN request", 403,
      await asA(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "approved" }),
      }));
    await expectStatus("AC4", "a coordinator CAN take it under review (Step 3)", 200,
      await asCoordinator(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "under_review" }),
      }));
    await expectStatus("AC4", "a coordinator CAN approve it (Step 5)", 200,
      await asCoordinator(`/api/events/${createdEventId}`, {
        method: "PATCH", body: JSON.stringify({ status: "approved" }),
      }));

    // -----------------------------------------------------------------------
    console.log("\nAC3 — an Attendee must not see internal planning information (§8b)");
    const attendeeView = await asAttendee(`/api/events/${confirmed.id}`);
    const seen = attendeeView.status === 200 ? await attendeeView.json() : {};
    record("AC3", "an attendee CAN see a confirmed, registerable event", attendeeView.status === 200,
      `expected 200, got ${attendeeView.status}`);

    const mustBeHidden = [
      "coordinatorId", "organiserId", "organisationId", "expectedAttendance",
      "specialRequirements", "accessibilityNotes", "rejectionReason",
      "cancellationReason", "equipmentRequests", "facilityRequirements",
    ];
    const leaked = mustBeHidden.filter((f) => f in seen);
    record("AC3", "…but none of the internal fields come with it", leaked.length === 0,
      leaked.length ? `LEAKED: ${leaked.join(", ")}` : `withheld all ${mustBeHidden.length} internal fields`);
    record("AC3", "…while still getting what they need to register",
      "title" in seen && "startsAt" in seen && "status" in seen,
      `received: ${Object.keys(seen).join(", ")}`);

    // The list endpoint must not leak what the detail endpoint withholds.
    const listRes = await asAttendee("/api/events");
    const list = listRes.status === 200 ? await listRes.json() : [];
    const listLeaks = Array.isArray(list)
      ? [...new Set(list.flatMap((e: Record<string, unknown>) => mustBeHidden.filter((f) => f in e)))]
      : ["(list unavailable)"];
    record("AC3", "the events LIST is narrowed for an attendee too", listLeaks.length === 0,
      listLeaks.length ? `LEAKED: ${listLeaks.join(", ")}` : `${list.length} events, no internal fields`);
    const nonRegisterable = Array.isArray(list)
      ? list.filter((e: { status: string; registrationEnabled?: boolean }) => e.status !== "confirmed")
      : [];
    record("AC3", "an attendee's list contains only confirmed events", nonRegisterable.length === 0,
      nonRegisterable.length ? `saw statuses: ${nonRegisterable.map((e) => e.status).join(", ")}` : "confirmed only");

    // -----------------------------------------------------------------------
    console.log("\nAC3 — an Organiser must not see another client's events (§8b)");
    const listA = await (await asA("/api/events")).json();
    const foreign = (listA as { organisationId: string | null }[]).filter(
      (e) => e.organisationId != null && e.organisationId !== organiserA.organisationId
    );
    record("AC3", "organiser A's list contains only their own client's events", foreign.length === 0,
      foreign.length ? `LEAKED ${foreign.length} events from other clients` : `${listA.length} events, all own client`);

    const otherClientEvent = await prisma.event.findFirst({
      where: { organisationId: { not: organiserA.organisationId }, status: { not: "draft" } },
    });
    if (otherClientEvent) {
      await expectStatus("AC3", "…and fetching another client's event directly is a 404", 404,
        await asA(`/api/events/${otherClientEvent.id}`));
    }

    await expectStatus("AC3", "an attendee cannot register for an event they cannot see", 404,
      await asAttendee("/api/registrations", {
        method: "POST", body: JSON.stringify({ eventId: createdEventId }),
      }));
  } finally {
    // Leave the database as we found it.
    if (createdEventId) {
      await prisma.eventStatusHistory.deleteMany({ where: { eventId: createdEventId } });
      await prisma.equipmentRequest.deleteMany({ where: { eventId: createdEventId } });
      await prisma.eventFacilityRequirement.deleteMany({ where: { eventId: createdEventId } });
      await prisma.registration.deleteMany({ where: { eventId: createdEventId } });
      await prisma.event.delete({ where: { id: createdEventId } }).catch(() => {});
    }
    if (createdEquipmentId) {
      await prisma.equipment.delete({ where: { id: createdEquipmentId } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"-".repeat(64)}`);
  for (const ac of ["AC2", "AC3", "AC4"]) {
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
  console.log("All permission checks passed.");
}

main().catch(async (err) => {
  console.error("\nVerification could not run:\n", err instanceof Error ? err.message : err);
  console.error("\nIs the dev server running? `npm run dev`, then re-run this.");
  await prisma.$disconnect();
  process.exit(1);
});

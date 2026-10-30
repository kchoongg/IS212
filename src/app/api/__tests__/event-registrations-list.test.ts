// SPM-65 View Registration List - the route behind the Attendees tab:
//   src/app/api/events/[id]/registrations/route.ts   exports GET
//   GET /api/events/EVT-000007/registrations
//   -> 401 no session; 404 malformed / unknown / not visible (canViewEvent);
//      403 "Only the event's organiser and its assigned coordinator can view its registrations";
//      200 { event, registrationEnabled, registrationCapacity, counts, registrations }; 500.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - registrations oldest first; registrations made before registration was
//     turned off are still sent, with registrationEnabled false (AC7)
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET } from "@/app/api/events/[id]/registrations/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const ORGANISER_ID = "organiser-id";

const organiser = () => user("organiser", { id: ORGANISER_ID });
const assignedCoordinator = () => user("coordinator", { id: ID.user });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM65 Harbourfront Seminar",
    status: "confirmed",
    organiserId: ORGANISER_ID,
    organisationId: ID.org,
    coordinatorId: ID.user,
    registrationEnabled: true,
    registrationCapacity: 40,
    ...overrides,
  };
}

const REGISTERED_AT = new Date("2026-10-01T02:00:00.000Z");
const WITHDRAWN_AT = new Date("2026-10-05T03:30:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.registration,
    status: "registered",
    registeredAt: REGISTERED_AT,
    withdrawnAt: null,
    dietaryRequirements: null,
    accessibilityRequirements: null,
    // SPM-66: never on the waiting list, nothing offered.
    waitlistedAt: null,
    offeredAt: null,
    offerExpiresAt: null,
    attendee: { fullName: "Marcus Yeo", email: "marcus@example.com", phone: "+65 9123 4567" },
    addedBy: null,
    ...overrides,
  };
}

function given({
  actor = assignedCoordinator(),
  eventRow = event(),
  rows = [row()],
  byStatus = [{ status: "registered", _count: { _all: rows.length } }],
}: {
  actor?: ReturnType<typeof user>;
  eventRow?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  byStatus?: { status: string; _count: { _all: number } }[];
} = {}) {
  const token = signIn(actor);
  db.event.findUnique.mockResolvedValue(eventRow);
  db.registration.findMany.mockResolvedValue(rows);
  db.registration.groupBy.mockResolvedValue(byStatus);
  // SPM-57: the venue capacity; see event-registrations-add.test.ts.
  db.venueBooking.findMany.mockResolvedValue([]);
  return token;
}

const list = (token: string | undefined, reference = REF) =>
  GET(req("GET", `/api/events/${reference}/registrations`, { token }), params({ id: reference }));

const nothingRead = () => expect(db.registration.findMany).not.toHaveBeenCalled();

describe("who may view the registration list", () => {
  it("[SPM-21][AC4] refuses a visitor with no session", async () => {
    const res = await list(undefined);

    expect(res.status).toBe(401);
    nothingRead();
  });

  it.each([
    ["the organiser responsible for the event", organiser],
    ["the coordinator assigned to it", assignedCoordinator],
  ])("[SPM-65][AC1] AC1: lets %s view it", async (_who, actor) => {
    const res = await list(given({ actor: actor() }));

    expect(res.status).toBe(200);
  });

  it("[SPM-65][AC8] AC8: refuses an organiser at the same client who is not responsible for the event", async () => {
    const res = await list(given({ actor: user("organiser", { id: "colleague-id" }) }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      "Only the event's organiser and its assigned coordinator can view its registrations"
    );
    nothingRead();
  });

  it("[SPM-65][AC8] AC8: answers 404 to an organiser of another client, who may not know the event exists", async () => {
    const res = await list(given({ actor: user("organiser", { id: "stranger-id", organisationId: ID.otherOrg }) }));

    expect(res.status).toBe(404);
    nothingRead();
  });

  it("[SPM-65][AC1] refuses a coordinator who is not assigned to the event", async () => {
    const res = await list(given({ actor: user("coordinator", { id: ID.otherUser }) }));

    expect(res.status).toBe(403);
    nothingRead();
  });

  it.each(ROLES.filter((role) => role !== "organiser" && role !== "coordinator" && role !== "attendee"))(
    "[SPM-65][AC9] AC9: refuses the %s role",
    async (role) => {
      const res = await list(given({ actor: user(role) }));

      expect(res.status).toBe(403);
      nothingRead();
    }
  );

  it("[SPM-65][AC9] AC9: refuses an attendee, even one who can see the event", async () => {
    const res = await list(given({ actor: user("attendee") }));

    expect(res.status).toBe(403);
    nothingRead();
  });

  it.each([
    ["a malformed reference", "not-a-ref", event()],
    ["an event that does not exist", REF, null],
    ["a draft, private to its organiser", REF, event({ status: "draft" })],
  ])("[SPM-65] answers 404 for %s", async (_what, reference, eventRow) => {
    const res = await list(given({ eventRow }), reference);

    expect(res.status).toBe(404);
    nothingRead();
  });
});

describe("what the list shows", () => {
  it("[SPM-65][AC2] AC2: gives each attendee's name, contact details, status and registration date", async () => {
    const body = await (await list(given())).json();

    expect(body.registrations).toEqual([
      {
        id: ID.registration,
        status: "registered",
        registeredAt: REGISTERED_AT.toISOString(),
        withdrawnAt: null,
        dietaryRequirements: null,
        accessibilityRequirements: null,
        // SPM-66: not on the waiting list, nothing offered.
        waitingListPosition: null,
        offeredAt: null,
        offerExpiresAt: null,
        attendee: { name: "Marcus Yeo", email: "marcus@example.com", phone: "+65 9123 4567" },
        addedBy: null,
      },
    ]);
  });

  it("[SPM-65][AC2] AC2: reads this event's registrations only, oldest first", async () => {
    await list(given());

    expect(callArg(db.registration.findMany)).toMatchObject({
      where: { eventId: ID.event },
      orderBy: { registeredAt: "asc" },
    });
  });

  it("[SPM-65][AC3] AC3: gives each registration its own status - registered, waitlisted, withdrawn and attended", async () => {
    const rows = ["registered", "waitlisted", "withdrawn", "attended"].map((status, i) =>
      row({ id: `r${i}`, status, withdrawnAt: status === "withdrawn" ? WITHDRAWN_AT : null })
    );

    const body = await (await list(given({ rows }))).json();

    expect(body.registrations.map((r: { status: string }) => r.status)).toEqual([
      "registered",
      "waitlisted",
      "withdrawn",
      "attended",
    ]);
    expect(body.registrations[2].withdrawnAt).toBe(WITHDRAWN_AT.toISOString());
  });

  it("[SPM-65][AC4] AC4: names who added a registration on the organiser's behalf", async () => {
    const rows = [row({ addedBy: { fullName: "Evelyn Chen" } })];

    const body = await (await list(given({ rows }))).json();

    expect(body.registrations[0].addedBy).toEqual({ name: "Evelyn Chen" });
  });

  it("[SPM-65][AC5] AC5: counts the places taken against the capacity, and the waiting list", async () => {
    const body = await (
      await list(
        given({
          byStatus: [
            { status: "registered", _count: { _all: 30 } },
            { status: "attended", _count: { _all: 2 } },
            { status: "waitlisted", _count: { _all: 5 } },
            { status: "withdrawn", _count: { _all: 3 } },
          ],
        })
      )
    ).json();

    expect(body.registrationCapacity).toBe(40);
    expect(body.counts).toEqual({ taken: 32, waitlisted: 5, withdrawn: 3 });
    expect(callArg(db.registration.groupBy)).toEqual({
      by: ["status"],
      where: { eventId: ID.event },
      _count: { _all: true },
    });
  });

  it("[SPM-65] gives the event's reference, title and status for the page header", async () => {
    const body = await (await list(given())).json();

    expect(body.event).toEqual({ sequenceNumber: 7, title: "SPM65 Harbourfront Seminar", status: "confirmed" });
  });

  it("[SPM-65][AC7] AC7: says when registration is not enabled, still listing anyone who registered before it was turned off", async () => {
    const body = await (await list(given({ eventRow: event({ registrationEnabled: false }) }))).json();

    expect(body.registrationEnabled).toBe(false);
    expect(body.registrations).toHaveLength(1);
  });

  it("[SPM-65] answers 500 when the database fails", async () => {
    const token = given();
    db.registration.findMany.mockRejectedValue(new Error("connection lost"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await list(token);

    expect(res.status).toBe(500);
  });
});

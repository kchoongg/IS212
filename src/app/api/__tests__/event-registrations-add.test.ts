// SPM-57 Manually Add Attendee - the route behind the Attendees tab's form:
//   src/app/api/events/[id]/registrations/route.ts   exports POST (and GET)
//   POST /api/events/EVT-000007/registrations
//     { email, dietaryRequirements?, accessibilityRequirements? }
//   -> 401 no session; 404 malformed / unknown / not visible;
//      403 "Only the coordinator assigned to this event can add attendees";
//      400 not Confirmed / registration off (addAttendeeRefusal);
//      400 the form (Zod, on `email`); 400 no Attendee account / holds a
//      place (on `email`); 400 venue capacity unknown or reached (AC3);
//      201 { id, status, message }; 500.
//   GET also gives venueCapacity, canAddAttendees, addAttendeesRefusal and
//   each registration's requirements.
// The rules are src/lib/manualRegistration.ts (manualRegistration.test.ts).
// Decided here, not in the story (change the test if the team wants otherwise):
//   - every message quoted below (docs/test-cases/SPM-57_test_cases.json)
//   - a withdrawn attendee's own row is registered again, as self-registration does
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/events/[id]/registrations/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const ORGANISER_ID = "organiser-id";
const ATTENDEE_ID = "attendee-id";
const BOOKING_ID = "booking-id";

const coordinator = () => user("coordinator", { id: ID.user, fullName: "Daniel Tan" });
const lee = (overrides: Record<string, unknown> = {}) => ({
  id: ATTENDEE_ID,
  email: "lee.wei.ming@example.com",
  fullName: "Lee Wei Ming",
  role: "attendee",
  isActive: true,
  ...overrides,
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM57 Salon Briefing",
    status: "confirmed",
    organiserId: ORGANISER_ID,
    organisationId: ID.org,
    coordinatorId: ID.user,
    registrationEnabled: true,
    registrationCapacity: 2,
    registrationVenueBookingId: BOOKING_ID,
    ...overrides,
  };
}

/// SPM57 Salon (SPM57-SAL), booked as a theatre: it seats 4.
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    status: "approved",
    layoutName: "theatre",
    venue: {
      name: "SPM57 Salon",
      code: "SPM57-SAL",
      layouts: [
        { layoutName: "theatre", capacity: 4 },
        { layoutName: "classroom", capacity: 3 },
      ],
    },
    ...overrides,
  };
}

const VALID = { email: "lee.wei.ming@example.com", dietaryRequirements: "Vegetarian", accessibilityRequirements: "Wheelchair access" };
const FULL =
  "This event has reached its venue capacity: 4 attendees in SPM57 Salon (SPM57-SAL), Theatre layout. No more attendees can be added.";
const NO_ACCOUNT = "No Attendee account uses this email address. Only people with an Attendee account can be added.";

function given({
  actor = coordinator(),
  accounts = [lee()] as object[],
  eventRow = event() as Record<string, unknown> | null,
  existing = null as Record<string, unknown> | null,
  bookings = [booking()],
  taken = 3,
} = {}) {
  const token = signIn(actor, ...accounts);
  db.event.findUnique.mockResolvedValue(eventRow);
  db.registration.findUnique.mockResolvedValue(existing);
  db.venueBooking.findMany.mockResolvedValue(bookings);
  db.registration.count.mockResolvedValue(taken);
  db.registration.create.mockResolvedValue({ id: "new-registration", status: "registered" });
  db.registration.update.mockResolvedValue({ id: "old-registration", status: "registered" });
  return token;
}

const add = (token: string | undefined, body: unknown = VALID, reference = REF) =>
  POST(req("POST", `/api/events/${reference}/registrations`, { token, body }), params({ id: reference }));

const nothingWritten = () => {
  expect(db.registration.create).not.toHaveBeenCalled();
  expect(db.registration.update).not.toHaveBeenCalled();
};

async function emailError(res: Response) {
  expect(res.status).toBe(400);
  return (await res.json()).details.fieldErrors.email[0];
}

describe("[SPM-57][AC1] who may add an attendee", () => {
  it("[SPM-21][AC4] refuses a visitor with no session", async () => {
    const res = await add(undefined);

    expect(res.status).toBe(401);
    nothingWritten();
  });

  it("[SPM-57][AC1] refuses a coordinator who is not assigned to the event", async () => {
    const res = await add(given({ actor: user("coordinator", { id: ID.otherUser }) }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only the coordinator assigned to this event can add attendees");
    nothingWritten();
  });

  it("[SPM-57][AC5] refuses the event's own organiser, who sees the list but adds no one", async () => {
    const res = await add(given({ actor: user("organiser", { id: ORGANISER_ID }) }));

    expect(res.status).toBe(403);
    nothingWritten();
  });

  it.each(ROLES.filter((role) => role !== "coordinator" && role !== "organiser"))(
    "[SPM-57][AC1] refuses the %s role",
    async (role) => {
      const res = await add(given({ actor: user(role, { id: ID.otherUser }) }));

      expect([403, 404]).toContain(res.status);
      nothingWritten();
    }
  );

  it.each([
    ["a malformed reference", "not-a-ref", event()],
    ["an event that does not exist", REF, null],
  ])("[SPM-57] answers 404 for %s", async (_what, reference, eventRow) => {
    const res = await add(given({ eventRow }), VALID, reference);

    expect(res.status).toBe(404);
    nothingWritten();
  });
});

describe("[SPM-57][AC1] when attendees can be added", () => {
  it.each(["approved", "planning", "safety_review", "postponed", "cancelled", "completed"])(
    "[SPM-57][AC1] refuses a %s event: only a Confirmed one",
    async (status) => {
      const res = await add(given({ eventRow: event({ status }) }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Attendees can only be added to a Confirmed event.");
      nothingWritten();
    }
  );

  it("[SPM-57][AC1] refuses an event whose registration is turned off", async () => {
    const res = await add(given({ eventRow: event({ registrationEnabled: false }) }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Registration is not enabled for this event");
    nothingWritten();
  });

  it("[SPM-57][AC2] ignores the self-service registration period, which has closed", async () => {
    const closed = event({ registrationOpensAt: new Date("2026-01-01"), registrationClosesAt: new Date("2026-02-01") });

    const res = await add(given({ eventRow: closed }));

    expect(res.status).toBe(201);
  });
});

describe("[SPM-57][AC1] choosing the Attendee account", () => {
  it.each([
    [{}, "Enter the attendee's email address"],
    [{ email: "   " }, "Enter the attendee's email address"],
    [{ email: "not-an-email" }, "Enter a valid email address"],
  ])("[SPM-57][AC1] refuses %j on the email field", async (body, message) => {
    expect(await emailError(await add(given(), body))).toBe(message);
    nothingWritten();
  });

  it("[SPM-57][AC1] finds the account by its email, ignoring case and surrounding spaces", async () => {
    const res = await add(given(), { email: "  Lee.Wei.Ming@Example.COM " });

    expect(res.status).toBe(201);
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "lee.wei.ming@example.com" } }));
  });

  it.each([
    ["no account at all", []],
    ["an Event Organiser's account", [lee({ role: "organiser" })]],
    ["a coordinator's account", [lee({ role: "coordinator" })]],
    ["a deactivated Attendee account", [lee({ isActive: false })]],
  ])("[SPM-57][AC1] refuses an email with %s", async (_what, accounts) => {
    expect(await emailError(await add(given({ accounts })))).toBe(NO_ACCOUNT);
    nothingWritten();
  });

  it.each([
    ["registered", "Lee Wei Ming is already registered for this event."],
    ["attended", "Lee Wei Ming is already registered for this event."],
    ["waitlisted", "Lee Wei Ming is on the waiting list for this event."],
  ])("[SPM-57][AC1] does not add an attendee who is already %s", async (status, message) => {
    const token = given({ existing: { id: "old-registration", status } });

    expect(await emailError(await add(token))).toBe(message);
    nothingWritten();
  });
});

describe("[SPM-57][AC4] how the registration is recorded", () => {
  it("[SPM-57][AC4] writes a Registered row with the requirements and who added it, and says so", async () => {
    const before = Date.now();
    const res = await add(given());

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "new-registration",
      status: "registered",
      message: "Lee Wei Ming has been added to the registration list.",
    });
    const { data } = callArg(db.registration.create);
    expect(data).toMatchObject({
      eventId: ID.event,
      attendeeId: ATTENDEE_ID,
      status: "registered",
      withdrawnAt: null,
      dietaryRequirements: "Vegetarian",
      accessibilityRequirements: "Wheelchair access",
      addedById: ID.user,
    });
    expect(data.registeredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("[SPM-57][AC1] records no requirements when they are left blank", async () => {
    await add(given(), { email: "lee.wei.ming@example.com", dietaryRequirements: "  ", accessibilityRequirements: "" });

    const { data } = callArg(db.registration.create);
    expect(data.dietaryRequirements).toBeUndefined();
    expect(data.accessibilityRequirements).toBeUndefined();
  });

  it("[SPM-57][AC4] registers a withdrawn attendee again on their own row, as registering again would", async () => {
    const res = await add(given({ existing: { id: "old-registration", status: "withdrawn" } }));

    expect(res.status).toBe(201);
    expect(db.registration.create).not.toHaveBeenCalled();
    expect(callArg(db.registration.update)).toMatchObject({
      where: { id: "old-registration" },
      data: { status: "registered", withdrawnAt: null, addedById: ID.user },
    });
  });

  it("[SPM-57][AC4] answers on the email field when the attendee registered themselves a moment before", async () => {
    const token = given();
    db.registration.create.mockRejectedValue(new Error("Unique constraint failed on the fields: (`event_id`,`attendee_id`)"));

    expect(await emailError(await add(token))).toBe("This attendee is already registered for this event.");
  });
});

describe("[SPM-57][AC2][AC3] the capacity", () => {
  it("[SPM-57][AC2] adds an attendee past the self-service registration capacity", async () => {
    // Capacity 2, 3 already registered.
    const res = await add(given({ taken: 3 }));

    expect(res.status).toBe(201);
  });

  it("[SPM-57][AC3] refuses once the registered attendees reach the venue's capacity", async () => {
    const res = await add(given({ taken: 4 }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(FULL);
    nothingWritten();
  });

  it("[SPM-57][AC3] counts the seats taken - registered and attended - under the event's row lock", async () => {
    await add(given());

    expect(callArg(db.registration.count)).toEqual({
      where: { eventId: ID.event, status: { in: ["registered", "attended"] } },
    });
    const [sql, eventId] = db.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join("?")).toContain("FOR UPDATE");
    expect(eventId).toBe(ID.event);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.registration.count.mock.invocationCallOrder[0]);
  });

  it("[SPM-57][AC3] measures against the booking registration is measured against", async () => {
    const hall = booking({
      id: "hall",
      venue: { name: "SPM57 Hall", code: "SPM57-HAL", layouts: [{ layoutName: "theatre", capacity: 60 }] },
    });

    const res = await add(given({ bookings: [hall, booking()], taken: 4 }));

    expect((await res.json()).error).toBe(FULL);
  });

  it.each([
    ["no active booking", [booking({ status: "rejected" })]],
    ["a booking with no layout", [booking({ layoutName: null })]],
  ])("[SPM-57][AC3] refuses when the venue capacity isn't known: %s", async (_what, bookings) => {
    const res = await add(given({ bookings, eventRow: event({ registrationVenueBookingId: null }) }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "This event's venue capacity isn't known, so attendees can't be added. Choose the venue booking registration is measured against in the Registration settings first."
    );
    nothingWritten();
  });

  it("[SPM-57] answers 500 when the database fails", async () => {
    const token = given();
    db.registration.create.mockRejectedValue(new Error("connection lost"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await add(token);

    expect(res.status).toBe(500);
  });
});

describe("[SPM-57] what the registration list adds for the form", () => {
  function listed({ actor = coordinator(), eventRow = event(), bookings = [booking()], rows = [] as object[] } = {}) {
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue(eventRow);
    db.registration.findMany.mockResolvedValue(rows);
    db.registration.groupBy.mockResolvedValue([]);
    db.venueBooking.findMany.mockResolvedValue(bookings);
    return GET(req("GET", `/api/events/${REF}/registrations`, { token }), params({ id: REF }));
  }

  it("[SPM-57][AC3] gives the venue capacity registration is measured against", async () => {
    const body = await (await listed()).json();

    expect(body.venueCapacity).toEqual({ capacity: 4, venue: "SPM57 Salon (SPM57-SAL)", layout: "Theatre" });
    expect(callArg(db.venueBooking.findMany)).toMatchObject({ where: { eventId: ID.event } });
  });

  it("[SPM-57][AC3] gives no venue capacity when it isn't known", async () => {
    const body = await (await listed({ bookings: [] })).json();

    expect(body.venueCapacity).toBeNull();
  });

  it("[SPM-57][AC1] tells the assigned coordinator they may add attendees", async () => {
    const body = await (await listed()).json();

    expect(body.canAddAttendees).toBe(true);
    expect(body.addAttendeesRefusal).toBeNull();
  });

  it("[SPM-57][AC1] tells the assigned coordinator why not, for an event that isn't Confirmed", async () => {
    const body = await (await listed({ eventRow: event({ status: "planning" }) })).json();

    expect(body.canAddAttendees).toBe(true);
    expect(body.addAttendeesRefusal).toBe("Attendees can only be added to a Confirmed event.");
  });

  it("[SPM-57][AC5] tells the organiser they can't add attendees, with no reason to give", async () => {
    const body = await (await listed({ actor: user("organiser", { id: ORGANISER_ID }) })).json();

    expect(body.canAddAttendees).toBe(false);
    expect(body.addAttendeesRefusal).toBeNull();
  });

  it("[SPM-57][AC1][AC5] gives each registration's dietary and accessibility requirements", async () => {
    const rows = [
      {
        id: "r1",
        status: "registered",
        registeredAt: new Date("2026-10-03T07:00:00.000Z"),
        withdrawnAt: null,
        dietaryRequirements: "Halal",
        accessibilityRequirements: "Hearing loop",
        attendee: { fullName: "Jocelyn Pang", email: "jocelyn.pang@example.com", phone: null },
        addedBy: { fullName: "Daniel Tan" },
      },
    ];

    const body = await (await listed({ actor: user("organiser", { id: ORGANISER_ID }), rows })).json();

    expect(body.registrations[0]).toMatchObject({
      dietaryRequirements: "Halal",
      accessibilityRequirements: "Hearing loop",
      addedBy: { name: "Daniel Tan" },
    });
  });
});

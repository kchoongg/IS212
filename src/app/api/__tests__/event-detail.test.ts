import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma");

import { GET, PATCH } from "@/app/api/events/[id]/route";
import { ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";
import {
  CLARIFICATION_NONE_OPEN,
  CLARIFICATION_NO_LONGER_UNDER_REVIEW,
  CLARIFICATION_RESPOND_FORBIDDEN,
} from "@/lib/clarification";

const REF = "EVT-000007";
const NOW = new Date("2026-10-02T04:00:00Z");
const HOUR = 60 * 60 * 1000;

const organiser = () => user("organiser", { id: ID.user });
const coordinator = () => user("coordinator", { id: ID.otherUser });

/// A complete event raised by organiser() and assigned to coordinator(). Each
/// test overrides the fields its rule depends on.
function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Gala Dinner",
    category: "conference",
    description: "Annual gala",
    status: "under_review",
    organiserId: ID.user,
    organisationId: ID.org,
    coordinatorId: ID.otherUser,
    startsAt: new Date("2027-03-04T01:00:00.000Z"),
    endsAt: new Date("2027-03-04T09:00:00.000Z"),
    expectedAttendance: 100,
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    specialRequirements: "VIP entrance",
    rejectionReason: null,
    ...overrides,
  };
}

function get(token?: string, reference = REF) {
  return GET(req("GET", `/api/events/${reference}`, { token }), params({ id: reference }));
}

function patch(token: string | undefined, body: unknown, reference = REF) {
  return PATCH(req("PATCH", `/api/events/${reference}`, { token, body }), params({ id: reference }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/events/[id]", () => {
  // SPM-52: the organiser and coordinator also get the registrations counted.
  beforeEach(() => {
    db.registration.groupBy.mockResolvedValue([]);
  });

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it("[SPM-31] looks the event up by the number in its reference", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event());

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(callArg(db.event.findUnique).where).toEqual({ sequenceNumber: 7 });
  });

  it.each(["not-a-reference", ID.event, "EVT-99999999999"])(
    "[SPM-31] is 404 for the malformed reference %s, without querying",
    async (reference) => {
      const token = signIn(coordinator());

      const res = await get(token, reference);

      expect(res.status).toBe(404);
      expect(db.event.findUnique).not.toHaveBeenCalled();
    }
  );

  it("[SPM-35] tells the organiser and the coordinator how many change requests the event has", async () => {
    for (const who of [organiser(), coordinator()]) {
      const token = signIn(who);
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));
      db.eventChangeRequest.count.mockResolvedValue(2);

      const body = await (await get(token)).json();

      expect(body.changeRequestCount).toBe(2);
      expect(callArg(db.eventChangeRequest.count)).toEqual({ where: { eventId: ID.event } });
    }
  });

  it("[SPM-35] leaves the count out when there are none", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));
    db.eventChangeRequest.count.mockResolvedValue(0);

    expect(await (await get(token)).json()).not.toHaveProperty("changeRequestCount");
  });

  it("[SPM-35] does not count change requests for someone who may not see them", async () => {
    const token = signIn(user("venue_staff", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));

    await get(token);

    expect(db.eventChangeRequest.count).not.toHaveBeenCalled();
  });

  it("[SPM-31] is 404 for a reference that matches no event", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(null);

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-24][AC3] shows a draft to the organiser who owns it", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(event({ status: "draft", coordinatorId: null }));

    expect((await get(token)).status).toBe(200);
  });

  it.each(["coordinator", "ops_manager", "venue_staff", "tech_support", "attendee"])(
    "[SPM-24][AC5] hides another user's draft from %s as a 404",
    async (role) => {
      const token = signIn(user(role, { id: ID.otherUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

      const res = await get(token);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Event not found" });
    }
  );

  it("[SPM-24][AC5] hides a colleague's draft from an organiser in the same organisation", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.org }));
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-31][AC1] shows a colleague's submitted event to an organiser in the same organisation", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.org }));
    db.event.findUnique.mockResolvedValue(event({ status: "submitted" }));

    expect((await get(token)).status).toBe(200);
  });

  it("[SPM-31][AC1] hides another client's event from an organiser", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));

    expect((await get(token)).status).toBe(404);
  });

  it.each([
    ["not confirmed yet", { status: "planning", registrationEnabled: true }],
    ["confirmed without registration", { status: "confirmed", registrationEnabled: false }],
  ])("[SPM-51][AC3] hides an event from an attendee when it is %s", async (_case, overrides) => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event(overrides));

    expect((await get(token)).status).toBe(404);
  });

  // SPM-64 (AC4, TC23): the booking the capacity is measured against comes
  // with the event, so the Registration card can say "Measured against".
  it("[SPM-64][AC4] includes the booking the registration capacity is measured against, with its room's layouts", async () => {
    const token = signIn(user("coordinator"));
    db.event.findUnique.mockResolvedValue(event({ status: "planning" }));

    await get(token);

    expect(callArg(db.event.findUnique).include.registrationVenueBooking).toEqual({
      select: {
        id: true,
        status: true,
        layoutName: true,
        venue: { select: { name: true, code: true, layouts: { select: { layoutName: true, capacity: true } } } },
      },
    });
  });

  // SPM-64 (#10), manual case TC22: registration turned off doesn't hide the
  // event from an attendee who already holds a place.
  it("[SPM-51][AC6] shows a confirmed event with registration off to an attendee who holds a place in it", async () => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: false }));
    db.registration.count.mockResolvedValue(1);

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(callArg(db.registration.count).where).toEqual({
      eventId: ID.event,
      attendeeId: ID.thirdUser,
      status: { in: ["registered", "waitlisted"] },
    });
  });

  // SPM-37 (decided 2026-10-21): an attendee holding a place can still open a
  // cancelled event, and is told why it was cancelled.
  it("[SPM-37][AC7][AC8] shows a cancelled event, with its reason, to an attendee who holds a place in it", async () => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(
      event({ status: "cancelled", registrationEnabled: true, cancellationReason: "Trainer unavailable" })
    );
    db.registration.count.mockResolvedValue(1);

    const res = await get(token);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("cancelled");
    expect(body.cancellationReason).toBe("Trainer unavailable");
    expect(body.registrationState).toEqual({ kind: "not_confirmed" });
  });

  it("[SPM-37][AC7] is 404 for a cancelled event to an attendee who holds no place in it", async () => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event({ status: "cancelled", registrationEnabled: true }));
    db.registration.count.mockResolvedValue(0);

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-22][AC5] gives an attendee only the public fields of a confirmed, open event", async () => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(
      event({
        status: "confirmed",
        registrationEnabled: true,
        registrationCapacity: 150,
        organisation: { name: "Meridian" },
        organiser: { fullName: "James Koh" },
        coordinator: { fullName: "Daniel Tan" },
        equipmentRequests: [{ id: ID.request }],
      })
    );

    const res = await get(token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      [
        "category",
        "description",
        "endsAt",
        "id",
        "organisation",
        "registrationCapacity",
        "registrationClosesAt",
        "registrationEnabled",
        "registrationOpensAt",
        // ADDED (SPM-51 AC4): whether they can register, and if not why.
        "registrationState",
        // ADDED (SPM-51 AC6, AC7): their own registration, if any.
        "myRegistration",
        "sequenceNumber",
        "startsAt",
        "status",
        "title",
      ].sort()
    );
  });

  // SPM-51 AC4, AC9 (TC05-TC07): the attendee's page says whether they can register.
  it("[SPM-51][AC3][AC9] tells an attendee the event's registration state, counting the seats taken", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-10T04:00:00Z"), toFake: ["Date"] });
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(
      event({
        status: "confirmed",
        registrationEnabled: true,
        registrationCapacity: 3,
        registrationOpensAt: new Date("2026-09-01T01:00:00Z"),
        registrationClosesAt: new Date("2027-12-31T09:00:00Z"),
      })
    );
    db.registration.count.mockResolvedValue(3);

    const body = await (await get(token)).json();
    vi.useRealTimers();

    expect(body.registrationState).toEqual({ kind: "full" });
    expect(db.registration.count).toHaveBeenCalledWith({
      where: { eventId: ID.event, status: { in: ["registered", "attended"] } },
    });
  });

  // SPM-51 AC6, AC7 (TC02, TC03, TC11): the page shows their own registration
  // instead of a Register button.
  it("[SPM-51][AC6] gives an attendee their own registration for the event", async () => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));
    db.registration.findUnique.mockResolvedValue({
      id: ID.registration,
      status: "waitlisted",
      registeredAt: new Date("2026-10-05T02:00:00Z"),
    });

    const body = await (await get(token)).json();

    expect(body.myRegistration).toEqual({
      id: ID.registration,
      status: "waitlisted",
      registeredAt: "2026-10-05T02:00:00.000Z",
    });
    // SPM-52: with its id, for Withdraw.
    expect(callArg(db.registration.findUnique)).toEqual({
      where: { eventId_attendeeId: { eventId: ID.event, attendeeId: ID.thirdUser } },
      select: { id: true, status: true, registeredAt: true },
    });
  });

  it("[SPM-51][AC6] gives an attendee with no registration null", async () => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));
    db.registration.findUnique.mockResolvedValue(null);

    expect((await (await get(token)).json()).myRegistration).toBeNull();
  });

  it("[SPM-51] doesn't work out a registration state for staff", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));

    const body = await (await get(token)).json();

    expect(body).not.toHaveProperty("registrationState");
    expect(body).not.toHaveProperty("myRegistration");
  });

  // SPM-52 AC4 + AC5: a withdrawal shows up for the organiser and coordinator.
  it.each([
    ["the organiser", organiser],
    ["the coordinator", coordinator],
  ])("[SPM-52][AC5] gives %s the places taken and the withdrawals", async (_who, actor) => {
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));
    db.registration.groupBy.mockResolvedValue([
      { status: "registered", _count: { _all: 11 } },
      { status: "waitlisted", _count: { _all: 2 } },
      { status: "withdrawn", _count: { _all: 1 } },
    ]);

    const body = await (await get(signIn(actor()))).json();

    expect(body.registrationCounts).toEqual({ taken: 11, waitlisted: 2, withdrawn: 1 });
    expect(callArg(db.registration.groupBy)).toEqual({
      by: ["status"],
      where: { eventId: ID.event },
      _count: { _all: true },
    });
    // SPM-65: and the page offers them the Attendees tab.
    expect(body.canViewRegistrationList).toBe(true);
  });

  // SPM-65 (AC8, AC1): they can open the event, so its tab bar is drawn, but
  // the registration list is not theirs - no Attendees tab.
  it.each([
    ["an organiser at the same client who did not raise it", () => user("organiser", { id: ID.thirdUser, organisationId: ID.org })],
    ["a coordinator who is not assigned to it", () => user("coordinator", { id: ID.thirdUser })],
  ])("[SPM-65][AC9] tells %s they cannot open its Attendees tab", async (_who, actor) => {
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));

    const res = await get(signIn(actor()));

    expect(res.status).toBe(200);
    expect((await res.json()).canViewRegistrationList).toBe(false);
  });

  it.each(ROLES.filter((role) => role !== "attendee" && !can(role, "registration:view_list")))(
    "[SPM-65] doesn't count the registrations for %s",
    async (role) => {
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));

      const res = await get(signIn(user(role)));

      expect(res.status).toBe(200);
      expect(await res.json()).not.toHaveProperty("registrationCounts");
      expect(db.registration.groupBy).not.toHaveBeenCalled();
    }
  );

  it("[SPM-65] doesn't count every registration for an attendee", async () => {
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));
    db.registration.findUnique.mockResolvedValue(null);

    const body = await (await get(signIn(user("attendee", { id: ID.thirdUser })))).json();

    expect(body).not.toHaveProperty("registrationCounts");
    expect(db.registration.groupBy).not.toHaveBeenCalled();
  });

  it("[SPM-31][AC1] loads only the approved venue bookings, so a pending request is never shown as settled", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event());

    await get(token);

    expect(callArg(db.event.findUnique).include.venueBookings.where).toEqual({ status: "approved" });
  });

  // SPM-85 (AC3): a safety review needs each booked room's layout and the
  // seats that layout holds, not only the room's name.
  it("[SPM-31][AC1] loads each approved booking's layout and the capacity of every layout the room has", async () => {
    const token = signIn(user("safety_officer"));
    // CHANGED (SPM-94 AC2): Planning - the Safety Officer sees no request under review.
    db.event.findUnique.mockResolvedValue(event({ status: "planning" }));

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(callArg(db.event.findUnique).include.venueBookings.select).toEqual({
      startsAt: true,
      endsAt: true,
      layoutName: true,
      // SPM-90 (AC5): what each booked space is for.
      purpose: true,
      session: { select: { label: true } },
      // CHANGED (SPM-87 AC2): with id and opening hours, for the venue restrictions.
      venue: {
        select: {
          id: true,
          name: true,
          code: true,
          opensAt: true,
          closesAt: true,
          layouts: { select: { layoutName: true, capacity: true } },
        },
      },
    });
  });

  it("[SPM-85][AC3] gives the Safety Officer the whole record and the latest safety check, like other staff", async () => {
    const token = signIn(user("safety_officer"));
    // CHANGED (SPM-94 AC2): Planning, not Under review - the Safety Officer
    // sees an event only from Approved onwards.
    db.event.findUnique.mockResolvedValue(
      event({ status: "planning", expectedAttendance: 200, accessibilityNotes: "Step-free" })
    );

    const body = await (await get(token)).json();

    expect(body).toMatchObject({ expectedAttendance: 200, accessibilityNotes: "Step-free" });
    expect(body).toHaveProperty("safetyCheck");
  });

  it("[SPM-31][AC1] gives staff the whole record, including the internal fields", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event({ coordinator: { fullName: "Daniel Tan" } }));

    const body = await (await get(token)).json();

    expect(body.specialRequirements).toBe("VIP entrance");
    expect(body.coordinator).toEqual({ fullName: "Daniel Tan" });
    expect(body.coordinatorId).toBe(ID.otherUser);
  });
});

// SPM-94 (Limit Who Sees a Request's Review Outcome; forum #125). AC6: "The
// same rules apply to the information the system returns, not only to what
// the screens show." CONTRACT: see the SPM-94 block in
// src/lib/__tests__/permissions.test.ts - the route answers through
// canViewEvent() and visibleEventFor(), so a hidden event is the same 404 as
// one that does not exist, and the reason is left out of the record.
describe("GET /api/events/[id] - who sees a request's review outcome (SPM-94)", () => {
  const REASON = "The requested ballroom is closed for renovation in November 2027.";
  const rejected = () => event({ status: "rejected", rejectionReason: REASON });

  beforeEach(() => {
    db.registration.groupBy.mockResolvedValue([]);
  });

  it.each([
    ["the organiser who owns it", () => organiser()],
    ["the coordinator assigned to it", () => coordinator()],
    ["the Event Coordinator Lead", () => user("ops_manager", { id: ID.thirdUser })],
  ])("[SPM-94][AC1][AC6] gives %s the rejection reason", async (_who, who) => {
    const token = signIn(who());
    db.event.findUnique.mockResolvedValue(rejected());

    const body = await (await get(token)).json();

    expect(body.rejectionReason).toBe(REASON);
  });

  it.each([
    ["a coordinator not assigned to it", () => user("coordinator", { id: ID.thirdUser })],
    ["another organiser in the same client", () => user("organiser", { id: ID.thirdUser, organisationId: ID.org })],
  ])("[SPM-94][AC3][AC4][AC6] gives %s the event and its status, without the reason", async (_who, who) => {
    const token = signIn(who());
    db.event.findUnique.mockResolvedValue(rejected());

    const res = await get(token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("rejected");
    expect(body).not.toHaveProperty("rejectionReason");
  });

  it.each(
    ["venue_staff", "tech_support", "safety_officer"].flatMap((role) =>
      ["submitted", "under_review", "rejected", "withdrawn"].map((status) => [role, status])
    )
  )("[SPM-94][AC2][AC5][AC6] is the same 404 as a missing event for %s on a %s request", async (role, status) => {
    const token = signIn(user(role, { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(
      event({ status, coordinatorId: status === "submitted" ? null : ID.otherUser, rejectionReason: status === "rejected" ? REASON : null })
    );

    const res = await get(token);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found" });
  });

  // CHANGED after review of PR #86: SPM-37 cancels from Under review too, so a
  // cancelled event is shown to these three only if its status history has an
  // approval (src/lib/eventVisibility.ts).
  it.each(["venue_staff", "tech_support", "safety_officer"])(
    "[SPM-94][AC2][AC5] is the same 404 as a missing event for %s on a request cancelled before approval",
    async (role) => {
      const token = signIn(user(role, { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "cancelled" }));
      db.eventStatusHistory.count.mockResolvedValue(0);

      const res = await get(token);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Event not found" });
      expect(callArg(db.eventStatusHistory.count)).toEqual({ where: { eventId: ID.event, toStatus: "approved" } });
    }
  );

  it.each(["venue_staff", "tech_support", "safety_officer"])(
    "[SPM-94][AC2] gives %s an event cancelled after it was approved",
    async (role) => {
      const token = signIn(user(role, { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "cancelled" }));
      db.eventStatusHistory.count.mockResolvedValue(1);

      const res = await get(token);

      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("cancelled");
    }
  );

  it("[SPM-94][AC2] reads no status history for a coordinator, or for an event that is not cancelled", async () => {
    db.event.findUnique.mockResolvedValue(event({ status: "cancelled" }));
    expect((await get(signIn(coordinator()))).status).toBe(200);

    db.event.findUnique.mockResolvedValue(event({ status: "approved" }));
    expect((await get(signIn(user("venue_staff", { id: ID.thirdUser })))).status).toBe(200);

    expect(db.eventStatusHistory.count).not.toHaveBeenCalled();
  });

  it.each(["venue_staff", "tech_support", "safety_officer"])(
    "[SPM-94][AC2] gives %s an approved event",
    async (role) => {
      const token = signIn(user(role, { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "approved" }));

      const res = await get(token);

      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("approved");
    }
  );
});

// SPM-29 (AC3): "The open clarification is shown on the event to the Event
// Organiser and the assigned Event Coordinator."
//
// CONTRACT (SPM-29; changed after review on PR #70, 2026-10-21):
//   GET reads the event's open clarification with its own query
//   (clarificationRequest.findFirst, where { eventId, status: "open" }) and returns it as
//   openClarification { id, fields: string[], message, requestedAt, requester: { fullName } },
//   or null when there is none - only to those canSeeClarification() lets see it.
//   Only while the event is Under review: once it is approved, rejected or withdrawn the
//   review is over, so openClarification is null and the query is not run (review point 1).
//   Everyone else gets no openClarification key, and the query is not run for them either.
describe("GET /api/events/[id] - the open clarification (SPM-29)", () => {
  const requestedAt = new Date("2026-10-19T02:00:00.000Z");
  const open = {
    id: "clarification-id",
    fields: "purpose,when",
    message: "Is this a dinner or a conference? Which day?",
    requestedAt,
    requester: { fullName: "Daniel Tan" },
  };

  beforeEach(() => {
    db.registration.groupBy.mockResolvedValue([]);
    db.clarificationRequest.findFirst.mockResolvedValue(open);
  });

  it("[SPM-29][AC4] reads the open clarification of this event", async () => {
    db.event.findUnique.mockResolvedValue(event());

    await get(signIn(coordinator()));

    expect(callArg(db.clarificationRequest.findFirst).where).toEqual({ eventId: ID.event, status: "open" });
  });

  it.each([
    ["the organiser who raised it", organiser],
    ["an organiser at the same client", () => user("organiser", { id: ID.thirdUser, organisationId: ID.org })],
    ["the assigned coordinator", coordinator],
  ])("[SPM-29][AC3] shows it to %s, with what needs clarifying", async (_who, actor) => {
    db.event.findUnique.mockResolvedValue(event());

    const body = await (await get(signIn(actor()))).json();

    expect(body.openClarification).toEqual({
      id: "clarification-id",
      fields: ["purpose", "when"],
      message: "Is this a dinner or a conference? Which day?",
      requestedAt: requestedAt.toISOString(),
      requester: { fullName: "Daniel Tan" },
    });
  });

  it("[SPM-29][AC3] is null for them when nothing is open", async () => {
    db.event.findUnique.mockResolvedValue(event());
    db.clarificationRequest.findFirst.mockResolvedValue(null);

    const body = await (await get(signIn(organiser()))).json();

    expect(body.openClarification).toBeNull();
  });

  it.each(["approved", "rejected", "withdrawn"])(
    "[SPM-29][AC3] is null once the review is over - the event is %s - so no banner is left behind",
    async (status) => {
      // Open both ways the route could read it, so the old include-based code fails too.
      db.event.findUnique.mockResolvedValue(event({ status, clarifications: [open] }));

      const body = await (await get(signIn(organiser()))).json();

      expect(body.openClarification).toBeNull();
      expect(db.clarificationRequest.findFirst).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["a coordinator it is not assigned to", () => user("coordinator", { id: ID.thirdUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.thirdUser })],
  ])("[SPM-29][AC3] keeps it from %s, without looking it up", async (_who, actor) => {
    db.event.findUnique.mockResolvedValue(event());

    const res = await get(signIn(actor()));

    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("openClarification");
    expect(db.clarificationRequest.findFirst).not.toHaveBeenCalled();
  });

  // CHANGED (SPM-94 AC2): a request under review is hidden from these three
  // altogether - not found, and the clarification is never looked up.
  it.each([
    ["Venue Staff", () => user("venue_staff", { id: ID.thirdUser })],
    ["Technical Support", () => user("tech_support", { id: ID.thirdUser })],
    ["the Safety Officer", () => user("safety_officer", { id: ID.thirdUser })],
  ])("[SPM-29][AC3] [SPM-94][AC2] keeps it from %s, who cannot see the request at all", async (_who, actor) => {
    db.event.findUnique.mockResolvedValue(event());

    const res = await get(signIn(actor()));

    expect(res.status).toBe(404);
    expect(db.clarificationRequest.findFirst).not.toHaveBeenCalled();
  });

  it("[SPM-29][AC3] keeps it from an attendee", async () => {
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.count.mockResolvedValue(0);

    const body = await (await get(signIn(user("attendee", { id: ID.thirdUser })))).json();

    expect(body).not.toHaveProperty("openClarification");
    expect(db.clarificationRequest.findFirst).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/events/[id] - who can reach it", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await patch(undefined, { status: "submitted" })).status).toBe(401);
  });

  it("[SPM-27] is 404 for a malformed reference", async () => {
    const res = await patch(signIn(organiser()), { status: "submitted" }, "nope");

    expect(res.status).toBe(404);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("[SPM-27] is 404 for a reference that matches no event", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(null);

    expect((await patch(token, { status: "submitted" })).status).toBe(404);
  });

  it("[SPM-27] is 404, not 403, for an event the user cannot see - and nothing is written", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    const res = await patch(token, { title: "Hijacked" });

    expect(res.status).toBe(404);
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("[SPM-27] answers 500 when the database fails", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await patch(token, { status: "submitted" })).status).toBe(500);
  });
});

describe("PATCH /api/events/[id] - status change", () => {
  /// What the route needs to complete a status change.
  function givenUpdateSucceeds() {
    db.event.update.mockImplementation(async ({ data }: { data: object }) => ({ ...event(), ...data }));
    db.eventSession.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([]);
  }

  describe("submitting a draft", () => {
    const draft = (overrides = {}) => event({ status: "draft", coordinatorId: null, ...overrides });

    it("[SPM-25][AC1][AC2] moves the organiser's own complete draft to submitted and stamps the time", async () => {
      vi.useFakeTimers({ now: NOW });
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(draft());
      givenUpdateSucceeds();

      const res = await patch(token, { status: "submitted" });

      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("submitted");
      expect(callArg(db.event.update)).toEqual({
        where: { id: ID.event },
        data: { status: "submitted", submittedAt: NOW },
      });
    });

    it("[SPM-27][AC2] records the move in the status history", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(draft());
      givenUpdateSucceeds();

      await patch(token, { status: "submitted" });

      expect(callArg(db.eventStatusHistory.create).data).toEqual({
        eventId: ID.event,
        fromStatus: "draft",
        toStatus: "submitted",
        changedBy: ID.user,
        reason: undefined,
      });
    });

    it("[SPM-53][AC1] notifies every active Ops Manager", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(draft());
      givenUpdateSucceeds();
      db.user.findMany.mockResolvedValue([{ id: "ops-1" }, { id: "ops-2" }]);

      await patch(token, { status: "submitted" });

      expect(callArg(db.user.findMany).where).toEqual({ role: "ops_manager", isActive: true });
      expect(callArg(db.notification.createMany).data).toEqual(
        ["ops-1", "ops-2"].map((recipientId) => ({
          recipientId,
          type: "event_submitted",
          title: "New event request submitted",
          body: '"Gala Dinner" has been submitted and needs a coordinator assigned.',
          eventId: ID.event,
        }))
      );
    });

    it("[SPM-53][AC1] writes no notification when there is no Ops Manager to tell", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(draft());
      givenUpdateSucceeds();

      const res = await patch(token, { status: "submitted" });

      expect(res.status).toBe(200);
      expect(db.notification.createMany).not.toHaveBeenCalled();
    });

    it("[SPM-23][AC7] [SPM-25][AC1] refuses an incomplete draft and names every missing field", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(
        draft({ title: "", category: null, startsAt: null, endsAt: null, expectedAttendance: null })
      );
      db.eventSession.findMany.mockResolvedValue([]);

      const res = await patch(token, { status: "submitted" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Cannot submit an incomplete event. Missing: title, category, startsAt, endsAt, expectedAttendance",
      });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("[SPM-23][AC7] [SPM-25][AC1] refuses a multi-session draft where one session has no attendance", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(draft());
      db.eventSession.findMany.mockResolvedValue([{ expectedAttendance: 80 }, { expectedAttendance: null }]);

      const res = await patch(token, { status: "submitted" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Cannot submit an incomplete event. Missing: session 2 expectedAttendance",
      });
    });

    it.each([
      ["a draft", () => draft()],
      ["a submitted request", () => event({ status: "submitted" })],
    ])("[SPM-25][AC3] refuses moving %s to draft - nothing goes back to draft", async (_case, row) => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(row());

      const res = await patch(token, { status: "draft" });

      expect(res.status).toBe(403);
      expect(db.event.update).not.toHaveBeenCalled();
    });
  });

  describe("reviewing", () => {
    it("[SPM-28][AC4][AC6] lets the assigned coordinator approve a request under review", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event());
      givenUpdateSucceeds();

      const res = await patch(token, { status: "approved" });

      expect(res.status).toBe(200);
      expect(callArg(db.event.update).data).toEqual({ status: "approved" });
      expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
        fromStatus: "under_review",
        toStatus: "approved",
        changedBy: ID.otherUser,
      });
      expect(db.notification.createMany).not.toHaveBeenCalled();
    });

    it("[SPM-28][AC1] refuses a coordinator who is not the one assigned", async () => {
      const token = signIn(user("coordinator", { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event());

      const res = await patch(token, { status: "approved" });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Your role cannot move an event to "approved"' });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("[SPM-27][AC4] refuses an organiser approving their own request", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(event());

      expect((await patch(token, { status: "approved" })).status).toBe(403);
    });

    it.each([
      ["approved", "This event is Planning and can't be moved to Approved."],
      ["rejected", "This event is Planning and can't be moved to Rejected."],
    ])("[SPM-28][AC6] refuses %s for a request no longer under review", async (status, message) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "planning" }));

      const res = await patch(token, { status, reason: "Changed my mind" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    // The lifecycle allows Postponed -> Approved (src/lib/statuses.ts), so this
    // gets past the move check - and is then refused as a review outcome. The
    // Postponed -> Approved move belongs to Process Event Change Request
    // (SPM-32), which must not go through this route (Jira comment on SPM-32,
    // 2026-10-15).
    it("[SPM-28][AC6] SPM-28: refuses 'approved' for a Postponed event, as approval is only a review outcome", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "postponed" }));

      const res = await patch(token, { status: "approved" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Only a request that is under review can be approved or rejected" });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("[SPM-59][AC1][AC2] lets the assigned coordinator record a withdrawal while the request is under review", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event());
      givenUpdateSucceeds();

      const res = await patch(token, { status: "withdrawn", reason: "Client asked to withdraw" });

      expect(res.status).toBe(200);
      expect(callArg(db.event.update).data).toEqual({ status: "withdrawn" });
      expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
        fromStatus: "under_review",
        toStatus: "withdrawn",
        reason: "Client asked to withdraw",
      });
    });

    it("[SPM-59][AC1] refuses an organiser withdrawing their own request - they ask the coordinator", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(event());

      expect((await patch(token, { status: "withdrawn" })).status).toBe(403);
    });

    it("[SPM-59][AC1] refuses a withdrawal for a Submitted request, which has no coordinator to record it", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "submitted", coordinatorId: null }));

      expect((await patch(token, { status: "withdrawn" })).status).toBe(403);
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it.each(["approved", "rejected", "withdrawn"])(
      "[SPM-59][AC1] refuses a withdrawal once the request is %s",
      async (status) => {
        const token = signIn(coordinator());
        db.event.findUnique.mockResolvedValue(event({ status }));

        expect((await patch(token, { status: "withdrawn" })).status).toBe(400);
        expect(db.event.update).not.toHaveBeenCalled();
      }
    );

    it.each(["approved", "rejected"])("[SPM-59][AC4] a withdrawn request can no longer be %s", async (outcome) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "withdrawn" }));

      const res = await patch(token, { status: outcome, reason: "Too late" });

      expect(res.status).toBe(400);
      expect(db.event.update).not.toHaveBeenCalled();
      expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    });

    it.each([undefined, "", "   "])("[SPM-28][AC5] refuses a rejection with reason %j", async (reason) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event());

      const res = await patch(token, { status: "rejected", reason });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "A reason is required when rejecting an event" });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("[SPM-28][AC5] keeps the trimmed rejection reason on the event and in the history", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event());
      givenUpdateSucceeds();

      const res = await patch(token, { status: "rejected", reason: "  No venue is licensed overnight. " });

      expect(res.status).toBe(200);
      expect(callArg(db.event.update).data).toEqual({
        status: "rejected",
        rejectionReason: "No venue is licensed overnight.",
      });
      expect(callArg(db.eventStatusHistory.create).data.toStatus).toBe("rejected");
    });
  });

  // An open clarification (SPM-29) only means something while the request is
  // Under review. Leaving review closes it - it was never answered, so
  // responseMessage and respondedAt stay empty.
  describe("an open clarification when the request leaves review", () => {
    it.each([
      ["approved", undefined],
      ["rejected", "Out of budget"],
      ["withdrawn", "Client asked to withdraw"],
    ])("[SPM-26] closes it when the request is %s", async (status, reason) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event());
      givenUpdateSucceeds();

      expect((await patch(token, { status, reason })).status).toBe(200);

      expect(callArg(db.clarificationRequest.updateMany)).toEqual({
        where: { eventId: ID.event, status: "open" },
        data: { status: "closed" },
      });
    });

    it("[SPM-26] leaves clarifications alone on a move that is not out of review", async () => {
      const token = signIn(user("organiser", { id: ID.user }));
      db.event.findUnique.mockResolvedValue(event({ status: "draft", coordinatorId: null }));
      givenUpdateSucceeds();

      expect((await patch(token, { status: "submitted" })).status).toBe(200);

      expect(db.clarificationRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("later transitions", () => {
    it.each([
      ["a submitted request straight to confirmed", "submitted", "confirmed", "This event is Submitted and can't be moved to Confirmed."],
      ["a completed event to cancelled", "completed", "cancelled", "This event is Completed and can't be moved to Cancelled."],
      ["a confirmed event back to planning", "confirmed", "planning", "This event is Confirmed and can't be moved to Planning."],
    ])("[SPM-5][AC4] refuses a move the lifecycle does not allow: %s", async (_case, from, to, message) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: from }));

      const res = await patch(token, { status: to, reason: "x" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("[SPM-54][AC2] refuses moving an approved event to planning by hand - a venue or equipment action does that", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "approved" }));

      const res = await patch(token, { status: "planning" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Planning begins with the first venue or equipment action on an approved event",
      });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    describe("confirming", () => {
      /// What the route reads to decide whether the arrangements are in place.
      function givenArrangements({
        sessions = [] as object[],
        bookings = [] as object[],
        equipment = [] as object[],
      } = {}) {
        db.eventSession.findMany.mockResolvedValue(sessions);
        db.venueBooking.findMany.mockResolvedValue(bookings);
        db.equipmentRequest.findMany.mockResolvedValue(equipment);
        // CHANGED (SPM-88): Confirm waits for the Safety Officer's approval, so
        // these tests, about the other arrangements, have an approved check.
        db.safetyCheck.findFirst.mockResolvedValue(approvedCheck);
      }
      const approvedCheck = {
        id: "check-1",
        status: "approved",
        submittedAt: new Date("2026-10-09T06:30:00.000Z"),
        submitter: { fullName: "Daniel Tan" },
      };
      // CHANGED (SPM-33): each row now carries what the Readiness list reads -
      // the venue's name, the review flag and whether it is marked as not
      // required. A booking is named in the refusal, since an event can have
      // more than one.
      const venue = (status: string, overrides: Record<string, unknown> = {}) => ({
        id: ID.booking,
        sessionId: null,
        status,
        needsReview: false,
        reviewReason: null,
        notRequired: false,
        venue: { name: "Hall A", code: "HALL-A" },
        ...overrides,
      });
      const venueApproved = venue("approved");
      const projector = (status: string, overrides: Record<string, unknown> = {}) => ({
        id: ID.request,
        sessionId: null,
        status,
        needsReview: false,
        reviewReason: null,
        notRequired: false,
        equipment: { name: "Projector" },
        ...overrides,
      });

      async function confirm(
        arrangements: Parameters<typeof givenArrangements>[0] = {},
        eventOverrides: Record<string, unknown> = {}
      ) {
        const token = signIn(coordinator());
        db.event.findUnique.mockResolvedValue(event({ status: "planning", ...eventOverrides }));
        givenUpdateSucceeds();
        // After givenUpdateSucceeds(), which stubs an event with no sessions.
        givenArrangements(arrangements);
        return patch(token, { status: "confirmed" });
      }

      it("[SPM-34][AC1][AC5] confirms, and stamps the time, once the venue is approved and no equipment is outstanding", async () => {
        vi.useFakeTimers({ now: NOW });
        const res = await confirm({ bookings: [venueApproved], equipment: [projector("reserved")] });

        expect(res.status).toBe(200);
        expect(callArg(db.event.update).data).toEqual({ status: "confirmed", confirmedAt: NOW });
        expect(callArg(db.venueBooking.findMany).where).toEqual({ eventId: ID.event });
      });

      it("[SPM-34][AC2] counts partially fulfilled equipment as arranged - the shortfall is the coordinator's call", async () => {
        const res = await confirm({ bookings: [venueApproved], equipment: [projector("partially_fulfilled")] });

        expect(res.status).toBe(200);
      });

      it("[SPM-34][AC2] confirms an event that needs no equipment", async () => {
        expect((await confirm({ bookings: [venueApproved] })).status).toBe(200);
      });

      it.each([
        ["no venue is booked", {}, "This event cannot be confirmed yet: no venue is booked for this event."],
        [
          "the venue request is still pending",
          { bookings: [venue("pending")] },
          "This event cannot be confirmed yet: Hall A for this event is still awaiting a decision from Venue Staff.",
        ],
        [
          "the only venue request was rejected",
          { bookings: [venue("rejected")] },
          "This event cannot be confirmed yet: no venue is booked for this event.",
        ],
        [
          "equipment is requested but not reserved",
          { bookings: [venueApproved], equipment: [projector("requested")] },
          "This event cannot be confirmed yet: Projector for this event is not reserved yet.",
        ],
        [
          "both are outstanding",
          { equipment: [projector("unavailable")] },
          "This event cannot be confirmed yet: no venue is booked for this event; Projector for this event is not reserved yet.",
        ],
        // SPM-33 AC4: a flagged arrangement is outstanding until it is resolved.
        [
          "an approved booking is flagged for review",
          { bookings: [venue("approved", { needsReview: true, reviewReason: "event_schedule_changed" })] },
          "This event cannot be confirmed yet: Hall A for this event is flagged for review: the date or time changed.",
        ],
        [
          "reserved equipment is flagged for review",
          {
            bookings: [venueApproved],
            equipment: [projector("reserved", { needsReview: true, reviewReason: "event_schedule_changed" })],
          },
          "This event cannot be confirmed yet: Projector for this event is flagged for review: the date or time changed.",
        ],
      ])("[SPM-34][AC3] refuses while %s, naming what is outstanding", async (_case, arrangements, message) => {
        const res = await confirm(arrangements);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toBe(message);
        // Exactly the arrangements the message names, in the same order, and
        // each one is what stops Confirm.
        const named = message.slice("This event cannot be confirmed yet: ".length, -1).split("; ");
        expect(body.outstanding.map((a: { missing: string }) => a.missing)).toEqual(named);
        expect(body.outstanding.every((a: { blocksConfirmation: boolean }) => a.blocksConfirmation)).toBe(true);
        expect(db.event.update).not.toHaveBeenCalled();
      });

      it("[SPM-64][AC8] refuses while registration is on but its setup is incomplete (SPM-64 AC8, TC16)", async () => {
        const token = signIn(coordinator());
        db.event.findUnique.mockResolvedValue(
          event({ status: "planning", registrationEnabled: true, registrationCapacity: 60, registrationVenueBookingId: ID.booking })
        );
        givenUpdateSucceeds();
        // CHANGED when SPM-33 was merged in: the confirm path now reads its rows
        // through SPM-33's loadConfirmationInput(), which also needs the venue's
        // name - venue() is SPM-33's full booking row, approved, with this id.
        givenArrangements({ bookings: [venue("approved")] });

        const res = await patch(token, { status: "confirmed" });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(
          "This event cannot be confirmed yet: registration setup is incomplete (still needed: opening date, closing date)."
        );
        expect(callArg(db.venueBooking.findMany).select).toMatchObject({ id: true, sessionId: true, status: true });
        expect(db.event.update).not.toHaveBeenCalled();
      });

      // SPM-88 (AC8, AC9): confirmation needs an approved safety check.
      it.each([
        ["SPM-88-TC13: was never submitted", null, "the Operational Safety Check has not been submitted yet"],
        ["SPM-88-TC08: was closed by a change", "closed", "the Operational Safety Check has to be submitted again"],
        ["was returned with changes requested", "changes_requested", "the Safety Officer asked for changes in the Operational Safety Check"],
        ["was rejected", "rejected", "the Safety Officer rejected the safety arrangement"],
      ])("[SPM-88][AC8] refuses an event whose safety check %s", async (_case, status, missing) => {
        const token = signIn(coordinator());
        db.event.findUnique.mockResolvedValue(event({ status: "planning" }));
        givenUpdateSucceeds();
        givenArrangements({ bookings: [venueApproved] });
        db.safetyCheck.findFirst.mockResolvedValue(status === null ? null : { ...approvedCheck, status });

        const res = await patch(token, { status: "confirmed" });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(`This event cannot be confirmed yet: ${missing}.`);
        expect(db.event.update).not.toHaveBeenCalled();
      });

      it("[SPM-88][AC9] SPM-88-TC09: confirms a Safety approved event", async () => {
        const res = await confirm({ bookings: [venueApproved] }, { status: "safety_cleared" });

        expect(res.status).toBe(200);
        expect(callArg(db.event.update).data).toMatchObject({ status: "confirmed" });
      });

      it("[SPM-34][AC2] [SPM-42][AC4] needs a venue for every session of a multi-session event", async () => {
        const res = await confirm({
          sessions: [
            { id: "s1", label: "Day 1" },
            { id: "s2", label: "Day 2" },
          ],
          bookings: [venue("approved", { sessionId: "s1" })],
        });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(
          "This event cannot be confirmed yet: no venue is booked for the Day 2 session."
        );
      });

      // SPM-33 AC11: "arrangements marked as not required do not prevent it".
      describe("with arrangements marked as not required (SPM-33)", () => {
        it.each([
          [
            "an equipment line Technical Support cannot provide",
            { bookings: [venueApproved], equipment: [projector("unavailable", { notRequired: true })] },
          ],
          [
            "a second venue booking that is still pending",
            { bookings: [venueApproved, venue("pending", { id: ID.otherVenue, notRequired: true })] },
          ],
        ])("[SPM-33][AC11] confirms when the only thing outstanding is %s, marked as not required", async (_case, arrangements) => {
          const res = await confirm(arrangements);

          expect(res.status).toBe(200);
          expect(callArg(db.event.update).data).toMatchObject({ status: "confirmed" });
        });

        it("[SPM-33][AC11] still refuses an event whose only venue booking is marked as not required", async () => {
          const res = await confirm({ bookings: [venue("pending", { notRequired: true })] });

          expect(res.status).toBe(400);
          expect((await res.json()).error).toBe(
            "This event cannot be confirmed yet: no venue is booked for this event."
          );
          expect(db.event.update).not.toHaveBeenCalled();
        });
      });

      // SPM-33 AC5: registration that is enabled but not set up is outstanding.
      describe("with registration enabled (SPM-33)", () => {
        const complete = {
          registrationEnabled: true,
          registrationCapacity: 80,
          registrationOpensAt: new Date("2027-02-01T01:00:00.000Z"),
          registrationClosesAt: new Date("2027-02-28T10:00:00.000Z"),
        };

        it("[SPM-64][AC8] confirms once registration has a capacity and a registration period", async () => {
          expect((await confirm({ bookings: [venueApproved] }, complete)).status).toBe(200);
        });

        it("[SPM-64][AC8] refuses while registration is enabled but has no capacity", async () => {
          const res = await confirm({ bookings: [venueApproved] }, { ...complete, registrationCapacity: null });

          expect(res.status).toBe(400);
          expect((await res.json()).error).toBe(
            "This event cannot be confirmed yet: registration setup is incomplete (still needed: registration capacity)."
          );
          expect(db.event.update).not.toHaveBeenCalled();
        });

        it("[SPM-33][AC11] confirms when incomplete registration setup is marked as not required", async () => {
          const res = await confirm(
            { bookings: [venueApproved] },
            { ...complete, registrationCapacity: null, registrationNotRequired: true }
          );

          expect(res.status).toBe(200);
        });
      });
    });

    it("[SPM-37][AC2][AC8] keeps the cancellation reason when the assigned coordinator cancels", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));
      givenUpdateSucceeds();

      await patch(token, { status: "cancelled", reason: "Client withdrew" });

      expect(callArg(db.event.update).data).toEqual({ status: "cancelled", cancellationReason: "Client withdrew" });
    });

    it("[SPM-37][AC2] refuses an organiser cancelling their own event - that is the coordinator's call", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));

      expect((await patch(token, { status: "cancelled", reason: "We changed plans" })).status).toBe(403);
    });

    // CONTRACT (SPM-37, written before the code): cancelling, in the same
    // transaction as the status change -
    //   venueBooking.updateMany  approved -> released, pending -> withdrawn, with
    //     cancelledBy / cancelledAt and cancellationReason from
    //     arrangementCancellationNote() (src/lib/eventCancellation.ts)
    //   equipmentRequest.updateMany  every line not already cancelled -> cancelled
    //   eventChangeRequest.updateMany  pending -> withdrawn, reviewedBy / reviewedAt,
    //     reviewNotes CHANGE_REQUEST_CLOSED_NOTE
    //   safetyCheck.updateMany  pending or approved -> closed (closeSafetyCheck(),
    //     src/lib/safetyCheckClose.ts), decisionNote SAFETY_CHECK_CLOSED_NOTE
    // Registrations are not touched (SPM-52: a cancelled event's history stays).
    // Notifications (decided 2026-10-21): every active Venue Staff user gets
    // SPM-67's releaseNotification() for each Approved booking released, read
    // first with venueBooking.findMany (venue name and code, session label).
    // Nothing for a withdrawn request. The Organiser and attendees are SPM-53's.
    describe("cancelling (SPM-37)", () => {
      const approvedHall = {
        id: ID.booking,
        status: "approved",
        startsAt: new Date("2027-03-04T01:00:00.000Z"),
        endsAt: new Date("2027-03-04T09:00:00.000Z"),
        venue: { name: "Hall A", code: "HAL-A" },
        session: null,
      };
      const pendingStudio = { ...approvedHall, id: ID.request, status: "pending", venue: { name: "Studio B", code: "STU-B" } };
      /// The event's bookings, as venueBooking.findMany answers for whatever status it asks for.
      const givenBookings = (...rows: { status: string }[]) =>
        db.venueBooking.findMany.mockImplementation(async (args: { where?: { status?: unknown } } = {}) => {
          const wanted = args.where?.status;
          if (wanted === undefined) return rows;
          if (typeof wanted === "string") return rows.filter((r) => r.status === wanted);
          const list = (wanted as { in?: string[] }).in;
          return list ? rows.filter((r) => list.includes(r.status)) : rows;
        });

      const cancel = async (body: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => {
        vi.useFakeTimers({ now: NOW });
        const token = signIn(coordinator());
        db.event.findUnique.mockResolvedValue(event({ status: "planning", ...overrides }));
        // givenUpdateSucceeds() answers user.findMany with nobody; keep a test's own Venue Staff.
        const staff = db.user.findMany.getMockImplementation();
        givenUpdateSucceeds();
        if (staff) db.user.findMany.mockImplementation(staff);
        if (!db.venueBooking.findMany.getMockImplementation()) givenBookings();
        for (const model of ["venueBooking", "equipmentRequest", "eventChangeRequest", "safetyCheck"]) {
          db[model].updateMany.mockResolvedValue({ count: 1 });
        }
        return patch(token, { status: "cancelled", ...body });
      };
      const updates = (model: string) =>
        db[model].updateMany.mock.calls.map((c: unknown[]) => c[0] as { where: unknown; data: Record<string, unknown> });

      it("[SPM-37][AC1] moves the event to Cancelled and records the move", async () => {
        const res = await cancel({ reason: "Sponsor pulled out" });

        expect(res.status).toBe(200);
        expect(callArg(db.event.update).data).toMatchObject({ status: "cancelled", cancellationReason: "Sponsor pulled out" });
        expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
          eventId: ID.event,
          fromStatus: "planning",
          toStatus: "cancelled",
          changedBy: ID.otherUser,
          reason: "Sponsor pulled out",
        });
      });

      it("[SPM-37][AC3][AC4][AC8] releases approved bookings and withdraws pending requests, carrying the reason", async () => {
        await cancel({ reason: "Sponsor pulled out" });

        const taken = { cancelledBy: ID.otherUser, cancelledAt: NOW, cancellationReason: "Event cancelled: Sponsor pulled out" };
        expect(updates("venueBooking")).toEqual(
          expect.arrayContaining([
            { where: { eventId: ID.event, status: "approved" }, data: { status: "released", ...taken } },
            { where: { eventId: ID.event, status: "pending" }, data: { status: "withdrawn", ...taken } },
          ])
        );
        expect(updates("venueBooking")).toHaveLength(2);
      });

      it("[SPM-37][AC3] tells every active Venue Staff user about each approved booking it releases", async () => {
        givenBookings(approvedHall, pendingStudio);
        db.user.findMany.mockResolvedValue([{ id: ID.thirdUser }]);

        await cancel({ reason: "Sponsor pulled out" });

        expect(db.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { role: "venue_staff", isActive: true } })
        );
        expect(db.notification.createMany).toHaveBeenCalledTimes(1);
        expect(callArg(db.notification.createMany).data).toEqual([
          {
            recipientId: ID.thirdUser,
            type: "venue_booking_released",
            title: "Venue booking released",
            body:
              "Test coordinator released Hall A (HAL-A) for EVT-000007 Gala Dinner on 4 Mar 2027, 09:00–17:00. " +
              "Reason: Event cancelled: Sponsor pulled out",
            eventId: ID.event,
          },
        ]);
      });

      it("[SPM-37][AC4] tells nobody about a withdrawn pending request", async () => {
        givenBookings(pendingStudio);
        db.user.findMany.mockResolvedValue([{ id: ID.thirdUser }]);

        await cancel();

        expect(db.notification.createMany).not.toHaveBeenCalled();
      });

      it("[SPM-37][AC8] notes 'Event cancelled.' on the bookings when no reason is given", async () => {
        await cancel();

        expect(updates("venueBooking").map((call) => call.data.cancellationReason)).toEqual([
          "Event cancelled.",
          "Event cancelled.",
        ]);
        expect(callArg(db.event.update).data.cancellationReason ?? null).toBeNull();
      });

      it("[SPM-37][AC8] stores a reason of only spaces as no reason", async () => {
        await cancel({ reason: "   " });

        expect(callArg(db.event.update).data.cancellationReason ?? null).toBeNull();
        expect(updates("venueBooking")[0].data.cancellationReason).toBe("Event cancelled.");
      });

      it("[SPM-37][AC3] cancels every equipment line not already cancelled, reserved or not", async () => {
        await cancel();

        expect(updates("equipmentRequest")).toEqual([
          { where: { eventId: ID.event, status: { not: "cancelled" } }, data: { status: "cancelled" } },
        ]);
      });

      it("[SPM-37][AC5] [SPM-32][AC2] approves the organiser's cancellation request, and closes the other pending change requests without applying them", async () => {
        await cancel();

        expect(updates("eventChangeRequest")).toEqual([
          {
            where: { eventId: ID.event, status: "pending", kind: "cancel" },
            data: {
              status: "approved",
              reviewedBy: ID.otherUser,
              reviewedAt: NOW,
              reviewNotes: "Approved: the event was cancelled.",
            },
          },
          {
            where: { eventId: ID.event, status: "pending" },
            data: {
              status: "withdrawn",
              reviewedBy: ID.otherUser,
              reviewedAt: NOW,
              reviewNotes: "Closed because the event was cancelled.",
            },
          },
        ]);
        // Nothing a change request proposes reaches the event.
        expect(Object.keys(callArg(db.event.update).data).sort()).toEqual(["cancellationReason", "status"]);
      });

      it("[SPM-37][AC6] closes a pending or approved safety check", async () => {
        await cancel({}, { status: "safety_review" });

        expect(updates("safetyCheck")).toEqual([
          {
            where: { eventId: ID.event, status: { in: ["pending", "approved"] } },
            data: { status: "closed", decidedBy: ID.otherUser, decidedAt: NOW, decisionNote: "Event cancelled" },
          },
        ]);
      });

      it("[SPM-37][AC7] keeps the event's registrations as they are", async () => {
        await cancel({}, { status: "confirmed", registrationEnabled: true });

        expect(db.registration.updateMany).not.toHaveBeenCalled();
        expect(db.registration.update).not.toHaveBeenCalled();
        expect(db.registration.deleteMany).not.toHaveBeenCalled();
      });

      it("[SPM-37][AC1] does it all in one transaction", async () => {
        await cancel();

        expect(db.$transaction).toHaveBeenCalledTimes(1);
      });

      it.each(["under_review", "approved", "safety_review", "safety_cleared", "confirmed", "postponed"])(
        "[SPM-37][AC1] cancels an event that is %s",
        async (status) => {
          expect((await cancel({}, { status })).status).toBe(200);
        }
      );

      it.each([
        ["completed", "This event is Completed and can't be moved to Cancelled."],
        ["cancelled", "This event is Cancelled and can't be moved to Cancelled."],
        ["rejected", "This event is Rejected and can't be moved to Cancelled."],
        ["withdrawn", "This event is Withdrawn and can't be moved to Cancelled."],
      ])("[SPM-37][AC1][AC9] refuses to cancel an event that is %s, and releases nothing", async (status, message) => {
        const res = await cancel({}, { status });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe(message);
        expect(db.event.update).not.toHaveBeenCalled();
        expect(db.venueBooking.updateMany).not.toHaveBeenCalled();
        expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
      });

      it.each(["approved", "planning", "confirmed", "postponed", "completed", "under_review"])(
        "[SPM-37][AC9] refuses to move a cancelled event to %s",
        async (status) => {
          const token = signIn(coordinator());
          db.event.findUnique.mockResolvedValue(event({ status: "cancelled" }));

          const res = await patch(token, { status });

          expect(res.status).toBe(400);
          expect(db.event.update).not.toHaveBeenCalled();
        }
      );

      it.each([
        ["a coordinator it is not assigned to", () => user("coordinator", { id: ID.thirdUser })],
        ["the Event Coordinator Lead", () => user("ops_manager", { id: ID.thirdUser })],
        ["the organiser who owns it", () => organiser()],
      ])("[SPM-37][AC2] refuses %s and releases nothing", async (_who, actor) => {
        const token = signIn(actor());
        db.event.findUnique.mockResolvedValue(event({ status: "planning" }));

        const res = await patch(token, { status: "cancelled" });

        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('Your role cannot move an event to "cancelled"');
        expect(db.event.update).not.toHaveBeenCalled();
        expect(db.venueBooking.updateMany).not.toHaveBeenCalled();
        expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
        expect(db.eventChangeRequest.updateMany).not.toHaveBeenCalled();
        expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
      });
    });

    it("[SPM-38][AC1] lets the assigned coordinator postpone a confirmed event", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));
      givenUpdateSucceeds();

      expect((await patch(token, { status: "postponed" })).status).toBe(200);
    });

    it.each([
      ["their own event", () => organiser()],
      ["a colleague's event", () => user("organiser", { id: ID.thirdUser, organisationId: ID.org })],
    ])("[SPM-38][AC2] refuses an organiser postponing %s - that goes through the coordinator", async (_case, actor) => {
      const token = signIn(actor());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));

      expect((await patch(token, { status: "postponed" })).status).toBe(403);
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("[SPM-30][AC1] lets the Ops Manager move any event to under review", async () => {
      const token = signIn(user("ops_manager", { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "submitted", coordinatorId: null }));
      givenUpdateSucceeds();

      expect((await patch(token, { status: "under_review" })).status).toBe(200);
    });

    it.each(["venue_staff", "tech_support"])("[SPM-27][AC4] refuses every status change from %s", async (role) => {
      const token = signIn(user(role, { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "planning" }));

      expect((await patch(token, { status: "confirmed" })).status).toBe(403);
    });

    it("[SPM-27][AC4] refuses an attendee changing the status of an event they can see", async () => {
      const token = signIn(user("attendee", { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));

      expect((await patch(token, { status: "cancelled" })).status).toBe(403);
    });
  });

  it("[SPM-27] rejects a status that does not exist", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event());

    const res = await patch(token, { status: "archived" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });
});

describe("PATCH /api/events/[id] - editing a draft", () => {
  const draft = (overrides = {}) => event({ status: "draft", coordinatorId: null, ...overrides });

  function givenOwnDraft(overrides = {}) {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(draft(overrides));
    db.event.update.mockResolvedValue({ id: ID.event });
    return token;
  }

  it("[SPM-24][AC4] changes only the fields that were sent", async () => {
    const token = givenOwnDraft();

    const res = await patch(token, { title: "  Gala Dinner 2027 ", purpose: "Fundraising" });
    const written = callArg(db.event.update);

    expect(res.status).toBe(200);
    expect(written.where).toEqual({ id: ID.event });
    expect(written.data).toEqual({
      title: "Gala Dinner 2027",
      purpose: "Fundraising",
      facilityRequirements: undefined,
      equipmentRequests: undefined,
    });
    expect(db.eventFacilityRequirement.deleteMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.deleteMany).not.toHaveBeenCalled();
    expect(db.eventSession.deleteMany).not.toHaveBeenCalled();
  });

  it("[SPM-24][AC4] [SPM-26] clears a draft's attendance and layout sent as null", async () => {
    const token = givenOwnDraft();

    expect((await patch(token, { expectedAttendance: null, preferredLayout: null })).status).toBe(200);

    expect(callArg(db.event.update).data).toMatchObject({ expectedAttendance: null, preferredLayout: null });
  });

  it("[SPM-24][AC4] edits a draft that has no dates yet", async () => {
    const token = givenOwnDraft({ startsAt: null, endsAt: null });

    const res = await patch(token, { description: "Dates to be confirmed" });

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toMatchObject({ description: "Dates to be confirmed" });
  });

  it("[SPM-24][AC4] saves every plain field it is given", async () => {
    const token = givenOwnDraft();
    const body = {
      category: "seminar",
      description: "Updated",
      startsAt: "2027-04-01T01:00:00.000Z",
      endsAt: "2027-04-01T05:00:00.000Z",
      expectedAttendance: 60,
      preferredLayout: "theatre",
      accessibilityNotes: "Step-free",
      specialRequirements: "None",
      registrationEnabled: true,
      registrationCapacity: 60,
      registrationOpensAt: "2027-03-01T00:00:00.000Z",
      registrationClosesAt: "2027-03-20T00:00:00.000Z",
    };

    const res = await patch(token, body);

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toEqual({
      ...body,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      registrationOpensAt: new Date(body.registrationOpensAt),
      registrationClosesAt: new Date(body.registrationClosesAt),
      facilityRequirements: undefined,
      equipmentRequests: undefined,
    });
  });

  it("[SPM-25][AC3] refuses to edit a request that has already been submitted", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(event({ status: "submitted" }));

    const res = await patch(token, { title: "Too late" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only draft requests can be edited" });
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("[SPM-24][AC4] refuses a draft's owner whose role cannot edit drafts", async () => {
    // Only reachable if a non-organiser account owns a draft; the role check
    // must still hold rather than trusting ownership alone.
    const token = signIn(user("coordinator", { id: ID.user }));
    db.event.findUnique.mockResolvedValue(draft());

    const res = await patch(token, { title: "Not mine to edit" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the organiser who owns this draft can edit it" });
  });

  it("[SPM-23][AC7] rejects a blank title", async () => {
    const token = givenOwnDraft();

    const res = await patch(token, { title: "   " });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details.fieldErrors.title).toEqual(["Title cannot be blank"]);
  });

  describe("rules checked against what is already saved", () => {
    it("[SPM-23][AC7] refuses a new end that is before the saved start", async () => {
      const token = givenOwnDraft();

      const res = await patch(token, { endsAt: "2027-03-04T00:30:00.000Z" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Ends at must be after starts at.",
        details: { fieldErrors: { endsAt: ["Ends at must be after starts at."] } },
      });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("[SPM-23][AC7] refuses switching registration on while no capacity is saved", async () => {
      const token = givenOwnDraft();

      const body = await (await patch(token, { registrationEnabled: true })).json();

      expect(body.details.fieldErrors).toEqual({
        registrationCapacity: ["Registration capacity is required when registration is enabled."],
      });
    });

    it("[SPM-23][AC7] accepts switching registration on when a capacity is already saved", async () => {
      const token = givenOwnDraft({ registrationCapacity: 100 });

      expect((await patch(token, { registrationEnabled: true })).status).toBe(200);
    });

    it("[SPM-23][AC7] refuses registration opening after the event starts", async () => {
      const token = givenOwnDraft();

      const body = await (await patch(token, { registrationOpensAt: "2027-03-04T02:00:00.000Z" })).json();

      expect(body.details.fieldErrors).toEqual({
        registrationOpensAt: ["Registration must open before the event starts."],
      });
    });

    it("[SPM-23][AC7] refuses registration closing after the event starts", async () => {
      const token = givenOwnDraft();

      const body = await (await patch(token, { registrationClosesAt: "2027-03-04T02:00:00.000Z" })).json();

      expect(body.details.fieldErrors).toEqual({
        registrationClosesAt: ["Registration must close before the event starts."],
      });
    });

    it("[SPM-23][AC7] keeps the 'after it opens' message when closing is wrong on both counts", async () => {
      const token = givenOwnDraft({ registrationOpensAt: new Date("2027-03-05T00:00:00.000Z") });

      const body = await (await patch(token, { registrationClosesAt: "2027-03-04T12:00:00.000Z" })).json();

      expect(body.details.fieldErrors.registrationClosesAt).toEqual(["Registration closes at must be after it opens."]);
    });

    it("[SPM-23][AC7] reports every failing field, with the first as the headline error", async () => {
      const token = givenOwnDraft();

      const body = await (
        await patch(token, { endsAt: "2027-03-04T00:30:00.000Z", registrationEnabled: true })
      ).json();

      expect(body.error).toBe("Ends at must be after starts at.");
      expect(Object.keys(body.details.fieldErrors)).toEqual(["endsAt", "registrationCapacity"]);
    });

    it("[SPM-23][AC7] refuses equipment on a draft with no dates", async () => {
      const token = givenOwnDraft({ startsAt: null, endsAt: null });

      const body = await (
        await patch(token, { equipment: [{ equipmentId: ID.equipment, quantityRequested: 1 }] })
      ).json();

      expect(body.details.fieldErrors).toEqual({
        equipment: ["Set the event date and time before requesting equipment."],
      });
    });
  });

  describe("replacing requirements", () => {
    it("[SPM-24][AC4] replaces the facility requirements wholesale", async () => {
      const token = givenOwnDraft();

      await patch(token, { facilityIds: [ID.facility] });

      expect(callArg(db.eventFacilityRequirement.deleteMany)).toEqual({ where: { eventId: ID.event } });
      expect(callArg(db.event.update).data.facilityRequirements).toEqual({
        create: [{ facilityId: ID.facility, isMandatory: true }],
      });
    });

    it("[SPM-24][AC4] clears the facility requirements when sent an empty list", async () => {
      const token = givenOwnDraft();

      await patch(token, { facilityIds: [] });

      expect(db.eventFacilityRequirement.deleteMany).toHaveBeenCalledOnce();
      expect(callArg(db.event.update).data.facilityRequirements).toBeUndefined();
    });

    it("[SPM-24][AC4] replaces event-wide equipment only, leaving each session's own in place", async () => {
      const token = givenOwnDraft();

      await patch(token, { equipment: [{ equipmentId: ID.equipment, quantityRequested: 3 }] });

      expect(callArg(db.equipmentRequest.deleteMany)).toEqual({ where: { eventId: ID.event, sessionId: null } });
      expect(callArg(db.event.update).data.equipmentRequests).toEqual({
        create: [
          {
            equipmentId: ID.equipment,
            quantityRequested: 3,
            technicalRequirements: undefined,
            startsAt: new Date(draft().startsAt.getTime() - 2 * HOUR),
            endsAt: new Date(draft().endsAt.getTime() + 2 * HOUR),
            requestedBy: ID.user,
            status: "requested",
          },
        ],
      });
    });

    it("[SPM-23][AC5] rejects the same equipment item twice", async () => {
      const token = givenOwnDraft();
      const item = { equipmentId: ID.equipment, quantityRequested: 1 };

      const res = await patch(token, { equipment: [item, item] });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Validation failed");
    });
  });

  describe("sessions", () => {
    const sessions = [
      { startsAt: "2027-05-01T01:00:00.000Z", endsAt: "2027-05-01T05:00:00.000Z", expectedAttendance: 40 },
      { startsAt: "2027-05-02T01:00:00.000Z", endsAt: "2027-05-02T08:00:00.000Z", expectedAttendance: 90 },
    ];

    it("[SPM-23][AC6] replaces the sessions and re-derives the event's dates and attendance", async () => {
      const token = givenOwnDraft();

      const res = await patch(token, { sessions, expectedAttendance: 5 });

      expect(res.status).toBe(200);
      expect(callArg(db.eventSession.deleteMany)).toEqual({ where: { eventId: ID.event } });
      expect(callArg(db.eventSession.createMany).data).toHaveLength(2);
      expect(callArg(db.event.update).data).toMatchObject({
        startsAt: new Date("2027-05-01T01:00:00.000Z"),
        endsAt: new Date("2027-05-02T08:00:00.000Z"),
        expectedAttendance: 90,
      });
    });

    it("[SPM-23][AC6] leaves the saved attendance alone when no session gives a figure", async () => {
      const token = givenOwnDraft();

      await patch(token, { sessions: sessions.map((s) => ({ ...s, expectedAttendance: undefined })) });

      expect(callArg(db.event.update).data).not.toHaveProperty("expectedAttendance");
    });

    it("[SPM-23][AC6] turns multi-session off when sent an empty list, without touching the dates", async () => {
      const token = givenOwnDraft();

      const res = await patch(token, { sessions: [] });
      const written = callArg(db.event.update).data;

      expect(res.status).toBe(200);
      expect(db.eventSession.deleteMany).toHaveBeenCalledOnce();
      expect(db.eventSession.createMany).not.toHaveBeenCalled();
      expect(written).not.toHaveProperty("startsAt");
      expect(written).not.toHaveProperty("endsAt");
    });
  });

  it("[SPM-23][AC5] reports a duplicate item caught only by the database's unique index", async () => {
    const token = givenOwnDraft();
    db.event.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    );

    const res = await patch(token, { title: "Gala" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Each item can only be requested once per event, across all sessions." });
  });
});

// SPM-36: the assigned coordinator marks a Confirmed event completed once it
// has taken place (#71); an event 7 days past its end is completed by the
// sweep that runs before the event is read.
describe("PATCH /api/events/[id] - marking completed", () => {
  const ENDED = { status: "confirmed", startsAt: new Date("2026-09-30T01:00:00Z"), endsAt: new Date("2026-09-30T09:00:00Z") };

  function givenUpdateSucceeds() {
    db.event.update.mockImplementation(async ({ data }: { data: object }) => ({ ...event(ENDED), ...data }));
  }

  it("[SPM-36][AC1] SPM-36-TC01: lets the assigned coordinator mark a Confirmed event that has ended as completed", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event(ENDED));
    givenUpdateSucceeds();

    const res = await patch(token, { status: "completed" });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("completed");
    expect(callArg(db.event.update)).toEqual({ where: { id: ID.event }, data: { status: "completed" } });
    expect(callArg(db.eventStatusHistory.create).data).toEqual({
      eventId: ID.event,
      fromStatus: "confirmed",
      toStatus: "completed",
      changedBy: ID.otherUser,
      reason: undefined,
    });
  });

  it("[SPM-36][AC3] leaves the venue bookings and equipment as they are", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event(ENDED));
    givenUpdateSucceeds();

    await patch(token, { status: "completed" });

    expect(db.venueBooking.update).not.toHaveBeenCalled();
    expect(db.venueBooking.updateMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
    expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-36][AC1] SPM-36-TC04: refuses an event that has not ended yet", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event({ ...ENDED, endsAt: new Date(NOW.getTime() + HOUR) }));

    const res = await patch(token, { status: "completed" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This event hasn't ended yet, so it can't be marked completed." });
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("[SPM-36][AC1] counts an event that ends at this very moment as ended", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event({ ...ENDED, endsAt: NOW }));
    givenUpdateSucceeds();

    expect((await patch(token, { status: "completed" })).status).toBe(200);
  });

  it.each(["planning", "safety_cleared", "postponed", "approved"])(
    "[SPM-36][AC2] refuses to complete a %s event - only a Confirmed one",
    async (status) => {
      vi.useFakeTimers({ now: NOW });
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ ...ENDED, status }));

      const res = await patch(token, { status: "completed" });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/can't be moved to Completed\.$/);
      expect(db.event.update).not.toHaveBeenCalled();
    }
  );

  it.each(["confirmed", "postponed", "cancelled", "planning"])(
    "[SPM-36][AC5] refuses to move a completed event to %s",
    async (status) => {
      vi.useFakeTimers({ now: NOW });
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ ...ENDED, status: "completed" }));

      const res = await patch(token, { status, reason: "Changed plans" });

      expect(res.status).toBe(400);
      expect(db.event.update).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["another coordinator", () => user("coordinator", { id: ID.thirdUser })],
    ["the organiser", () => organiser()],
    ["the Event Coordinator Lead", () => user("ops_manager", { id: ID.thirdUser })],
  ])("[SPM-36][AC1] SPM-36-TC05: refuses %s", async (_who, actor) => {
    vi.useFakeTimers({ now: NOW });
    const token = signIn(actor());
    db.event.findUnique.mockResolvedValue(event(ENDED));

    expect((await patch(token, { status: "completed" })).status).toBe(403);
    expect(db.event.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/events/[id] - completing events 7 days past their end", () => {
  it("[SPM-36][AC6] completes due events before reading this one", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(null);

    await get(token);

    const [strings] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join("?")).toContain("UPDATE events SET status = 'completed'");
  });

  it("[SPM-36][AC6] does not sweep for a reference that cannot exist", async () => {
    const token = signIn(coordinator());

    await get(token, "not-a-reference");

    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

// SPM-36: once an event is completed, the attendee who registered for it can
// still open it from My Registrations (#10).
describe("GET /api/events/[id] - an attendee and a completed event", () => {
  const attendee = () => user("attendee", { id: ID.thirdUser });
  const completed = () => event({ status: "completed", endsAt: new Date("2026-09-30T09:00:00Z") });

  beforeEach(() => {
    db.registration.groupBy.mockResolvedValue([]);
  });

  it("[SPM-36][AC6] [SPM-51][AC1] shows it to an attendee who is still registered", async () => {
    const token = signIn(attendee());
    db.event.findUnique.mockResolvedValue(completed());
    db.registration.count.mockResolvedValueOnce(1);

    expect((await get(token)).status).toBe(200);
  });

  it("[SPM-36][AC6] [SPM-51][AC1] shows it to an attendee who was marked attended", async () => {
    const token = signIn(attendee());
    db.event.findUnique.mockResolvedValue(completed());
    db.registration.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    expect((await get(token)).status).toBe(200);
    expect(db.registration.count.mock.calls[1][0]).toEqual({
      where: { eventId: ID.event, attendeeId: ID.thirdUser, status: "attended" },
    });
  });

  it("[SPM-36][AC6] [SPM-51][AC1] hides it from an attendee who never registered or withdrew", async () => {
    const token = signIn(attendee());
    db.event.findUnique.mockResolvedValue(completed());
    db.registration.count.mockResolvedValue(0);

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-36] does not look for an attended registration on an event that is not completed", async () => {
    const token = signIn(attendee());
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: false }));
    db.registration.count.mockResolvedValue(0);

    expect((await get(token)).status).toBe(404);
    expect(db.registration.count).toHaveBeenCalledTimes(1);
  });
});

// SPM-36 (AC3, AC4): the organiser can still open a completed event, with the
// venue booked and the equipment recorded for it.
describe("GET /api/events/[id] - the organiser and a completed event", () => {
  beforeEach(() => {
    db.registration.groupBy.mockResolvedValue([]);
  });

  it("[SPM-36][AC4] SPM-36-TC02: gives the organiser who owns it the event with its approved bookings and equipment", async () => {
    const token = signIn(organiser());
    const venueBookings = [{ startsAt: new Date("2026-09-30T01:00:00Z"), venue: { name: "Orchard Gallery", code: "ORC-GAL" } }];
    const equipmentRequests = [{ id: "r1", status: "reserved", equipment: { name: "Handheld Wireless Mic" } }];
    db.event.findUnique.mockResolvedValue(event({ status: "completed", venueBookings, equipmentRequests }));

    const res = await get(token);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.venueBookings).toHaveLength(1);
    expect(body.equipmentRequests).toHaveLength(1);
    expect(callArg(db.event.findUnique).include.venueBookings.where).toEqual({ status: "approved" });
  });
});

// CONTRACT (SPM-26, written before the code) - the organiser answers an open
// clarification by updating the request and resubmitting it, in one PATCH
// with no `status` key (the draft editor's own payload, SPM-24):
//   - only the organiser who raised it (canRespondToClarification), only while
//     Under review: 403 CLARIFICATION_RESPOND_FORBIDDEN for anyone else who can
//     see the event; an event past review keeps "Only draft requests can be
//     edited";
//   - only while a clarification is open: 400 CLARIFICATION_NONE_OPEN;
//   - the draft's fields and rules (updateEventDraftSchema, the merged-record
//     field errors), and the request must stay as complete as submitting
//     requires: 400 "Cannot resubmit an incomplete request. Missing: ...";
//   - one transaction: lock the event row and read its status again
//     (SELECT status FROM events WHERE id = ? FOR UPDATE) - changed meanwhile:
//     400 CLARIFICATION_NO_LONGER_UNDER_REVIEW; mark the open clarification
//     answered (updateMany where it is still open; count 0: 400
//     CLARIFICATION_NONE_OPEN), then write the content;
//   - the status and its history are never written (AC4), and no reply
//     message is stored (decided 2026-10-21).
describe("PATCH /api/events/[id] - answering a clarification (SPM-26)", () => {
  const OPEN = { id: "clarification-1" };

  function givenResponding({
    row = event(),
    actor = organiser(),
    open = OPEN as { id: string } | null,
    lockedStatus = "under_review",
    answered = 1,
  } = {}) {
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue(row);
    db.clarificationRequest.findFirst.mockResolvedValue(open);
    db.$queryRaw.mockResolvedValue([{ status: lockedStatus }]);
    db.clarificationRequest.updateMany.mockResolvedValue({ count: answered });
    db.eventSession.findMany.mockResolvedValue([]);
    db.event.update.mockImplementation(async ({ data }: { data: object }) => ({ ...row, ...data }));
    return token;
  }

  function nothingWritten() {
    expect(db.event.update).not.toHaveBeenCalled();
    expect(db.clarificationRequest.updateMany).not.toHaveBeenCalled();
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
  }

  it("[SPM-26][AC2][AC3] saves the organiser's changes", async () => {
    const token = givenResponding();

    const res = await patch(token, { description: "Gala for 150 guests", expectedAttendance: 150 });

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).where).toEqual({ id: ID.event });
    expect(callArg(db.event.update).data).toMatchObject({ description: "Gala for 150 guests", expectedAttendance: 150 });
  });

  it("[SPM-26][AC4] marks the open clarification answered, with the time and no reply message", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const token = givenResponding();

    expect((await patch(token, { description: "Gala for 150 guests" })).status).toBe(200);

    expect(callArg(db.clarificationRequest.updateMany)).toEqual({
      where: { id: OPEN.id, status: "open" },
      data: { status: "answered", respondedAt: NOW },
    });
  });

  it("[SPM-26][AC4] keeps the event Under review: the status and its history are not written", async () => {
    const token = givenResponding();

    expect((await patch(token, { title: "Gala Dinner 2027" })).status).toBe(200);

    expect(callArg(db.event.update).data).not.toHaveProperty("status");
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
  });

  it("[SPM-26][AC2] accepts any field a draft can change, not only the ones the coordinator asked about", async () => {
    const token = givenResponding();
    const facilityId = "11111111-1111-4111-8111-111111111111";
    const equipmentId = "22222222-2222-4222-8222-222222222222";

    const res = await patch(token, {
      title: "Gala Dinner 2027",
      category: "networking",
      purpose: "Fundraising",
      preferredLayout: "banquet",
      accessibilityNotes: "Step-free entrance",
      specialRequirements: "Halal catering",
      facilityIds: [facilityId],
      equipment: [{ equipmentId, quantityRequested: 2 }],
    });

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toMatchObject({
      title: "Gala Dinner 2027",
      category: "networking",
      purpose: "Fundraising",
      preferredLayout: "banquet",
      accessibilityNotes: "Step-free entrance",
      specialRequirements: "Halal catering",
      facilityRequirements: { create: [{ facilityId, isMandatory: true }] },
    });
    expect(db.eventFacilityRequirement.deleteMany).toHaveBeenCalledWith({ where: { eventId: ID.event } });
    expect(db.equipmentRequest.deleteMany).toHaveBeenCalledWith({ where: { eventId: ID.event, sessionId: null } });
  });

  it("[SPM-26][AC3] locks the event row and reads its status again before writing", async () => {
    const token = givenResponding();

    expect((await patch(token, { title: "Gala Dinner 2027" })).status).toBe(200);

    const [sql, lockedId] = db.$queryRaw.mock.calls[0];
    expect(sql.join("?")).toBe("SELECT status FROM events WHERE id = ? FOR UPDATE");
    expect(lockedId).toBe(ID.event);
    const locked = db.$queryRaw.mock.invocationCallOrder[0];
    expect(locked).toBeLessThan(db.clarificationRequest.updateMany.mock.invocationCallOrder[0]);
    expect(locked).toBeLessThan(db.event.update.mock.invocationCallOrder[0]);
  });

  it("[SPM-26][AC4] refuses when the request left review in the meantime, and writes nothing", async () => {
    const token = givenResponding({ lockedStatus: "approved" });

    const res = await patch(token, { title: "Gala Dinner 2027" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CLARIFICATION_NO_LONGER_UNDER_REVIEW });
    nothingWritten();
  });

  it("[SPM-26][AC4] refuses when the clarification was answered in the meantime, before writing the content", async () => {
    const token = givenResponding({ answered: 0 });

    const res = await patch(token, { title: "Gala Dinner 2027" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CLARIFICATION_NONE_OPEN });
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("[SPM-26][AC2] refuses when no clarification is open, without opening a transaction", async () => {
    const token = givenResponding({ open: null });

    const res = await patch(token, { title: "Gala Dinner 2027" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CLARIFICATION_NONE_OPEN });
    expect(callArg(db.clarificationRequest.findFirst).where).toEqual({ eventId: ID.event, status: "open" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    nothingWritten();
  });

  it.each([
    ["an organiser at the same client", () => user("organiser", { id: ID.thirdUser, organisationId: ID.org })],
    ["the assigned coordinator", coordinator],
    ["the Ops Manager", () => user("ops_manager", { id: ID.thirdUser })],
  ])("[SPM-26][AC2] refuses %s with 403", async (_who, actor) => {
    const token = givenResponding({ actor: actor() });

    const res = await patch(token, { title: "Not mine to change" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CLARIFICATION_RESPOND_FORBIDDEN });
    nothingWritten();
  });

  // CHANGED (SPM-94 AC2): Venue Staff cannot see a request under review, so
  // it is a 404 for them, as for another client.
  it("[SPM-26][AC2] [SPM-94][AC2] is 404 for Venue Staff, who cannot see a request under review", async () => {
    const token = givenResponding({ actor: user("venue_staff", { id: ID.thirdUser }) });

    const res = await patch(token, { title: "Not mine to change" });

    expect(res.status).toBe(404);
    nothingWritten();
  });

  it("[SPM-26][AC2] is 404 for an organiser at another client", async () => {
    const token = givenResponding({ actor: user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }) });

    expect((await patch(token, { title: "Hijacked" })).status).toBe(404);
    nothingWritten();
  });

  it.each(["approved", "rejected", "withdrawn"])(
    "[SPM-26][AC4] still refuses a content edit once the request is %s",
    async (status) => {
      const token = givenResponding({ row: event({ status }) });

      const res = await patch(token, { title: "Too late" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Only draft requests can be edited" });
      nothingWritten();
    }
  );

  it("[SPM-26][AC2] applies the draft's validation", async () => {
    const token = givenResponding();

    const res = await patch(token, { title: "   " });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.title).toEqual(["Title cannot be blank"]);
    nothingWritten();
  });

  it("[SPM-26][AC2] checks the changes against what is already saved", async () => {
    const token = givenResponding();

    const res = await patch(token, { endsAt: "2027-03-04T00:00:00.000Z" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.endsAt).toEqual(["Ends at must be after starts at."]);
    nothingWritten();
  });

  it("[SPM-26][AC3] refuses to resubmit a request a required field was cleared from", async () => {
    const token = givenResponding();

    const res = await patch(token, { category: "" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot resubmit an incomplete request. Missing: category" });
    nothingWritten();
  });

  it("[SPM-26][AC3] refuses sessions sent without their own expected attendance", async () => {
    const token = givenResponding();

    const res = await patch(token, {
      sessions: [
        { label: "Day 1", startsAt: "2027-03-04T01:00:00.000Z", endsAt: "2027-03-04T05:00:00.000Z", expectedAttendance: 80 },
        { label: "Day 2", startsAt: "2027-03-05T01:00:00.000Z", endsAt: "2027-03-05T05:00:00.000Z" },
      ],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Cannot resubmit an incomplete request. Missing: session 2 expectedAttendance",
    });
    nothingWritten();
  });

  it("[SPM-26][AC3] refuses sessions none of which has an expected attendance", async () => {
    const token = givenResponding();

    const res = await patch(token, {
      sessions: [
        { startsAt: "2027-03-04T01:00:00.000Z", endsAt: "2027-03-04T05:00:00.000Z" },
        { startsAt: "2027-03-05T01:00:00.000Z", endsAt: "2027-03-05T05:00:00.000Z" },
      ],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Cannot resubmit an incomplete request. Missing: expectedAttendance, session 1 expectedAttendance, session 2 expectedAttendance"
    );
    nothingWritten();
  });

  it("[SPM-26][AC3] refuses a saved session with no expected attendance when the sessions are not resent", async () => {
    const token = givenResponding();
    db.eventSession.findMany.mockResolvedValue([{ expectedAttendance: 80 }, { expectedAttendance: null }]);

    const res = await patch(token, { title: "Gala Dinner 2027" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Cannot resubmit an incomplete request. Missing: session 2 expectedAttendance");
    nothingWritten();
  });

  it("[SPM-26][AC2] removes a preferred layout sent as null", async () => {
    const token = givenResponding();

    expect((await patch(token, { preferredLayout: null })).status).toBe(200);

    expect(callArg(db.event.update).data).toMatchObject({ preferredLayout: null });
  });

  it("[SPM-26][AC3] refuses an expected attendance sent as null", async () => {
    const token = givenResponding();

    const res = await patch(token, { expectedAttendance: null });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot resubmit an incomplete request. Missing: expectedAttendance" });
    nothingWritten();
  });

  it("[SPM-26] answers 500 when the database fails inside the transaction", async () => {
    const token = givenResponding();
    db.$queryRaw.mockRejectedValue(new Error("lock timeout"));

    expect((await patch(token, { title: "Gala Dinner 2027" })).status).toBe(500);
    nothingWritten();
  });

  it("[SPM-26] a draft edit takes no lock and answers no clarification", async () => {
    const token = givenResponding({ row: event({ status: "draft", coordinatorId: null }) });

    expect((await patch(token, { title: "Gala Dinner 2027" })).status).toBe(200);

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.clarificationRequest.updateMany).not.toHaveBeenCalled();
  });
});

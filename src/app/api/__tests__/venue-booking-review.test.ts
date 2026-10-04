// SPM-43: the Booking Requests list Venue Staff work from, and their decision
// on one request. Times are UTC; Singapore is UTC+8, so 05:00Z-10:00Z on
// 4 March is that day's PM slot (13:00-18:00).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET } from "@/app/api/venue-bookings/route";
import { PATCH } from "@/app/api/venue-bookings/[id]/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const NOW = new Date("2026-10-04T04:00:00Z");
const PM = { startsAt: new Date("2027-03-04T05:00:00.000Z"), endsAt: new Date("2027-03-04T10:00:00.000Z") };
const AM = { startsAt: new Date("2027-03-03T23:00:00.000Z"), endsAt: new Date("2027-03-04T04:00:00.000Z") };

const venueStaff = () => user("venue_staff");
const rolesExcept = (...allowed: string[]) => ROLES.filter((role) => !allowed.includes(role));

/// A venue as loadReviewVenues() reads it: with its approved bookings and its
/// unavailable periods.
function venueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.venue,
    name: "Hall A",
    isActive: true,
    setupMinutes: 0,
    teardownMinutes: 0,
    bookings: [],
    unavailability: [],
    ...overrides,
  };
}

const approvedElsewhere = (overrides: Record<string, unknown> = {}) => ({
  id: "other-booking",
  ...PM,
  event: { sequenceNumber: 50, title: "Gala Dinner" },
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/venue-bookings", () => {
  function pending(overrides: Record<string, unknown> = {}) {
    return {
      id: ID.booking,
      status: "pending",
      ...PM,
      layoutName: "theatre",
      requirementsNote: null,
      requestedAt: new Date("2027-01-10T02:00:00.000Z"),
      requester: { fullName: "Daniel Tan" },
      event: {
        sequenceNumber: 42,
        title: "Town Hall",
        status: "planning",
        startsAt: PM.startsAt,
        endsAt: PM.endsAt,
        expectedAttendance: 100,
        organisation: { name: "Meridian" },
      },
      session: null,
      venue: { id: ID.venue, code: "HALL-A", name: "Hall A", setupMinutes: 0, teardownMinutes: 0, isActive: true },
      ...overrides,
    };
  }

  function given(bookings: object[], venues: object[] = [venueRow()]) {
    const token = signIn(venueStaff());
    db.venueBooking.findMany.mockResolvedValue(bookings);
    db.venue.findMany.mockResolvedValue(venues);
    return token;
  }

  const list = (token?: string) => GET(req("GET", "/api/venue-bookings", { token }));

  it("is 401 without a session", async () => {
    expect((await list()).status).toBe(401);
  });

  it.each(rolesExcept("venue_staff"))("is 403 for %s", async (role) => {
    const res = await list(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueBooking.findMany).not.toHaveBeenCalled();
  });

  it("lists pending requests only, and not those whose event is still awaiting approval", async () => {
    const token = given([]);

    await list(token);

    expect(callArg(db.venueBooking.findMany).where).toEqual({
      status: "pending",
      event: { status: { notIn: ["draft", "submitted", "under_review"] } },
    });
  });

  it("gives each request with the event information a decision needs", async () => {
    const token = given([pending()]);

    const res = await list(token);
    const [row] = await res.json();

    expect(res.status).toBe(200);
    expect(row.event).toEqual({
      reference: "EVT-000042",
      title: "Town Hall",
      status: "planning",
      startsAt: PM.startsAt.toISOString(),
      endsAt: PM.endsAt.toISOString(),
      expectedAttendance: 100,
      organisation: "Meridian",
    });
    expect(row).toMatchObject({ id: ID.booking, status: "pending", layoutName: "theatre", conflict: null });
    expect(row.requester).toEqual({ fullName: "Daniel Tan" });
  });

  it("gives no organisation name for an event that has none", async () => {
    const token = given([pending({ event: { ...pending().event, organisation: null } })]);

    const [row] = await (await list(token)).json();

    expect(row.event.organisation).toBeNull();
  });

  it("loads each venue once, however many requests are for it", async () => {
    const token = given([pending(), pending({ id: "second" })]);

    await list(token);

    expect(db.venue.findMany).toHaveBeenCalledOnce();
    expect(callArg(db.venue.findMany).where).toEqual({ id: { in: [ID.venue] } });
    expect(callArg(db.venue.findMany).select.bookings.where).toEqual({ status: "approved" });
  });

  describe("flagging a clash before anyone clicks Approve", () => {
    it("names the approved booking that already holds the slot", async () => {
      const token = given([pending()], [venueRow({ bookings: [approvedElsewhere()] })]);

      const [row] = await (await list(token)).json();

      expect(row.conflict).toBe(
        "This overlaps an approved booking: EVT-000050 Gala Dinner holds Hall A on 4 Mar 2027 · PM (13:00–18:00)."
      );
    });

    it("says when the clash is only through the venue's setup or turnaround slot", async () => {
      // The other booking is in the AM; this one's setup reaches back into it.
      const token = given(
        [pending({ venue: { ...pending().venue, setupMinutes: 60 } })],
        [venueRow({ setupMinutes: 60, bookings: [approvedElsewhere(AM)] })]
      );

      const [row] = await (await list(token)).json();

      expect(row.conflict).toMatch(/The clash is through a setup or turnaround slot\.$/);
    });

    it("names an unavailable period, with its reason in words", async () => {
      const token = given([pending()], [venueRow({ unavailability: [{ ...PM, reason: "internal_activity" }] })]);

      const [row] = await (await list(token)).json();

      expect(row.conflict).toBe("Hall A is unavailable at this time (internal activity).");
    });

    it("does not flag a slot that is free", async () => {
      const token = given([pending()], [venueRow({ bookings: [approvedElsewhere(AM)] })]);

      const [row] = await (await list(token)).json();

      expect(row.conflict).toBeNull();
    });

    it("gives no verdict when the venue cannot be loaded", async () => {
      const token = given([pending()], []);

      const [row] = await (await list(token)).json();

      expect(row.conflict).toBeNull();
    });
  });
});

describe("PATCH /api/venue-bookings/[id]", () => {
  function booking(overrides: Record<string, unknown> = {}) {
    return { id: ID.booking, status: "pending", venueId: ID.venue, ...PM, event: { status: "planning" }, ...overrides };
  }

  function given(row: object | null = booking(), venue: object = venueRow(), actor = venueStaff()) {
    const token = signIn(actor);
    db.venueBooking.findUnique.mockResolvedValue(row ? { venueId: ID.venue } : null);
    db.venueBooking.findUniqueOrThrow.mockResolvedValue(row);
    db.venue.findMany.mockResolvedValue([venue]);
    db.venueBooking.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.booking, ...data }));
    return token;
  }

  const decide = (token: string | undefined, body: unknown) =>
    PATCH(req("PATCH", `/api/venue-bookings/${ID.booking}`, { token, body }), params({ id: ID.booking }));

  const approve = { decision: "approve" };
  const reject = { decision: "reject", reason: "The hall is being refitted that week." };

  async function refusal(token: string, body: unknown) {
    const res = await decide(token, body);
    expect(res.status).toBe(400);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
    return res.json();
  }

  it("is 401 without a session", async () => {
    expect((await decide(undefined, approve)).status).toBe(401);
  });

  it.each(rolesExcept("venue_staff"))("is 403 for %s", async (role) => {
    const res = await decide(given(booking(), venueRow(), user(role)), approve);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Deciding venue bookings is Venue Staff's role" });
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("is 404 for a request that does not exist", async () => {
    const res = await decide(given(null), approve);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Booking request not found" });
  });

  it.each([
    ["no decision", {}],
    ["a decision that is neither approve nor reject", { decision: "hold" }],
    ["approve with amended details", { decision: "approve", suggestedAlternative: "Use Hall B" }],
    ["reject with no reason field", { decision: "reject" }],
    ["a suggested venue that is not a UUID", { ...reject, suggestedVenueId: "hall-b" }],
  ])("rejects %s", async (_case, body) => {
    const res = await decide(given(), body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    expect(db.venueBooking.findUnique).not.toHaveBeenCalled();
  });

  describe("approving", () => {
    it("marks the request approved, recording who decided and when", async () => {
      vi.useFakeTimers({ now: NOW });
      const staff = venueStaff();
      const token = given();

      const res = await decide(token, approve);

      expect(res.status).toBe(200);
      expect(callArg(db.venueBooking.update)).toMatchObject({
        where: { id: ID.booking },
        data: { status: "approved", decidedBy: staff.id, decidedAt: NOW },
      });
    });

    it("locks the venue before checking for a clash, so two approvals cannot both take the slot", async () => {
      const token = given();

      await decide(token, approve);

      const [sql, lockedId] = db.$queryRaw.mock.calls[0];
      expect(sql.join("?")).toBe("SELECT id FROM venues WHERE id = ? FOR UPDATE");
      expect(lockedId).toBe(ID.venue);
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.venue.findMany.mock.invocationCallOrder[0]);
    });

    it("never changes the event, and writes no notification", async () => {
      const token = given();

      await decide(token, approve);

      expect(db.event.update).not.toHaveBeenCalled();
      expect(db.event.updateMany).not.toHaveBeenCalled();
      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it.each([
      ["has already been approved", booking({ status: "approved" }), venueRow(), "This booking request has already been decided."],
      ["has already been rejected", booking({ status: "rejected" }), venueRow(), "This booking request has already been decided."],
      [
        "is for a cancelled event",
        booking({ event: { status: "cancelled" } }),
        venueRow(),
        "A booking cannot be approved for a completed, cancelled or rejected event. Reject it instead.",
      ],
      [
        "is for an event not yet approved",
        booking({ event: { status: "under_review" } }),
        venueRow(),
        "This event has not been approved yet, so a venue cannot be booked for it.",
      ],
      [
        "is for a retired venue",
        booking(),
        venueRow({ isActive: false }),
        "Hall A has been retired. Reject this request and suggest another venue.",
      ],
      [
        "clashes with an approved booking",
        booking(),
        venueRow({ bookings: [approvedElsewhere()] }),
        "This overlaps an approved booking: EVT-000050 Gala Dinner holds Hall A on 4 Mar 2027 · PM (13:00–18:00).",
      ],
      [
        "falls in an unavailable period",
        booking(),
        venueRow({ unavailability: [{ ...PM, reason: "maintenance" }] }),
        "Hall A is unavailable at this time (maintenance).",
      ],
    ])("refuses a request that %s", async (_case, row, venue, message) => {
      const body = await refusal(given(row, venue), approve);

      expect(body.error).toBe(message);
    });

    it("does not count the request's own row as a clash with itself", async () => {
      const token = given(booking(), venueRow({ bookings: [approvedElsewhere({ id: ID.booking })] }));

      expect((await decide(token, approve)).status).toBe(200);
    });
  });

  describe("rejecting", () => {
    it("keeps the trimmed reason, with no suggestion unless one is given", async () => {
      vi.useFakeTimers({ now: NOW });
      const staff = venueStaff();
      const token = given();

      const res = await decide(token, { decision: "reject", reason: "  The hall is being refitted.  " });

      expect(res.status).toBe(200);
      expect(callArg(db.venueBooking.update).data).toEqual({
        status: "rejected",
        decidedBy: staff.id,
        decidedAt: NOW,
        decisionReason: "The hall is being refitted.",
        suggestedVenueId: null,
        suggestedAlternative: null,
      });
    });

    it.each(["", "   "])("refuses a reason of %j, against the reason field", async (reason) => {
      const body = await refusal(given(), { decision: "reject", reason });

      expect(body).toEqual({
        error: "A reason is required when rejecting. The Coordinator sees this message.",
        field: "reason",
      });
    });

    it("records a suggested venue and a suggested alternative for the coordinator", async () => {
      const token = given();
      db.venue.findUnique.mockResolvedValue({ id: ID.otherVenue, isActive: true });

      const res = await decide(token, {
        ...reject,
        suggestedVenueId: ID.otherVenue,
        suggestedAlternative: "  Room B is free that afternoon. ",
      });

      expect(res.status).toBe(200);
      expect(callArg(db.venueBooking.update).data).toMatchObject({
        suggestedVenueId: ID.otherVenue,
        suggestedAlternative: "Room B is free that afternoon.",
      });
    });

    it("treats a blank suggestion as none", async () => {
      const token = given();

      await decide(token, { ...reject, suggestedVenueId: "", suggestedAlternative: "   " });

      expect(db.venue.findUnique).not.toHaveBeenCalled();
      expect(callArg(db.venueBooking.update).data).toMatchObject({ suggestedVenueId: null, suggestedAlternative: null });
    });

    it.each([
      ["does not exist", null, ID.otherVenue, "Choose a venue from the catalogue to suggest."],
      ["has been retired", { id: ID.otherVenue, isActive: false }, ID.otherVenue, "Choose a venue from the catalogue to suggest."],
      ["is the venue that was requested", { id: ID.venue, isActive: true }, ID.venue, "Suggest a different venue from the one requested."],
    ])("refuses suggesting a venue that %s", async (_case, suggested, suggestedVenueId, message) => {
      const token = given();
      db.venue.findUnique.mockResolvedValue(suggested);

      const body = await refusal(token, { ...reject, suggestedVenueId });

      expect(body).toEqual({ error: message, field: "suggestedVenueId" });
    });

    it.each([
      ["the event has been cancelled", booking({ event: { status: "cancelled" } }), venueRow()],
      ["the venue has been retired", booking(), venueRow({ isActive: false })],
      ["the slot is already taken", booking(), venueRow({ bookings: [approvedElsewhere()] })],
    ])("is still possible when %s - that is what rejecting is for", async (_case, row, venue) => {
      expect((await decide(given(row, venue), reject)).status).toBe(200);
    });

    it("refuses a request that has already been decided", async () => {
      const body = await refusal(given(booking({ status: "approved" })), reject);

      expect(body.error).toBe("This booking request has already been decided.");
    });
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.venueBooking.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await decide(token, approve)).status).toBe(500);
  });
});

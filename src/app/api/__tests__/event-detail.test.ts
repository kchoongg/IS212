import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma");

import { GET, PATCH } from "@/app/api/events/[id]/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

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
  it("is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it("looks the event up by the number in its reference", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event());

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(callArg(db.event.findUnique).where).toEqual({ sequenceNumber: 7 });
  });

  it.each(["not-a-reference", ID.event, "EVT-99999999999"])(
    "is 404 for the malformed reference %s, without querying",
    async (reference) => {
      const token = signIn(coordinator());

      const res = await get(token, reference);

      expect(res.status).toBe(404);
      expect(db.event.findUnique).not.toHaveBeenCalled();
    }
  );

  it("is 404 for a reference that matches no event", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(null);

    expect((await get(token)).status).toBe(404);
  });

  it("shows a draft to the organiser who owns it", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(event({ status: "draft", coordinatorId: null }));

    expect((await get(token)).status).toBe(200);
  });

  it.each(["coordinator", "ops_manager", "venue_staff", "tech_support", "attendee"])(
    "hides another user's draft from %s as a 404",
    async (role) => {
      const token = signIn(user(role, { id: ID.otherUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

      const res = await get(token);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Event not found" });
    }
  );

  it("hides a colleague's draft from an organiser in the same organisation", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.org }));
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    expect((await get(token)).status).toBe(404);
  });

  it("shows a colleague's submitted event to an organiser in the same organisation", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.org }));
    db.event.findUnique.mockResolvedValue(event({ status: "submitted" }));

    expect((await get(token)).status).toBe(200);
  });

  it("hides another client's event from an organiser", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));

    expect((await get(token)).status).toBe(404);
  });

  it.each([
    ["not confirmed yet", { status: "planning", registrationEnabled: true }],
    ["confirmed without registration", { status: "confirmed", registrationEnabled: false }],
  ])("hides an event from an attendee when it is %s", async (_case, overrides) => {
    const token = signIn(user("attendee", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event(overrides));

    expect((await get(token)).status).toBe(404);
  });

  it("gives an attendee only the public fields of a confirmed, open event", async () => {
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
        "sequenceNumber",
        "startsAt",
        "status",
        "title",
      ].sort()
    );
  });

  it("loads only the approved venue bookings, so a pending request is never shown as settled", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event());

    await get(token);

    expect(callArg(db.event.findUnique).include.venueBookings.where).toEqual({ status: "approved" });
  });

  it("gives staff the whole record, including the internal fields", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event({ coordinator: { fullName: "Daniel Tan" } }));

    const body = await (await get(token)).json();

    expect(body.specialRequirements).toBe("VIP entrance");
    expect(body.coordinator).toEqual({ fullName: "Daniel Tan" });
    expect(body.coordinatorId).toBe(ID.otherUser);
  });
});

describe("PATCH /api/events/[id] - who can reach it", () => {
  it("is 401 without a session", async () => {
    expect((await patch(undefined, { status: "submitted" })).status).toBe(401);
  });

  it("is 404 for a malformed reference", async () => {
    const res = await patch(signIn(organiser()), { status: "submitted" }, "nope");

    expect(res.status).toBe(404);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("is 404 for a reference that matches no event", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(null);

    expect((await patch(token, { status: "submitted" })).status).toBe(404);
  });

  it("is 404, not 403, for an event the user cannot see - and nothing is written", async () => {
    const token = signIn(user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    const res = await patch(token, { title: "Hijacked" });

    expect(res.status).toBe(404);
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("answers 500 when the database fails", async () => {
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

    it("moves the organiser's own complete draft to submitted and stamps the time", async () => {
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

    it("records the move in the status history", async () => {
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

    it("notifies every active Ops Manager", async () => {
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

    it("writes no notification when there is no Ops Manager to tell", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(draft());
      givenUpdateSucceeds();

      const res = await patch(token, { status: "submitted" });

      expect(res.status).toBe(200);
      expect(db.notification.createMany).not.toHaveBeenCalled();
    });

    it("refuses an incomplete draft and names every missing field", async () => {
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

    it("refuses a multi-session draft where one session has no attendance", async () => {
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
    ])("refuses moving %s to draft - nothing goes back to draft", async (_case, row) => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(row());

      const res = await patch(token, { status: "draft" });

      expect(res.status).toBe(403);
      expect(db.event.update).not.toHaveBeenCalled();
    });
  });

  describe("reviewing", () => {
    it("lets the assigned coordinator approve a request under review", async () => {
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

    it("refuses a coordinator who is not the one assigned", async () => {
      const token = signIn(user("coordinator", { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event());

      const res = await patch(token, { status: "approved" });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Your role cannot move an event to "approved"' });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("refuses an organiser approving their own request", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(event());

      expect((await patch(token, { status: "approved" })).status).toBe(403);
    });

    it.each([
      ["approved", "This event is Planning and can't be moved to Approved."],
      ["rejected", "This event is Planning and can't be moved to Rejected."],
    ])("refuses %s for a request no longer under review", async (status, message) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "planning" }));

      const res = await patch(token, { status, reason: "Changed my mind" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("lets the assigned coordinator record a withdrawal while the request is under review", async () => {
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

    it("refuses an organiser withdrawing their own request - they ask the coordinator", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(event());

      expect((await patch(token, { status: "withdrawn" })).status).toBe(403);
    });

    it.each([undefined, "", "   "])("refuses a rejection with reason %j", async (reason) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event());

      const res = await patch(token, { status: "rejected", reason });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "A reason is required when rejecting an event" });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("keeps the trimmed rejection reason on the event and in the history", async () => {
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

  describe("later transitions", () => {
    it.each([
      ["a submitted request straight to confirmed", "submitted", "confirmed", "This event is Submitted and can't be moved to Confirmed."],
      ["a completed event to cancelled", "completed", "cancelled", "This event is Completed and can't be moved to Cancelled."],
      ["a confirmed event back to planning", "confirmed", "planning", "This event is Confirmed and can't be moved to Planning."],
    ])("refuses a move the lifecycle does not allow: %s", async (_case, from, to, message) => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: from }));

      const res = await patch(token, { status: to, reason: "x" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("refuses moving an approved event to planning by hand - a venue or equipment action does that", async () => {
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
      }
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

      it("confirms, and stamps the time, once the venue is approved and no equipment is outstanding", async () => {
        vi.useFakeTimers({ now: NOW });
        const res = await confirm({ bookings: [venueApproved], equipment: [projector("reserved")] });

        expect(res.status).toBe(200);
        expect(callArg(db.event.update).data).toEqual({ status: "confirmed", confirmedAt: NOW });
        expect(callArg(db.venueBooking.findMany).where).toEqual({ eventId: ID.event });
      });

      it("confirms an event that needs no equipment", async () => {
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
        // CHANGED (SPM-33, decided 2026-10-08): this used to confirm. The
        // shortfall is the coordinator's call (#90), made by marking the line
        // as not required.
        [
          "equipment is only partly reserved",
          { bookings: [venueApproved], equipment: [projector("partially_fulfilled")] },
          "This event cannot be confirmed yet: Projector for this event is only partly reserved.",
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
      ])("refuses while %s, naming what is outstanding", async (_case, arrangements, message) => {
        const res = await confirm(arrangements);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toBe(message);
        expect(body.outstanding.length).toBeGreaterThan(0);
        expect(db.event.update).not.toHaveBeenCalled();
      });

      it("needs a venue for every session of a multi-session event", async () => {
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
            "a partly reserved equipment line",
            { bookings: [venueApproved], equipment: [projector("partially_fulfilled", { notRequired: true })] },
          ],
          [
            "a second venue booking that is still pending",
            { bookings: [venueApproved, venue("pending", { id: ID.otherVenue, notRequired: true })] },
          ],
        ])("confirms when the only thing outstanding is %s, marked as not required", async (_case, arrangements) => {
          const res = await confirm(arrangements);

          expect(res.status).toBe(200);
          expect(callArg(db.event.update).data).toMatchObject({ status: "confirmed" });
        });

        it("still refuses an event whose only venue booking is marked as not required", async () => {
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

        it("confirms once registration has a capacity and a registration period", async () => {
          expect((await confirm({ bookings: [venueApproved] }, complete)).status).toBe(200);
        });

        it("refuses while registration is enabled but has no capacity", async () => {
          const res = await confirm({ bookings: [venueApproved] }, { ...complete, registrationCapacity: null });

          expect(res.status).toBe(400);
          expect((await res.json()).error).toBe(
            "This event cannot be confirmed yet: registration is enabled but has no capacity."
          );
          expect(db.event.update).not.toHaveBeenCalled();
        });

        it("confirms when incomplete registration setup is marked as not required", async () => {
          const res = await confirm(
            { bookings: [venueApproved] },
            { ...complete, registrationCapacity: null, registrationNotRequired: true }
          );

          expect(res.status).toBe(200);
        });
      });
    });

    it("keeps the cancellation reason when the assigned coordinator cancels", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));
      givenUpdateSucceeds();

      await patch(token, { status: "cancelled", reason: "Client withdrew" });

      expect(callArg(db.event.update).data).toEqual({ status: "cancelled", cancellationReason: "Client withdrew" });
    });

    it("refuses an organiser cancelling their own event - that is the coordinator's call", async () => {
      const token = signIn(organiser());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));

      expect((await patch(token, { status: "cancelled", reason: "We changed plans" })).status).toBe(403);
    });

    it("lets the assigned coordinator postpone a confirmed event", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));
      givenUpdateSucceeds();

      expect((await patch(token, { status: "postponed" })).status).toBe(200);
    });

    it.each([
      ["their own event", () => organiser()],
      ["a colleague's event", () => user("organiser", { id: ID.thirdUser, organisationId: ID.org })],
    ])("refuses an organiser postponing %s - that goes through the coordinator", async (_case, actor) => {
      const token = signIn(actor());
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));

      expect((await patch(token, { status: "postponed" })).status).toBe(403);
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("lets the Ops Manager move any event to under review", async () => {
      const token = signIn(user("ops_manager", { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "submitted", coordinatorId: null }));
      givenUpdateSucceeds();

      expect((await patch(token, { status: "under_review" })).status).toBe(200);
    });

    it.each(["venue_staff", "tech_support"])("refuses every status change from %s", async (role) => {
      const token = signIn(user(role, { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "planning" }));

      expect((await patch(token, { status: "confirmed" })).status).toBe(403);
    });

    it("refuses an attendee changing the status of an event they can see", async () => {
      const token = signIn(user("attendee", { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status: "confirmed", registrationEnabled: true }));

      expect((await patch(token, { status: "cancelled" })).status).toBe(403);
    });
  });

  it("rejects a status that does not exist", async () => {
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

  it("changes only the fields that were sent", async () => {
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

  it("edits a draft that has no dates yet", async () => {
    const token = givenOwnDraft({ startsAt: null, endsAt: null });

    const res = await patch(token, { description: "Dates to be confirmed" });

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toMatchObject({ description: "Dates to be confirmed" });
  });

  it("saves every plain field it is given", async () => {
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

  it("refuses to edit a request that has already been submitted", async () => {
    const token = signIn(organiser());
    db.event.findUnique.mockResolvedValue(event({ status: "submitted" }));

    const res = await patch(token, { title: "Too late" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only draft requests can be edited" });
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("refuses a draft's owner whose role cannot edit drafts", async () => {
    // Only reachable if a non-organiser account owns a draft; the role check
    // must still hold rather than trusting ownership alone.
    const token = signIn(user("coordinator", { id: ID.user }));
    db.event.findUnique.mockResolvedValue(draft());

    const res = await patch(token, { title: "Not mine to edit" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the organiser who owns this draft can edit it" });
  });

  it("rejects a blank title", async () => {
    const token = givenOwnDraft();

    const res = await patch(token, { title: "   " });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.details.fieldErrors.title).toEqual(["Title cannot be blank"]);
  });

  describe("rules checked against what is already saved", () => {
    it("refuses a new end that is before the saved start", async () => {
      const token = givenOwnDraft();

      const res = await patch(token, { endsAt: "2027-03-04T00:30:00.000Z" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Ends at must be after starts at.",
        details: { fieldErrors: { endsAt: ["Ends at must be after starts at."] } },
      });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("refuses switching registration on while no capacity is saved", async () => {
      const token = givenOwnDraft();

      const body = await (await patch(token, { registrationEnabled: true })).json();

      expect(body.details.fieldErrors).toEqual({
        registrationCapacity: ["Registration capacity is required when registration is enabled."],
      });
    });

    it("accepts switching registration on when a capacity is already saved", async () => {
      const token = givenOwnDraft({ registrationCapacity: 100 });

      expect((await patch(token, { registrationEnabled: true })).status).toBe(200);
    });

    it("refuses registration opening after the event starts", async () => {
      const token = givenOwnDraft();

      const body = await (await patch(token, { registrationOpensAt: "2027-03-04T02:00:00.000Z" })).json();

      expect(body.details.fieldErrors).toEqual({
        registrationOpensAt: ["Registration must open before the event starts."],
      });
    });

    it("refuses registration closing after the event starts", async () => {
      const token = givenOwnDraft();

      const body = await (await patch(token, { registrationClosesAt: "2027-03-04T02:00:00.000Z" })).json();

      expect(body.details.fieldErrors).toEqual({
        registrationClosesAt: ["Registration must close before the event starts."],
      });
    });

    it("keeps the 'after it opens' message when closing is wrong on both counts", async () => {
      const token = givenOwnDraft({ registrationOpensAt: new Date("2027-03-05T00:00:00.000Z") });

      const body = await (await patch(token, { registrationClosesAt: "2027-03-04T12:00:00.000Z" })).json();

      expect(body.details.fieldErrors.registrationClosesAt).toEqual(["Registration closes at must be after it opens."]);
    });

    it("reports every failing field, with the first as the headline error", async () => {
      const token = givenOwnDraft();

      const body = await (
        await patch(token, { endsAt: "2027-03-04T00:30:00.000Z", registrationEnabled: true })
      ).json();

      expect(body.error).toBe("Ends at must be after starts at.");
      expect(Object.keys(body.details.fieldErrors)).toEqual(["endsAt", "registrationCapacity"]);
    });

    it("refuses equipment on a draft with no dates", async () => {
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
    it("replaces the facility requirements wholesale", async () => {
      const token = givenOwnDraft();

      await patch(token, { facilityIds: [ID.facility] });

      expect(callArg(db.eventFacilityRequirement.deleteMany)).toEqual({ where: { eventId: ID.event } });
      expect(callArg(db.event.update).data.facilityRequirements).toEqual({
        create: [{ facilityId: ID.facility, isMandatory: true }],
      });
    });

    it("clears the facility requirements when sent an empty list", async () => {
      const token = givenOwnDraft();

      await patch(token, { facilityIds: [] });

      expect(db.eventFacilityRequirement.deleteMany).toHaveBeenCalledOnce();
      expect(callArg(db.event.update).data.facilityRequirements).toBeUndefined();
    });

    it("replaces event-wide equipment only, leaving each session's own in place", async () => {
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

    it("rejects the same equipment item twice", async () => {
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

    it("replaces the sessions and re-derives the event's dates and attendance", async () => {
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

    it("leaves the saved attendance alone when no session gives a figure", async () => {
      const token = givenOwnDraft();

      await patch(token, { sessions: sessions.map((s) => ({ ...s, expectedAttendance: undefined })) });

      expect(callArg(db.event.update).data).not.toHaveProperty("expectedAttendance");
    });

    it("turns multi-session off when sent an empty list, without touching the dates", async () => {
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

  it("reports a duplicate item caught only by the database's unique index", async () => {
    const token = givenOwnDraft();
    db.event.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    );

    const res = await patch(token, { title: "Gala" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Each item can only be requested once per event, across all sessions." });
  });
});

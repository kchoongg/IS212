// SPM-87 - Conduct Operational Safety Check.
//
// CONTRACT (SPM-87, written before the code):
//   src/app/api/events/[id]/safety-decision/route.ts   exports POST
//     body { decision: "approved" | "changes_requested" | "rejected", note? } (safetyDecisionSchema)
//     401; 404 unseen event; 403 "Only the Safety Officer can record a safety decision" (AC12);
//     400 SAFETY_CHECK_DECIDED_MESSAGE when the event is not in Safety review or its latest check
//       is no longer pending (AC11); 400 { error: "Validation failed", details } for a missing reason (AC6).
//     In one transaction: safetyCheck.updateMany guarded on { id, status: "pending" } (count 0 ->
//     the AC11 message) with { status, decidedBy, decidedAt, decisionNote } (AC10);
//     event.updateMany guarded on status "safety_review" -> statusAfterDecision() (AC7, AC8);
//     eventStatusHistory.create; notifyUser(coordinator ?? submitter, decisionNotification()) (AC9).
//     200 { status, safetyCheck: { status, decidedAt, decidedBy, decisionNote } }.
//   GET /api/events/[id]: safetyCheck also carries decidedAt, decidedBy, decisionNote (staff only);
//     each venue booking's venue carries opensAt, closesAt and `unavailable` - its
//     VenueUnavailability periods on the event's Singapore dates (AC2).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/prisma");

import { POST as decide } from "@/app/api/events/[id]/safety-decision/route";
import { GET } from "@/app/api/events/[id]/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const NOW = new Date("2026-10-13T06:30:00Z");
const officer = () => user("safety_officer", { id: ID.user, fullName: "Hana Yusof" });

afterEach(() => {
  vi.useRealTimers();
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM87 Lakeside Conference",
    status: "safety_review",
    organiserId: "organiser-id",
    organisationId: ID.org,
    coordinatorId: "coordinator-id",
    ...overrides,
  };
}

const pendingCheck = (overrides: Record<string, unknown> = {}) => ({
  id: "check-1",
  status: "pending",
  submittedBy: "coordinator-id",
  ...overrides,
});

describe("POST /api/events/[id]/safety-decision", () => {
  const post = (token: string | undefined, body: unknown = { decision: "approved" }, reference = REF) =>
    decide(req("POST", `/api/events/${reference}/safety-decision`, { token, body }), params({ id: reference }));

  function given(row: object | null = event(), actor = officer(), check: object | null = pendingCheck()) {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue(row);
    db.safetyCheck.findFirst.mockResolvedValue(check);
    db.safetyCheck.updateMany.mockResolvedValue({ count: 1 });
    db.event.updateMany.mockResolvedValue({ count: 1 });
    return token;
  }

  function expectNothingWritten() {
    expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
    expect(db.event.updateMany).not.toHaveBeenCalled();
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  }

  it("is 401 without a session", async () => {
    expect((await post(undefined)).status).toBe(401);
  });

  it("is 404 for a malformed reference or an event that does not exist", async () => {
    expect((await post(given(), { decision: "approved" }, "nope")).status).toBe(404);
    expect((await post(given(null))).status).toBe(404);
  });

  it.each(ROLES.filter((r) => r !== "safety_officer" && r !== "attendee" && r !== "organiser"))(
    "SPM-87-TC11: is 403 for %s (AC12)",
    async (role) => {
      const res = await post(given(event(), user(role, { id: "coordinator-id" })));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Only the Safety Officer can record a safety decision" });
      expectNothingWritten();
    }
  );

  it("SPM-87-TC03: approves, moving the event to Safety approved and recording who and when", async () => {
    const token = given();

    const res = await post(token, { decision: "approved" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "safety_cleared",
      safetyCheck: { status: "approved", decidedAt: NOW.toISOString(), decidedBy: "Hana Yusof", decisionNote: null },
    });
    expect(callArg(db.safetyCheck.findFirst)).toEqual({
      where: { eventId: ID.event },
      orderBy: { submittedAt: "desc" },
      select: { id: true, status: true, submittedBy: true },
    });
    expect(callArg(db.safetyCheck.updateMany)).toEqual({
      where: { id: "check-1", status: "pending" },
      data: { status: "approved", decidedBy: ID.user, decidedAt: NOW, decisionNote: null },
    });
    expect(callArg(db.event.updateMany)).toEqual({
      where: { id: ID.event, status: "safety_review" },
      data: { status: "safety_cleared" },
    });
    expect(callArg(db.eventStatusHistory.create)).toEqual({
      data: {
        eventId: ID.event,
        fromStatus: "safety_review",
        toStatus: "safety_cleared",
        changedBy: ID.user,
        changedAt: NOW,
        reason: "Safety check approved",
      },
    });
  });

  it.each([
    ["changes_requested", "Add a second fire marshal at the east exit.", "Safety check: changes requested"],
    ["rejected", "A single stairway cannot evacuate 300 people.", "Safety check rejected"],
  ])("SPM-87-TC06/TC07: %s returns the event to Planning with the note", async (decision, note, reason) => {
    const token = given();

    const res = await post(token, { decision, note: `  ${note} ` });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("planning");
    expect(callArg(db.safetyCheck.updateMany).data).toEqual({
      status: decision,
      decidedBy: ID.user,
      decidedAt: NOW,
      decisionNote: note,
    });
    expect(callArg(db.event.updateMany).data).toEqual({ status: "planning" });
    expect(callArg(db.eventStatusHistory.create).data).toMatchObject({ toStatus: "planning", reason });
  });

  it("SPM-87-TC12: notifies the assigned coordinator with the changes required (AC9)", async () => {
    const token = given();

    await post(token, { decision: "changes_requested", note: "Add a marshal." });

    expect(callArg(db.notification.create).data).toEqual({
      recipientId: "coordinator-id",
      type: "safety_check_decided",
      title: "Safety check: changes requested",
      body: "The Safety Officer requested changes to SPM87 Lakeside Conference (EVT-000007). Changes required: Add a marshal. The event is back in Planning; resubmit it once the changes are made.",
      eventId: ID.event,
    });
  });

  it("names an untitled event 'an event', and answers without a name it cannot find", async () => {
    const token = given(event({ title: null }));
    db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === ID.user ? { ...officer() } : null
    );
    // The second lookup (the decider's name) finds nothing.
    db.user.findUnique.mockResolvedValueOnce({ ...officer() }).mockResolvedValueOnce(null);

    const res = await post(token, { decision: "approved" });

    expect((await res.json()).safetyCheck.decidedBy).toBeNull();
    expect(callArg(db.notification.create).data.body).toBe(
      "The Safety Officer approved an event (EVT-000007). You can now proceed to confirm it."
    );
  });

  it("notifies whoever submitted it when the event has no coordinator", async () => {
    const token = given(event({ coordinatorId: null }), officer(), pendingCheck({ submittedBy: "submitter-id" }));

    await post(token, { decision: "approved" });

    expect(callArg(db.notification.create).data.recipientId).toBe("submitter-id");
  });

  describe("refuses, writing nothing", () => {
    it.each([
      ["rejected", {}, "Give a reason for rejecting."],
      ["changes_requested", { note: "   " }, "Describe the changes required."],
    ])("SPM-87-TC08: %s without a reason (AC6)", async (decision, extra, message) => {
      const res = await post(given(), { decision, ...extra });

      expect(res.status).toBe(400);
      expect((await res.json()).details.fieldErrors.note).toEqual([message]);
      expectNothingWritten();
    });

    it.each(["planning", "safety_cleared", "confirmed"])(
      "SPM-87-TC10: an event that is %s, not in Safety review (AC11)",
      async (status) => {
        const res = await post(given(event({ status })));

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "This safety check has already been decided." });
        expectNothingWritten();
      }
    );

    it("an event in Safety review with no pending check", async () => {
      const res = await post(given(event(), officer(), pendingCheck({ status: "approved" })));

      expect(res.status).toBe(400);
      expectNothingWritten();
    });

    it("SPM-87-TC09: a second decision that arrives after the first was saved (AC11)", async () => {
      const token = given();
      db.safetyCheck.updateMany.mockResolvedValue({ count: 0 });

      const res = await post(token, { decision: "rejected", note: "Too crowded" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "This safety check has already been decided." });
      expect(db.event.updateMany).not.toHaveBeenCalled();
      expect(db.notification.create).not.toHaveBeenCalled();
    });
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.safetyCheck.updateMany.mockRejectedValue(new Error("connection lost"));

    expect((await post(token)).status).toBe(500);
  });
});

describe("GET /api/events/[id] - the decision and the venue restrictions", () => {
  // SPM-52: the organiser and coordinator also get the registrations counted.
  beforeEach(() => {
    db.registration.groupBy.mockResolvedValue([]);
  });

  const get = (token: string) => GET(req("GET", `/api/events/${REF}`, { token }), params({ id: REF }));

  it("SPM-87-TC06: gives staff the decision, who made it, when, and the note (AC10)", async () => {
    const token = signIn(user("coordinator", { id: "coordinator-id" }));
    db.event.findUnique.mockResolvedValue(
      event({
        status: "planning",
        safetyChecks: [
          {
            status: "changes_requested",
            submittedAt: new Date("2026-10-09T06:30:00Z"),
            submitter: { fullName: "Daniel Tan" },
            decidedAt: NOW,
            decider: { fullName: "Hana Yusof" },
            decisionNote: "Add a marshal.",
          },
        ],
      })
    );

    const body = await (await get(token)).json();

    expect(body.safetyCheck).toEqual({
      status: "changes_requested",
      submittedAt: "2026-10-09T06:30:00.000Z",
      submittedBy: "Daniel Tan",
      decidedAt: NOW.toISOString(),
      decidedBy: "Hana Yusof",
      decisionNote: "Add a marshal.",
    });
    expect(callArg(db.event.findUnique).include.safetyChecks.select).toEqual({
      status: true,
      submittedAt: true,
      submitter: { select: { fullName: true } },
      decidedAt: true,
      decider: { select: { fullName: true } },
      decisionNote: true,
    });
  });

  it("SPM-87-TC02: gives each booked venue its opening hours and unavailable periods on the event's dates (AC2)", async () => {
    const token = signIn(officer());
    db.event.findUnique.mockResolvedValue(
      event({
        startsAt: new Date("2027-10-08T02:00:00Z"),
        endsAt: new Date("2027-10-08T05:00:00Z"),
        venueBookings: [
          {
            startsAt: new Date("2027-10-08T02:00:00Z"),
            endsAt: new Date("2027-10-08T05:00:00Z"),
            layoutName: "theatre",
            session: null,
            venue: { id: ID.venue, name: "SPM87 Hillside Studio", code: "SPM87-STU", opensAt: "08:00", closesAt: "22:00", layouts: [] },
          },
        ],
      })
    );
    db.venueUnavailability.findMany.mockResolvedValue([
      { venueId: ID.venue, startsAt: new Date("2027-10-07T23:00:00Z"), endsAt: new Date("2027-10-08T01:00:00Z"), reason: "maintenance" },
    ]);

    const body = await (await get(token)).json();

    // The event's Singapore day, 8 Oct 2027, is 7 Oct 16:00 UTC to 8 Oct 16:00 UTC.
    expect(callArg(db.venueUnavailability.findMany).where).toEqual({
      venueId: { in: [ID.venue] },
      startsAt: { lt: new Date("2027-10-08T16:00:00Z") },
      endsAt: { gt: new Date("2027-10-07T16:00:00Z") },
    });
    expect(body.venueBookings[0].venue).toMatchObject({
      opensAt: "08:00",
      closesAt: "22:00",
      unavailable: [{ startsAt: "2027-10-07T23:00:00.000Z", endsAt: "2027-10-08T01:00:00.000Z", reason: "maintenance" }],
    });
  });

  it("reads no unavailable periods when nothing is booked", async () => {
    const token = signIn(officer());
    db.event.findUnique.mockResolvedValue(event({ venueBookings: [] }));

    await get(token);

    expect(db.venueUnavailability.findMany).not.toHaveBeenCalled();
  });
});

// SPM-86 - Submit Event for Operational Safety Check.
//
// CONTRACT (SPM-86, written before the code and built to it):
//   src/app/api/events/[id]/safety-check/route.ts   exports POST
//     POST -> 200 { status: "safety_review", safetyCheck: { status: "pending", submittedAt, submittedBy } }
//             401; 404 unseen event; 403 "Only the assigned Coordinator can submit this event for a safety check"
//             400 "A safety check is already pending for this event."   (already in Safety review, AC6)
//             400 transitionError(status, "safety_review")               (not in Planning)
//             400 { error, outstanding }  from checkSafetySubmission()   (AC2)
//     Reads the arrangements with eventSession.findMany, venueBooking.findMany and
//     equipmentRequest.findMany (each by eventId). In one transaction: event.updateMany
//     guarded on status "planning" (count 0 = someone submitted first -> the AC6 message),
//     safetyCheck.create (AC8), eventStatusHistory.create, and a notification to every
//     active "safety_officer" (AC5).
//   GET /api/events/[id] adds `safetyCheck` (the latest: status, submittedAt, submittedBy)
//     for internal users only; the Event Organiser never receives it (SPM-88: safety details
//     are internal).
//   PATCH /api/events/[id] refuses { status: "safety_review" } - there is one way in.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the 403 wording, the history reason, and the notification's type, title and body

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/prisma");

import { POST as submit } from "@/app/api/events/[id]/safety-check/route";
import { GET, PATCH } from "@/app/api/events/[id]/route";
import { callArg, db, holdExpirySweepOrder, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const NOW = new Date("2026-10-09T06:30:00Z");

const assignedCoordinator = () => user("coordinator", { id: ID.user, fullName: "Daniel Tan" });

afterEach(() => {
  vi.useRealTimers();
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Harbour Safety Summit",
    status: "planning",
    organiserId: "organiser-id",
    organisationId: ID.org,
    coordinatorId: ID.user,
    ...overrides,
  };
}

const approvedBooking = (overrides: Record<string, unknown> = {}) => ({
  sessionId: null,
  status: "approved",
  needsReview: false,
  reviewReason: null,
  venue: { name: "Orchard Seminar Room" },
  ...overrides,
});

const reservedMic = (overrides: Record<string, unknown> = {}) => ({
  sessionId: null,
  status: "reserved",
  needsReview: false,
  reviewReason: null,
  equipment: { name: "Handheld Wireless Mic" },
  ...overrides,
});

describe("POST /api/events/[id]/safety-check", () => {
  const post = (token?: string, reference = REF) =>
    submit(req("POST", `/api/events/${reference}/safety-check`, { token }), params({ id: reference }));

  function given(
    row: object | null = event(),
    actor = assignedCoordinator(),
    arrangements: { bookings?: object[]; equipment?: object[]; sessions?: object[] } = {}
  ) {
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue(row);
    db.eventSession.findMany.mockResolvedValue(arrangements.sessions ?? []);
    db.venueBooking.findMany.mockResolvedValue(arrangements.bookings ?? [approvedBooking()]);
    db.equipmentRequest.findMany.mockResolvedValue(arrangements.equipment ?? [reservedMic()]);
    db.event.updateMany.mockResolvedValue({ count: 1 });
    db.safetyCheck.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "check-1",
      ...data,
    }));
    db.user.findMany.mockResolvedValue([{ id: "officer-1" }, { id: "officer-2" }]);
    return token;
  }

  function expectNothingWritten() {
    expect(db.event.updateMany).not.toHaveBeenCalled();
    expect(db.safetyCheck.create).not.toHaveBeenCalled();
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  }

  it("is 401 without a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it("SPM-82: expires overdue holds before judging whether the arrangements are ready", async () => {
    await post(given());

    expect(holdExpirySweepOrder()).toBeLessThan(db.venueBooking.findMany.mock.invocationCallOrder[0]);
  });

  it("is 404 for a malformed reference", async () => {
    expect((await post(given(), "nope")).status).toBe(404);
  });

  it("is 404 for an event that does not exist", async () => {
    expect((await post(given(null))).status).toBe(404);
  });

  it("is 404 for an event the user cannot see, before any role check", async () => {
    const stranger = user("organiser", { id: ID.otherUser, organisationId: ID.otherOrg });
    const res = await post(given(event(), stranger));

    expect(res.status).toBe(404);
    expectNothingWritten();
  });

  it.each([
    ["a coordinator who is not assigned", () => user("coordinator", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.otherUser })],
    ["Venue Staff", () => user("venue_staff", { id: ID.otherUser })],
    ["Technical Support", () => user("tech_support", { id: ID.otherUser })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
  ])("SPM-86-TC10: is 403 for %s (AC7)", async (_who, actor) => {
    const res = await post(given(event(), actor()));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the assigned Coordinator can submit this event for a safety check" });
    expectNothingWritten();
  });

  it("answers with no submitter name when the submitter's name cannot be found", async () => {
    const token = given();
    const lookUp = db.user.findUnique.getMockImplementation()!;
    db.user.findUnique.mockImplementation(async (args: { select?: object }) =>
      JSON.stringify(args.select) === JSON.stringify({ fullName: true }) ? null : lookUp(args)
    );

    const res = await post(token);

    expect(res.status).toBe(200);
    expect((await res.json()).safetyCheck.submittedBy).toBeNull();
  });

  it("SPM-86-TC01: moves a ready event to Safety review, records who and when, and notifies the Safety Officers", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = given();

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "safety_review",
      safetyCheck: { status: "pending", submittedAt: NOW.toISOString(), submittedBy: "Daniel Tan" },
    });
    // AC3, re-checked in the database so two submissions cannot both pass (AC6).
    expect(callArg(db.event.updateMany)).toEqual({
      where: { id: ID.event, status: "planning" },
      data: { status: "safety_review" },
    });
    // AC8: who submitted it and when.
    expect(callArg(db.safetyCheck.create)).toEqual({
      data: { eventId: ID.event, status: "pending", submittedBy: ID.user, submittedAt: NOW },
    });
    expect(callArg(db.eventStatusHistory.create)).toEqual({
      data: {
        eventId: ID.event,
        fromStatus: "planning",
        toStatus: "safety_review",
        changedBy: ID.user,
        changedAt: NOW,
        reason: "Submitted for an operational safety check",
      },
    });
    // AC5: every active Safety Officer.
    expect(callArg(db.user.findMany)).toEqual({ where: { role: "safety_officer", isActive: true }, select: { id: true } });
    expect(callArg(db.notification.createMany).data).toEqual(
      ["officer-1", "officer-2"].map((recipientId) => ({
        recipientId,
        type: "safety_check_submitted",
        title: "Event submitted for safety check",
        body: "Harbour Safety Summit (EVT-000007) is ready for an Operational Safety Check.",
        eventId: ID.event,
      }))
    );
  });

  it("names an untitled event 'An event' in the notification", async () => {
    await post(given(event({ title: null })));

    expect(callArg(db.notification.createMany).data[0].body).toBe(
      "An event (EVT-000007) is ready for an Operational Safety Check."
    );
  });

  it("reads the arrangements of this event only", async () => {
    await post(given());

    for (const fn of [db.eventSession.findMany, db.venueBooking.findMany, db.equipmentRequest.findMany]) {
      expect(callArg(fn).where).toEqual({ eventId: ID.event });
    }
  });

  it("SPM-86-TC05: accepts equipment Technical Support could only partly supply", async () => {
    const res = await post(given(event(), assignedCoordinator(), { equipment: [reservedMic({ status: "partially_fulfilled" })] }));

    expect(res.status).toBe(200);
  });

  it("still submits when no Safety Officer account exists yet", async () => {
    const token = given();
    db.user.findMany.mockResolvedValue([]);

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  describe("refuses, writing nothing", () => {
    it("SPM-86-TC06: while a venue and an equipment request are outstanding, naming each (AC2)", async () => {
      const res = await post(
        given(event(), assignedCoordinator(), {
          bookings: [approvedBooking({ status: "pending" })],
          equipment: [reservedMic(), reservedMic({ status: "requested", equipment: { name: "Audio Mixing Desk" } })],
        })
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error:
          "This event cannot be submitted for a safety check yet: " +
          "the venue for this event is still awaiting a decision from Venue Staff; " +
          "Audio Mixing Desk for this event is not reserved yet.",
        outstanding: [
          "the venue for this event is still awaiting a decision from Venue Staff",
          "Audio Mixing Desk for this event is not reserved yet",
        ],
      });
      expectNothingWritten();
    });

    it("SPM-86-TC07: while an approved venue booking is flagged for review (AC2)", async () => {
      const res = await post(
        given(event(), assignedCoordinator(), {
          bookings: [approvedBooking({ needsReview: true, reviewReason: "event_schedule_changed" })],
        })
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "This event cannot be submitted for a safety check yet: the venue booking at Orchard Seminar Room " +
          "for this event is flagged for review (the date or time changed)."
      );
      expectNothingWritten();
    });

    it("SPM-86-TC08: while reserved equipment is flagged for review (AC2)", async () => {
      const res = await post(
        given(event(), assignedCoordinator(), {
          equipment: [reservedMic({ needsReview: true, reviewReason: "event_schedule_changed" })],
        })
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "This event cannot be submitted for a safety check yet: Handheld Wireless Mic for this event is flagged for review (the date or time changed)."
      );
      expectNothingWritten();
    });

    it("SPM-86-TC02: an event already in Safety review (AC6)", async () => {
      const res = await post(given(event({ status: "safety_review" })));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "A safety check is already pending for this event." });
      expectNothingWritten();
    });

    it("SPM-86-TC09: a second submission that arrives after the first was saved (AC6)", async () => {
      const token = given();
      db.event.updateMany.mockResolvedValue({ count: 0 });

      const res = await post(token);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "A safety check is already pending for this event." });
      expect(db.safetyCheck.create).not.toHaveBeenCalled();
      expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
      expect(db.notification.createMany).not.toHaveBeenCalled();
    });

    it.each([
      ["approved", "This event is Approved and can't be moved to Safety review."],
      ["confirmed", "This event is Confirmed and can't be moved to Safety review."],
      ["cancelled", "This event is Cancelled and can't be moved to Safety review."],
    ])("SPM-86-TC11: an event that is %s, not in Planning", async (status, message) => {
      const res = await post(given(event({ status })));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message });
      expectNothingWritten();
    });
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.event.updateMany.mockRejectedValue(new Error("connection lost"));

    const res = await post(token);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

describe("GET /api/events/[id] - the pending safety check (AC8)", () => {
  // SPM-52: the organiser and coordinator also get the registrations counted.
  beforeEach(() => {
    db.registration.groupBy.mockResolvedValue([]);
  });

  const get = (token: string) => GET(req("GET", `/api/events/${REF}`, { token }), params({ id: REF }));

  const withCheck = () =>
    event({
      status: "safety_review",
      safetyChecks: [{ status: "pending", submittedAt: NOW, submitter: { fullName: "Daniel Tan" } }],
    });

  it("SPM-86-TC02: gives staff the latest safety check, with who submitted it and when", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(withCheck());

    const res = await get(token);

    expect(res.status).toBe(200);
    // CHANGED (SPM-87): the decision fields come too, null while pending.
    expect((await res.json()).safetyCheck).toEqual({
      status: "pending",
      submittedAt: NOW.toISOString(),
      submittedBy: "Daniel Tan",
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
    });
    // CHANGED (SPM-88 AC1): every check, newest first - the latest is `safetyCheck`.
    expect(callArg(db.event.findUnique).include.safetyChecks).toEqual({
      orderBy: { submittedAt: "desc" },
      select: {
        status: true,
        submittedAt: true,
        submitter: { select: { fullName: true } },
        decidedAt: true,
        decider: { select: { fullName: true } },
        decisionNote: true,
      },
    });
  });

  it("gives no submitter name when the submitter's account is gone", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(
      event({ status: "safety_review", safetyChecks: [{ status: "pending", submittedAt: NOW, submitter: null }] })
    );

    expect((await (await get(token)).json()).safetyCheck.submittedBy).toBeNull();
  });

  it("gives staff null when the event was never submitted", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ safetyChecks: [] }));

    expect((await (await get(token)).json()).safetyCheck).toBeNull();
  });

  it("SPM-86-TC03: never gives the Event Organiser who submitted it", async () => {
    const token = signIn(user("organiser", { id: "organiser-id" }));
    db.event.findUnique.mockResolvedValue(withCheck());

    const body = await (await get(token)).json();

    expect(body.status).toBe("safety_review");
    expect(body).not.toHaveProperty("safetyCheck");
    expect(body).not.toHaveProperty("safetyChecks");
    expect(body).not.toHaveProperty("safetyHistory");
  });
});

describe("GET /api/events/[id] - the safety check history (SPM-88 AC1)", () => {
  const get = (token: string) => GET(req("GET", `/api/events/${REF}`, { token }), params({ id: REF }));
  const returned = {
    status: "changes_requested",
    submittedAt: new Date("2026-10-08T06:00:00Z"),
    submitter: { fullName: "Daniel Tan" },
    decidedAt: new Date("2026-10-09T02:00:00Z"),
    decider: { fullName: "Hana Yusof" },
    decisionNote: "Add a second fire marshal at the east exit.",
  };
  const rejected = {
    status: "rejected",
    submittedAt: new Date("2026-10-05T06:00:00Z"),
    submitter: null,
    decidedAt: new Date("2026-10-06T02:00:00Z"),
    decider: null,
    decisionNote: "Fire exits are blocked by the stage set.",
  };

  it("SPM-88-TC01: gives staff every submission and decision, newest first", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ status: "planning", safetyChecks: [returned, rejected] }));

    const body = await (await get(token)).json();

    expect(body.safetyHistory).toEqual([
      {
        status: "changes_requested",
        submittedAt: "2026-10-08T06:00:00.000Z",
        submittedBy: "Daniel Tan",
        decidedAt: "2026-10-09T02:00:00.000Z",
        decidedBy: "Hana Yusof",
        decisionNote: "Add a second fire marshal at the east exit.",
      },
      {
        status: "rejected",
        submittedAt: "2026-10-05T06:00:00.000Z",
        submittedBy: null,
        decidedAt: "2026-10-06T02:00:00.000Z",
        decidedBy: null,
        decisionNote: "Fire exits are blocked by the stage set.",
      },
    ]);
    expect(body.safetyCheck).toEqual(body.safetyHistory[0]);
  });

  it("gives staff an empty history when the event was never submitted", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ safetyChecks: [] }));

    expect((await (await get(token)).json()).safetyHistory).toEqual([]);
  });

  it("SPM-88-TC02: never gives the Event Organiser the history", async () => {
    const token = signIn(user("organiser", { id: "organiser-id" }));
    db.event.findUnique.mockResolvedValue(event({ status: "planning", safetyChecks: [returned, rejected] }));

    const body = await (await get(token)).json();

    expect(body).not.toHaveProperty("safetyHistory");
    expect(body).not.toHaveProperty("safetyCheck");
  });
});

describe("PATCH /api/events/[id] - Safety review is not set through the status route", () => {
  it("refuses { status: 'safety_review' }, writing nothing", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event());

    const res = await PATCH(
      req("PATCH", `/api/events/${REF}`, { token, body: { status: "safety_review" } }),
      params({ id: REF })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "An event is sent for a safety check with Submit for safety check" });
    expect(db.event.update).not.toHaveBeenCalled();
  });
});

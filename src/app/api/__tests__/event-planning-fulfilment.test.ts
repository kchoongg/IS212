// SPM-54 (begin planning) and SPM-50 (Technical Support updates an equipment
// line's fulfilment status).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { POST as beginPlanning } from "@/app/api/events/[id]/begin-planning/route";
import { PATCH as updateFulfilment } from "@/app/api/events/[id]/equipment/[requestId]/fulfilment/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const NOW = new Date("2026-10-04T04:00:00Z");

const assignedCoordinator = () => user("coordinator", { id: ID.user });
const techSupport = () => user("tech_support", { id: ID.thirdUser });

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/events/[id]/begin-planning", () => {
  function event(overrides: Record<string, unknown> = {}) {
    return {
      id: ID.event,
      sequenceNumber: 7,
      status: "approved",
      organiserId: "organiser-id",
      organisationId: ID.org,
      coordinatorId: ID.user,
      ...overrides,
    };
  }

  const begin = (token?: string, reference = REF) =>
    beginPlanning(req("POST", `/api/events/${reference}/begin-planning`, { token }), params({ id: reference }));

  function given(row: object | null = event(), actor = assignedCoordinator()) {
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue(row);
    db.event.updateMany.mockResolvedValue({ count: 1 });
    return token;
  }

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await begin()).status).toBe(401);
  });

  it("[SPM-54] is 404 for a malformed reference", async () => {
    expect((await begin(given(), "nope")).status).toBe(404);
  });

  it("[SPM-54] is 404 for an event that does not exist", async () => {
    expect((await begin(given(null))).status).toBe(404);
  });

  it("[SPM-54] is 404 for a draft, which a coordinator cannot see", async () => {
    expect((await begin(given(event({ status: "draft" })))).status).toBe(404);
  });

  it.each([
    ["a coordinator who is not assigned", () => user("coordinator", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.otherUser })],
    ["Venue Staff", () => user("venue_staff", { id: ID.otherUser })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
  ])("[SPM-21][AC4] is 403 for %s", async (_who, actor) => {
    const res = await begin(given(event(), actor()));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the assigned Coordinator can begin planning this event" });
    expect(db.event.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-54][AC1] moves an approved event to planning, and records why in its history", async () => {
    const token = given();

    const res = await begin(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ planningStarted: true });
    expect(callArg(db.event.updateMany)).toEqual({
      where: { id: ID.event, status: "approved" },
      data: { status: "planning" },
    });
    expect(callArg(db.eventStatusHistory.create).data).toEqual({
      eventId: ID.event,
      fromStatus: "approved",
      toStatus: "planning",
      changedBy: ID.user,
      reason: "Venue search started",
    });
  });

  it.each(["planning", "confirmed", "postponed"])(
    "[SPM-54][AC2] leaves an event that is already %s exactly as it is, and says so without an error",
    async (status) => {
      const res = await begin(given(event({ status })));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ planningStarted: false });
      expect(db.event.updateMany).not.toHaveBeenCalled();
      expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    }
  );

  it("[SPM-54][AC1] writes no history row when another action began planning a moment earlier", async () => {
    const token = given();
    db.event.updateMany.mockResolvedValue({ count: 0 });

    const res = await begin(token);

    expect(await res.json()).toEqual({ planningStarted: false });
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
  });

  it("[SPM-54] answers 500 when the database fails", async () => {
    const token = given();
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await begin(token)).status).toBe(500);
  });
});

describe("PATCH /api/events/[id]/equipment/[requestId]/fulfilment", () => {
  /// The request line as the route reads it for its checks.
  function line(status = "requested", eventStatus = "planning") {
    return {
      eventId: ID.event,
      status,
      event: { organiserId: "organiser-id", organisationId: ID.org, coordinatorId: ID.user, status: eventStatus },
    };
  }

  const saved = { id: ID.request, status: "under_review", quantityReserved: null, staffNotes: null };

  function given(row: object | null = line(), actor = techSupport()) {
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue({ id: ID.event });
    // First read is the access check; the second returns the saved line.
    db.equipmentRequest.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(saved);
    db.equipmentRequest.updateMany.mockResolvedValue({ count: 1 });
    return token;
  }

  const update = (token: string | undefined, body: unknown, reference = REF) =>
    updateFulfilment(
      req("PATCH", `/api/events/${reference}/equipment/${ID.request}/fulfilment`, { token, body }),
      params({ id: reference, requestId: ID.request })
    );

  const underReview = { status: "under_review", staffNotes: "" };

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await update(undefined, underReview)).status).toBe(401);
  });

  it("[SPM-50] is 404 for a malformed event reference", async () => {
    expect((await update(given(), underReview, "nope")).status).toBe(404);
  });

  it("[SPM-50] is 404 when the request does not exist", async () => {
    expect((await update(given(null), underReview)).status).toBe(404);
  });

  it("[SPM-50] is 404 when the request belongs to a different event than the URL names", async () => {
    const res = await update(given({ ...line(), eventId: "another-event" }), underReview);

    expect(res.status).toBe(404);
    expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["the assigned coordinator", () => user("coordinator", { id: ID.user })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
    ["the Ops Manager", () => user("ops_manager")],
  ])("[SPM-21][AC4] is 403 for %s", async (_who, actor) => {
    const res = await update(given(line(), actor()), underReview);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only Technical Support Staff can update equipment requests" });
    expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each(["submitted", "under_review", "approved", "postponed", "cancelled", "completed"])(
    "[SPM-50] is 404 for an event that is %s - Technical Support does not see its equipment",
    async (eventStatus) => {
      const res = await update(given(line("requested", eventStatus)), underReview);

      expect(res.status).toBe(404);
      expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
    }
  );

  it("[SPM-50] refuses a confirmed event, whose equipment is final", async () => {
    const res = await update(given(line("reserved", "confirmed")), { status: "unavailable", staffNotes: "Broken" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This event is confirmed — its equipment is final. A change now goes through a change request.",
    });
    expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each([{}, { status: "under_review" }, { status: "", staffNotes: "" }, { staffNotes: "note" }])(
    "[SPM-50][AC2] rejects the body %j",
    async (body) => {
      const res = await update(given(), body);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Validation failed");
    }
  );

  describe("what it saves", () => {
    it("[SPM-50][AC2][AC4][AC5] the new status and trimmed notes, with who reviewed it and when", async () => {
      vi.useFakeTimers({ now: NOW });
      const token = given();

      const res = await update(token, { status: "under_review", staffNotes: "  Checking the spare unit.  " });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(saved);
      expect(callArg(db.equipmentRequest.updateMany).data).toEqual({
        status: "under_review",
        staffNotes: "Checking the spare unit.",
        reviewedBy: ID.thirdUser,
        reviewedAt: NOW,
      });
    });

    it("[SPM-50][AC4] blank notes as none", async () => {
      await update(given(), { status: "under_review", staffNotes: "   " });

      expect(callArg(db.equipmentRequest.updateMany).data.staffNotes).toBeNull();
    });

    it("[SPM-50][AC3] 'cannot be provided' with its reason, releasing anything that was reserved", async () => {
      await update(given(line("reserved")), { status: "unavailable", staffNotes: "Both units are out for repair." });

      expect(callArg(db.equipmentRequest.updateMany).data).toMatchObject({
        status: "unavailable",
        staffNotes: "Both units are out for repair.",
        quantityReserved: null,
      });
    });

    it("[SPM-50][AC4] notes alone, leaving the status as it was", async () => {
      await update(given(line("reserved")), { status: "reserved", staffNotes: "Deliver to the loading bay." });

      expect(callArg(db.equipmentRequest.updateMany).data).toMatchObject({
        status: "reserved",
        staffNotes: "Deliver to the loading bay.",
      });
      expect(callArg(db.equipmentRequest.updateMany).data).not.toHaveProperty("quantityReserved");
    });

    it("[SPM-50][AC2] only if the line is still in the status the rules were checked against", async () => {
      await update(given(line("requested")), underReview);

      expect(callArg(db.equipmentRequest.updateMany).where).toEqual({ id: ID.request, status: "requested" });
    });
  });

  describe("what it refuses", () => {
    async function refusal(currentStatus: string, body: object) {
      const res = await update(given(line(currentStatus)), body);
      expect(res.status).toBe(400);
      expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
      return res.json();
    }

    it.each(["reserved", "partially_fulfilled"])("[SPM-50][AC2] hand-picking %s - only Reserve sets it", async (status) => {
      expect(await refusal("requested", { status, staffNotes: "" })).toEqual({
        error: "Use Reserve to commit equipment to this event.",
        field: null,
      });
    });

    it.each(["requested", "under_review"])("[SPM-50][AC2] quietly moving a reserved line back to %s", async (status) => {
      expect(await refusal("reserved", { status, staffNotes: "" })).toEqual({
        error: 'A reserved item can only be changed to "Cannot be provided".',
        field: null,
      });
    });

    it("[SPM-50][AC2] a status that does not exist", async () => {
      expect(await refusal("requested", { status: "lost", staffNotes: "" })).toEqual({
        error: "That status cannot be chosen here.",
        field: null,
      });
    });

    it.each(["", "   "])("[SPM-50][AC3] 'cannot be provided' with a reason of %j", async (staffNotes) => {
      expect(await refusal("requested", { status: "unavailable", staffNotes })).toEqual({
        error: "Give a reason when equipment cannot be provided.",
        field: "staffNotes",
      });
    });

    it("[SPM-50][AC4] notes longer than 500 characters", async () => {
      expect(await refusal("requested", { status: "under_review", staffNotes: "x".repeat(501) })).toEqual({
        error: "Technical notes must be 500 characters or fewer.",
        field: "staffNotes",
      });
    });

    it("[SPM-50][AC2] a line the coordinator has withdrawn", async () => {
      expect(await refusal("cancelled", underReview)).toEqual({
        error: "This request has been withdrawn and can no longer be updated.",
        field: null,
      });
    });
  });

  it("[SPM-50][AC4] accepts notes of exactly 500 characters", async () => {
    const res = await update(given(), { status: "under_review", staffNotes: "x".repeat(500) });

    expect(res.status).toBe(200);
  });

  it("[SPM-50] is 409 when someone else changed the line in the meantime", async () => {
    const token = given();
    db.equipmentRequest.updateMany.mockResolvedValue({ count: 0 });

    const res = await update(token, underReview);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed by someone else/);
  });

  it("[SPM-50] answers 500 when the database fails", async () => {
    const token = given();
    db.equipmentRequest.updateMany.mockRejectedValue(new Error("connection lost"));

    expect((await update(token, underReview)).status).toBe(500);
  });
});

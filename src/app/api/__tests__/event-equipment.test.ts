import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/events/[id]/equipment/route";
import { DELETE, PATCH } from "@/app/api/events/[id]/equipment/[requestId]/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const HOUR = 60 * 60 * 1000;

const ORGANISER_ID = "organiser-id";
const assignedCoordinator = () => user("coordinator", { id: ID.user });
const otherCoordinator = () => user("coordinator", { id: ID.otherUser });
const owner = () => user("organiser", { id: ORGANISER_ID });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    status: "planning",
    organiserId: ORGANISER_ID,
    organisationId: ID.org,
    coordinatorId: ID.user,
    registrationEnabled: false,
    startsAt: new Date("2027-03-04T01:00:00.000Z"),
    endsAt: new Date("2027-03-04T09:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /api/events/[id]/equipment", () => {
  function list(token?: string, reference = REF) {
    return GET(req("GET", `/api/events/${reference}/equipment`, { token }), params({ id: reference }));
  }

  it("is 401 without a session", async () => {
    expect((await list()).status).toBe(401);
  });

  it("is 404 for a malformed reference", async () => {
    expect((await list(signIn(user("tech_support")), "nope")).status).toBe(404);
  });

  it("is 404 for an event the user cannot see", async () => {
    const token = signIn(user("tech_support"));
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    expect((await list(token)).status).toBe(404);
  });

  it.each([
    ["Technical Support", () => user("tech_support", { id: ID.thirdUser })],
    ["the assigned coordinator", assignedCoordinator],
    ["the organiser who owns the event", owner],
  ])("lists the event's equipment requests for %s", async (_who, actor) => {
    const token = signIn(actor());
    const rows = [{ id: ID.request, quantityRequested: 4, equipment: { id: ID.equipment, name: "Projector" } }];
    db.event.findUnique.mockResolvedValue(event());
    db.equipmentRequest.findMany.mockResolvedValue(rows);

    const res = await list(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    expect(callArg(db.equipmentRequest.findMany).where).toEqual({ eventId: ID.event });
  });

  it.each([
    ["a coordinator who is not assigned", otherCoordinator],
    ["the Ops Manager", () => user("ops_manager", { id: ID.thirdUser })],
    ["Venue Staff", () => user("venue_staff", { id: ID.thirdUser })],
    ["a colleague of the organiser", () => user("organiser", { id: ID.thirdUser, organisationId: ID.org })],
  ])("is 403 for %s, who can see the event but not its equipment", async (_who, actor) => {
    const token = signIn(actor());
    db.event.findUnique.mockResolvedValue(event());

    const res = await list(token);

    expect(res.status).toBe(403);
    expect(db.equipmentRequest.findMany).not.toHaveBeenCalled();
  });

  it("still shows Technical Support the equipment of a confirmed event, to prepare it", async () => {
    const token = signIn(user("tech_support", { id: ID.thirdUser }));
    db.event.findUnique.mockResolvedValue(event({ status: "confirmed" }));
    db.equipmentRequest.findMany.mockResolvedValue([]);

    expect((await list(token)).status).toBe(200);
  });

  it.each(["submitted", "under_review", "approved", "postponed", "cancelled", "completed"])(
    "is 403 for Technical Support while the event is %s - their part starts with planning",
    async (status) => {
      const token = signIn(user("tech_support", { id: ID.thirdUser }));
      db.event.findUnique.mockResolvedValue(event({ status }));

      const res = await list(token);

      expect(res.status).toBe(403);
      expect(db.equipmentRequest.findMany).not.toHaveBeenCalled();
    }
  );
});

describe("POST /api/events/[id]/equipment", () => {
  const valid = { equipmentId: ID.equipment, quantityRequested: 4, technicalRequirements: "HDMI" };

  function add(token: string | undefined, body: unknown, reference = REF) {
    return POST(req("POST", `/api/events/${reference}/equipment`, { token, body }), params({ id: reference }));
  }

  function givenAssignedCoordinator(eventOverrides = {}) {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event(eventOverrides));
    db.equipment.findUnique.mockResolvedValue({ isActive: true });
    db.equipmentRequest.create.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.request, ...data }));
    return token;
  }

  it("is 401 without a session", async () => {
    expect((await add(undefined, valid)).status).toBe(401);
  });

  it("is 404 for an event the user cannot see", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    expect((await add(token, valid)).status).toBe(404);
  });

  it.each([
    ["a coordinator who is not assigned", otherCoordinator],
    ["Technical Support", () => user("tech_support", { id: ID.thirdUser })],
    ["the organiser who owns the event", owner],
  ])("is 403 for %s", async (_who, actor) => {
    const token = signIn(actor());
    db.event.findUnique.mockResolvedValue(event());

    const res = await add(token, valid);

    expect(res.status).toBe(403);
    expect(db.equipmentRequest.create).not.toHaveBeenCalled();
  });

  it("records the requirement for two hours either side of the event", async () => {
    const token = givenAssignedCoordinator();

    const res = await add(token, valid);

    expect(res.status).toBe(201);
    expect(callArg(db.equipmentRequest.create).data).toEqual({
      eventId: ID.event,
      sessionId: undefined,
      equipmentId: ID.equipment,
      quantityRequested: 4,
      technicalRequirements: "HDMI",
      startsAt: new Date(event().startsAt.getTime() - 2 * HOUR),
      endsAt: new Date(event().endsAt.getTime() + 2 * HOUR),
      requestedBy: ID.user,
      status: "requested",
    });
  });

  it.each([
    ["a quantity of zero", { ...valid, quantityRequested: 0 }, "quantityRequested"],
    ["a fractional quantity", { ...valid, quantityRequested: 1.5 }, "quantityRequested"],
    ["an equipment id that is not a UUID", { ...valid, equipmentId: "projector" }, "equipmentId"],
  ])("rejects %s", async (_case, body, field) => {
    const token = givenAssignedCoordinator();

    const res = await add(token, body);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details.fieldErrors).toHaveProperty(field);
    expect(db.equipmentRequest.create).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled", "rejected", "withdrawn"])("refuses an event that is %s", async (status) => {
    const token = givenAssignedCoordinator({ status });

    const res = await add(token, valid);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot record equipment for a completed, cancelled, or rejected event" });
    expect(db.equipmentRequest.create).not.toHaveBeenCalled();
  });

  it.each(["submitted", "under_review"])("refuses an event that is still %s - arrangements wait for approval", async (status) => {
    const token = givenAssignedCoordinator({ status });

    const res = await add(token, valid);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Equipment can be recorded once this request has been approved" });
    expect(db.equipmentRequest.create).not.toHaveBeenCalled();
  });

  it("begins planning when it is the first arrangement on an approved event", async () => {
    const token = givenAssignedCoordinator({ status: "approved" });
    db.event.updateMany.mockResolvedValue({ count: 1 });

    const res = await add(token, valid);

    expect(res.status).toBe(201);
    expect((await res.json()).planningStarted).toBe(true);
    expect(callArg(db.event.updateMany)).toEqual({
      where: { id: ID.event, status: "approved" },
      data: { status: "planning" },
    });
    expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
      fromStatus: "approved",
      toStatus: "planning",
      changedBy: ID.user,
      reason: "Equipment requirement recorded",
    });
  });

  it("leaves the status alone on an event already in planning", async () => {
    const token = givenAssignedCoordinator();

    const res = await add(token, valid);

    expect((await res.json()).planningStarted).toBe(false);
    expect(db.event.updateMany).not.toHaveBeenCalled();
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
  });

  // SPM-62 (AC4, AC6): equipment requirements are important information, so
  // changing them on a Confirmed event moves it back to Planning to be
  // confirmed again, in the same transaction as the change. Telling the
  // organiser is Receive Event Notifications (SPM-53), not this route.
  it("moves a Confirmed event back to Planning", async () => {
    const token = givenAssignedCoordinator({ status: "confirmed", title: "Sundara Hospitality Showcase" });
    db.event.updateMany.mockResolvedValue({ count: 1 });

    const res = await add(token, valid);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.confirmationReverted).toBe(true);
    expect(body.planningStarted).toBe(false);
    expect(callArg(db.event.updateMany)).toEqual({
      where: { id: ID.event, status: "confirmed" },
      data: { status: "planning", confirmedAt: null },
    });
    expect(callArg(db.eventStatusHistory.create).data).toEqual({
      eventId: ID.event,
      fromStatus: "confirmed",
      toStatus: "planning",
      changedBy: ID.user,
      reason: "Equipment requirement recorded",
    });
  });

  it("says nothing was unconfirmed for an event in Planning", async () => {
    const token = givenAssignedCoordinator();

    const body = await (await add(token, valid)).json();

    expect(body.confirmationReverted).toBe(false);
  });

  it("scopes the requirement to one of the event's own sessions", async () => {
    const token = givenAssignedCoordinator();
    db.eventSession.findUnique.mockResolvedValue({ id: ID.session, eventId: ID.event });

    const res = await add(token, { ...valid, sessionId: ID.session });

    expect(res.status).toBe(201);
    expect(callArg(db.equipmentRequest.create).data.sessionId).toBe(ID.session);
  });

  it.each([
    ["does not exist", null],
    ["belongs to a different event", { id: ID.session, eventId: "another-event" }],
  ])("refuses a session that %s", async (_case, session) => {
    const token = givenAssignedCoordinator();
    db.eventSession.findUnique.mockResolvedValue(session);

    const res = await add(token, { ...valid, sessionId: ID.session });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Session not found for this event" });
    expect(db.equipmentRequest.create).not.toHaveBeenCalled();
  });

  it("refuses equipment that has been retired", async () => {
    const token = givenAssignedCoordinator();
    db.equipment.findUnique.mockResolvedValue({ isActive: false });

    const res = await add(token, valid);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This equipment has been retired and can no longer be requested" });
  });

  it("refuses an event that has no dates yet", async () => {
    const token = givenAssignedCoordinator({ startsAt: null, endsAt: null });

    const res = await add(token, valid);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Set the event date and time before requesting equipment" });
  });

  it("reports an item that is already requested for the event", async () => {
    const token = givenAssignedCoordinator();
    db.equipmentRequest.create.mockRejectedValue(new Error("Unique constraint failed on the fields"));

    const res = await add(token, valid);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already requested for this event/);
  });

  it("answers 500 when the database fails", async () => {
    const token = givenAssignedCoordinator();
    db.equipmentRequest.create.mockRejectedValue(new Error("connection lost"));

    expect((await add(token, valid)).status).toBe(500);
  });
});

describe("one equipment request: PATCH and DELETE /api/events/[id]/equipment/[requestId]", () => {
  const context = (reference = REF) => params({ id: reference, requestId: ID.request });
  const path = `/api/events/${REF}/equipment/${ID.request}`;

  function update(token: string | undefined, body: unknown, reference = REF) {
    return PATCH(req("PATCH", path, { token, body }), context(reference));
  }

  function remove(token: string | undefined, reference = REF) {
    return DELETE(req("DELETE", path, { token }), context(reference));
  }

  /// The request row as loadRequest() reads it: with its event's access fields.
  function requestRow(eventOverrides = {}, overrides = {}) {
    return { id: ID.request, eventId: ID.event, event: event(eventOverrides), ...overrides };
  }

  function givenRequest(actor = assignedCoordinator(), row: object | null = requestRow()) {
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue({ id: ID.event });
    db.equipmentRequest.findUnique.mockResolvedValue(row);
    return token;
  }

  describe.each([
    ["PATCH", (token: string | undefined, reference?: string) => update(token, { quantityRequested: 6 }, reference)],
    ["DELETE", (token: string | undefined, reference?: string) => remove(token, reference)],
  ])("%s refusals", (_method, call) => {
    it("is 401 without a session", async () => {
      expect((await call(undefined)).status).toBe(401);
    });

    it("is 404 for a malformed event reference", async () => {
      expect((await call(signIn(assignedCoordinator()), "nope")).status).toBe(404);
    });

    it("is 404 when the event does not exist", async () => {
      const token = signIn(assignedCoordinator());
      db.event.findUnique.mockResolvedValue(null);

      expect((await call(token)).status).toBe(404);
      expect(db.equipmentRequest.findUnique).not.toHaveBeenCalled();
    });

    it("is 404 when the request does not exist", async () => {
      expect((await call(givenRequest(assignedCoordinator(), null))).status).toBe(404);
    });

    it("is 404 when the request belongs to a different event than the URL names", async () => {
      const token = givenRequest(assignedCoordinator(), requestRow({}, { eventId: "another-event" }));

      expect((await call(token)).status).toBe(404);
    });

    it("is 404 for an event the user cannot see", async () => {
      const token = givenRequest(user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));

      expect((await call(token)).status).toBe(404);
    });

    it.each([
      ["a coordinator who is not assigned", otherCoordinator],
      ["Technical Support", () => user("tech_support", { id: ID.thirdUser })],
      ["the organiser who owns the event", owner],
    ])("is 403 for %s", async (_who, actor) => {
      const res = await call(givenRequest(actor()));

      expect(res.status).toBe(403);
      expect(db.equipmentRequest.update).not.toHaveBeenCalled();
      expect(db.equipmentRequest.delete).not.toHaveBeenCalled();
    });

    it.each(["completed", "cancelled", "rejected", "withdrawn"])("is refused once the event is %s", async (status) => {
      const res = await call(givenRequest(assignedCoordinator(), requestRow({ status })));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Cannot update equipment for a completed, cancelled, or rejected event",
      });
      expect(db.equipmentRequest.update).not.toHaveBeenCalled();
      expect(db.equipmentRequest.delete).not.toHaveBeenCalled();
    });

    it.each(["submitted", "under_review"])("is refused while the event is still %s", async (status) => {
      const res = await call(givenRequest(assignedCoordinator(), requestRow({ status })));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Equipment can be recorded once this request has been approved" });
      expect(db.equipmentRequest.update).not.toHaveBeenCalled();
      expect(db.equipmentRequest.delete).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ["PATCH", "Equipment requirement updated", (token: string) => update(token, { quantityRequested: 6 })],
    ["DELETE", "Equipment requirement removed", (token: string) => remove(token)],
  ])("%s and planning", (_method, reason, call) => {
    it("begins planning on an approved event, in the same transaction as the change", async () => {
      const token = givenRequest(assignedCoordinator(), requestRow({ status: "approved" }));
      db.equipmentRequest.update.mockResolvedValue({ id: ID.request });
      db.event.updateMany.mockResolvedValue({ count: 1 });

      const res = await call(token);

      expect(res.status).toBe(200);
      expect((await res.json()).planningStarted).toBe(true);
      expect(db.$transaction).toHaveBeenCalledOnce();
      expect(callArg(db.eventStatusHistory.create).data).toMatchObject({ toStatus: "planning", reason });
    });

    it("leaves the status alone on an event already in planning", async () => {
      const token = givenRequest();
      db.equipmentRequest.update.mockResolvedValue({ id: ID.request });

      const res = await call(token);

      expect((await res.json()).planningStarted).toBe(false);
      expect(db.event.updateMany).not.toHaveBeenCalled();
    });

    it("moves a Confirmed event back to Planning (SPM-62)", async () => {
      const token = givenRequest(assignedCoordinator(), requestRow({ status: "confirmed", title: "Sundara Hospitality Showcase" }));
      db.equipmentRequest.update.mockResolvedValue({ id: ID.request });
      db.event.updateMany.mockResolvedValue({ count: 1 });

      const res = await call(token);

      expect(res.status).toBe(200);
      expect((await res.json()).confirmationReverted).toBe(true);
      expect(db.$transaction).toHaveBeenCalledOnce();
      expect(callArg(db.event.updateMany)).toEqual({
        where: { id: ID.event, status: "confirmed" },
        data: { status: "planning", confirmedAt: null },
      });
      expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
        fromStatus: "confirmed",
        toStatus: "planning",
        reason,
      });
    });
  });

  it("PATCH changes the quantity and technical requirements, and nothing else", async () => {
    const token = givenRequest();
    db.equipmentRequest.update.mockResolvedValue({ id: ID.request, quantityRequested: 6 });

    const res = await update(token, {
      quantityRequested: 6,
      technicalRequirements: "VGA",
      equipmentId: ID.otherVenue,
      sessionId: ID.session,
    });

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update)).toMatchObject({
      where: { id: ID.request },
      data: { quantityRequested: 6, technicalRequirements: "VGA" },
    });
  });

  it("PATCH rejects a body with nothing to update", async () => {
    const token = givenRequest();

    const res = await update(token, {});

    expect(res.status).toBe(400);
    expect((await res.json()).details.formErrors).toEqual(["Nothing to update"]);
  });

  it("PATCH rejects a quantity of zero", async () => {
    const res = await update(givenRequest(), { quantityRequested: 0 });

    expect(res.status).toBe(400);
  });

  it("PATCH answers 500 when the database fails", async () => {
    const token = givenRequest();
    db.equipmentRequest.update.mockRejectedValue(new Error("connection lost"));

    expect((await update(token, { quantityRequested: 6 })).status).toBe(500);
  });

  it("DELETE removes the request and says whether planning began", async () => {
    const token = givenRequest();

    const res = await remove(token);

    expect(res.status).toBe(200);
    // CHANGED (SPM-62): also says whether a Confirmed event was unconfirmed.
    expect(await res.json()).toEqual({ planningStarted: false, confirmationReverted: false });
    expect(callArg(db.equipmentRequest.delete)).toEqual({ where: { id: ID.request } });
  });
});

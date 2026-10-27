// SPM-77 — Suggest Alternative Equipment. The availability of a suggested
// alternative is worked out by equipmentAvailabilityService.ts with the real
// SPM-48 rules, so these tests feed it database rows, as the reserve and
// reservation tests do.
//
// CONTRACT (SPM-77, written before the code) - what these tests expect to exist:
//   src/app/api/events/[id]/equipment/[requestId]/suggestion/availability/route.ts   exports GET
//     GET ?equipmentId=&quantity= -> 200 { equipmentId, equipmentName, result } - the alternative's
//         availability for this line's dates (AC2); 400 bad query / unknown item
//   src/app/api/events/[id]/equipment/[requestId]/suggestion/route.ts                exports POST, PATCH
//     POST { equipmentId, quantity, note } -> 201 the suggestion (AC1); writes nothing to the
//         requirement (AC7); notifies the assigned Coordinator in the same transaction (AC4)
//     PATCH { decision: "accept" | "decline" } -> 200 { decision: "accepted" | "declined" } (AC5, AC6)
//   GET / POST: 401; 404 unseen event / request of another event / event Technical Support cannot see;
//               403 "Only Technical Support Staff can suggest alternative equipment" (AC9);
//               POST also 400 reservingClosedMessage() outside Planning, 400 for each checkSuggestion() rule
//   PATCH: 401; 404 unseen event / request of another event; 403 "Only the assigned Coordinator can
//          accept or decline a suggestion" (AC9); 400 outside Planning; 400 nothing pending;
//          409 decided by someone else meanwhile
// Decided with the team, not in the story (change the test if the team wants otherwise):
//   - the suggestion is a row of its own (EquipmentSuggestion), pending until decided
//   - PATCH acts on the line's one pending suggestion, so the URL needs no suggestion id
//   - see src/lib/__tests__/equipmentSuggestion.test.ts for the rules themselves

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET as alternativeAvailability } from "@/app/api/events/[id]/equipment/[requestId]/suggestion/availability/route";
import { PATCH as decide, POST as suggest } from "@/app/api/events/[id]/equipment/[requestId]/suggestion/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const STARTS = new Date("2027-03-04T01:00:00.000Z");
const ENDS = new Date("2027-03-04T09:00:00.000Z");
const PATH = `/api/events/${REF}/equipment/${ID.request}/suggestion`;
const SCREEN_ID = "12121212-1212-4212-8212-121212121212";
const SUGGESTION_ID = "13131313-1313-4313-8313-131313131313";
const NOTE = "Two LED screens give the same coverage.";

const techSupport = () => user("tech_support", { id: ID.user });
const coordinator = () => user("coordinator", { id: ID.otherUser });

/// The requirement the suggestion is about: 4 projectors, none available. The
/// route reads it for the access check and the availability service reads it
/// again; one row serves both.
function requestRow(overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
  return {
    id: ID.request,
    eventId: ID.event,
    equipmentId: ID.equipment,
    quantityRequested: 4,
    quantityReserved: null,
    status: "unavailable",
    technicalRequirements: "Facing the stage",
    startsAt: new Date("2027-03-03T01:00:00.000Z"),
    endsAt: new Date("2027-03-05T09:00:00.000Z"),
    sessionId: null,
    session: null,
    equipment: { id: ID.equipment, name: "Projector" },
    event: {
      id: ID.event,
      title: "Gala Dinner",
      organiserId: "organiser-id",
      organisationId: ID.org,
      coordinatorId: ID.otherUser,
      status: "planning",
      startsAt: STARTS,
      endsAt: ENDS,
      venueBookings: [],
      ...eventOverrides,
    },
    ...overrides,
  };
}

function screenItem(overrides: Record<string, unknown> = {}) {
  return {
    id: SCREEN_ID,
    name: "LED Screen",
    totalQuantity: 5,
    quantityInMaintenance: 0,
    isActive: true,
    locationVenueId: null,
    ...overrides,
  };
}

/// Another event's reservation of the alternative on the same day.
function otherHold(quantityReserved: number) {
  return {
    id: "other-request",
    equipmentId: SCREEN_ID,
    status: "reserved",
    quantityReserved,
    sessionId: null,
    session: null,
    event: { title: "Tech Summit", status: "planning", startsAt: STARTS, endsAt: ENDS, venueBookings: [] },
  };
}

interface Given {
  row?: object | null;
  item?: object | null;
  holds?: object[];
  pending?: object | null;
  alreadyRequested?: object | null;
  actor?: ReturnType<typeof user>;
}

function given({ row = requestRow(), item = screenItem(), holds = [], pending = null, alreadyRequested = null, actor = techSupport() }: Given = {}) {
  const token = signIn(actor);
  db.event.findUnique.mockResolvedValue({ id: ID.event });
  db.equipmentRequest.findUnique.mockResolvedValue(row);
  db.equipment.findUnique.mockResolvedValue(item);
  db.equipmentRequest.findMany.mockResolvedValue(holds);
  db.equipmentRequest.findFirst.mockResolvedValue(alreadyRequested);
  db.equipmentSuggestion.findFirst.mockResolvedValue(pending);
  db.equipmentSuggestion.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: SUGGESTION_ID,
    ...data,
    equipment: { id: SCREEN_ID, name: "LED Screen" },
  }));
  db.equipmentSuggestion.updateMany.mockResolvedValue({ count: 1 });
  db.equipmentRequest.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.request, ...data }));
  db.equipmentRequest.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "new-line", ...data }));
  return token;
}

function check(token?: string, query = `equipmentId=${SCREEN_ID}&quantity=2`, reference = REF) {
  return alternativeAvailability(
    req("GET", `${PATH.replace(REF, reference)}/availability?${query}`, { token }),
    params({ id: reference, requestId: ID.request })
  );
}

function record(token?: string, body: unknown = { equipmentId: SCREEN_ID, quantity: 2, note: NOTE }, reference = REF) {
  return suggest(
    req("POST", PATH.replace(REF, reference), { token, body }),
    params({ id: reference, requestId: ID.request })
  );
}

function decideOn(token?: string, decision: unknown = "accept", reference = REF) {
  return decide(
    req("PATCH", PATH.replace(REF, reference), { token, body: { decision } }),
    params({ id: reference, requestId: ID.request })
  );
}

const pendingSuggestion = (overrides: Record<string, unknown> = {}) => ({
  id: SUGGESTION_ID,
  equipmentId: SCREEN_ID,
  quantity: 2,
  status: "pending",
  ...overrides,
});

describe.each([
  ["GET availability", (token?: string, reference?: string) => check(token, undefined, reference)],
  ["POST (record)", (token?: string, reference?: string) => record(token, undefined, reference)],
])("%s: who may, and when", (_name, call) => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await call()).status).toBe(401);
  });

  it("[SPM-77] is 404 for a malformed event reference", async () => {
    expect((await call(signIn(techSupport()), "nope")).status).toBe(404);
  });

  it("[SPM-77] is 404 when the requirement does not exist", async () => {
    expect((await call(given({ row: null }))).status).toBe(404);
  });

  it("[SPM-77][AC3] is 404 when the requirement belongs to a different event than the URL names", async () => {
    const res = await call(given({ row: requestRow({ eventId: "another-event" }) }));

    expect(res.status).toBe(404);
    expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
  });

  it.each([
    ["the assigned coordinator", coordinator],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
    ["the Ops Manager", () => user("ops_manager")],
    ["Venue Staff", () => user("venue_staff")],
  ])("[SPM-77][AC9] is 403 for %s - only Technical Support suggests alternatives", async (_who, actor) => {
    const res = await call(given({ actor: actor() }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only Technical Support Staff can suggest alternative equipment" });
    expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
  });

  it.each(["draft", "submitted", "approved", "postponed", "cancelled", "completed"])(
    "[SPM-77] is 404 for an event that is %s - Technical Support does not see its equipment",
    async (status) => {
      const res = await call(given({ row: requestRow({}, { status }) }));

      expect(res.status).toBe(404);
      expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
    }
  );
});

describe("GET .../suggestion/availability", () => {
  it("[SPM-77][AC2] shows the alternative as available when nothing else holds it", async () => {
    const res = await check(given());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ equipmentId: SCREEN_ID, equipmentName: "LED Screen" });
    expect(body.result).toMatchObject({ status: "available", total: 5, available: 5, requested: 2 });
  });

  it("[SPM-77][AC2] counts other events' holds on the alternative for the same dates", async () => {
    const body = await (await check(given({ holds: [otherHold(4)] }))).json();

    expect(body.result).toMatchObject({ status: "partial", available: 1, reservedElsewhere: 4, shortfall: 1 });
    expect(body.result.heldBy).toEqual([expect.objectContaining({ eventTitle: "Tech Summit", quantity: 4 })]);
  });

  it("[SPM-77][AC2] looks only at holds on the alternative, never at this requirement itself", async () => {
    await check(given());

    expect(callArg(db.equipmentRequest.findMany).where).toMatchObject({ equipmentId: SCREEN_ID });
  });

  it("[SPM-77][AC2] says it cannot be checked while the event has no dates", async () => {
    const body = await (await check(given({ row: requestRow({}, { startsAt: null, endsAt: null }) }))).json();

    expect(body.result).toBeNull();
  });

  it("[SPM-77][AC2] still shows availability on a confirmed event, which Technical Support can see", async () => {
    expect((await check(given({ row: requestRow({}, { status: "confirmed" }) }))).status).toBe(200);
  });

  it("[SPM-77][AC1] refuses an item that is not in the catalogue", async () => {
    const res = await check(given({ item: null }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose an item from the equipment catalogue." });
  });

  it.each([
    ["no item", "quantity=2"],
    ["an item id that is not one", "equipmentId=nope&quantity=2"],
    ["no quantity", `equipmentId=${SCREEN_ID}`],
    ["a quantity of 0", `equipmentId=${SCREEN_ID}&quantity=0`],
    ["a fractional quantity", `equipmentId=${SCREEN_ID}&quantity=1.5`],
  ])("[SPM-77][AC2] is 400 for %s", async (_case, query) => {
    const token = given();

    expect((await check(token, query)).status).toBe(400);
  });

  it("[SPM-77] answers 500 when the database fails", async () => {
    const token = given();
    db.equipment.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await check(token)).status).toBe(500);
  });
});

describe("POST .../suggestion (record)", () => {
  it("[SPM-77][AC1][AC3] records the alternative item, quantity and note against the requirement", async () => {
    const res = await record(given());

    expect(res.status).toBe(201);
    expect(callArg(db.equipmentSuggestion.create).data).toEqual({
      requestId: ID.request,
      equipmentId: SCREEN_ID,
      quantity: 2,
      note: NOTE,
      status: "pending",
      suggestedBy: ID.user,
    });
    expect(await res.json()).toMatchObject({ id: SUGGESTION_ID, equipment: { name: "LED Screen" } });
  });

  it("[SPM-77][AC1] saves the note without surrounding spaces", async () => {
    await record(given(), { equipmentId: SCREEN_ID, quantity: 2, note: `  ${NOTE}  ` });

    expect(callArg(db.equipmentSuggestion.create).data.note).toBe(NOTE);
  });

  it("[SPM-77][AC1] records one for a partly fulfilled requirement", async () => {
    const res = await record(given({ row: requestRow({ status: "partially_fulfilled", quantityReserved: 2 }) }));

    expect(res.status).toBe(201);
  });

  it("[SPM-77][AC7][AC8] neither reserves anything nor changes the requirement", async () => {
    await record(given({ row: requestRow({ status: "partially_fulfilled", quantityReserved: 2 }) }));

    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
    expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.create).not.toHaveBeenCalled();
  });

  it("[SPM-77][AC4] notifies the assigned Coordinator in the same transaction", async () => {
    await record(given());

    expect(db.$transaction).toHaveBeenCalled();
    expect(callArg(db.notification.create).data).toEqual({
      recipientId: ID.otherUser,
      type: "equipment_alternative_suggested",
      title: "Alternative equipment suggested",
      body: `Technical Support suggested 2 LED Screen in place of Projector for Gala Dinner. Note: ${NOTE}`,
      eventId: ID.event,
    });
  });

  it("[SPM-77][AC4] still records it when the event has no Coordinator to notify", async () => {
    const res = await record(given({ row: requestRow({}, { coordinatorId: null }) }));

    expect(res.status).toBe(201);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-77][AC2] refuses an alternative that is not fully available for the event's dates", async () => {
    const res = await record(given({ holds: [otherHold(4)] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only 1 available for this event's dates." });
    expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-77][AC1] refuses on a requirement that is not short of anything", async () => {
    const res = await record(given({ row: requestRow({ status: "reserved", quantityReserved: 4 }) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "An alternative can only be suggested for an item that cannot be provided or is only partly fulfilled.",
    });
    expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
  });

  it("[SPM-77] refuses while another suggestion is waiting for the Coordinator", async () => {
    const res = await record(given({ pending: pendingSuggestion() }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This item already has a suggestion waiting for the Coordinator's decision." });
    expect(callArg(db.equipmentSuggestion.findFirst).where).toEqual({ requestId: ID.request, status: "pending" });
  });

  it("[SPM-77][AC5] refuses an item this event already requests for the same session", async () => {
    const res = await record(given({ alreadyRequested: { id: "another-line" } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This item is already requested for this event." });
    expect(callArg(db.equipmentRequest.findFirst).where).toEqual({ eventId: ID.event, sessionId: null, equipmentId: SCREEN_ID });
  });

  it("[SPM-77][AC1] refuses the item that could not be provided", async () => {
    const token = given({ item: screenItem({ id: ID.equipment, name: "Projector" }) });

    const res = await record(token, { equipmentId: ID.equipment, quantity: 2, note: NOTE });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Suggest a different item from the one requested." });
  });

  it("[SPM-77][AC1] refuses a retired item", async () => {
    const res = await record(given({ item: screenItem({ isActive: false }) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This equipment has been retired and cannot be suggested." });
  });

  it("[SPM-77][AC1] refuses an item that is not in the catalogue", async () => {
    const res = await record(given({ item: null }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose an item from the equipment catalogue." });
  });

  it("[SPM-77][AC1] refuses a missing note", async () => {
    const res = await record(given(), { equipmentId: SCREEN_ID, quantity: 2, note: "  " });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Add a note for the Coordinator." });
  });

  it.each([
    ["no item", { quantity: 2, note: NOTE }],
    ["no quantity", { equipmentId: SCREEN_ID, note: NOTE }],
    ["a quantity of 0", { equipmentId: SCREEN_ID, quantity: 0, note: NOTE }],
    ["no note at all", { equipmentId: SCREEN_ID, quantity: 2 }],
  ])("[SPM-77][AC1] is 400 for %s", async (_case, body) => {
    const res = await record(given(), body);

    expect(res.status).toBe(400);
    expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
  });

  it("[SPM-77] refuses on a confirmed event, whose equipment is final", async () => {
    const res = await record(given({ row: requestRow({}, { status: "confirmed" }) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This event is confirmed — its equipment is final. A change now goes through a change request.",
    });
    expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
  });

  it("[SPM-77] refuses when the requirement disappears between the access check and the transaction", async () => {
    const token = given();
    db.equipmentRequest.findUnique.mockResolvedValueOnce(requestRow()).mockResolvedValueOnce(null);

    const res = await record(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This request no longer exists." });
    expect(db.equipmentSuggestion.create).not.toHaveBeenCalled();
  });

  it("[SPM-77] answers 409 when another suggestion was recorded at the same moment", async () => {
    const token = given();
    db.equipmentSuggestion.create.mockRejectedValue(new Error("Unique constraint failed on the fields: (`request_id`)"));

    const res = await record(token);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This item already has a suggestion waiting for the Coordinator's decision." });
  });

  it("[SPM-77] answers 500 when the database fails", async () => {
    const token = given();
    db.equipmentSuggestion.create.mockRejectedValue(new Error("connection lost"));

    expect((await record(token)).status).toBe(500);
  });
});

describe("PATCH .../suggestion (accept or decline)", () => {
  const asCoordinator = (overrides: Given = {}) => given({ actor: coordinator(), pending: pendingSuggestion(), ...overrides });

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await decideOn()).status).toBe(401);
  });

  it("[SPM-77] is 404 for a malformed event reference", async () => {
    expect((await decideOn(signIn(coordinator()), "accept", "nope")).status).toBe(404);
  });

  it("[SPM-77][AC3] is 404 when the requirement belongs to a different event than the URL names", async () => {
    const res = await decideOn(asCoordinator({ row: requestRow({ eventId: "another-event" }) }));

    expect(res.status).toBe(404);
    expect(db.equipmentSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["Technical Support", techSupport],
    ["a coordinator not assigned to the event", () => user("coordinator", { id: ID.thirdUser })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
    ["the Ops Manager", () => user("ops_manager")],
  ])("[SPM-77][AC9] is 403 or 404 for %s - only the assigned Coordinator decides", async (_who, actor) => {
    const res = await decideOn(asCoordinator({ actor: actor() }));

    expect([403, 404]).toContain(res.status);
    expect(db.equipmentSuggestion.updateMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-77][AC9] tells Technical Support, who can see the event, that the decision is the Coordinator's", async () => {
    const res = await decideOn(asCoordinator({ actor: techSupport() }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the assigned Coordinator can accept or decline a suggestion" });
  });

  it.each(["safety_review", "confirmed"])("[SPM-77][AC5][AC6] refuses while the event is %s", async (status) => {
    const res = await decideOn(asCoordinator({ row: requestRow({}, { status }) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A suggestion can be accepted or declined while the event is in planning." });
    expect(db.equipmentSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-77] refuses when nothing is waiting for a decision", async () => {
    const res = await decideOn(asCoordinator({ pending: null }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "There is no suggestion waiting for a decision on this item." });
  });

  it.each([
    ["no decision", null],
    ["an unknown decision", "maybe"],
  ])("[SPM-77] is 400 for %s", async (_case, decision) => {
    const res = await decideOn(asCoordinator(), decision);

    expect(res.status).toBe(400);
    expect(db.equipmentSuggestion.updateMany).not.toHaveBeenCalled();
  });

  describe("accepting", () => {
    it("[SPM-77][AC5] marks the suggestion accepted, by whom and when", async () => {
      const res = await decideOn(asCoordinator());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ decision: "accepted" });
      const { where, data } = callArg(db.equipmentSuggestion.updateMany);
      expect(where).toEqual({ id: SUGGESTION_ID, status: "pending" });
      expect(data).toEqual({ status: "accepted", decidedBy: ID.otherUser, decidedAt: expect.any(Date) });
    });

    it("[SPM-77][AC5] turns an Unavailable requirement into the alternative, for Technical Support to reserve", async () => {
      await decideOn(asCoordinator());

      expect(callArg(db.equipmentRequest.update)).toEqual({
        where: { id: ID.request },
        data: {
          equipmentId: SCREEN_ID,
          quantityRequested: 2,
          status: "requested",
          quantityReserved: null,
          staffNotes: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      });
      expect(db.equipmentRequest.create).not.toHaveBeenCalled();
    });

    it("[SPM-77][AC5][AC8] keeps a partly fulfilled requirement's reservation and adds the alternative as a new line", async () => {
      await decideOn(asCoordinator({ row: requestRow({ status: "partially_fulfilled", quantityReserved: 3 }) }));

      expect(callArg(db.equipmentRequest.update)).toEqual({
        where: { id: ID.request },
        data: { quantityRequested: 3, status: "reserved" },
      });
      expect(callArg(db.equipmentRequest.create).data).toEqual({
        eventId: ID.event,
        sessionId: null,
        equipmentId: SCREEN_ID,
        quantityRequested: 2,
        technicalRequirements: "Facing the stage",
        startsAt: new Date("2027-03-03T01:00:00.000Z"),
        endsAt: new Date("2027-03-05T09:00:00.000Z"),
        requestedBy: ID.otherUser,
        status: "requested",
      });
    });

    it("[SPM-77][AC5] refuses once the requirement no longer needs an alternative", async () => {
      const res = await decideOn(asCoordinator({ row: requestRow({ status: "reserved", quantityReserved: 4 }) }));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "This item has changed since the alternative was suggested and no longer needs one. Decline the suggestion instead.",
      });
      expect(db.equipmentSuggestion.updateMany).not.toHaveBeenCalled();
    });

    it("[SPM-77][AC5] refuses when the event has meanwhile requested the alternative itself", async () => {
      const token = asCoordinator();
      db.equipmentRequest.update.mockRejectedValue(new Error("Unique constraint failed on the fields"));

      const res = await decideOn(token);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "This item is already requested for this event — update the existing row instead" });
    });
  });

  describe("declining", () => {
    it("[SPM-77][AC6] marks the suggestion declined and leaves the requirement as it was", async () => {
      const res = await decideOn(asCoordinator(), "decline");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ decision: "declined" });
      expect(callArg(db.equipmentSuggestion.updateMany).data).toEqual({
        status: "declined",
        decidedBy: ID.otherUser,
        decidedAt: expect.any(Date),
      });
      expect(db.equipmentRequest.update).not.toHaveBeenCalled();
      expect(db.equipmentRequest.create).not.toHaveBeenCalled();
    });

    it("[SPM-77][AC6] is allowed even when the requirement no longer needs an alternative", async () => {
      const res = await decideOn(asCoordinator({ row: requestRow({ status: "reserved", quantityReserved: 4 }) }), "decline");

      expect(res.status).toBe(200);
    });
  });

  it("[SPM-77] answers 409, and changes nothing, when the suggestion was decided meanwhile", async () => {
    const token = asCoordinator();
    db.equipmentSuggestion.updateMany.mockResolvedValue({ count: 0 });

    const res = await decideOn(token);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This suggestion has already been decided — refresh the page." });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-77] answers 500 when the database fails", async () => {
    const token = asCoordinator();
    db.equipmentSuggestion.updateMany.mockRejectedValue(new Error("connection lost"));

    expect((await decideOn(token)).status).toBe(500);
  });
});

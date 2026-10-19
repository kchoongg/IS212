// SPM-29 - Request Event Clarification. The coordinator assigned to an event
// that is Under review asks the organiser to clarify parts of the request.
// The event stays Under review; there is no Clarification Required status
// (AC3, team decision 2026-09-22).
//
// CONTRACT (SPM-29, written before the code) - what these tests expect to exist:
//   src/app/api/events/[id]/clarifications/route.ts   exports POST
//     body { fields: string[], message: string } (clarificationSchema, src/lib/clarification.ts)
//     401; 404 unseen event; 403 CLARIFICATION_FORBIDDEN_MESSAGE unless the assigned coordinator;
//     400 "Validation failed" for a malformed body;
//     400 CLARIFICATION_FIELDS_REQUIRED / CLARIFICATION_MESSAGE_REQUIRED (clarificationProblem);
//     400 CLARIFICATION_NOT_UNDER_REVIEW unless the event is under_review;
//     400 CLARIFICATION_ALREADY_OPEN when the event has an open one - checked inside the
//       transaction that creates it, so two quick clicks cannot open two;
//     creates { eventId, requestedBy, message: <trimmed>, fields: encodeFields(fields) };
//     never writes the event or its status history (AC3);
//     201 { id, fields: string[], message, requestedAt, requester: { fullName } } - the same
//       shape as GET /api/events/[id]'s openClarification.
//   Notifying the organiser is SPM-53's, not this route's.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { POST } from "@/app/api/events/[id]/clarifications/route";
import {
  CLARIFICATION_ALREADY_OPEN,
  CLARIFICATION_FIELDS_REQUIRED,
  CLARIFICATION_FORBIDDEN_MESSAGE,
  CLARIFICATION_MESSAGE_REQUIRED,
  CLARIFICATION_NOT_UNDER_REVIEW,
} from "@/lib/clarification";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const coordinator = () => user("coordinator", { id: ID.user, fullName: "Daniel Tan" });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Gala Dinner",
    status: "under_review",
    organiserId: ID.otherUser,
    organisationId: ID.org,
    coordinatorId: ID.user,
    ...overrides,
  };
}

const body = { fields: ["purpose", "when"], message: "  Is this a dinner or a conference? Which day?  " };
const requestedAt = new Date("2026-10-19T02:00:00.000Z");
const created = {
  id: "clarification-id",
  eventId: ID.event,
  requestedBy: ID.user,
  requestedAt,
  message: "Is this a dinner or a conference? Which day?",
  fields: "purpose,when",
  status: "open",
  responseMessage: null,
  respondedAt: null,
  requester: { fullName: "Daniel Tan" },
};

function given({ row = event(), open = null as object | null, actor = coordinator() } = {}) {
  const token = signIn(actor);
  db.event.findUnique.mockResolvedValue(row);
  db.clarificationRequest.findFirst.mockResolvedValue(open);
  db.clarificationRequest.create.mockResolvedValue(created);
  return token;
}

const post = (token: string | undefined, payload: unknown = body, reference = REF) =>
  POST(req("POST", `/api/events/${reference}/clarifications`, { token, body: payload }), params({ id: reference }));

function nothingWritten() {
  expect(db.clarificationRequest.create).not.toHaveBeenCalled();
}

describe("POST /api/events/[id]/clarifications - who may ask", () => {
  it("is 401 without a session", async () => {
    expect((await post(undefined)).status).toBe(401);
    nothingWritten();
  });

  it("is 404 for a malformed reference, an unknown event, or one the user may not see", async () => {
    const token = given();
    expect((await post(token, body, "nope")).status).toBe(404);

    db.event.findUnique.mockResolvedValue(null);
    expect((await post(token)).status).toBe(404);

    const otherClient = given({ actor: user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }) });
    expect((await post(otherClient)).status).toBe(404);
    nothingWritten();
  });

  it.each([
    ["a coordinator who is not assigned", () => user("coordinator", { id: ID.thirdUser })],
    ["the organiser who raised it", () => user("organiser", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.thirdUser })],
    ["Technical Support", () => user("tech_support", { id: ID.thirdUser })],
    ["the Safety Officer", () => user("safety_officer", { id: ID.thirdUser })],
  ])("is 403 for %s", async (_who, actor) => {
    const res = await post(given({ actor: actor() }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CLARIFICATION_FORBIDDEN_MESSAGE });
    nothingWritten();
  });
});

describe("POST /api/events/[id]/clarifications - what is refused", () => {
  it.each([
    [{ fields: "purpose", message: "x" }],
    [{ fields: ["budget"], message: "x" }],
    [{ fields: ["purpose"] }],
    [{ fields: ["purpose"], message: "x", status: "closed" }],
  ])("refuses a malformed body %j", async (payload) => {
    const res = await post(given(), payload);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    nothingWritten();
  });

  it("AC1: asks which information needs clarification when none is chosen", async () => {
    const res = await post(given(), { fields: [], message: "Please clarify" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CLARIFICATION_FIELDS_REQUIRED });
    nothingWritten();
  });

  it.each(["", "   "])("AC2: asks for a message when it is %j", async (message) => {
    const res = await post(given(), { fields: ["purpose"], message });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CLARIFICATION_MESSAGE_REQUIRED });
    nothingWritten();
  });

  it.each(["submitted", "approved", "planning", "rejected", "cancelled"])(
    "refuses an event that is %s - only one under review is being reviewed",
    async (status) => {
      const res = await post(given({ row: event({ status }) }));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: CLARIFICATION_NOT_UNDER_REVIEW });
      nothingWritten();
    }
  );

  it("refuses a second clarification while one is still open", async () => {
    const res = await post(given({ open: { id: "earlier" } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CLARIFICATION_ALREADY_OPEN });
    expect(callArg(db.clarificationRequest.findFirst).where).toEqual({ eventId: ID.event, status: "open" });
    nothingWritten();
  });

  it("looks for an open one in the same transaction that creates it", async () => {
    const token = given();
    let inTransaction = false;
    const seen: Record<string, boolean> = {};
    db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await work(db);
      } finally {
        inTransaction = false;
      }
    });
    db.clarificationRequest.findFirst.mockImplementation(async () => {
      seen.check = inTransaction;
      return null;
    });
    db.clarificationRequest.create.mockImplementation(async () => {
      seen.create = inTransaction;
      return created;
    });

    expect((await post(token)).status).toBe(201);
    expect(seen).toEqual({ check: true, create: true });
  });

  it("is 500, with nothing said about why, when the database fails", async () => {
    const token = given();
    db.clarificationRequest.create.mockRejectedValue(new Error("connection lost"));

    const res = await post(token);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

describe("POST /api/events/[id]/clarifications - asking", () => {
  it("AC4: records the clarification against the event, by the coordinator, with what to clarify and the trimmed message", async () => {
    await post(given());

    expect(callArg(db.clarificationRequest.create).data).toEqual({
      eventId: ID.event,
      requestedBy: ID.user,
      message: "Is this a dinner or a conference? Which day?",
      fields: "purpose,when",
    });
  });

  it("is 201 with the clarification as the event page shows it", async () => {
    const res = await post(given());

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "clarification-id",
      fields: ["purpose", "when"],
      message: "Is this a dinner or a conference? Which day?",
      requestedAt: requestedAt.toISOString(),
      requester: { fullName: "Daniel Tan" },
    });
  });

  it("AC3: leaves the event Under review - no status change, no status history", async () => {
    await post(given());

    expect(db.event.update).not.toHaveBeenCalled();
    expect(db.event.updateMany).not.toHaveBeenCalled();
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
  });
});

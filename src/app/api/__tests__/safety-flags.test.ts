// SPM-88 (AC3) - after the Safety Officer returns a check, the assigned
// coordinator flags the arrangements it concerns for review. Nothing else
// changes; the flags block resubmission (SPM-86 AC2) until cleared in Review
// Flagged Arrangements (SPM-68).
//
// CONTRACT (SPM-88, written before the code):
//   src/app/api/events/[id]/safety-flags/route.ts   exports POST
//     body { venueBookingIds?: string[], equipmentRequestIds?: string[] }
//     401; 404 unseen event; 403 "Only the coordinator assigned to this event can flag its arrangements for review."
//     400 "Validation failed" for a malformed body; 400 "Choose at least one arrangement to flag." for none;
//     400 SAFETY_FLAG_NOT_RETURNED_MESSAGE unless the event is in Planning and its latest check was returned;
//     400 SAFETY_FLAG_STALE_MESSAGE when an id is not one of the event's pending/approved bookings or
//       its equipment lines that are not cancelled.
//     In one transaction, each: { needsReview: true, reviewReason: + "safety_check_returned", flaggedAt }.
//     200 { flagged: <count> }.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { POST } from "@/app/api/events/[id]/safety-flags/route";
import { SAFETY_FLAG_NOT_RETURNED_MESSAGE, SAFETY_FLAG_STALE_MESSAGE } from "@/lib/safetyResolution";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const coordinator = () => user("coordinator", { id: ID.user });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM88 Harbour Returned Forum",
    status: "planning",
    organiserId: "organiser-id",
    organisationId: ID.org,
    coordinatorId: ID.user,
    ...overrides,
  };
}

const booking = { id: ID.booking, reviewReason: null };
const mic = { id: ID.request, reviewReason: "event_schedule_changed" };
const both = { venueBookingIds: [ID.booking], equipmentRequestIds: [ID.request] };

function given({ row = event(), check = "changes_requested" as string | null, actor = coordinator() } = {}) {
  const token = signIn(actor);
  db.event.findUnique.mockResolvedValue(row);
  db.safetyCheck.findFirst.mockResolvedValue(check === null ? null : { status: check });
  db.venueBooking.findMany.mockResolvedValue([booking]);
  db.equipmentRequest.findMany.mockResolvedValue([mic]);
  return token;
}

const post = (token: string | undefined, body: unknown = both, reference = REF) =>
  POST(req("POST", `/api/events/${reference}/safety-flags`, { token, body }), params({ id: reference }));

function nothingWritten() {
  expect(db.venueBooking.update).not.toHaveBeenCalled();
  expect(db.equipmentRequest.update).not.toHaveBeenCalled();
}

describe("POST /api/events/[id]/safety-flags - who may flag", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await post(undefined)).status).toBe(401);
  });

  it("[SPM-88] is 404 for a malformed reference, an unknown event, or one the user may not see", async () => {
    const token = given();
    expect((await post(token, both, "nope")).status).toBe(404);

    db.event.findUnique.mockResolvedValue(null);
    expect((await post(token)).status).toBe(404);

    const attendee = given({ actor: user("attendee", { id: ID.otherUser }) });
    expect((await post(attendee)).status).toBe(404);
    nothingWritten();
  });

  it.each([
    ["a coordinator who is not assigned", () => user("coordinator", { id: ID.otherUser })],
    ["the Safety Officer", () => user("safety_officer", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.otherUser })],
  ])("[SPM-88][AC3] SPM-88-TC05: is 403 for %s", async (_who, actor) => {
    const token = given({ actor: actor() });

    const res = await post(token);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only the coordinator assigned to this event can flag its arrangements for review.",
    });
    nothingWritten();
  });
});

describe("POST /api/events/[id]/safety-flags - what is refused", () => {
  it.each([
    [{ venueBookingIds: "x" }],
    [{ venueBookingIds: [42] }],
    [{ venueBookingIds: [ID.booking], extra: true }],
  ])("[SPM-88][AC3] refuses a malformed body %j", async (body) => {
    const res = await post(given(), body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    nothingWritten();
  });

  it.each([[{}], [{ venueBookingIds: [], equipmentRequestIds: [] }]])(
    "[SPM-88][AC3] SPM-88-TC05: asks for at least one arrangement (%j)",
    async (body) => {
      const res = await post(given(), body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Choose at least one arrangement to flag." });
      nothingWritten();
    }
  );

  it.each([
    ["the latest check was approved", { check: "approved" }],
    ["the check is still pending", { row: event({ status: "safety_review" }), check: "pending" }],
    ["the check was closed by a change", { check: "closed" }],
    ["the event was never submitted", { check: null }],
    ["the event is no longer in Planning", { row: event({ status: "safety_cleared" }), check: "rejected" }],
  ])("[SPM-88][AC3] SPM-88-TC05: refuses when %s", async (_case, setup) => {
    const res = await post(given(setup));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SAFETY_FLAG_NOT_RETURNED_MESSAGE });
    nothingWritten();
  });

  it("[SPM-88][AC3] reads the event's latest check", async () => {
    await post(given());

    expect(callArg(db.safetyCheck.findFirst)).toMatchObject({
      where: { eventId: ID.event },
      orderBy: { submittedAt: "desc" },
    });
  });

  it("[SPM-88][AC3] refuses an arrangement that is not one of the event's current ones", async () => {
    const token = given();
    db.equipmentRequest.findMany.mockResolvedValue([]);

    const res = await post(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: SAFETY_FLAG_STALE_MESSAGE });
    nothingWritten();
  });

  it("[SPM-88][AC3] looks only among the event's pending or approved bookings and its equipment that is not cancelled", async () => {
    await post(given());

    expect(callArg(db.venueBooking.findMany).where).toEqual({
      id: { in: [ID.booking] },
      eventId: ID.event,
      status: { in: ["pending", "approved"] },
    });
    expect(callArg(db.equipmentRequest.findMany).where).toEqual({
      id: { in: [ID.request] },
      eventId: ID.event,
      status: { not: "cancelled" },
    });
  });
});

describe("POST /api/events/[id]/safety-flags - flagging", () => {
  it.each(["changes_requested", "rejected"])(
    "[SPM-88][AC3] SPM-88-TC03: flags each chosen arrangement after a %s check, and changes nothing else",
    async (check) => {
      const res = await post(given({ check }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ flagged: 2 });
      expect(callArg(db.venueBooking.update)).toEqual({
        where: { id: ID.booking },
        data: { needsReview: true, reviewReason: "safety_check_returned", flaggedAt: expect.any(Date) },
      });
      expect(callArg(db.equipmentRequest.update)).toEqual({
        where: { id: ID.request },
        data: {
          needsReview: true,
          reviewReason: "event_schedule_changed,safety_check_returned",
          flaggedAt: expect.any(Date),
        },
      });
      expect(db.$transaction).toHaveBeenCalledOnce();
      expect(db.event.update).not.toHaveBeenCalled();
      expect(db.event.updateMany).not.toHaveBeenCalled();
    }
  );

  it("[SPM-88][AC3] flags only the kind chosen", async () => {
    const token = given();

    const res = await post(token, { venueBookingIds: [ID.booking] });

    expect(await res.json()).toEqual({ flagged: 1 });
    expect(db.equipmentRequest.findMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-88][AC3] flags equipment alone", async () => {
    const token = given();

    const res = await post(token, { equipmentRequestIds: [ID.request] });

    expect(await res.json()).toEqual({ flagged: 1 });
    expect(db.venueBooking.findMany).not.toHaveBeenCalled();
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("[SPM-88] answers 500 when the database fails", async () => {
    const token = given();
    db.venueBooking.update.mockRejectedValue(new Error("down"));

    expect((await post(token)).status).toBe(500);
  });
});

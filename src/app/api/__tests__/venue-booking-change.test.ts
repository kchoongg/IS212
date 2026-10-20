// SPM-67, Withdraw or Release Venue Booking:
// PATCH /api/events/[id]/venue-bookings/[bookingId]. The assigned Coordinator
// withdraws a pending request (AC1) or releases an approved booking (AC3),
// with an optional reason (AC5); Venue Staff are notified of a release (AC7).
// The rules about the booking itself are unit-tested in
// src/lib/__tests__/venueBookingChange.test.ts.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { PATCH } from "@/app/api/events/[id]/venue-bookings/[bookingId]/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";
import {
  ALREADY_APPROVED_MESSAGE,
  CLOSED_EVENT_CHANGE_MESSAGE,
  ONLY_ASSIGNED_TO_CHANGE,
} from "@/lib/venueBookingChange";

const REF = "EVT-000007";

const coordinator = () => user("coordinator", { id: ID.user, fullName: "Daniel Tan" });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Town Hall",
    status: "planning",
    organiserId: "organiser-id",
    organisationId: ID.org,
    coordinatorId: ID.user,
    facilityRequirements: [],
    sessions: [],
    ...overrides,
  };
}

/// A booking at Hall A on 4 Mar 2027, 13:30-17:00 Singapore time.
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.booking,
    status: "pending",
    venueId: ID.venue,
    startsAt: new Date("2027-03-04T05:30:00.000Z"),
    endsAt: new Date("2027-03-04T09:00:00.000Z"),
    session: null,
    venue: { name: "Hall A", code: "HALL-A" },
    ...overrides,
  };
}

function given({ ev = event(), row = booking() }: { ev?: object | null; row?: object | null } = {}) {
  db.event.findUnique.mockResolvedValue(ev);
  db.venueBooking.findFirst.mockResolvedValue(row && { venueId: ID.venue });
  db.venueBooking.findUniqueOrThrow.mockResolvedValue(row);
  db.venueBooking.update.mockImplementation(async (args: { data: { status: string } }) => ({
    id: ID.booking,
    status: args.data.status,
  }));
  db.user.findMany.mockResolvedValue([{ id: ID.otherUser }, { id: ID.thirdUser }]);
}

function patch(token: string | undefined, body: unknown, reference = REF, bookingId: string = ID.booking) {
  return PATCH(
    req("PATCH", `/api/events/${reference}/venue-bookings/${bookingId}`, { token, body }),
    params({ id: reference, bookingId })
  );
}

describe("PATCH /api/events/[id]/venue-bookings/[bookingId]", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await patch(undefined, { action: "withdraw" })).status).toBe(401);
  });

  it("[SPM-67] is 404 for a malformed reference", async () => {
    expect((await patch(signIn(coordinator()), { action: "withdraw" }, "nope")).status).toBe(404);
  });

  it("[SPM-67] is 404 for an event the user cannot see", async () => {
    const token = signIn(coordinator());
    given({ ev: event({ status: "draft" }) });

    expect((await patch(token, { action: "withdraw" })).status).toBe(404);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it.each([
    ["SPM-67-TC08: a coordinator who is not assigned", () => user("coordinator", { id: ID.otherUser })],
    ["SPM-67-TC09: the Ops Manager", () => user("ops_manager", { id: ID.otherUser })],
    ["SPM-67-TC10: Venue Staff", () => user("venue_staff", { id: ID.otherUser })],
  ])("[SPM-67][AC9] refuses %s, and changes nothing", async (_who, actor) => {
    const token = signIn(actor());
    given({ row: booking({ status: "approved" }) });

    const res = await patch(token, { action: "release" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ONLY_ASSIGNED_TO_CHANGE });
    expect(db.venueBooking.update).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("[SPM-67] is 400 for an unknown action", async () => {
    const token = signIn(coordinator());
    given();

    const res = await patch(token, { action: "approve" });

    expect(res.status).toBe(400);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("[SPM-67] is 404 for a booking that is not this event's", async () => {
    const token = signIn(coordinator());
    given({ row: null });

    const res = await patch(token, { action: "withdraw" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Booking not found" });
    expect(callArg(db.venueBooking.findFirst).where).toEqual({ id: ID.booking, eventId: ID.event });
  });

  it("[SPM-67][AC1][AC5] SPM-67-TC01: withdraws a pending request with the Coordinator's reason, and notifies no one", async () => {
    const token = signIn(coordinator());
    given();

    const res = await patch(token, { action: "withdraw", reason: "  The client has cut the guest list.  " });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("withdrawn");
    const { where, data } = callArg(db.venueBooking.update);
    expect(where).toEqual({ id: ID.booking });
    expect(data).toEqual({
      status: "withdrawn",
      cancelledBy: ID.user,
      cancelledAt: expect.any(Date),
      cancellationReason: "The client has cut the guest list.",
    });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("[SPM-67] locks the venue before reading the booking, as Venue Staff's decision does", async () => {
    const token = signIn(coordinator());
    given();

    await patch(token, { action: "withdraw" });

    // The first raw query is the lock on this booking's venue row.
    expect(db.$queryRaw.mock.calls[0][0].join("?")).toBe("SELECT id FROM venues WHERE id = ? FOR UPDATE");
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.venueBooking.findUniqueOrThrow.mock.invocationCallOrder[0]
    );
  });

  it("[SPM-67][AC5] SPM-67-TC06: stores no reason when none was given", async () => {
    const token = signIn(coordinator());
    given();

    await patch(token, { action: "withdraw", reason: "" });

    expect(callArg(db.venueBooking.update).data.cancellationReason).toBeNull();
  });

  it("[SPM-67][AC3][AC7] SPM-67-TC03: releases an approved booking and notifies every active member of Venue Staff", async () => {
    const token = signIn(coordinator());
    given({ row: booking({ status: "approved" }) });

    const res = await patch(token, { action: "release", reason: "Plenary moved." });

    expect(res.status).toBe(200);
    expect(callArg(db.venueBooking.update).data).toEqual({
      status: "released",
      cancelledBy: ID.user,
      cancelledAt: expect.any(Date),
      cancellationReason: "Plenary moved.",
    });
    expect(callArg(db.user.findMany).where).toEqual({ role: "venue_staff", isActive: true });
    expect(callArg(db.notification.createMany).data).toEqual(
      [ID.otherUser, ID.thirdUser].map((recipientId) => ({
        recipientId,
        type: "venue_booking_released",
        title: "Venue booking released",
        body: "Daniel Tan released Hall A (HALL-A) for EVT-000007 Town Hall on 4 Mar 2027, 13:30–17:00. Reason: Plenary moved.",
        eventId: ID.event,
      }))
    );
  });

  it("[SPM-67][AC7] names 'The assigned Coordinator' when the coordinator's name cannot be found", async () => {
    const token = signIn(coordinator());
    given({ row: booking({ status: "approved" }) });
    const lookUp = db.user.findUnique.getMockImplementation()!;
    db.user.findUnique.mockImplementation(async (args: { select?: object }) =>
      JSON.stringify(args.select) === JSON.stringify({ fullName: true }) ? null : lookUp(args)
    );

    const res = await patch(token, { action: "release" });

    expect(res.status).toBe(200);
    expect(callArg(db.notification.createMany).data[0].body).toMatch(/^The assigned Coordinator released Hall A/);
  });

  it("[SPM-67][AC1] refuses to withdraw a request Venue Staff approved in the meantime, and changes nothing", async () => {
    const token = signIn(coordinator());
    given({ row: booking({ status: "approved" }) });

    const res = await patch(token, { action: "withdraw" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ALREADY_APPROVED_MESSAGE });
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("[SPM-67] refuses a change on a closed event", async () => {
    const token = signIn(coordinator());
    given({ ev: event({ status: "completed" }), row: booking({ status: "approved" }) });

    const res = await patch(token, { action: "release" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CLOSED_EVENT_CHANGE_MESSAGE });
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("[SPM-67] leaves the event's status alone", async () => {
    const token = signIn(coordinator());
    given({ ev: event({ status: "confirmed" }), row: booking({ status: "approved" }) });

    expect((await patch(token, { action: "release" })).status).toBe(200);
    expect(db.event.update).not.toHaveBeenCalled();
  });

  // SPM-88 (AC5, AC6): withdrawing or releasing a booking is a significant
  // change - it closes the safety check the event rests on.
  it.each([
    ["withdraw", "pending", "safety_review", "a venue booking was withdrawn"],
    ["release", "approved", "safety_cleared", "a venue booking was released"],
  ])("[SPM-88][AC6] SPM-88: a %s on a %s booking moves a %s event back to Planning and closes its check", async (action, bookingStatus, status, why) => {
    const token = signIn(coordinator());
    given({ ev: event({ status }), row: booking({ status: bookingStatus }) });
    db.event.updateMany.mockResolvedValue({ count: 1 });
    db.safetyCheck.updateMany.mockResolvedValue({ count: 1 });

    const res = await patch(token, { action });

    expect(res.status).toBe(200);
    expect((await res.json()).safetyCheckClosed).toBe(true);
    expect(callArg(db.event.updateMany)).toEqual({ where: { id: ID.event, status }, data: { status: "planning" } });
    expect(callArg(db.eventStatusHistory.create).data).toMatchObject({ reason: `Safety check closed: ${why}` });
    expect(callArg(db.safetyCheck.updateMany).data).toMatchObject({ status: "closed", decisionNote: why });
  });

  it("[SPM-88][AC7] SPM-88: leaves the safety check of a Planning event alone", async () => {
    const token = signIn(coordinator());
    given();

    expect((await (await patch(token, { action: "withdraw" })).json()).safetyCheckClosed).toBe(false);
    expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-67] answers 500 when the database fails", async () => {
    const token = signIn(coordinator());
    given();
    db.venueBooking.update.mockRejectedValue(new Error("down"));

    expect((await patch(token, { action: "withdraw" })).status).toBe(500);
  });
});

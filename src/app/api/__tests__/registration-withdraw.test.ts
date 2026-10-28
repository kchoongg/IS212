// SPM-52 Withdraw from Event - PATCH /api/registrations/[id].
//   { status: "withdrawn" } -> 200, the registration as now saved (status withdrawn, withdrawnAt set)
//   401; 403 "Only an Attendee can withdraw a registration";
//   404 "Registration not found" - none with that id, or it is another attendee's;
//   400 "Validation failed" - any other body;
//   400 "Only an active registration can be withdrawn" - not registered, or withdrawn meanwhile;
//   400 "This event has been cancelled, ..." / "This event is over, ..." - cancelled, completed or ended.
// The place comes back because seats are counted from SEAT_TAKING (registrationEligibility.test.ts).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/prisma");

import { PATCH } from "@/app/api/registrations/[id]/route";
import { ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const NOW = new Date("2026-10-13T04:00:00Z");

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.registration,
    eventId: ID.event,
    attendeeId: ID.user,
    status: "registered",
    registeredAt: new Date("2026-10-05T02:00:00Z"),
    withdrawnAt: null,
    event: { status: "confirmed", endsAt: new Date("2028-03-04T09:00:00Z") },
    ...overrides,
  };
}

function withdraw(token: string | undefined, body: unknown = { status: "withdrawn" }) {
  return PATCH(
    req("PATCH", `/api/registrations/${ID.registration}`, { token, body }),
    params({ id: ID.registration })
  );
}

const attendee = () => user("attendee", { id: ID.user });

describe("PATCH /api/registrations/[id]", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await withdraw(undefined)).status).toBe(401);
  });

  it.each(ROLES.filter((role) => !can(role, "registration:create")))(
    "[SPM-21][AC4] is 403 for %s - only an Attendee withdraws",
    async (role) => {
      const res = await withdraw(signIn(user(role)));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Only an Attendee can withdraw a registration" });
      expect(db.registration.updateMany).not.toHaveBeenCalled();
    }
  );

  it("[SPM-52] is 404 for a registration that doesn't exist", async () => {
    db.registration.findUnique.mockResolvedValue(null);

    const res = await withdraw(signIn(attendee()));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Registration not found" });
  });

  it("[SPM-52] is 404, not 403, for another attendee's registration, and changes nothing", async () => {
    db.registration.findUnique.mockResolvedValue(registration({ attendeeId: ID.otherUser }));

    const res = await withdraw(signIn(attendee()));

    expect(res.status).toBe(404);
    expect(db.registration.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-52][AC1][AC2] withdraws a registered attendee: status withdrawn, with the time (AC1, AC2)", async () => {
    const withdrawn = registration({ status: "withdrawn", withdrawnAt: NOW });
    db.registration.findUnique.mockResolvedValueOnce(registration()).mockResolvedValueOnce(withdrawn);
    db.registration.updateMany.mockResolvedValue({ count: 1 });

    const res = await withdraw(signIn(attendee()));

    expect(res.status).toBe(200);
    expect(callArg(db.registration.findUnique)).toEqual({
      where: { id: ID.registration },
      include: { event: { select: { status: true, endsAt: true } } },
    });
    // Only while it is still registered, so a second click can't withdraw twice.
    expect(callArg(db.registration.updateMany)).toEqual({
      where: { id: ID.registration, status: "registered" },
      data: { status: "withdrawn", withdrawnAt: NOW },
    });
    expect(await res.json()).toMatchObject({ status: "withdrawn", withdrawnAt: NOW.toISOString() });
  });

  it("[SPM-52][AC2] keeps the row, so the attendee can register again later", async () => {
    db.registration.findUnique.mockResolvedValue(registration());
    db.registration.updateMany.mockResolvedValue({ count: 1 });

    await withdraw(signIn(attendee()));

    expect(db.registration.delete).not.toHaveBeenCalled();
    expect(db.registration.deleteMany).not.toHaveBeenCalled();
  });

  // CHANGED (SPM-66, AC4): a waitlisted attendee now leaves the waiting list
  // through this route - see waiting-list.test.ts.
  it.each(["withdrawn", "attended"])(
    "[SPM-52][AC1] refuses to withdraw a %s registration, changing nothing",
    async (status) => {
      db.registration.findUnique.mockResolvedValue(registration({ status }));

      const res = await withdraw(signIn(attendee()));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Only an active registration can be withdrawn" });
      expect(db.registration.updateMany).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["cancelled", { status: "cancelled", endsAt: new Date("2028-03-04T09:00:00Z") }, "This event has been cancelled, so there is nothing to withdraw from"],
    ["completed", { status: "completed", endsAt: new Date("2026-09-15T09:00:00Z") }, "This event is over, so the registration can no longer be withdrawn"],
    ["ended but not yet completed", { status: "confirmed", endsAt: new Date("2026-10-12T09:00:00Z") }, "This event is over, so the registration can no longer be withdrawn"],
  ])("[SPM-52][AC1] refuses to withdraw from a %s event, changing nothing", async (_case, event, error) => {
    db.registration.findUnique.mockResolvedValue(registration({ event }));

    const res = await withdraw(signIn(attendee()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(db.registration.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-52][AC1] refuses when it was withdrawn from another tab in the meantime", async () => {
    db.registration.findUnique.mockResolvedValue(registration());
    db.registration.updateMany.mockResolvedValue({ count: 0 });

    const res = await withdraw(signIn(attendee()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only an active registration can be withdrawn" });
  });

  it.each([
    ["another status", { status: "registered" }],
    ["no status", {}],
    ["another field as well", { status: "withdrawn", attendeeId: ID.otherUser }],
  ])("[SPM-52][AC1] refuses a body with %s, changing nothing", async (_case, body) => {
    db.registration.findUnique.mockResolvedValue(registration());

    const res = await withdraw(signIn(attendee()), body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    expect(db.registration.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-52] is 500 when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.registration.findUnique.mockRejectedValue(new Error("connection lost"));

    const res = await withdraw(signIn(attendee()));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

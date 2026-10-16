// SPM-82 (AC3): Venue Staff change a tentative hold's expiry while it is still
// active. PATCH /api/venue-bookings/[id]/expiry, body { holdExpiresAt }.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { PATCH } from "@/app/api/venue-bookings/[id]/expiry/route";
import { ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { callArg, db, holdExpirySweepOrder, ID, params, req, signIn, user } from "@/test/kit";

const NOW = new Date("2026-10-15T01:00:00.000Z"); // 15 Oct 2026, 09:00 in Singapore
const EVENT_START = new Date("2027-02-08T01:00:00.000Z"); // 8 Feb 2027, 09:00

const change = (token: string | undefined, body: unknown) =>
  PATCH(req("PATCH", `/api/venue-bookings/${ID.booking}/expiry`, { token, body }), params({ id: ID.booking }));

function given(row: object | null = hold()) {
  const token = signIn(user("venue_staff"));
  db.venueBooking.findUnique.mockResolvedValue(row);
  db.venueBooking.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.booking, ...data }));
  return token;
}

function hold(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.booking,
    status: "pending",
    holdExpiresAt: new Date("2027-01-15T01:00:00.000Z"),
    event: { startsAt: EVENT_START },
    ...overrides,
  };
}

async function refusal(token: string, body: unknown) {
  const res = await change(token, body);
  expect(res.status).toBe(400);
  expect(db.venueBooking.update).not.toHaveBeenCalled();
  return (await res.json()).error as string;
}

describe("PATCH /api/venue-bookings/[id]/expiry", () => {
  afterEach(() => vi.useRealTimers());

  function atNow() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  }

  it("is 401 without a session", async () => {
    expect((await change(undefined, { holdExpiresAt: "2027-01-20T01:00:00.000Z" })).status).toBe(401);
  });

  it.each(ROLES.filter((role) => !can(role, "venue_booking:decide")))(
    "is 403 for %s, before anything is read",
    async (role) => {
      const res = await change(signIn(user(role)), { holdExpiresAt: "2027-01-20T01:00:00.000Z" });

      expect(res.status).toBe(403);
      expect(db.venueBooking.findUnique).not.toHaveBeenCalled();
    }
  );

  it("is 404 for a booking that does not exist", async () => {
    const res = await change(given(null), { holdExpiresAt: "2027-01-20T01:00:00.000Z" });

    expect(res.status).toBe(404);
  });

  it.each([
    ["no expiry", {}],
    ["something that is not a date", { holdExpiresAt: "next Tuesday" }],
  ])("refuses %s", async (_case, body) => {
    const res = await change(given(), body);

    expect(res.status).toBe(400);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("AC3: moves an active hold's expiry, and lets it be warned about again for the new time", async () => {
    atNow();
    const res = await change(given(), { holdExpiresAt: "2027-01-20T01:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: ID.booking, holdExpiresAt: "2027-01-20T01:00:00.000Z" });
    expect(callArg(db.venueBooking.update)).toEqual({
      where: { id: ID.booking },
      data: { holdExpiresAt: new Date("2027-01-20T01:00:00.000Z"), expiryWarningSentAt: null },
      select: { id: true, holdExpiresAt: true },
    });
  });

  it("SPM-82-TC04: refuses an expiry after the event starts, naming the start", async () => {
    atNow();

    expect(await refusal(given(), { holdExpiresAt: "2027-02-09T01:00:00.000Z" })).toBe(
      "The expiry cannot be later than the start of the event (8 Feb 2027, 09:00)."
    );
  });

  it("SPM-82-TC04: refuses an expiry in the past", async () => {
    atNow();

    expect(await refusal(given(), { holdExpiresAt: "2026-01-01T01:00:00.000Z" })).toBe("The expiry must be in the future.");
  });

  it("refuses to change a hold that has expired - it is no longer active", async () => {
    atNow();

    expect(await refusal(given(hold({ status: "expired" })), { holdExpiresAt: "2027-01-20T01:00:00.000Z" })).toBe(
      "This hold has expired. The Coordinator must submit a new request."
    );
  });

  it("AC11: refuses to give an approved booking an expiry", async () => {
    atNow();

    expect(await refusal(given(hold({ status: "approved" })), { holdExpiresAt: "2027-01-20T01:00:00.000Z" })).toBe(
      "An approved booking does not expire."
    );
  });

  it("expires overdue holds before reading this one, so a hold whose time just ran out is refused as expired", async () => {
    atNow();
    await change(given(), { holdExpiresAt: "2027-01-20T01:00:00.000Z" });

    expect(holdExpirySweepOrder()).toBeLessThan(db.venueBooking.findUnique.mock.invocationCallOrder[0]);
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.venueBooking.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await change(token, { holdExpiresAt: "2027-01-20T01:00:00.000Z" })).status).toBe(500);
  });
});

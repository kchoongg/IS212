// SPM-85: the data behind the Safety Officer's Safety Checks page - the
// events waiting for an Operational Safety Check (SPM-86 puts them there).

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET as safetyChecks } from "@/app/api/safety-checks/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, req, signIn, user } from "@/test/kit";

const get = (token?: string) => safetyChecks(req("GET", "/api/safety-checks", { token }));

/// An event in Safety review as the query returns it: its latest submission
/// first in `safetyChecks` (SPM-86 keeps one row per submission).
function row(id: string, submittedAt: string | null, submitter = "Daniel Tan") {
  return {
    id,
    sequenceNumber: 41,
    title: `Event ${id}`,
    status: "safety_review",
    startsAt: "2027-06-14T01:00:00.000Z",
    endsAt: "2027-06-14T09:00:00.000Z",
    expectedAttendance: 200,
    organisation: { name: "Meridian Financial Group" },
    safetyChecks: submittedAt ? [{ submittedAt, submitter: { fullName: submitter } }] : [],
  };
}

describe("GET /api/safety-checks", () => {
  it("is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  // AC8: users in other roles cannot perform Safety Officer actions.
  it.each(ROLES.filter((role) => role !== "safety_officer"))("is 403 for %s, before anything is read", async (role) => {
    const res = await get(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("lists only the events in Safety review", async () => {
    db.event.findMany.mockResolvedValue([]);

    await get(signIn(user("safety_officer")));

    expect(callArg(db.event.findMany).where).toEqual({ status: "safety_review" });
  });

  // CHANGED (SPM-87 AC1): "earliest event date first" - the database orders
  // by the event's start, and the list keeps that order whatever the
  // submission dates. Was oldest submission first (SPM-85).
  it("SPM-87-TC01: lists the events earliest event date first", async () => {
    db.event.findMany.mockResolvedValue([]);

    await get(signIn(user("safety_officer")));

    expect(callArg(db.event.findMany).orderBy).toEqual({ startsAt: "asc" });
  });

  it("says who submitted each event for its check and when, keeping the event-date order", async () => {
    db.event.findMany.mockResolvedValue([
      row("older", "2026-10-10T02:00:00.000Z"),
      row("newer", "2026-10-11T02:00:00.000Z", "Priya Raj"),
    ]);

    const res = await get(signIn(user("safety_officer")));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: "older",
        sequenceNumber: 41,
        title: "Event older",
        status: "safety_review",
        startsAt: "2027-06-14T01:00:00.000Z",
        endsAt: "2027-06-14T09:00:00.000Z",
        expectedAttendance: 200,
        organisation: { name: "Meridian Financial Group" },
        submittedAt: "2026-10-10T02:00:00.000Z",
        submittedBy: "Daniel Tan",
      },
      expect.objectContaining({ id: "newer", submittedAt: "2026-10-11T02:00:00.000Z", submittedBy: "Priya Raj" }),
    ]);
  });

  it("reads only the latest submission of each event", async () => {
    db.event.findMany.mockResolvedValue([]);

    await get(signIn(user("safety_officer")));

    expect(callArg(db.event.findMany).select.safetyChecks).toEqual({
      orderBy: { submittedAt: "desc" },
      take: 1,
      select: { submittedAt: true, submitter: { select: { fullName: true } } },
    });
  });

  it("lists an event with no recorded submission in its date order, rather than dropping it", async () => {
    db.event.findMany.mockResolvedValue([row("unrecorded", null), row("recorded", "2026-10-10T02:00:00.000Z")]);

    const body = await (await get(signIn(user("safety_officer")))).json();

    expect(body.map((e: { id: string }) => e.id)).toEqual(["unrecorded", "recorded"]);
    expect(body[0]).toMatchObject({ submittedAt: null, submittedBy: null });
  });

  it("keeps two events with no recorded submission in the order they were read", async () => {
    db.event.findMany.mockResolvedValue([row("first", null), row("second", null)]);

    const body = await (await get(signIn(user("safety_officer")))).json();

    expect(body.map((e: { id: string }) => e.id)).toEqual(["first", "second"]);
  });

  it("answers 500 when the database fails", async () => {
    db.event.findMany.mockRejectedValue(new Error("connection lost"));

    expect((await get(signIn(user("safety_officer")))).status).toBe(500);
  });
});


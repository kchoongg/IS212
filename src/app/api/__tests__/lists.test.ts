// The read-only list endpoints: one role-gated query each.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET as assignments } from "@/app/api/assignments/route";
import { GET as queue } from "@/app/api/queue/route";
import { GET as facilities } from "@/app/api/facilities/route";
import { GET as equipmentRequests } from "@/app/api/equipment/requests/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, eventCompletionSweepOrder, req, signIn, user } from "@/test/kit";

const rolesExcept = (...allowed: string[]) => ROLES.filter((role) => !allowed.includes(role));

describe("GET /api/assignments", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await assignments(req("GET", "/api/assignments"))).status).toBe(401);
  });

  it.each(rolesExcept("ops_manager"))("[SPM-30][AC1] is 403 for %s", async (role) => {
    const res = await assignments(req("GET", "/api/assignments", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("[SPM-36][AC6] completes events 7 days past their end before listing the active ones", async () => {
    db.event.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([]);

    await assignments(req("GET", "/api/assignments", { token: signIn(user("ops_manager")) }));

    expect(eventCompletionSweepOrder()).toBeLessThan(db.event.findMany.mock.invocationCallOrder[0]);
  });

  // CHANGED (SPM-84): `assigned` became `active` - every active event, with or
  // without a coordinator - and `workload` counts each coordinator's active
  // events. `coordinators` is still the active accounts an event can go to.
  it("[SPM-30][AC2] [SPM-84][AC4][AC5] gives the Lead the unassigned events, every active event, the coordinators and their workload", async () => {
    const token = signIn(user("ops_manager"));
    const awaiting = [{ id: "e1", title: "Awaiting", status: "submitted", coordinator: null }];
    const active = [
      { id: "e2", title: "Gala", status: "planning", coordinator: { id: "c1", fullName: "Aisha Karim" } },
      { id: "e3", title: "Workshop", status: "planning", coordinator: { id: "c4", fullName: "Dennis Ho" } },
      { id: "e1", title: "Awaiting", status: "submitted", coordinator: null },
    ];
    db.event.findMany.mockResolvedValueOnce(awaiting).mockResolvedValueOnce(active);
    db.user.findMany.mockResolvedValue([
      { id: "c1", fullName: "Aisha Karim", isActive: true },
      { id: "c3", fullName: "Clara Tay", isActive: true },
      { id: "c4", fullName: "Dennis Ho", isActive: false },
    ]);

    const res = await assignments(req("GET", "/api/assignments", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      awaiting,
      active,
      coordinators: [
        { id: "c1", fullName: "Aisha Karim" },
        { id: "c3", fullName: "Clara Tay" },
      ],
      workload: [
        { id: "c1", fullName: "Aisha Karim", isActive: true, activeEvents: 1 },
        { id: "c3", fullName: "Clara Tay", isActive: true, activeEvents: 0 },
        { id: "c4", fullName: "Dennis Ho", isActive: false, activeEvents: 1 },
      ],
    });
  });

  it("[SPM-30][AC2] [SPM-84][AC6] asks for submitted events with no coordinator, every active event, and every coordinator", async () => {
    const token = signIn(user("ops_manager"));
    db.event.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([]);

    await assignments(req("GET", "/api/assignments", { token }));

    expect(callArg(db.event.findMany, 0).where).toEqual({ status: { in: ["submitted"] }, coordinatorId: null });
    expect(callArg(db.event.findMany, 1).where).toEqual({
      status: {
        in: ["submitted", "under_review", "approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed"],
      },
    });
    expect(callArg(db.event.findMany, 1).orderBy).toEqual([{ startsAt: "asc" }, { sequenceNumber: "asc" }]);
    expect(callArg(db.user.findMany).where).toEqual({ role: "coordinator" });
  });

  it("[SPM-84][AC1] refuses everyone else naming the Event Coordinator Lead", async () => {
    const res = await assignments(req("GET", "/api/assignments", { token: signIn(user("coordinator")) }));

    expect(await res.json()).toEqual({ error: "Only the Event Coordinator Lead can assign coordinators" });
  });
});

describe("GET /api/queue", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await queue(req("GET", "/api/queue"))).status).toBe(401);
  });

  it.each(rolesExcept("coordinator"))("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await queue(req("GET", "/api/queue", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("[SPM-28][AC1] lists only the signed-in coordinator's own requests still under review", async () => {
    const coordinator = user("coordinator");
    const token = signIn(coordinator);
    const events = [{ id: "e1", sequenceNumber: 7, title: "Seminar", status: "under_review" }];
    db.event.findMany.mockResolvedValue(events);

    const res = await queue(req("GET", "/api/queue", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(events);
    expect(callArg(db.event.findMany).where).toEqual({
      coordinatorId: coordinator.id,
      status: { in: ["under_review"] },
    });
  });
});

describe("GET /api/facilities", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await facilities(req("GET", "/api/facilities"))).status).toBe(401);
  });

  it.each(ROLES)("[SPM-23][AC5] is readable by %s", async (role) => {
    const token = signIn(user(role));
    const rows = [{ id: "f1", name: "Hearing loop", category: "accessibility" }];
    db.facility.findMany.mockResolvedValue(rows);

    const res = await facilities(req("GET", "/api/facilities", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it("[SPM-23][AC5] is 403 for a role the app does not know", async () => {
    const res = await facilities(req("GET", "/api/facilities", { token: signIn(user("intern")) }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/equipment/requests", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await equipmentRequests(req("GET", "/api/equipment/requests"))).status).toBe(401);
  });

  it.each(rolesExcept("tech_support"))("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await equipmentRequests(req("GET", "/api/equipment/requests", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("[SPM-50][AC1] gives Technical Support each event with its count of live requests", async () => {
    const token = signIn(user("tech_support"));
    db.event.findMany.mockResolvedValue([
      { sequenceNumber: 12, title: "Gala", status: "planning", _count: { equipmentRequests: 3 } },
    ]);

    const res = await equipmentRequests(req("GET", "/api/equipment/requests", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ sequenceNumber: 12, title: "Gala", status: "planning", requestCount: 3 }]);
  });

  it("[SPM-50][AC1] lists only events in planning, safety review or confirmed that have a request which is not cancelled", async () => {
    const token = signIn(user("tech_support"));
    db.event.findMany.mockResolvedValue([]);

    await equipmentRequests(req("GET", "/api/equipment/requests", { token }));

    expect(callArg(db.event.findMany).where).toEqual({
      AND: [
        // CHANGED (SPM-94 AC2): Technical Support's own event scope.
        { status: { notIn: ["draft", "submitted", "under_review", "rejected", "withdrawn"] } },
        // Technical Support sees an event's equipment once planning has begun.
        // SPM-86: and while the Safety Officer checks it.
        { status: { in: ["planning", "safety_review", "safety_cleared", "confirmed"] } },
        { equipmentRequests: { some: { status: { not: "cancelled" } } } },
      ],
    });
  });
});

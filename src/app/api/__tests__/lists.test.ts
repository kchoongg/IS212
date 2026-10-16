// The read-only list endpoints: one role-gated query each.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET as assignments } from "@/app/api/assignments/route";
import { GET as queue } from "@/app/api/queue/route";
import { GET as facilities } from "@/app/api/facilities/route";
import { GET as equipmentRequests } from "@/app/api/equipment/requests/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, req, signIn, user } from "@/test/kit";

const rolesExcept = (...allowed: string[]) => ROLES.filter((role) => !allowed.includes(role));

describe("GET /api/assignments", () => {
  it("is 401 without a session", async () => {
    expect((await assignments(req("GET", "/api/assignments"))).status).toBe(401);
  });

  it.each(rolesExcept("ops_manager"))("is 403 for %s", async (role) => {
    const res = await assignments(req("GET", "/api/assignments", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("gives the Ops Manager the unassigned events, the assigned ones and the coordinators", async () => {
    const token = signIn(user("ops_manager"));
    const awaiting = [{ id: "e1", title: "Awaiting" }];
    const assigned = [{ id: "e2", title: "Assigned" }];
    const coordinators = [{ id: "c1", fullName: "Daniel Tan" }];
    db.event.findMany.mockResolvedValueOnce(awaiting).mockResolvedValueOnce(assigned);
    db.user.findMany.mockResolvedValue(coordinators);

    const res = await assignments(req("GET", "/api/assignments", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ awaiting, assigned, coordinators });
  });

  it("asks for submitted events with no coordinator, and live events with one", async () => {
    const token = signIn(user("ops_manager"));
    db.event.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([]);

    await assignments(req("GET", "/api/assignments", { token }));

    expect(callArg(db.event.findMany, 0).where).toEqual({ status: { in: ["submitted"] }, coordinatorId: null });
    expect(callArg(db.event.findMany, 1).where).toEqual({
      status: { in: ["under_review", "approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed"] },
      coordinatorId: { not: null },
    });
    expect(callArg(db.user.findMany).where).toEqual({ role: "coordinator", isActive: true });
  });
});

describe("GET /api/queue", () => {
  it("is 401 without a session", async () => {
    expect((await queue(req("GET", "/api/queue"))).status).toBe(401);
  });

  it.each(rolesExcept("coordinator"))("is 403 for %s", async (role) => {
    const res = await queue(req("GET", "/api/queue", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("lists only the signed-in coordinator's own requests still under review", async () => {
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
  it("is 401 without a session", async () => {
    expect((await facilities(req("GET", "/api/facilities"))).status).toBe(401);
  });

  it.each(ROLES)("is readable by %s", async (role) => {
    const token = signIn(user(role));
    const rows = [{ id: "f1", name: "Hearing loop", category: "accessibility" }];
    db.facility.findMany.mockResolvedValue(rows);

    const res = await facilities(req("GET", "/api/facilities", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it("is 403 for a role the app does not know", async () => {
    const res = await facilities(req("GET", "/api/facilities", { token: signIn(user("intern")) }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/equipment/requests", () => {
  it("is 401 without a session", async () => {
    expect((await equipmentRequests(req("GET", "/api/equipment/requests"))).status).toBe(401);
  });

  it.each(rolesExcept("tech_support"))("is 403 for %s", async (role) => {
    const res = await equipmentRequests(req("GET", "/api/equipment/requests", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("gives Technical Support each event with its count of live requests", async () => {
    const token = signIn(user("tech_support"));
    db.event.findMany.mockResolvedValue([
      { sequenceNumber: 12, title: "Gala", status: "planning", _count: { equipmentRequests: 3 } },
    ]);

    const res = await equipmentRequests(req("GET", "/api/equipment/requests", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ sequenceNumber: 12, title: "Gala", status: "planning", requestCount: 3 }]);
  });

  it("lists only events in planning, safety review or confirmed that have a request which is not cancelled", async () => {
    const token = signIn(user("tech_support"));
    db.event.findMany.mockResolvedValue([]);

    await equipmentRequests(req("GET", "/api/equipment/requests", { token }));

    expect(callArg(db.event.findMany).where).toEqual({
      AND: [
        { status: { not: "draft" } },
        // Technical Support sees an event's equipment once planning has begun.
        // SPM-86: and while the Safety Officer checks it.
        { status: { in: ["planning", "safety_review", "safety_cleared", "confirmed"] } },
        { equipmentRequests: { some: { status: { not: "cancelled" } } } },
      ],
    });
  });
});

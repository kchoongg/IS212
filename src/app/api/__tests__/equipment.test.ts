import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/equipment/route";
import { PATCH as recordOutOfService } from "@/app/api/equipment/[id]/out-of-service/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

describe("GET /api/equipment", () => {
  it("is 401 without a session", async () => {
    expect((await GET(req("GET", "/api/equipment"))).status).toBe(401);
  });

  it.each(["attendee", "venue_staff"])("is 403 for %s", async (role) => {
    const res = await GET(req("GET", "/api/equipment", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.equipment.findMany).not.toHaveBeenCalled();
  });

  it.each(["organiser", "coordinator", "ops_manager", "tech_support"])(
    "lists only active equipment for %s",
    async (role) => {
      const token = signIn(user(role));
      const items = [{ id: ID.equipment, name: "Projector", isActive: true }];
      db.equipment.findMany.mockResolvedValue(items);

      const res = await GET(req("GET", "/api/equipment", { token }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(items);
      expect(callArg(db.equipment.findMany).where).toEqual({ isActive: true });
    }
  );

  it("includes retired equipment for Technical Support when asked", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findMany.mockResolvedValue([]);

    await GET(req("GET", "/api/equipment?includeInactive=true", { token }));

    expect(callArg(db.equipment.findMany).where).toBeUndefined();
  });

  it("ignores includeInactive from a role that cannot manage the catalogue", async () => {
    const token = signIn(user("organiser"));
    db.equipment.findMany.mockResolvedValue([]);

    await GET(req("GET", "/api/equipment?includeInactive=true", { token }));

    expect(callArg(db.equipment.findMany).where).toEqual({ isActive: true });
  });
});

describe("POST /api/equipment", () => {
  const valid = { name: "Wireless microphone", category: "audio", totalQuantity: 10, quantityInMaintenance: 2 };

  it("is 401 without a session", async () => {
    expect((await POST(req("POST", "/api/equipment", { body: valid }))).status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "venue_staff", "attendee"])(
    "is 403 for %s",
    async (role) => {
      const res = await POST(req("POST", "/api/equipment", { token: signIn(user(role)), body: valid }));

      expect(res.status).toBe(403);
      expect(db.equipment.create).not.toHaveBeenCalled();
    }
  );

  it("lets Technical Support add an item", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.create.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.equipment, ...data }));

    const res = await POST(req("POST", "/api/equipment", { token, body: valid }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID.equipment, ...valid });
    expect(callArg(db.equipment.create).data).toEqual(valid);
  });

  it("accepts an item with no maintenance figure", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.create.mockResolvedValue({ id: ID.equipment });

    const res = await POST(req("POST", "/api/equipment", { token, body: { name: "Lectern", totalQuantity: 0 } }));

    expect(res.status).toBe(201);
    expect(callArg(db.equipment.create).data).toEqual({ name: "Lectern", totalQuantity: 0 });
  });

  it("refuses more units in maintenance than the item has", async () => {
    const token = signIn(user("tech_support"));

    const res = await POST(
      req("POST", "/api/equipment", { token, body: { ...valid, totalQuantity: 1, quantityInMaintenance: 2 } })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "quantityInMaintenance cannot exceed totalQuantity" });
    expect(db.equipment.create).not.toHaveBeenCalled();
  });

  it("rejects a body that fails validation", async () => {
    const token = signIn(user("tech_support"));

    const res = await POST(req("POST", "/api/equipment", { token, body: { name: "", totalQuantity: -1 } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(Object.keys(body.details.fieldErrors).sort()).toEqual(["name", "totalQuantity"]);
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.create.mockRejectedValue(new Error("connection lost"));

    const res = await POST(req("POST", "/api/equipment", { token, body: valid }));

    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/equipment/[id]/out-of-service", () => {
  const path = `/api/equipment/${ID.equipment}/out-of-service`;
  const context = () => params({ id: ID.equipment });

  it("is 401 without a session", async () => {
    const res = await recordOutOfService(req("PATCH", path, { body: { quantityOutOfService: 1 } }), context());
    expect(res.status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "venue_staff", "attendee"])(
    "is 403 for %s",
    async (role) => {
      const token = signIn(user(role));

      const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 1 } }), context());

      expect(res.status).toBe(403);
      expect(db.equipment.update).not.toHaveBeenCalled();
    }
  );

  it("records the units out of service and the reason", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue({ totalQuantity: 10 });
    db.equipment.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.equipment, ...data }));

    const res = await recordOutOfService(
      req("PATCH", path, { token, body: { quantityOutOfService: 3, reason: "  Cracked lenses " } }),
      context()
    );

    expect(res.status).toBe(200);
    expect(callArg(db.equipment.update)).toEqual({
      where: { id: ID.equipment },
      data: { quantityInMaintenance: 3, outOfServiceReason: "Cracked lenses" },
    });
  });

  it("clears the reason when no units are out of service", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue({ totalQuantity: 10 });
    db.equipment.update.mockResolvedValue({});

    await recordOutOfService(
      req("PATCH", path, { token, body: { quantityOutOfService: 0, reason: "Stale reason" } }),
      context()
    );

    expect(callArg(db.equipment.update).data).toEqual({ quantityInMaintenance: 0, outOfServiceReason: null });
  });

  it("is 404 for equipment that does not exist", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue(null);

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 1 } }), context());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Equipment not found" });
  });

  it("refuses more units out of service than the item has", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue({ totalQuantity: 2 });

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 5 } }), context());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only 2 units in total - cannot mark 5 as out of service" });
    expect(db.equipment.update).not.toHaveBeenCalled();
  });

  it("rejects a negative quantity", async () => {
    const token = signIn(user("tech_support"));

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: -1 } }), context());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockRejectedValue(new Error("connection lost"));

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 1 } }), context());

    expect(res.status).toBe(500);
  });
});

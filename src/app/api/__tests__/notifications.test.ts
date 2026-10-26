// SPM-71 (View Notifications): the signed-in user's own notifications - the
// list, the unread count, and marking one or all as read. A notification is
// personal, so no role permission is involved: being signed in is enough, and
// every query is scoped to the caller (AC7).

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET as list } from "@/app/api/notifications/route";
import { GET as unreadCount } from "@/app/api/notifications/unread-count/route";
import { PATCH as markOne } from "@/app/api/notifications/[id]/route";
import { POST as markAll } from "@/app/api/notifications/read-all/route";
import { ROLES } from "@/lib/roles";
import { callArg, db, eventCompletionSweepOrder, holdExpirySweepOrder, ID, params, req, signIn, user } from "@/test/kit";

const NOTE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE,
    type: "booking_needs_review",
    title: "Booking needs review",
    body: "Orchard Seminar Room was updated.",
    isRead: false,
    createdAt: new Date("2026-10-11T07:30:00.000Z"),
    event: { sequenceNumber: 71, title: "Harbour Lights Gala" },
    ...overrides,
  };
}

describe("GET /api/notifications", () => {
  const get = (token?: string) => list(req("GET", "/api/notifications", { token }));

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
    expect(db.notification.findMany).not.toHaveBeenCalled();
  });

  it.each(ROLES)("[SPM-71][AC1][AC7] lets %s read their own notifications", async (role) => {
    db.notification.findMany.mockResolvedValue([]);

    const res = await get(signIn(user(role)));

    expect(res.status).toBe(200);
    expect(callArg(db.notification.findMany).where).toEqual({ recipientId: ID.user });
  });

  it("[SPM-71][AC1] AC1: asks for them newest first", async () => {
    db.notification.findMany.mockResolvedValue([]);

    await get(signIn(user("coordinator")));

    expect(callArg(db.notification.findMany).orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("[SPM-71][AC2][AC5] AC2, AC5: says what happened, which event and when, and where selecting it goes", async () => {
    db.notification.findMany.mockResolvedValue([row()]);

    const body = await (await get(signIn(user("coordinator")))).json();

    expect(body).toEqual([
      {
        id: NOTE,
        type: "booking_needs_review",
        title: "Booking needs review",
        body: "Orchard Seminar Room was updated.",
        isRead: false,
        createdAt: "2026-10-11T07:30:00.000Z",
        event: { reference: "EVT-000071", title: "Harbour Lights Gala" },
        href: "/events/EVT-000071/venue",
      },
    ]);
  });

  it("[SPM-71][AC2] reads only the event's reference and title - nothing else about it", async () => {
    db.notification.findMany.mockResolvedValue([]);

    await get(signIn(user("coordinator")));

    expect(callArg(db.notification.findMany).select).toEqual({
      id: true,
      type: true,
      title: true,
      body: true,
      isRead: true,
      createdAt: true,
      event: { select: { sequenceNumber: true, title: true } },
    });
  });

  it("[SPM-71][AC2] gives a notification about no event no event and no link", async () => {
    db.notification.findMany.mockResolvedValue([row({ event: null })]);

    const [only] = await (await get(signIn(user("coordinator")))).json();

    expect(only).toMatchObject({ event: null, href: null });
  });

  it("[SPM-71] answers 500 when the database fails", async () => {
    const token = signIn(user("coordinator"));
    db.notification.findMany.mockRejectedValue(new Error("connection lost"));

    expect((await get(token)).status).toBe(500);
  });
});

describe("GET /api/notifications/unread-count", () => {
  const get = (token?: string) => unreadCount(req("GET", "/api/notifications/unread-count", { token }));

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  // SPM-82 (AC9): the count is asked for on every page change, so it is where
  // holds are warned about and expired while anyone is using the app.
  it("[SPM-82][AC9] SPM-82: expires and warns about holds before counting, so a new notice is counted", async () => {
    db.notification.count.mockResolvedValue(0);

    await get(signIn(user("coordinator")));

    expect(holdExpirySweepOrder()).toBeLessThan(db.notification.count.mock.invocationCallOrder[0]);
  });

  // SPM-36 (AC6): and where events 7 days past their end are completed.
  it("[SPM-36][AC6] completes events 7 days past their end on every page", async () => {
    db.notification.count.mockResolvedValue(0);

    await get(signIn(user("attendee")));

    expect(eventCompletionSweepOrder()).toBeLessThan(db.notification.count.mock.invocationCallOrder[0]);
  });

  it("[SPM-71][AC3] AC3: counts the caller's own unread notifications", async () => {
    db.notification.count.mockResolvedValue(3);

    const res = await get(signIn(user("coordinator")));

    expect(await res.json()).toEqual({ unread: 3 });
    expect(callArg(db.notification.count)).toEqual({ where: { recipientId: ID.user, isRead: false } });
  });

  it("[SPM-71] answers 500 when the database fails", async () => {
    const token = signIn(user("coordinator"));
    db.notification.count.mockRejectedValue(new Error("connection lost"));

    expect((await get(token)).status).toBe(500);
  });
});

describe("PATCH /api/notifications/[id]", () => {
  const patch = (token: string | undefined, body: unknown, id = NOTE) =>
    markOne(req("PATCH", `/api/notifications/${id}`, { token, body }), params({ id }));

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await patch(undefined, { isRead: true })).status).toBe(401);
  });

  it("[SPM-71][AC4] AC4: marks the caller's own notification as read", async () => {
    db.notification.updateMany.mockResolvedValue({ count: 1 });

    const res = await patch(signIn(user("coordinator")), { isRead: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: NOTE, isRead: true });
    expect(callArg(db.notification.updateMany)).toEqual({
      where: { id: NOTE, recipientId: ID.user },
      data: { isRead: true },
    });
  });

  it("[SPM-71][AC7] AC7: is 404 for someone else's notification, and changes nothing of theirs", async () => {
    // The ownership check is the update's own where clause, so another
    // user's row is never touched - it simply does not match.
    db.notification.updateMany.mockResolvedValue({ count: 0 });

    const res = await patch(signIn(user("coordinator", { id: ID.otherUser })), { isRead: true });

    expect(res.status).toBe(404);
    expect(callArg(db.notification.updateMany).where).toEqual({ id: NOTE, recipientId: ID.otherUser });
  });

  it.each([
    ["nothing", {}],
    ["isRead false - marking unread is not offered", { isRead: false }],
    ["a string", { isRead: "true" }],
  ])("[SPM-71] refuses a body with %s", async (_case, body) => {
    const res = await patch(signIn(user("coordinator")), body);

    expect(res.status).toBe(400);
    expect(db.notification.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-71] answers 500 when the database fails", async () => {
    const token = signIn(user("coordinator"));
    db.notification.updateMany.mockRejectedValue(new Error("connection lost"));

    expect((await patch(token, { isRead: true })).status).toBe(500);
  });
});

describe("POST /api/notifications/read-all", () => {
  const post = (token?: string) => markAll(req("POST", "/api/notifications/read-all", { token }));

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it("[SPM-71][AC4] AC4: marks every unread notification of the caller's as read, and says how many", async () => {
    db.notification.updateMany.mockResolvedValue({ count: 2 });

    const res = await post(signIn(user("coordinator")));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
    expect(callArg(db.notification.updateMany)).toEqual({
      where: { recipientId: ID.user, isRead: false },
      data: { isRead: true },
    });
  });

  it("[SPM-71] answers 500 when the database fails", async () => {
    const token = signIn(user("coordinator"));
    db.notification.updateMany.mockRejectedValue(new Error("connection lost"));

    expect((await post(token)).status).toBe(500);
  });
});

import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma");

import { PUT } from "@/app/api/events/[id]/coordinator/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";

const opsManager = () => user("ops_manager", { id: ID.user });
const daniel = () => user("coordinator", { id: ID.otherUser, fullName: "Daniel Tan" });
const priya = () => user("coordinator", { id: ID.thirdUser, fullName: "Priya Raj" });

/// A submitted event still waiting for its first coordinator.
function unassigned(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Gala Dinner",
    status: "submitted",
    organiserId: "organiser-id",
    organisationId: ID.org,
    coordinatorId: null,
    coordinator: null,
    ...overrides,
  };
}

/// A live event already coordinated by Daniel.
function assignedToDaniel(overrides: Record<string, unknown> = {}) {
  return unassigned({
    status: "planning",
    coordinatorId: ID.otherUser,
    coordinator: { id: ID.otherUser, fullName: "Daniel Tan" },
    ...overrides,
  });
}

function assign(token: string | undefined, body: unknown, reference = REF) {
  return PUT(req("PUT", `/api/events/${reference}/coordinator`, { token, body }), params({ id: reference }));
}

function givenUpdateSucceeds(result: Record<string, unknown>) {
  db.event.update.mockResolvedValue({ sequenceNumber: 7, ...result });
}

describe("PUT /api/events/[id]/coordinator", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await assign(undefined, { coordinatorId: ID.otherUser })).status).toBe(401);
  });

  it("[SPM-30] is 404 for a malformed reference, without querying", async () => {
    const res = await assign(signIn(opsManager()), { coordinatorId: ID.otherUser }, "nope");

    expect(res.status).toBe(404);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("[SPM-30] is 404 for a reference that matches no event", async () => {
    const token = signIn(opsManager());
    db.event.findUnique.mockResolvedValue(null);

    expect((await assign(token, { coordinatorId: ID.otherUser })).status).toBe(404);
  });

  it("[SPM-30] is 404 for a draft, which even the Ops Manager cannot see", async () => {
    const token = signIn(opsManager(), daniel());
    db.event.findUnique.mockResolvedValue(unassigned({ status: "draft" }));

    const res = await assign(token, { coordinatorId: ID.otherUser });

    expect(res.status).toBe(404);
    expect(db.event.update).not.toHaveBeenCalled();
  });

  // CHANGED (SPM-94 AC2): Venue Staff and Technical Support cannot see a
  // submitted request at all, so for them it is the 404 below, not a 403.
  it.each(["venue_staff", "tech_support"])(
    "[SPM-30][AC1] [SPM-94][AC2] is 404 for %s, who cannot see a submitted request",
    async (role) => {
      const token = signIn(user(role, { id: ID.user }), daniel());
      db.event.findUnique.mockResolvedValue(unassigned());

      const res = await assign(token, { coordinatorId: ID.otherUser });

      expect(res.status).toBe(404);
      expect(db.event.update).not.toHaveBeenCalled();
    }
  );

  it.each(["coordinator"])("[SPM-30][AC1] is 403 for %s", async (role) => {
    const token = signIn(user(role, { id: ID.user }), daniel());
    db.event.findUnique.mockResolvedValue(unassigned());

    const res = await assign(token, { coordinatorId: ID.otherUser });

    expect(res.status).toBe(403);
    // CHANGED (SPM-84 AC1): the role is now the Event Coordinator Lead.
    expect(await res.json()).toEqual({ error: "Only the Event Coordinator Lead can assign coordinators" });
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("[SPM-30][AC1] is 403 for the organiser who raised the event", async () => {
    const token = signIn(user("organiser", { id: "organiser-id" }), daniel());
    db.event.findUnique.mockResolvedValue(unassigned());

    expect((await assign(token, { coordinatorId: ID.otherUser })).status).toBe(403);
  });

  describe("first assignment", () => {
    it("[SPM-30][AC1][AC3] assigns the coordinator and moves the event to under review", async () => {
      const token = signIn(opsManager(), daniel());
      db.event.findUnique.mockResolvedValue(unassigned());
      givenUpdateSucceeds({ status: "under_review", coordinator: { id: ID.otherUser, fullName: "Daniel Tan" } });

      const res = await assign(token, { coordinatorId: ID.otherUser });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        sequenceNumber: 7,
        status: "under_review",
        coordinator: { id: ID.otherUser, fullName: "Daniel Tan" },
        previousCoordinator: null,
      });
      expect(callArg(db.event.update).data).toEqual({ coordinatorId: ID.otherUser, status: "under_review" });
    });

    it("[SPM-30][AC1] only writes if the event is still unassigned and submitted, so two Ops Managers cannot overwrite each other", async () => {
      const token = signIn(opsManager(), daniel());
      db.event.findUnique.mockResolvedValue(unassigned());
      givenUpdateSucceeds({});

      await assign(token, { coordinatorId: ID.otherUser });

      expect(callArg(db.event.update).where).toEqual({ id: ID.event, coordinatorId: null, status: "submitted" });
    });

    it("[SPM-30][AC3] records the status move in the history, naming the coordinator", async () => {
      const token = signIn(opsManager(), daniel());
      db.event.findUnique.mockResolvedValue(unassigned());
      givenUpdateSucceeds({});

      await assign(token, { coordinatorId: ID.otherUser });

      expect(callArg(db.eventStatusHistory.create).data).toEqual({
        eventId: ID.event,
        fromStatus: "submitted",
        toStatus: "under_review",
        changedBy: ID.user,
        reason: "Coordinator assigned: Daniel Tan",
      });
    });

    it("[SPM-53][AC5][AC6] notifies the new coordinator and the organiser, and nobody else", async () => {
      const token = signIn(opsManager(), daniel());
      db.event.findUnique.mockResolvedValue(unassigned());
      givenUpdateSucceeds({});

      await assign(token, { coordinatorId: ID.otherUser });

      expect(db.notification.create).toHaveBeenCalledTimes(2);
      expect(callArg(db.notification.create, 1).data).toEqual({
        recipientId: "organiser-id",
        type: "event_coordinator_assigned",
        title: "Coordinator assigned",
        body: 'Daniel Tan is now the coordinator for "Gala Dinner".',
        eventId: ID.event,
      });
      expect(callArg(db.notification.create, 0).data).toEqual({
        recipientId: ID.otherUser,
        type: "coordinator_assigned",
        title: "You have been assigned an event",
        body: 'You are now the coordinator for "Gala Dinner".',
        eventId: ID.event,
      });
    });

    it("[SPM-53][AC6] names an event with no title as 'Untitled event' in the notification", async () => {
      const token = signIn(opsManager(), daniel());
      db.event.findUnique.mockResolvedValue(unassigned({ title: null }));
      givenUpdateSucceeds({});

      await assign(token, { coordinatorId: ID.otherUser });

      expect(callArg(db.notification.create).data.body).toBe('You are now the coordinator for "Untitled event".');
    });

    it.each(["under_review", "approved", "planning", "confirmed", "completed", "cancelled", "rejected"])(
      "[SPM-30][AC1] refuses an unassigned event that is %s rather than submitted",
      async (status) => {
        const token = signIn(opsManager(), daniel());
        db.event.findUnique.mockResolvedValue(unassigned({ status }));

        const res = await assign(token, { coordinatorId: ID.otherUser });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/^Only a submitted event can be assigned a coordinator\. This event is /);
        expect(db.event.update).not.toHaveBeenCalled();
      }
    );
  });

  describe("reassignment", () => {
    it("[SPM-30][AC6] hands a live event to another coordinator without changing its status", async () => {
      const token = signIn(opsManager(), daniel(), priya());
      db.event.findUnique.mockResolvedValue(assignedToDaniel());
      givenUpdateSucceeds({ status: "planning", coordinator: { id: ID.thirdUser, fullName: "Priya Raj" } });

      const res = await assign(token, { coordinatorId: ID.thirdUser });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        sequenceNumber: 7,
        status: "planning",
        coordinator: { id: ID.thirdUser, fullName: "Priya Raj" },
        previousCoordinator: { id: ID.otherUser, fullName: "Daniel Tan" },
      });
      expect(callArg(db.event.update)).toMatchObject({
        where: { id: ID.event, coordinatorId: ID.otherUser, status: "planning" },
        data: { coordinatorId: ID.thirdUser },
      });
      expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    });

    it("[SPM-53][AC7] notifies the new coordinator, the organiser and the one who was replaced", async () => {
      const token = signIn(opsManager(), daniel(), priya());
      db.event.findUnique.mockResolvedValue(assignedToDaniel());
      givenUpdateSucceeds({});

      await assign(token, { coordinatorId: ID.thirdUser });

      expect(db.notification.create).toHaveBeenCalledTimes(3);
      expect(callArg(db.notification.create, 2).data).toEqual({
        recipientId: "organiser-id",
        type: "event_coordinator_assigned",
        title: "Coordinator assigned",
        body: 'Priya Raj is now the coordinator for "Gala Dinner".',
        eventId: ID.event,
      });
      expect(callArg(db.notification.create, 0).data).toMatchObject({
        recipientId: ID.thirdUser,
        type: "coordinator_assigned",
      });
      expect(callArg(db.notification.create, 1).data).toEqual({
        recipientId: ID.otherUser,
        type: "coordinator_unassigned",
        title: "An event has been reassigned",
        body: '"Gala Dinner" has been reassigned to Priya Raj. You are no longer its coordinator.',
        eventId: ID.event,
      });
    });

    it.each(["under_review", "approved", "planning", "confirmed", "postponed"])(
      "[SPM-30][AC6] is allowed while the event is %s",
      async (status) => {
        const token = signIn(opsManager(), daniel(), priya());
        db.event.findUnique.mockResolvedValue(assignedToDaniel({ status }));
        givenUpdateSucceeds({});

        expect((await assign(token, { coordinatorId: ID.thirdUser })).status).toBe(200);
      }
    );

    it.each([
      ["completed", "Completed"],
      ["cancelled", "Cancelled"],
      ["rejected", "Rejected"],
    ])("[SPM-30][AC6] is refused once the event is %s", async (status, label) => {
      const token = signIn(opsManager(), daniel(), priya());
      db.event.findUnique.mockResolvedValue(assignedToDaniel({ status }));

      const res = await assign(token, { coordinatorId: ID.thirdUser });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: `This event is ${label} and its coordinator can no longer be changed.`,
      });
    });

    it("[SPM-30][AC6] refuses reassigning to the coordinator who already has it", async () => {
      const token = signIn(opsManager(), daniel());
      db.event.findUnique.mockResolvedValue(assignedToDaniel());

      const res = await assign(token, { coordinatorId: ID.otherUser });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Daniel Tan is already the assigned coordinator." });
      expect(db.event.update).not.toHaveBeenCalled();
    });
  });

  it("[SPM-30][AC6] still refuses a no-op reassignment when the current coordinator's name cannot be read", async () => {
    const token = signIn(opsManager(), daniel());
    db.event.findUnique.mockResolvedValue(assignedToDaniel({ coordinator: null }));

    const res = await assign(token, { coordinatorId: ID.otherUser });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This person is already the assigned coordinator." });
  });

  it("[SPM-59][AC4] a withdrawn request can no longer be given another coordinator", async () => {
    const token = signIn(opsManager(), daniel(), priya());
    db.event.findUnique.mockResolvedValue(assignedToDaniel({ status: "withdrawn" }));

    const res = await assign(token, { coordinatorId: ID.thirdUser });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This event is Withdrawn and its coordinator can no longer be changed." });
    expect(db.event.update).not.toHaveBeenCalled();
  });

  describe("who can be chosen", () => {
    const refusal = {
      error: "Choose an active Event Coordinator.",
      details: { fieldErrors: { coordinatorId: ["Choose an active Event Coordinator."] } },
    };

    it("[SPM-30][AC1] refuses an id that belongs to nobody", async () => {
      const token = signIn(opsManager());
      db.event.findUnique.mockResolvedValue(unassigned());

      const res = await assign(token, { coordinatorId: ID.otherUser });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(refusal);
    });

    it.each(["organiser", "ops_manager", "venue_staff", "tech_support", "attendee"])(
      "[SPM-30][AC1] refuses a %s - only an Event Coordinator can be assigned",
      async (role) => {
        const token = signIn(opsManager(), user(role, { id: ID.otherUser }));
        db.event.findUnique.mockResolvedValue(unassigned());

        const res = await assign(token, { coordinatorId: ID.otherUser });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(refusal);
        expect(db.event.update).not.toHaveBeenCalled();
      }
    );

    it("[SPM-30][AC1] refuses a deactivated coordinator", async () => {
      const token = signIn(opsManager(), { ...daniel(), isActive: false });
      db.event.findUnique.mockResolvedValue(unassigned());

      const res = await assign(token, { coordinatorId: ID.otherUser });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(refusal);
    });

    it.each([{}, { coordinatorId: "" }, { coordinatorId: "daniel" }])("[SPM-30][AC1] rejects the body %j", async (body) => {
      const token = signIn(opsManager());
      db.event.findUnique.mockResolvedValue(unassigned());

      const res = await assign(token, body);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe("Choose a coordinator.");
      expect(json.details.fieldErrors).toHaveProperty("coordinatorId");
    });
  });

  it("[SPM-30][AC1] is 409 when someone else changed the coordinator in the meantime", async () => {
    const token = signIn(opsManager(), daniel());
    db.event.findUnique.mockResolvedValue(unassigned());
    db.event.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record to update not found", { code: "P2025", clientVersion: "test" })
    );

    const res = await assign(token, { coordinatorId: ID.otherUser });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Someone else changed this event's coordinator/);
  });

  it("[SPM-30] answers 500 when the database fails", async () => {
    const token = signIn(opsManager(), daniel());
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await assign(token, { coordinatorId: ID.otherUser })).status).toBe(500);
  });
});

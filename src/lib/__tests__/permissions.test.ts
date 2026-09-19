import { describe, it, expect } from "vitest";
import { ROLES } from "../roles";
import {
  ACTIONS,
  ROLE_PERMISSIONS,
  STATUS_TRANSITION_ROLES,
  can,
  canEditEventContent,
  canManageEquipmentRequests,
  canSetEventStatus,
  canViewEquipmentRequests,
  canViewEvent,
  eventListWhere,
  isAssignedCoordinator,
  ownsEvent,
  sharesOrganisation,
  visibleEventFor,
  type Actor,
  type EventAccessFields,
} from "../permissions";

// Traces to SPM-4 (role and permission model) and, through it, to the
// customer briefing:
//   §8b  "Access should depend on the user's role and relationship to an
//        event. For example, an Event Organiser should not normally be able
//        to view events belonging to unrelated clients, and an Attendee
//        should not be able to view internal planning information."
//   §5   the fourteen-step process, which says who performs each step.
// Week 4 core feature 1: "Users should only be able to view or modify
// information appropriate to their role and relationship to an event."

const CLIENT_A = "org-a";
const CLIENT_B = "org-b";

function actor(role: string, id = `${role}-1`, organisationId: string | null = null): Actor {
  return { id, role, organisationId };
}

function event(over: Partial<EventAccessFields> = {}): EventAccessFields {
  return {
    organiserId: "organiser-1",
    organisationId: CLIENT_A,
    coordinatorId: null,
    status: "submitted",
    registrationEnabled: false,
    ...over,
  };
}

const organiserA = actor("organiser", "organiser-1", CLIENT_A);
const colleagueA = actor("organiser", "organiser-2", CLIENT_A);
const organiserB = actor("organiser", "organiser-9", CLIENT_B);
const coordinator = actor("coordinator", "coordinator-1");
const otherCoordinator = actor("coordinator", "coordinator-2");
const opsManager = actor("ops_manager");
const venueStaff = actor("venue_staff");
const techSupport = actor("tech_support");
const attendee = actor("attendee");

describe("the role matrix", () => {
  it("grants every role a defined, non-empty set of permissions", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it("grants only actions that exist", () => {
    for (const role of ROLES) {
      for (const action of ROLE_PERMISSIONS[role]) {
        expect(ACTIONS).toContain(action);
      }
    }
  });

  it("grants nothing at all to an unknown role", () => {
    for (const action of ACTIONS) {
      expect(can("future_role", action)).toBe(false);
    }
  });

  it("puts each planning decision with the role the briefing gives it", () => {
    // §5 Step 1-2: the organiser raises and owns the request.
    expect(can("organiser", "event:create")).toBe(true);
    expect(can("coordinator", "event:create")).toBe(false);
    expect(can("attendee", "event:create")).toBe(false);

    // §5 Step 3: assignment is the Ops Manager's.
    expect(can("ops_manager", "event:assign_coordinator")).toBe(true);
    expect(can("coordinator", "event:assign_coordinator")).toBe(false);

    // §5 Steps 5 and 10: review and confirmation are the coordinator's.
    expect(can("coordinator", "event:review")).toBe(true);
    expect(can("coordinator", "event:confirm")).toBe(true);
    expect(can("organiser", "event:review")).toBe(false);
    expect(can("venue_staff", "event:review")).toBe(false);

    // §5 Step 7: Venue Staff decide bookings; §5 Step 8: Technical Support
    // decides equipment. Neither decides the other's.
    expect(can("venue_staff", "venue_booking:decide")).toBe(true);
    expect(can("coordinator", "venue_booking:decide")).toBe(false);
    expect(can("tech_support", "equipment_request:review")).toBe(true);
    expect(can("venue_staff", "equipment_request:review")).toBe(false);

    // SPM-47: recording the requirements themselves is the coordinator's job,
    // same footing as requesting a venue booking — separate from Technical
    // Support's equipment_request:review above.
    expect(can("coordinator", "equipment_request:manage")).toBe(true);
    expect(can("organiser", "equipment_request:manage")).toBe(false);
    expect(can("tech_support", "equipment_request:manage")).toBe(false);

    // §5 Step 11: only an attendee registers.
    expect(can("attendee", "registration:create")).toBe(true);
    expect(can("organiser", "registration:create")).toBe(false);
    expect(can("coordinator", "registration:create")).toBe(false);
  });

  it("keeps the venue catalogue internal but the equipment catalogue open to organisers", () => {
    // The event request form asks the organiser to pick equipment, so they
    // must be able to read that catalogue; venue selection is not theirs.
    expect(can("organiser", "equipment:view")).toBe(true);
    expect(can("organiser", "venue:view")).toBe(false);
    expect(can("attendee", "venue:view")).toBe(false);
    expect(can("attendee", "equipment:view")).toBe(false);
    expect(can("coordinator", "venue:view")).toBe(true);
  });

  it("lets no role write a catalogue it does not own", () => {
    for (const role of ROLES) {
      if (role !== "venue_staff") expect(can(role, "venue:manage")).toBe(false);
      if (role !== "tech_support") expect(can(role, "equipment:manage")).toBe(false);
    }
  });
});

describe("relationship to an event", () => {
  it("recognises the organiser who raised it", () => {
    expect(ownsEvent(organiserA, event())).toBe(true);
    expect(ownsEvent(colleagueA, event())).toBe(false);
  });

  it("recognises a colleague at the same client", () => {
    expect(sharesOrganisation(colleagueA, event())).toBe(true);
    expect(sharesOrganisation(organiserB, event())).toBe(false);
  });

  it("does not treat two users without an organisation as colleagues", () => {
    // Internal staff have no organisationId. Null must never match null.
    expect(sharesOrganisation(coordinator, event({ organisationId: null }))).toBe(false);
  });

  it("lets the assigned coordinator act, and lets any coordinator pick up an unassigned event", () => {
    expect(isAssignedCoordinator(coordinator, event({ coordinatorId: "coordinator-1" }))).toBe(true);
    expect(isAssignedCoordinator(otherCoordinator, event({ coordinatorId: "coordinator-1" }))).toBe(
      false
    );
    expect(isAssignedCoordinator(coordinator, event({ coordinatorId: null }))).toBe(true);
  });
});

describe("canViewEvent", () => {
  it("keeps a draft private to the organiser who owns it — from everyone", () => {
    const draft = event({ status: "draft" });
    expect(canViewEvent(organiserA, draft)).toBe(true);
    // Not a colleague at the same client, and not ConnectSphere staff either.
    for (const other of [colleagueA, organiserB, coordinator, opsManager, venueStaff, techSupport, attendee]) {
      expect(canViewEvent(other, draft)).toBe(false);
    }
  });

  it("hides another client's event from an organiser (§8b, first example)", () => {
    const clientAEvent = event({ status: "confirmed" });
    expect(canViewEvent(organiserA, clientAEvent)).toBe(true);
    expect(canViewEvent(colleagueA, clientAEvent)).toBe(true);
    expect(canViewEvent(organiserB, clientAEvent)).toBe(false);
  });

  it("shows an organiser with no organisation only their own events", () => {
    const loose = actor("organiser", "organiser-7", null);
    expect(canViewEvent(loose, event({ organiserId: "organiser-7" }))).toBe(true);
    expect(canViewEvent(loose, event({ organisationId: null }))).toBe(false);
  });

  it("shows an attendee only confirmed events that are open for registration", () => {
    expect(canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: true }))).toBe(true);
    expect(canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: false }))).toBe(false);
    expect(canViewEvent(attendee, event({ status: "planning", registrationEnabled: true }))).toBe(false);
    expect(canViewEvent(attendee, event({ status: "rejected", registrationEnabled: true }))).toBe(false);
  });

  it("shows internal staff every event that has left draft", () => {
    for (const staff of [coordinator, opsManager, venueStaff, techSupport]) {
      expect(canViewEvent(staff, event({ status: "submitted" }))).toBe(true);
      expect(canViewEvent(staff, event({ status: "confirmed" }))).toBe(true);
    }
  });
});

describe("eventListWhere", () => {
  it("agrees with canViewEvent about drafts", () => {
    // The list filter and the single-record check are the same rule written
    // twice (one for Prisma, one for objects); this is the cheap guard that
    // they have not drifted.
    const where = eventListWhere(coordinator) as { status: { not: string } };
    expect(where.status.not).toBe("draft");
  });

  it("gives an organiser their own events plus their client's submitted ones", () => {
    const where = eventListWhere(organiserA) as { OR: Record<string, unknown>[] };
    expect(where.OR).toEqual([
      { organiserId: "organiser-1" },
      { organisationId: CLIENT_A, status: { not: "draft" } },
    ]);
  });

  it("gives an organiser with no organisation only their own events", () => {
    const where = eventListWhere(actor("organiser", "organiser-7", null)) as {
      OR: Record<string, unknown>[];
    };
    expect(where.OR).toEqual([{ organiserId: "organiser-7" }]);
  });

  it("gives an attendee only confirmed, registerable events", () => {
    expect(eventListWhere(attendee)).toEqual({ status: "confirmed", registrationEnabled: true });
  });

  it("matches nothing for a role that cannot view events at all", () => {
    const where = eventListWhere(actor("future_role")) as { id: { equals: string } };
    expect(where.id.equals).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("canEditEventContent", () => {
  it("lets the owning organiser edit their own draft", () => {
    expect(canEditEventContent(organiserA, event({ status: "draft" }))).toBe(true);
  });

  it("stops the edit once the draft has been submitted", () => {
    // Past draft, changes belong to EventChangeRequest (SPM-24).
    for (const status of ["submitted", "under_review", "approved", "confirmed"]) {
      expect(canEditEventContent(organiserA, event({ status }))).toBe(false);
    }
  });

  it("stops everyone else, including a colleague at the same client", () => {
    const draft = event({ status: "draft" });
    for (const other of [colleagueA, organiserB, coordinator, opsManager, attendee]) {
      expect(canEditEventContent(other, draft)).toBe(false);
    }
  });
});

describe("canManageEquipmentRequests", () => {
  it("lets the assigned coordinator manage equipment on their event", () => {
    const mine = event({ status: "planning", coordinatorId: "coordinator-1" });
    expect(canManageEquipmentRequests(coordinator, mine)).toBe(true);
  });

  it("lets any coordinator pick up an event with no coordinator yet", () => {
    expect(canManageEquipmentRequests(coordinator, event({ coordinatorId: null }))).toBe(true);
  });

  it("stops a coordinator managing equipment on a colleague's event", () => {
    const theirs = event({ coordinatorId: "coordinator-1" });
    expect(canManageEquipmentRequests(otherCoordinator, theirs)).toBe(false);
  });

  it("is not restricted to draft — equipment planning happens well past it", () => {
    // Unlike canEditEventContent, which is draft-only.
    const mine = { coordinatorId: "coordinator-1" };
    for (const status of ["planning", "confirmed", "postponed"]) {
      expect(canManageEquipmentRequests(coordinator, event({ ...mine, status }))).toBe(true);
    }
  });

  it("stops every other role, including the organiser who owns the event", () => {
    const draft = event({ status: "draft" });
    for (const other of [organiserA, opsManager, venueStaff, techSupport, attendee]) {
      expect(canManageEquipmentRequests(other, draft)).toBe(false);
    }
  });
});

describe("canViewEquipmentRequests", () => {
  it("lets Technical Support view any event's equipment, assigned or not", () => {
    expect(canViewEquipmentRequests(techSupport, event({ coordinatorId: "coordinator-1" }))).toBe(
      true
    );
  });

  it("lets the assigned coordinator view it — because managing it requires seeing it", () => {
    const mine = event({ coordinatorId: "coordinator-1" });
    expect(canViewEquipmentRequests(coordinator, mine)).toBe(true);
  });

  it("stops a coordinator viewing equipment on a colleague's event", () => {
    const theirs = event({ coordinatorId: "coordinator-1" });
    expect(canViewEquipmentRequests(otherCoordinator, theirs)).toBe(false);
  });

  it("lets the owning organiser view their own event's equipment read-only", () => {
    // Broader than AC6's literal wording (Technical Support only), confirmed
    // 2026-09-19 as intended — an Organiser should be able to see what's
    // been recorded against the event they raised.
    expect(canViewEquipmentRequests(organiserA, event())).toBe(true);
  });

  it("stops an organiser viewing equipment on an event they don't own", () => {
    expect(canViewEquipmentRequests(organiserB, event())).toBe(false);
    expect(canViewEquipmentRequests(colleagueA, event())).toBe(false);
  });

  it("stops every other role", () => {
    for (const other of [opsManager, venueStaff, attendee]) {
      expect(canViewEquipmentRequests(other, event())).toBe(false);
    }
  });
});

describe("canSetEventStatus", () => {
  it("lets the owning organiser submit their own request (§5 Step 2)", () => {
    const draft = event({ status: "draft" });
    expect(canSetEventStatus(organiserA, draft, "submitted")).toBe(true);
    expect(canSetEventStatus(colleagueA, draft, "submitted")).toBe(false);
  });

  it("stops an attendee confirming or rejecting an event", () => {
    // This was the open hole before the permission model: any authenticated
    // user could drive an event's status once it had left draft.
    const submitted = event({ status: "submitted" });
    for (const status of ["under_review", "approved", "rejected", "planning", "confirmed", "completed"]) {
      expect(canSetEventStatus(attendee, submitted, status)).toBe(false);
    }
  });

  it("stops an organiser approving their own event", () => {
    const underReview = event({ status: "under_review" });
    expect(canSetEventStatus(organiserA, underReview, "approved")).toBe(false);
    expect(canSetEventStatus(organiserA, underReview, "confirmed")).toBe(false);
  });

  it("lets the assigned coordinator approve, reject and confirm", () => {
    const mine = event({ status: "under_review", coordinatorId: "coordinator-1" });
    for (const status of ["approved", "rejected", "planning", "confirmed", "completed"]) {
      expect(canSetEventStatus(coordinator, mine, status)).toBe(true);
    }
  });

  it("stops a coordinator deciding an event assigned to a colleague", () => {
    const theirs = event({ status: "under_review", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(otherCoordinator, theirs, "approved")).toBe(false);
    expect(canSetEventStatus(otherCoordinator, theirs, "rejected")).toBe(false);
  });

  it("keeps Venue Staff and Technical Support out of the event lifecycle", () => {
    const submitted = event({ status: "submitted" });
    for (const status of Object.keys(STATUS_TRANSITION_ROLES)) {
      expect(canSetEventStatus(venueStaff, submitted, status)).toBe(false);
      expect(canSetEventStatus(techSupport, submitted, status)).toBe(false);
    }
  });

  it("lets either side cancel, but only for their own event", () => {
    const confirmed = event({ status: "confirmed", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(organiserA, confirmed, "cancelled")).toBe(true);
    expect(canSetEventStatus(coordinator, confirmed, "cancelled")).toBe(true);
    expect(canSetEventStatus(organiserB, confirmed, "cancelled")).toBe(false);
    expect(canSetEventStatus(otherCoordinator, confirmed, "cancelled")).toBe(false);
  });

  it("refuses a status nobody owns rather than defaulting to allow", () => {
    expect(canSetEventStatus(coordinator, event(), "deleted")).toBe(false);
    expect(canSetEventStatus(coordinator, event(), "")).toBe(false);
  });
});

describe("visibleEventFor", () => {
  const full = {
    id: "e1",
    title: "Annual conference",
    description: "Two days",
    category: "conference",
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: "2026-10-02T17:00:00.000Z",
    status: "confirmed",
    registrationEnabled: true,
    registrationCapacity: 200,
    registrationOpensAt: null,
    registrationClosesAt: null,
    // Internal planning information:
    organiserId: "organiser-1",
    organisationId: CLIENT_A,
    coordinatorId: "coordinator-1",
    expectedAttendance: 180,
    specialRequirements: "CEO arrives by private entrance",
    accessibilityNotes: "Hearing loop in hall B",
    rejectionReason: null,
    cancellationReason: null,
    equipmentRequests: [{ id: "eq1" }],
    facilityRequirements: [{ facilityId: "f1" }],
  };

  it("withholds internal planning information from an attendee (§8b, second example)", () => {
    const visible = visibleEventFor(attendee, full);
    for (const hidden of [
      "coordinatorId",
      "organiserId",
      "organisationId",
      "expectedAttendance",
      "specialRequirements",
      "accessibilityNotes",
      "rejectionReason",
      "cancellationReason",
      "equipmentRequests",
      "facilityRequirements",
    ]) {
      expect(visible).not.toHaveProperty(hidden);
    }
  });

  it("still tells an attendee what they need in order to register", () => {
    const visible = visibleEventFor(attendee, full);
    expect(visible.title).toBe("Annual conference");
    expect(visible.startsAt).toBe("2026-10-01T09:00:00.000Z");
    expect(visible.status).toBe("confirmed");
    expect(visible.registrationCapacity).toBe(200);
  });

  it("does not narrow the record for anyone else", () => {
    for (const other of [organiserA, coordinator, opsManager, venueStaff, techSupport]) {
      expect(visibleEventFor(other, full)).toBe(full);
    }
  });
});

import { describe, it, expect } from "vitest";
import { ROLES } from "../roles";
import {
  ACTIONS,
  ROLE_PERMISSIONS,
  REASSIGNABLE_STATUSES,
  REVIEWABLE_STATUSES,
  REVIEW_OUTCOMES,
  STATUS_TRANSITION_ROLES,
  can,
  canAssignCoordinator,
  canBeginPlanning,
  canConfigureRegistration,
  canConfirmEvent,
  canUpdateEventInformation,
  canReviewEvent,
  canCheckEquipmentAvailability,
  canReserveEquipment,
  canUpdateEquipmentFulfilment,
  canRequestVenueBooking,
  canEditEventContent,
  canManageEquipmentRequests,
  canSetEventStatus,
  canSubmitForSafetyCheck,
  canRecordSafetyDecision,
  canViewEquipmentRequests,
  canViewRegistrationList,
  techSupportSeesEquipment,
  TECH_SUPPORT_EQUIPMENT_STATUSES,
  canWithdrawEvent,
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

  it("SPM-55: shows equipment's operational status to internal staff only", () => {
    for (const role of ["coordinator", "ops_manager", "tech_support"]) {
      expect(can(role, "equipment:view_status"), role).toBe(true);
    }
    // The organiser may pick from the catalogue (equipment:view) but not see
    // what is out of service, or why.
    for (const role of ["organiser", "venue_staff", "attendee"]) {
      expect(can(role, "equipment:view_status"), role).toBe(false);
    }
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

  it("lets only the assigned coordinator act", () => {
    expect(isAssignedCoordinator(coordinator, event({ coordinatorId: "coordinator-1" }))).toBe(true);
    expect(isAssignedCoordinator(otherCoordinator, event({ coordinatorId: "coordinator-1" }))).toBe(
      false
    );
  });

  // SPM-30 (confirmed 2026-09-28): the "any coordinator may pick up an
  // unassigned event" allowance is gone now that the Ops Manager assigns.
  it("gives no coordinator an event nobody has been assigned to yet", () => {
    expect(isAssignedCoordinator(coordinator, event({ coordinatorId: null }))).toBe(false);
    expect(isAssignedCoordinator(otherCoordinator, event({ coordinatorId: null }))).toBe(false);
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

  // SPM-64 (#10: attendees "can view events that they register for"):
  // turning registration off must not hide the event from the people already
  // holding a place. Manual case SPM-64-TC22.
  it("keeps showing a confirmed event to an attendee who holds a place after registration is turned off", () => {
    expect(
      canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: false, attendeeHoldsPlace: true }))
    ).toBe(true);
  });

  it("doesn't show it to an attendee who holds no place (withdrawn, or never registered)", () => {
    expect(
      canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: false, attendeeHoldsPlace: false }))
    ).toBe(false);
  });

  it("still hides an event that is not confirmed from an attendee who holds a place", () => {
    expect(
      canViewEvent(attendee, event({ status: "planning", registrationEnabled: false, attendeeHoldsPlace: true }))
    ).toBe(false);
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

  // CHANGED (SPM-64, #10): plus the confirmed events they hold a place in.
  it("gives an attendee confirmed events open for registration, or that they hold a place in", () => {
    expect(eventListWhere(attendee)).toEqual({
      status: "confirmed",
      OR: [
        { registrationEnabled: true },
        { registrations: { some: { attendeeId: "attendee-1", status: { in: ["registered", "waitlisted"] } } } },
      ],
    });
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

  it("stops every coordinator on an event with no coordinator yet (SPM-30)", () => {
    expect(canManageEquipmentRequests(coordinator, event({ coordinatorId: null }))).toBe(false);
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

describe("canAssignCoordinator (SPM-30)", () => {
  it("lets the Ops Manager assign a submitted event that has no coordinator", () => {
    expect(canAssignCoordinator(opsManager, event({ status: "submitted", coordinatorId: null }))).toBe(true);
  });

  it("lets the Ops Manager reassign a live event", () => {
    for (const status of REASSIGNABLE_STATUSES) {
      expect(canAssignCoordinator(opsManager, event({ status, coordinatorId: "coordinator-1" }))).toBe(true);
    }
  });

  it("does not reassign a completed, cancelled or rejected event", () => {
    for (const status of ["completed", "cancelled", "rejected"]) {
      expect(canAssignCoordinator(opsManager, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
  });

  it("does not assign a draft, or a live event somehow left without one", () => {
    expect(canAssignCoordinator(opsManager, event({ status: "draft" }))).toBe(false);
    expect(canAssignCoordinator(opsManager, event({ status: "planning", coordinatorId: null }))).toBe(false);
  });

  it("stops every other role, including coordinators and the owning organiser (#94, #101)", () => {
    const submitted = event({ status: "submitted" });
    const live = event({ status: "under_review", coordinatorId: "coordinator-1" });
    for (const other of [coordinator, otherCoordinator, organiserA, venueStaff, techSupport, attendee]) {
      expect(canAssignCoordinator(other, submitted)).toBe(false);
      expect(canAssignCoordinator(other, live)).toBe(false);
    }
  });
});

describe("canReviewEvent (SPM-28)", () => {
  const underReview = event({ status: "under_review", coordinatorId: "coordinator-1" });

  it("lets the assigned coordinator review a request that is under review", () => {
    expect(canReviewEvent(coordinator, underReview)).toBe(true);
  });

  it("stops a coordinator the request is not assigned to", () => {
    expect(canReviewEvent(otherCoordinator, underReview)).toBe(false);
  });

  it("stops every other role, including the owning organiser", () => {
    for (const other of [organiserA, opsManager, venueStaff, techSupport, attendee]) {
      expect(canReviewEvent(other, underReview)).toBe(false);
    }
  });

  it("only while under review - a decided or earlier request has nothing to review", () => {
    for (const status of ["draft", "submitted", "approved", "planning", "confirmed", "rejected", "cancelled"]) {
      expect(canReviewEvent(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
    expect(REVIEWABLE_STATUSES).toEqual(["under_review"]);
  });

  it("review outcomes are exactly approve and reject, both the coordinator's", () => {
    expect(REVIEW_OUTCOMES).toEqual(["approved", "rejected"]);
    for (const outcome of REVIEW_OUTCOMES) {
      expect(STATUS_TRANSITION_ROLES[outcome]).toEqual(["coordinator"]);
    }
  });
});

describe("canCheckEquipmentAvailability (SPM-48)", () => {
  it("lets Technical Support check equipment availability", () => {
    expect(canCheckEquipmentAvailability(techSupport)).toBe(true);
  });

  it("stops everyone else - the result names other events' bookings", () => {
    expect(canCheckEquipmentAvailability(coordinator)).toBe(false);
    expect(canCheckEquipmentAvailability(organiserA)).toBe(false);
  });
});

describe("canReserveEquipment (SPM-49)", () => {
  it("lets Technical Support reserve equipment", () => {
    expect(canReserveEquipment(techSupport)).toBe(true);
  });

  it("stops a Coordinator or Organiser from reserving", () => {
    expect(canReserveEquipment(coordinator)).toBe(false);
    expect(canReserveEquipment(organiserA)).toBe(false);
  });
});

describe("canUpdateEquipmentFulfilment (SPM-50)", () => {
  it("lets Technical Support update fulfilment status and technical notes", () => {
    expect(canUpdateEquipmentFulfilment(techSupport)).toBe(true);
  });

  it("SPM-50-TC12: stops a Coordinator or Organiser from updating them", () => {
    expect(canUpdateEquipmentFulfilment(coordinator)).toBe(false);
    expect(canUpdateEquipmentFulfilment(organiserA)).toBe(false);
  });
});

describe("canRequestVenueBooking (SPM-42)", () => {
  it("SPM-42-TC01: the assigned coordinator can request a venue booking", () => {
    expect(canRequestVenueBooking(coordinator, event({ status: "approved", coordinatorId: "coordinator-1" }))).toBe(true);
  });

  it("SPM-42-TC12: a coordinator cannot request a booking for an event not assigned to them", () => {
    expect(canRequestVenueBooking(otherCoordinator, event({ coordinatorId: "coordinator-1" }))).toBe(false);
    expect(canRequestVenueBooking(coordinator, event({ coordinatorId: null }))).toBe(false);
  });

  it("SPM-42-TC12: no other role can request a venue booking", () => {
    const assigned = event({ status: "approved", coordinatorId: "coordinator-1" });
    for (const other of [organiserA, opsManager, venueStaff, techSupport, attendee]) {
      expect(canRequestVenueBooking(other, assigned)).toBe(false);
    }
  });
});

describe("canViewEquipmentRequests", () => {
  it("lets Technical Support view the equipment of any event in planning or confirmed, assigned or not", () => {
    for (const status of ["planning", "confirmed"]) {
      expect(canViewEquipmentRequests(techSupport, event({ coordinatorId: "coordinator-1", status }))).toBe(true);
    }
  });

  it("hides an event's equipment from Technical Support before planning and after it ends (BPMN)", () => {
    for (const status of ["submitted", "under_review", "approved", "postponed", "cancelled", "rejected", "completed", "withdrawn"]) {
      expect(canViewEquipmentRequests(techSupport, event({ coordinatorId: "coordinator-1", status }))).toBe(false);
    }
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

  // Customer clarification, 2026-09-18: cancelling is the Event Coordinator's
  // decision and nobody else's. It releases the venue and the equipment and
  // drops the attendee list, so the organiser who owns the event cannot do it
  // themselves and neither can the Ops Manager.
  it("lets ONLY the assigned coordinator cancel an event", () => {
    const confirmed = event({ status: "confirmed", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(coordinator, confirmed, "cancelled")).toBe(true);

    expect(canSetEventStatus(organiserA, confirmed, "cancelled")).toBe(false);
    expect(canSetEventStatus(organiserB, confirmed, "cancelled")).toBe(false);
    expect(canSetEventStatus(opsManager, confirmed, "cancelled")).toBe(false);
    expect(canSetEventStatus(otherCoordinator, confirmed, "cancelled")).toBe(false);
    expect(canSetEventStatus(attendee, confirmed, "cancelled")).toBe(false);
  });

  // SPM-27 AC4: the organiser cannot change the status themselves, so
  // postponing is the coordinator's too. An organiser asks through a change
  // request instead (decision 2026-10-01).
  it("SPM-27-TC05: lets ONLY the assigned coordinator postpone an event", () => {
    const confirmed = event({ status: "confirmed", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(coordinator, confirmed, "postponed")).toBe(true);
    expect(canSetEventStatus(organiserA, confirmed, "postponed")).toBe(false);
    expect(canSetEventStatus(organiserB, confirmed, "postponed")).toBe(false);
    expect(canSetEventStatus(opsManager, confirmed, "postponed")).toBe(false);
  });

  it("SPM-27-TC05: no role can move an event back to draft", () => {
    const submitted = event({ status: "submitted" });
    expect(canSetEventStatus(organiserA, submitted, "draft")).toBe(false);
  });

  // Clarification #103: the organiser asks outside the system and the
  // coordinator records the withdrawal.
  it("SPM-27-TC06: lets ONLY the assigned coordinator record a withdrawal", () => {
    const underReview = event({ status: "under_review", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(coordinator, underReview, "withdrawn")).toBe(true);
    expect(canSetEventStatus(otherCoordinator, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(organiserA, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(colleagueA, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(organiserB, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(opsManager, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(attendee, underReview, "withdrawn")).toBe(false);
  });

  it("keeps event:cancel and the cancelled transition in step", () => {
    // The two halves of the model must agree: a role that may not make the
    // transition must not be advertised as holding the permission either.
    for (const role of ROLES) {
      expect(can(role, "event:cancel")).toBe(
        STATUS_TRANSITION_ROLES.cancelled.includes(role)
      );
    }
  });

  it("refuses a status nobody owns rather than defaulting to allow", () => {
    expect(canSetEventStatus(coordinator, event(), "deleted")).toBe(false);
    expect(canSetEventStatus(coordinator, event(), "")).toBe(false);
  });
});

// SPM-27: whether the event page offers "Record withdrawal" - the assigned
// coordinator, and only while the request is Under review (#103).
describe("canWithdrawEvent", () => {
  it("SPM-27-TC04: offers it to the assigned coordinator while Under review", () => {
    expect(
      canWithdrawEvent(coordinator, event({ status: "under_review", coordinatorId: "coordinator-1" }))
    ).toBe(true);
  });

  it("SPM-27-TC05: does not offer it before review or from Approved onwards", () => {
    for (const status of [
      "submitted", "approved", "planning", "confirmed", "postponed",
      "completed", "rejected", "cancelled", "withdrawn",
    ]) {
      expect(
        canWithdrawEvent(coordinator, event({ status, coordinatorId: "coordinator-1" })),
        status
      ).toBe(false);
    }
  });

  it("SPM-27-TC06: does not offer it to anyone but the assigned coordinator", () => {
    const underReview = event({ status: "under_review", coordinatorId: "coordinator-1" });
    for (const actor of [organiserA, colleagueA, organiserB, otherCoordinator, opsManager, attendee]) {
      expect(canWithdrawEvent(actor, underReview), actor.id).toBe(false);
    }
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
    // Shown to an attendee by name (§4). Present here so the pair of tests
    // below pin BOTH halves of the rule: the client's name goes out, the
    // organiser's personal name and the raw organisationId do not.
    organisation: { name: "Tanjong Legal Chambers" },
    organiser: { fullName: "Aaron Sim" },
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
      // The organiser's personal name is withheld even though the client's
      // company name is not - see the note on ATTENDEE_EVENT_FIELDS.
      "organiser",
    ]) {
      expect(visible).not.toHaveProperty(hidden);
    }
  });

  // SPM-31 decided an attendee may see whose event it is; docs/PERMISSIONS.md §4
  // records it. Asserted here so the exception cannot be dropped or widened by
  // accident - nothing exercised it before, which is how it drifted from §4 in
  // the first place (SPM-22 TC17).
  it("shows an attendee the client's company name, but not the organiser's own", () => {
    const visible = visibleEventFor(attendee, full);
    expect(visible.organisation).toEqual({ name: "Tanjong Legal Chambers" });
    expect(visible).not.toHaveProperty("organiser");
    expect(visible).not.toHaveProperty("organisationId");
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

describe("canBeginPlanning (SPM-54)", () => {
  it("lets the assigned coordinator begin planning an approved event (AC1)", () => {
    const approved = event({ status: "approved", coordinatorId: "coordinator-1" });
    expect(canBeginPlanning(coordinator, approved)).toBe(true);
  });

  it("only from Approved (AC2)", () => {
    for (const status of [
      "draft", "submitted", "under_review", "planning", "confirmed",
      "postponed", "completed", "rejected", "cancelled",
    ]) {
      expect(canBeginPlanning(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
  });

  it("not for a coordinator who is not assigned, nor any other role", () => {
    const approved = event({ status: "approved", coordinatorId: "coordinator-1" });
    for (const other of [otherCoordinator, opsManager, organiserA, attendee]) {
      expect(canBeginPlanning(other, approved)).toBe(false);
    }
  });
});

describe("techSupportSeesEquipment (BPMN: Technical Support's lane is Planning and Confirmed)", () => {
  it("is Planning, Safety review and Confirmed only", () => {
    // SPM-86: Safety review sits between Planning and Confirmed, so Technical
    // Support keep sight of what they reserved while the check is pending.
    expect(TECH_SUPPORT_EQUIPMENT_STATUSES).toEqual(["planning", "safety_review", "safety_cleared", "confirmed"]);
    expect(techSupportSeesEquipment("planning")).toBe(true);
    expect(techSupportSeesEquipment("safety_review")).toBe(true);
    expect(techSupportSeesEquipment("approved")).toBe(false);
  });
});

describe("canSubmitForSafetyCheck (SPM-86)", () => {
  const inPlanning = event({ status: "planning", coordinatorId: "coordinator-1" });

  it("lets the assigned coordinator submit an event in Planning (AC1)", () => {
    expect(canSubmitForSafetyCheck(coordinator, inPlanning)).toBe(true);
  });

  it("only from Planning - not again while a check is pending (AC6), nor before planning begins", () => {
    for (const status of [
      "draft", "submitted", "under_review", "approved", "safety_review", "confirmed",
      "postponed", "completed", "rejected", "cancelled",
    ]) {
      expect(canSubmitForSafetyCheck(coordinator, event({ status, coordinatorId: "coordinator-1" })), status).toBe(false);
    }
  });

  it("not for a coordinator who is not assigned, nor any other role (AC7)", () => {
    for (const other of [otherCoordinator, opsManager, organiserA, venueStaff, techSupport, attendee]) {
      expect(canSubmitForSafetyCheck(other, inPlanning), other.role).toBe(false);
    }
  });
});

describe("canRecordSafetyDecision (SPM-87)", () => {
  const safetyOfficer = actor("safety_officer");
  const inReview = event({ status: "safety_review", coordinatorId: "coordinator-1" });

  it("lets the Safety Officer decide an event in Safety review", () => {
    expect(canRecordSafetyDecision(safetyOfficer, inReview)).toBe(true);
  });

  it("SPM-87-TC10: only while it is in Safety review (AC11)", () => {
    for (const status of ["planning", "safety_cleared", "confirmed", "approved", "cancelled"]) {
      expect(canRecordSafetyDecision(safetyOfficer, event({ status, coordinatorId: "coordinator-1" })), status).toBe(false);
    }
  });

  it("SPM-87-TC11: for no other role, the assigned coordinator included (AC12)", () => {
    for (const other of [coordinator, otherCoordinator, opsManager, organiserA, venueStaff, techSupport, attendee]) {
      expect(canRecordSafetyDecision(other, inReview), other.role).toBe(false);
    }
  });

  it("SPM-87-TC04: lets the assigned coordinator confirm a Safety approved event", () => {
    expect(canConfirmEvent(coordinator, event({ status: "safety_cleared", coordinatorId: "coordinator-1" }))).toBe(true);
  });

  it("keeps Safety approved among the statuses a coordinator can be reassigned in", () => {
    expect(REASSIGNABLE_STATUSES).toContain("safety_cleared");
  });
});

describe("REASSIGNABLE_STATUSES (SPM-86)", () => {
  it("includes Safety review, so a coordinator can still be replaced while the check is pending", () => {
    expect(REASSIGNABLE_STATUSES).toContain("safety_review");
  });
});

// SPM-85 (Week 7 change #6). The Safety Officer reviews the operational safety
// of planned events: they read what a review needs and change nothing.
describe("the Safety Officer (SPM-85)", () => {
  const safetyOfficer = actor("safety_officer");
  // The kind of event they review: assigned, arranged, and in Safety review.
  const underCheck = event({ coordinatorId: "coordinator-1", status: "safety_review" });

  it("AC1: has a defined set of permissions of its own", () => {
    expect(ROLE_PERMISSIONS.safety_officer).toEqual(["event:view", "event:safety_check", "facility:view"]);
  });

  it("AC3: sees every event that has left Draft, like the rest of ConnectSphere's staff", () => {
    for (const status of ["submitted", "under_review", "approved", "planning", "safety_review", "confirmed", "completed"]) {
      expect(canViewEvent(safetyOfficer, event({ status })), status).toBe(true);
    }
    expect(eventListWhere(safetyOfficer)).toEqual({ status: { not: "draft" } });
  });

  it("AC3: never sees an organiser's draft", () => {
    expect(canViewEvent(safetyOfficer, event({ status: "draft" }))).toBe(false);
  });

  it("AC3: sees an event's equipment arrangements, whatever stage it is at", () => {
    for (const status of ["approved", "planning", "safety_review", "confirmed"]) {
      expect(canViewEquipmentRequests(safetyOfficer, event({ coordinatorId: "coordinator-1", status })), status).toBe(true);
    }
  });

  it("AC3: is given the whole event record, not the attendee's public subset", () => {
    const record = { id: "e1", title: "Forum", expectedAttendance: 200, accessibilityNotes: "Step-free", sessions: [] };
    expect(visibleEventFor(safetyOfficer, record)).toEqual(record);
  });

  it("AC4: cannot change an event's information, venue bookings, equipment or registration", () => {
    expect(canEditEventContent(safetyOfficer, event({ status: "draft" }))).toBe(false);
    expect(canUpdateEventInformation(safetyOfficer, underCheck)).toBe(false);
    expect(canRequestVenueBooking(safetyOfficer, underCheck)).toBe(false);
    expect(canManageEquipmentRequests(safetyOfficer, underCheck)).toBe(false);
    expect(canConfigureRegistration(safetyOfficer, underCheck)).toBe(false);
    for (const action of ["event:edit_draft", "venue:manage", "venue_booking:request", "equipment:manage", "equipment_request:manage"] as const) {
      expect(can("safety_officer", action), action).toBe(false);
    }
  });

  it("AC5: cannot assign coordinators, review requests, approve bookings, reserve equipment or confirm events", () => {
    expect(canAssignCoordinator(safetyOfficer, event({ status: "submitted" }))).toBe(false);
    expect(canReviewEvent(safetyOfficer, event({ coordinatorId: "safety_officer-1", status: "under_review" }))).toBe(false);
    expect(can("safety_officer", "venue_booking:decide")).toBe(false);
    expect(canReserveEquipment(safetyOfficer)).toBe(false);
    expect(canUpdateEquipmentFulfilment(safetyOfficer)).toBe(false);
    expect(canCheckEquipmentAvailability(safetyOfficer)).toBe(false);
    expect(canConfirmEvent(safetyOfficer, event({ coordinatorId: "safety_officer-1", status: "planning" }))).toBe(false);
    expect(canSubmitForSafetyCheck(safetyOfficer, event({ coordinatorId: "safety_officer-1", status: "planning" }))).toBe(false);
  });

  it("AC5: cannot move an event to any status", () => {
    for (const to of Object.keys(STATUS_TRANSITION_ROLES)) {
      expect(canSetEventStatus(safetyOfficer, underCheck, to), to).toBe(false);
    }
  });

  it("AC6: cannot see who is registered for an event", () => {
    expect(can("safety_officer", "registration:view_list")).toBe(false);
    expect(can("safety_officer", "registration:create")).toBe(false);
  });

  it("AC8: is the only role that works the Operational Safety Check", () => {
    for (const role of ROLES) {
      expect(can(role, "event:safety_check"), role).toBe(role === "safety_officer");
    }
  });
});

describe("canViewRegistrationList (SPM-65)", () => {
  const theirs = event({ coordinatorId: "coordinator-1", status: "confirmed", registrationEnabled: true });

  it("AC1: lets the organiser responsible for the event view its registrations", () => {
    expect(canViewRegistrationList(organiserA, theirs)).toBe(true);
  });

  it("AC1: lets the coordinator assigned to the event view its registrations", () => {
    expect(canViewRegistrationList(coordinator, theirs)).toBe(true);
  });

  it("AC8: stops an organiser who is not responsible for the event - a colleague at the same client included", () => {
    expect(canViewRegistrationList(colleagueA, theirs)).toBe(false);
    expect(canViewRegistrationList(organiserB, theirs)).toBe(false);
  });

  it("stops a coordinator who is not assigned to the event, and every coordinator while it has none", () => {
    expect(canViewRegistrationList(otherCoordinator, theirs)).toBe(false);
    expect(canViewRegistrationList(coordinator, event({ coordinatorId: null }))).toBe(false);
  });

  it.each(ROLES.filter((role) => role !== "organiser" && role !== "coordinator"))(
    "AC9: stops the %s role, whatever their relationship to the event",
    (role) => {
      expect(canViewRegistrationList(actor(role, "organiser-1", CLIENT_A), theirs)).toBe(false);
    }
  );
});

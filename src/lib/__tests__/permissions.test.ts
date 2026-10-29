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
  canAddAttendees,
  canAssignCoordinator,
  canBeginPlanning,
  canConfigureRegistration,
  canConfirmEvent,
  canUpdateEventInformation,
  canReviewEvent,
  canRequestClarification,
  canRespondToClarification,
  canSeeClarification,
  canSeeRejectionReason,
  needsApprovalHistory,
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
  canCancelEvent,
  canPostponeEvent,
  canViewEvent,
  canProcessChangeRequests,
  canRequestEventChange,
  canViewChangeRequests,
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
  it("[SPM-4][AC2] grants every role exactly the permissions in the docs/PERMISSIONS.md matrix", () => {
    // The whole matrix, so granting or removing any permission is a
    // deliberate change made here as well, not a silent one.
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
    expect(ROLE_PERMISSIONS).toEqual({
      organiser: [
        "event:create",
        "event:view",
        "event:edit_draft",
        // SPM-35: the organiser asks for a change after submission.
        "event:request_change",
        "equipment:view",
        "registration:view_list",
        "facility:view",
      ],
      coordinator: [
        "event:view",
        "event:review",
        "event:confirm",
        "event:cancel",
        "venue:view",
        "venue_booking:request",
        "equipment:view",
        "equipment:view_status",
        "equipment_request:manage",
        "registration:view_list",
        "registration:add_attendee",
        "facility:view",
      ],
      venue_staff: ["event:view", "venue:view", "venue:manage", "venue_booking:decide", "facility:view"],
      tech_support: [
        "event:view",
        "equipment:view",
        "equipment:view_status",
        "equipment:manage",
        "equipment_request:review",
        "facility:view",
      ],
      attendee: ["event:view", "registration:create", "facility:view"],
      ops_manager: ["event:view", "event:assign_coordinator", "venue:view", "equipment:view", "equipment:view_status", "facility:view"],
      safety_officer: ["event:view", "event:safety_check", "facility:view"],
    });
  });

  it("[SPM-4][AC2] grants only actions that exist", () => {
    for (const role of ROLES) {
      for (const action of ROLE_PERMISSIONS[role]) {
        expect(ACTIONS).toContain(action);
      }
    }
  });

  it("[SPM-4][AC2] grants nothing at all to an unknown role", () => {
    for (const action of ACTIONS) {
      expect(can("future_role", action)).toBe(false);
    }
  });

  it("[SPM-4][AC2] puts each planning decision with the role the briefing gives it", () => {
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

  it("[SPM-4][AC2] keeps the venue catalogue internal but the equipment catalogue open to organisers", () => {
    // The event request form asks the organiser to pick equipment, so they
    // must be able to read that catalogue; venue selection is not theirs.
    expect(can("organiser", "equipment:view")).toBe(true);
    expect(can("organiser", "venue:view")).toBe(false);
    expect(can("attendee", "venue:view")).toBe(false);
    expect(can("attendee", "equipment:view")).toBe(false);
    expect(can("coordinator", "venue:view")).toBe(true);
  });

  it("[SPM-55][AC6] SPM-55: shows equipment's operational status to internal staff only", () => {
    for (const role of ["coordinator", "ops_manager", "tech_support"]) {
      expect(can(role, "equipment:view_status"), role).toBe(true);
    }
    // The organiser may pick from the catalogue (equipment:view) but not see
    // what is out of service, or why.
    for (const role of ["organiser", "venue_staff", "attendee"]) {
      expect(can(role, "equipment:view_status"), role).toBe(false);
    }
  });

  it("[SPM-4][AC2] lets no role write a catalogue it does not own", () => {
    for (const role of ROLES) {
      if (role !== "venue_staff") expect(can(role, "venue:manage")).toBe(false);
      if (role !== "tech_support") expect(can(role, "equipment:manage")).toBe(false);
    }
  });
});

describe("relationship to an event", () => {
  it("[SPM-4][AC3] recognises the organiser who raised it", () => {
    expect(ownsEvent(organiserA, event())).toBe(true);
    expect(ownsEvent(colleagueA, event())).toBe(false);
  });

  it("[SPM-4][AC3] recognises a colleague at the same client", () => {
    expect(sharesOrganisation(colleagueA, event())).toBe(true);
    expect(sharesOrganisation(organiserB, event())).toBe(false);
  });

  it("[SPM-4][AC3] does not treat two users without an organisation as colleagues", () => {
    // Internal staff have no organisationId. Null must never match null.
    expect(sharesOrganisation(coordinator, event({ organisationId: null }))).toBe(false);
  });

  it("[SPM-4][AC3] lets only the assigned coordinator act", () => {
    expect(isAssignedCoordinator(coordinator, event({ coordinatorId: "coordinator-1" }))).toBe(true);
    expect(isAssignedCoordinator(otherCoordinator, event({ coordinatorId: "coordinator-1" }))).toBe(
      false
    );
  });

  // SPM-30 (confirmed 2026-09-28): the "any coordinator may pick up an
  // unassigned event" allowance is gone now that the Ops Manager assigns.
  it("[SPM-4][AC3] gives no coordinator an event nobody has been assigned to yet", () => {
    expect(isAssignedCoordinator(coordinator, event({ coordinatorId: null }))).toBe(false);
    expect(isAssignedCoordinator(otherCoordinator, event({ coordinatorId: null }))).toBe(false);
  });
});

describe("canViewEvent", () => {
  it("[SPM-4][AC3] keeps a draft private to the organiser who owns it — from everyone", () => {
    const draft = event({ status: "draft" });
    expect(canViewEvent(organiserA, draft)).toBe(true);
    // Not a colleague at the same client, and not ConnectSphere staff either.
    for (const other of [colleagueA, organiserB, coordinator, opsManager, venueStaff, techSupport, attendee]) {
      expect(canViewEvent(other, draft)).toBe(false);
    }
  });

  it("[SPM-4][AC3] hides another client's event from an organiser (§8b, first example)", () => {
    const clientAEvent = event({ status: "confirmed" });
    expect(canViewEvent(organiserA, clientAEvent)).toBe(true);
    expect(canViewEvent(colleagueA, clientAEvent)).toBe(true);
    expect(canViewEvent(organiserB, clientAEvent)).toBe(false);
  });

  it("[SPM-4][AC3] shows an organiser with no organisation only their own events", () => {
    const loose = actor("organiser", "organiser-7", null);
    expect(canViewEvent(loose, event({ organiserId: "organiser-7" }))).toBe(true);
    expect(canViewEvent(loose, event({ organisationId: null }))).toBe(false);
  });

  it("[SPM-4][AC3] [SPM-51][AC1] shows an attendee only confirmed events that are open for registration", () => {
    expect(canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: true }))).toBe(true);
    expect(canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: false }))).toBe(false);
    expect(canViewEvent(attendee, event({ status: "planning", registrationEnabled: true }))).toBe(false);
    expect(canViewEvent(attendee, event({ status: "rejected", registrationEnabled: true }))).toBe(false);
  });

  // SPM-64 (#10: attendees "can view events that they register for"):
  // turning registration off must not hide the event from the people already
  // holding a place. Manual case SPM-64-TC22.
  // SPM-36: an event is completed by its coordinator or 7 days after it ends;
  // the attendee who registered for it keeps it (#10). Not everyone else.
  it.each([
    ["registered or on the waiting list", { attendeeHoldsPlace: true }],
    ["marked attended", { attendeeAttended: true }],
  ])("[SPM-36][AC6] [SPM-51][AC1] keeps showing a completed event to an attendee who %s", (_who, flags) => {
    expect(canViewEvent(attendee, event({ status: "completed", registrationEnabled: false, ...flags }))).toBe(true);
  });

  it("[SPM-36][AC6] [SPM-51][AC1] hides a completed event from an attendee who never registered or withdrew", () => {
    expect(canViewEvent(attendee, event({ status: "completed", registrationEnabled: true }))).toBe(false);
  });

  it("[SPM-4][AC3] [SPM-51][AC1] keeps showing a confirmed event to an attendee who holds a place after registration is turned off", () => {
    expect(
      canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: false, attendeeHoldsPlace: true }))
    ).toBe(true);
  });

  it("[SPM-4][AC3] [SPM-51][AC1] doesn't show it to an attendee who holds no place (withdrawn, or never registered)", () => {
    expect(
      canViewEvent(attendee, event({ status: "confirmed", registrationEnabled: false, attendeeHoldsPlace: false }))
    ).toBe(false);
  });

  it("[SPM-4][AC3] [SPM-51][AC1] still hides an event that is not confirmed from an attendee who holds a place", () => {
    expect(
      canViewEvent(attendee, event({ status: "planning", registrationEnabled: false, attendeeHoldsPlace: true }))
    ).toBe(false);
  });

  // SPM-37 (decided 2026-10-21): an attendee who holds a place can still open a
  // cancelled event, from My Registrations, to see that and why it was cancelled.
  it.each([true, false])(
    "[SPM-37][AC7] shows a cancelled event to an attendee who holds a place in it (registration enabled: %s)",
    (registrationEnabled) => {
      expect(canViewEvent(attendee, event({ status: "cancelled", registrationEnabled, attendeeHoldsPlace: true }))).toBe(true);
    }
  );

  it("[SPM-37][AC7] hides a cancelled event from an attendee who holds no place in it", () => {
    expect(canViewEvent(attendee, event({ status: "cancelled", registrationEnabled: true, attendeeHoldsPlace: false }))).toBe(false);
    expect(canViewEvent(attendee, event({ status: "cancelled", registrationEnabled: true }))).toBe(false);
  });

  // SPM-38 (AC8, decided 2026-10-26): a postponed event is no longer upcoming,
  // but an attendee who holds a place can still open it to see why.
  it("[SPM-38][AC8] shows a postponed event only to an attendee who holds a place in it", () => {
    expect(canViewEvent(attendee, event({ status: "postponed", registrationEnabled: true, attendeeHoldsPlace: true }))).toBe(true);
    expect(canViewEvent(attendee, event({ status: "postponed", registrationEnabled: true, attendeeHoldsPlace: false }))).toBe(false);
    expect(canViewEvent(attendee, event({ status: "postponed", registrationEnabled: true }))).toBe(false);
  });

  // "completed" is SPM-36's: an attendee holding a place still sees it.
  // "postponed" is SPM-38's, above.
  it.each(["rejected", "withdrawn"])(
    "[SPM-37][AC7] still hides a %s event from an attendee who holds a place",
    (status) => {
      expect(canViewEvent(attendee, event({ status, registrationEnabled: true, attendeeHoldsPlace: true }))).toBe(false);
    }
  );

  // CHANGED (SPM-94 AC2): Venue Staff, Technical Support and the Safety
  // Officer see an event only from Approved onwards - see the SPM-94 block.
  it("[SPM-4][AC3] shows coordinators and the Event Coordinator Lead every event that has left draft", () => {
    for (const staff of [coordinator, opsManager]) {
      expect(canViewEvent(staff, event({ status: "submitted" }))).toBe(true);
      expect(canViewEvent(staff, event({ status: "confirmed" }))).toBe(true);
    }
  });
});

describe("eventListWhere", () => {
  it("[SPM-4][AC3] agrees with canViewEvent about drafts", () => {
    // The list filter and the single-record check are the same rule written
    // twice (one for Prisma, one for objects); this is the cheap guard that
    // they have not drifted.
    const where = eventListWhere(coordinator) as { status: { not: string } };
    expect(where.status.not).toBe("draft");
  });

  it("[SPM-4][AC3] gives an organiser their own events plus their client's submitted ones", () => {
    const where = eventListWhere(organiserA) as { OR: Record<string, unknown>[] };
    expect(where.OR).toEqual([
      { organiserId: "organiser-1" },
      { organisationId: CLIENT_A, status: { not: "draft" } },
    ]);
  });

  it("[SPM-4][AC3] gives an organiser with no organisation only their own events", () => {
    const where = eventListWhere(actor("organiser", "organiser-7", null)) as {
      OR: Record<string, unknown>[];
    };
    expect(where.OR).toEqual([{ organiserId: "organiser-7" }]);
  });

  // CHANGED (SPM-64, #10): plus the confirmed events they hold a place in.
  // CHANGED (SPM-37, decided 2026-10-21): plus the cancelled events they hold a
  // place in, in step with canViewEvent(). Browse Events leaves those out itself.
  // CHANGED (SPM-38, decided 2026-10-26): and the postponed ones they hold a place in.
  it("[SPM-4][AC3] [SPM-51][AC1] [SPM-37][AC7] [SPM-38][AC8] gives an attendee confirmed events open for registration, or confirmed, cancelled or postponed events they hold a place in", () => {
    const holdsPlace = { registrations: { some: { attendeeId: "attendee-1", status: { in: ["registered", "waitlisted"] } } } };
    expect(eventListWhere(attendee)).toEqual({
      OR: [
        { status: "confirmed", OR: [{ registrationEnabled: true }, holdsPlace] },
        { status: { in: ["cancelled", "postponed"] }, ...holdsPlace },
      ],
    });
  });

  it("[SPM-4][AC3] matches nothing for a role that cannot view events at all", () => {
    const where = eventListWhere(actor("future_role")) as { id: { equals: string } };
    expect(where.id.equals).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("canEditEventContent", () => {
  it("[SPM-24][AC4] [SPM-25][AC3] lets the owning organiser edit their own draft", () => {
    expect(canEditEventContent(organiserA, event({ status: "draft" }))).toBe(true);
  });

  it("[SPM-24][AC4] [SPM-25][AC3] stops the edit once the draft has been submitted", () => {
    // Past draft, changes belong to EventChangeRequest (SPM-24).
    for (const status of ["submitted", "under_review", "approved", "confirmed"]) {
      expect(canEditEventContent(organiserA, event({ status }))).toBe(false);
    }
  });

  it("[SPM-24][AC4] [SPM-25][AC3] stops everyone else, including a colleague at the same client", () => {
    const draft = event({ status: "draft" });
    for (const other of [colleagueA, organiserB, coordinator, opsManager, attendee]) {
      expect(canEditEventContent(other, draft)).toBe(false);
    }
  });
});

describe("canManageEquipmentRequests", () => {
  it("[SPM-47][AC7] lets the assigned coordinator manage equipment on their event", () => {
    const mine = event({ status: "planning", coordinatorId: "coordinator-1" });
    expect(canManageEquipmentRequests(coordinator, mine)).toBe(true);
  });

  it("[SPM-47][AC7] stops every coordinator on an event with no coordinator yet (SPM-30)", () => {
    expect(canManageEquipmentRequests(coordinator, event({ coordinatorId: null }))).toBe(false);
  });

  it("[SPM-47][AC7] stops a coordinator managing equipment on a colleague's event", () => {
    const theirs = event({ coordinatorId: "coordinator-1" });
    expect(canManageEquipmentRequests(otherCoordinator, theirs)).toBe(false);
  });

  it("[SPM-47][AC7] is not restricted to draft — equipment planning happens well past it", () => {
    // Unlike canEditEventContent, which is draft-only.
    const mine = { coordinatorId: "coordinator-1" };
    for (const status of ["planning", "confirmed", "postponed"]) {
      expect(canManageEquipmentRequests(coordinator, event({ ...mine, status }))).toBe(true);
    }
  });

  it("[SPM-47][AC7] stops every other role, including the organiser who owns the event", () => {
    const draft = event({ status: "draft" });
    for (const other of [organiserA, opsManager, venueStaff, techSupport, attendee]) {
      expect(canManageEquipmentRequests(other, draft)).toBe(false);
    }
  });
});

describe("canAssignCoordinator (SPM-30)", () => {
  it("[SPM-30][AC1][AC6] lets the Ops Manager assign a submitted event that has no coordinator", () => {
    expect(canAssignCoordinator(opsManager, event({ status: "submitted", coordinatorId: null }))).toBe(true);
  });

  it("[SPM-30][AC1][AC6] lets the Ops Manager reassign a live event", () => {
    for (const status of REASSIGNABLE_STATUSES) {
      expect(canAssignCoordinator(opsManager, event({ status, coordinatorId: "coordinator-1" }))).toBe(true);
    }
  });

  it("[SPM-30][AC1][AC6] does not reassign a completed, cancelled or rejected event", () => {
    for (const status of ["completed", "cancelled", "rejected"]) {
      expect(canAssignCoordinator(opsManager, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
  });

  it("[SPM-30][AC1][AC6] does not assign a draft, or a live event somehow left without one", () => {
    expect(canAssignCoordinator(opsManager, event({ status: "draft" }))).toBe(false);
    expect(canAssignCoordinator(opsManager, event({ status: "planning", coordinatorId: null }))).toBe(false);
  });

  it("[SPM-30][AC1][AC6] stops every other role, including coordinators and the owning organiser (#94, #101)", () => {
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

  it("[SPM-28][AC1] lets the assigned coordinator review a request that is under review", () => {
    expect(canReviewEvent(coordinator, underReview)).toBe(true);
  });

  it("[SPM-28][AC1] stops a coordinator the request is not assigned to", () => {
    expect(canReviewEvent(otherCoordinator, underReview)).toBe(false);
  });

  it("[SPM-28][AC1] stops every other role, including the owning organiser", () => {
    for (const other of [organiserA, opsManager, venueStaff, techSupport, attendee]) {
      expect(canReviewEvent(other, underReview)).toBe(false);
    }
  });

  it("[SPM-28][AC1] only while under review - a decided or earlier request has nothing to review", () => {
    for (const status of ["draft", "submitted", "approved", "planning", "confirmed", "rejected", "cancelled"]) {
      expect(canReviewEvent(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
    expect(REVIEWABLE_STATUSES).toEqual(["under_review"]);
  });

  it("[SPM-28][AC4][AC5] review outcomes are exactly approve and reject, both the coordinator's", () => {
    expect(REVIEW_OUTCOMES).toEqual(["approved", "rejected"]);
    for (const outcome of REVIEW_OUTCOMES) {
      expect(STATUS_TRANSITION_ROLES[outcome]).toEqual(["coordinator"]);
    }
  });
});

// SPM-29: the coordinator assigned to the event asks the organiser for
// clarification. Whether the event is Under review is checked separately
// (REVIEWABLE_STATUSES), so the refusal can say which rule was broken.
describe("canRequestClarification (SPM-29)", () => {
  const assigned = event({ status: "under_review", coordinatorId: "coordinator-1" });

  it("[SPM-29] lets the assigned coordinator ask", () => {
    expect(canRequestClarification(coordinator, assigned)).toBe(true);
  });

  it("[SPM-29] stops a coordinator the event is not assigned to", () => {
    expect(canRequestClarification(otherCoordinator, assigned)).toBe(false);
  });

  it("[SPM-29] stops every other role, including the organiser who raised it", () => {
    for (const other of [organiserA, colleagueA, opsManager, venueStaff, techSupport, attendee]) {
      expect(canRequestClarification(other, assigned)).toBe(false);
    }
  });
});

// SPM-29 (AC3): "The open clarification is shown on the event to the Event
// Organiser and the assigned Event Coordinator" - and to no one else.
describe("canSeeClarification (SPM-29)", () => {
  const assigned = event({ status: "under_review", coordinatorId: "coordinator-1" });

  it.each([
    ["the organiser who raised it", organiserA],
    ["an organiser at the same client", colleagueA],
    ["the assigned coordinator", coordinator],
  ])("[SPM-29][AC3] shows it to %s", (_who, who) => {
    expect(canSeeClarification(who, assigned)).toBe(true);
  });

  it.each([
    ["an organiser at another client", organiserB],
    ["a coordinator it is not assigned to", otherCoordinator],
    ["the Ops Manager", opsManager],
    ["Venue Staff", venueStaff],
    ["Technical Support", techSupport],
    ["an attendee", attendee],
  ])("[SPM-29][AC3] hides it from %s", (_who, who) => {
    expect(canSeeClarification(who, assigned)).toBe(false);
  });
});

// SPM-26: the organiser who raised the request answers the clarification by
// updating and resubmitting it, while it is Under review - the same person
// who could edit it as a draft (SPM-24). Whether a clarification is open is
// checked separately, so the refusal can say which rule was broken.
describe("canRespondToClarification (SPM-26)", () => {
  const underReview = event({ status: "under_review", coordinatorId: "coordinator-1" });

  it("[SPM-26][AC2][AC3] lets the organiser who raised it respond", () => {
    expect(canRespondToClarification(organiserA, underReview)).toBe(true);
  });

  it.each([
    ["an organiser at the same client", colleagueA],
    ["an organiser at another client", organiserB],
    ["the assigned coordinator", coordinator],
    ["the Ops Manager", opsManager],
    ["Venue Staff", venueStaff],
    ["Technical Support", techSupport],
    ["an attendee", attendee],
  ])("[SPM-26][AC2] stops %s", (_who, who) => {
    expect(canRespondToClarification(who, underReview)).toBe(false);
  });

  it.each(["draft", "submitted", "approved", "planning", "rejected", "withdrawn"])(
    "[SPM-26][AC4] stops the organiser once the event is %s",
    (status) => {
      expect(canRespondToClarification(organiserA, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
  );
});

describe("canCheckEquipmentAvailability (SPM-48)", () => {
  it("[SPM-48] lets Technical Support check equipment availability", () => {
    expect(canCheckEquipmentAvailability(techSupport)).toBe(true);
  });

  it("[SPM-48] stops everyone else - the result names other events' bookings", () => {
    expect(canCheckEquipmentAvailability(coordinator)).toBe(false);
    expect(canCheckEquipmentAvailability(organiserA)).toBe(false);
  });
});

describe("canReserveEquipment (SPM-49)", () => {
  it("[SPM-49][AC1] lets Technical Support reserve equipment", () => {
    expect(canReserveEquipment(techSupport)).toBe(true);
  });

  it("[SPM-49][AC1] stops a Coordinator or Organiser from reserving", () => {
    expect(canReserveEquipment(coordinator)).toBe(false);
    expect(canReserveEquipment(organiserA)).toBe(false);
  });
});

describe("canUpdateEquipmentFulfilment (SPM-50)", () => {
  it("[SPM-50][AC2] lets Technical Support update fulfilment status and technical notes", () => {
    expect(canUpdateEquipmentFulfilment(techSupport)).toBe(true);
  });

  it("[SPM-50][AC2] SPM-50-TC12: stops a Coordinator or Organiser from updating them", () => {
    expect(canUpdateEquipmentFulfilment(coordinator)).toBe(false);
    expect(canUpdateEquipmentFulfilment(organiserA)).toBe(false);
  });
});

describe("canRequestVenueBooking (SPM-42)", () => {
  it("[SPM-42][AC1] SPM-42-TC01: the assigned coordinator can request a venue booking", () => {
    expect(canRequestVenueBooking(coordinator, event({ status: "approved", coordinatorId: "coordinator-1" }))).toBe(true);
  });

  it("[SPM-42][AC1] SPM-42-TC12: a coordinator cannot request a booking for an event not assigned to them", () => {
    expect(canRequestVenueBooking(otherCoordinator, event({ coordinatorId: "coordinator-1" }))).toBe(false);
    expect(canRequestVenueBooking(coordinator, event({ coordinatorId: null }))).toBe(false);
  });

  it("[SPM-42][AC1] SPM-42-TC12: no other role can request a venue booking", () => {
    const assigned = event({ status: "approved", coordinatorId: "coordinator-1" });
    for (const other of [organiserA, opsManager, venueStaff, techSupport, attendee]) {
      expect(canRequestVenueBooking(other, assigned)).toBe(false);
    }
  });
});

describe("canViewEquipmentRequests", () => {
  it("[SPM-47][AC6] lets Technical Support view the equipment of any event in planning or confirmed, assigned or not", () => {
    for (const status of ["planning", "confirmed"]) {
      expect(canViewEquipmentRequests(techSupport, event({ coordinatorId: "coordinator-1", status }))).toBe(true);
    }
  });

  it("[SPM-47][AC6] hides an event's equipment from Technical Support before planning and after it ends (BPMN)", () => {
    for (const status of ["submitted", "under_review", "approved", "postponed", "cancelled", "rejected", "completed", "withdrawn"]) {
      expect(canViewEquipmentRequests(techSupport, event({ coordinatorId: "coordinator-1", status }))).toBe(false);
    }
  });

  it("[SPM-47][AC6] lets the assigned coordinator view it — because managing it requires seeing it", () => {
    const mine = event({ coordinatorId: "coordinator-1" });
    expect(canViewEquipmentRequests(coordinator, mine)).toBe(true);
  });

  it("[SPM-47][AC6] stops a coordinator viewing equipment on a colleague's event", () => {
    const theirs = event({ coordinatorId: "coordinator-1" });
    expect(canViewEquipmentRequests(otherCoordinator, theirs)).toBe(false);
  });

  it("[SPM-47][AC6] lets the owning organiser view their own event's equipment read-only", () => {
    // Broader than AC6's literal wording (Technical Support only), confirmed
    // 2026-09-19 as intended — an Organiser should be able to see what's
    // been recorded against the event they raised.
    expect(canViewEquipmentRequests(organiserA, event())).toBe(true);
  });

  it("[SPM-47][AC6] stops an organiser viewing equipment on an event they don't own", () => {
    expect(canViewEquipmentRequests(organiserB, event())).toBe(false);
    expect(canViewEquipmentRequests(colleagueA, event())).toBe(false);
  });

  it("[SPM-47][AC6] stops every other role", () => {
    for (const other of [opsManager, venueStaff, attendee]) {
      expect(canViewEquipmentRequests(other, event())).toBe(false);
    }
  });
});

describe("canSetEventStatus", () => {
  it("[SPM-25][AC1] lets the owning organiser submit their own request (§5 Step 2)", () => {
    const draft = event({ status: "draft" });
    expect(canSetEventStatus(organiserA, draft, "submitted")).toBe(true);
    expect(canSetEventStatus(colleagueA, draft, "submitted")).toBe(false);
  });

  it("[SPM-27][AC4] stops an attendee confirming or rejecting an event", () => {
    // This was the open hole before the permission model: any authenticated
    // user could drive an event's status once it had left draft.
    const submitted = event({ status: "submitted" });
    for (const status of ["under_review", "approved", "rejected", "planning", "confirmed", "completed"]) {
      expect(canSetEventStatus(attendee, submitted, status)).toBe(false);
    }
  });

  it("[SPM-27][AC4] stops an organiser approving their own event", () => {
    const underReview = event({ status: "under_review" });
    expect(canSetEventStatus(organiserA, underReview, "approved")).toBe(false);
    expect(canSetEventStatus(organiserA, underReview, "confirmed")).toBe(false);
  });

  it("[SPM-34][AC4] [SPM-28][AC4] lets the assigned coordinator approve, reject and confirm", () => {
    const mine = event({ status: "under_review", coordinatorId: "coordinator-1" });
    for (const status of ["approved", "rejected", "planning", "confirmed", "completed"]) {
      expect(canSetEventStatus(coordinator, mine, status)).toBe(true);
    }
  });

  it("[SPM-27][AC4] stops a coordinator deciding an event assigned to a colleague", () => {
    const theirs = event({ status: "under_review", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(otherCoordinator, theirs, "approved")).toBe(false);
    expect(canSetEventStatus(otherCoordinator, theirs, "rejected")).toBe(false);
  });

  it("[SPM-27][AC4] keeps Venue Staff and Technical Support out of the event lifecycle", () => {
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
  it("[SPM-37][AC2] lets ONLY the assigned coordinator cancel an event", () => {
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
  it("[SPM-38][AC2] SPM-27-TC05: lets ONLY the assigned coordinator postpone an event", () => {
    const confirmed = event({ status: "confirmed", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(coordinator, confirmed, "postponed")).toBe(true);
    expect(canSetEventStatus(organiserA, confirmed, "postponed")).toBe(false);
    expect(canSetEventStatus(organiserB, confirmed, "postponed")).toBe(false);
    expect(canSetEventStatus(opsManager, confirmed, "postponed")).toBe(false);
  });

  it("[SPM-27][AC4] SPM-27-TC05: no role can move an event back to draft", () => {
    const submitted = event({ status: "submitted" });
    expect(canSetEventStatus(organiserA, submitted, "draft")).toBe(false);
  });

  // Clarification #103: the organiser asks outside the system and the
  // coordinator records the withdrawal.
  it("[SPM-59][AC1] SPM-27-TC06: lets ONLY the assigned coordinator record a withdrawal", () => {
    const underReview = event({ status: "under_review", coordinatorId: "coordinator-1" });
    expect(canSetEventStatus(coordinator, underReview, "withdrawn")).toBe(true);
    expect(canSetEventStatus(otherCoordinator, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(organiserA, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(colleagueA, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(organiserB, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(opsManager, underReview, "withdrawn")).toBe(false);
    expect(canSetEventStatus(attendee, underReview, "withdrawn")).toBe(false);
  });

  it("[SPM-4][AC2] keeps event:cancel and the cancelled transition in step", () => {
    // The two halves of the model must agree: a role that may not make the
    // transition must not be advertised as holding the permission either.
    for (const role of ROLES) {
      expect(can(role, "event:cancel")).toBe(
        STATUS_TRANSITION_ROLES.cancelled.includes(role)
      );
    }
  });

  it("[SPM-4][AC2] refuses a status nobody owns rather than defaulting to allow", () => {
    expect(canSetEventStatus(coordinator, event(), "deleted")).toBe(false);
    expect(canSetEventStatus(coordinator, event(), "")).toBe(false);
  });
});

// SPM-27: whether the event page offers "Record withdrawal" - the assigned
// coordinator, and only while the request is Under review (#103).
describe("canWithdrawEvent", () => {
  it("[SPM-59][AC1] SPM-27-TC04: offers it to the assigned coordinator while Under review", () => {
    expect(
      canWithdrawEvent(coordinator, event({ status: "under_review", coordinatorId: "coordinator-1" }))
    ).toBe(true);
  });

  it("[SPM-59][AC1] SPM-27-TC05: does not offer it before review or from Approved onwards", () => {
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

  it("[SPM-59][AC1] SPM-27-TC06: does not offer it to anyone but the assigned coordinator", () => {
    const underReview = event({ status: "under_review", coordinatorId: "coordinator-1" });
    for (const actor of [organiserA, colleagueA, organiserB, otherCoordinator, opsManager, attendee]) {
      expect(canWithdrawEvent(actor, underReview), actor.id).toBe(false);
    }
  });
});

// SPM-37: whether the event page offers "Cancel event" - the same two checks
// the PATCH route makes, as canWithdrawEvent above.
describe("canPostponeEvent", () => {
  // AC1, decided 2026-10-26: every stage after approval that is not final.
  it.each(["approved", "planning", "safety_review", "safety_cleared", "confirmed"])(
    "[SPM-38][AC1] offers it to the assigned coordinator while the event is %s",
    (status) => {
      expect(canPostponeEvent(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(true);
    }
  );

  it.each(["draft", "submitted", "under_review", "postponed", "completed", "rejected", "withdrawn", "cancelled"])(
    "[SPM-38][AC1] does not offer it while the event is %s",
    (status) => {
      expect(canPostponeEvent(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
  );

  it("[SPM-38][AC2] does not offer it to anyone but the assigned coordinator", () => {
    const planning = event({ status: "planning", coordinatorId: "coordinator-1" });
    for (const actor of [organiserA, colleagueA, organiserB, otherCoordinator, opsManager, venueStaff, techSupport, attendee]) {
      expect(canPostponeEvent(actor, planning), actor.id).toBe(false);
    }
  });
});

describe("canCancelEvent", () => {
  // AC1, #68 "any stage": every status with an assigned coordinator that is not final.
  const CANCELLABLE = ["under_review", "approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed"];

  it.each(CANCELLABLE)("[SPM-37][AC1] offers it to the assigned coordinator while the event is %s", (status) => {
    expect(canCancelEvent(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(true);
  });

  it.each(["draft", "submitted", "completed", "rejected", "withdrawn", "cancelled"])(
    "[SPM-37][AC1][AC9] does not offer it while the event is %s",
    (status) => {
      expect(canCancelEvent(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
  );

  it("[SPM-37][AC2] does not offer it to anyone but the assigned coordinator", () => {
    const planning = event({ status: "planning", coordinatorId: "coordinator-1" });
    for (const actor of [organiserA, colleagueA, organiserB, otherCoordinator, opsManager, venueStaff, techSupport, attendee]) {
      expect(canCancelEvent(actor, planning), actor.id).toBe(false);
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

  it("[SPM-22][AC5] withholds internal planning information from an attendee (§8b, second example)", () => {
    const visible = visibleEventFor(attendee, full);
    for (const hidden of [
      "coordinatorId",
      "organiserId",
      "organisationId",
      "expectedAttendance",
      "specialRequirements",
      "accessibilityNotes",
      "rejectionReason",
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
  // CHANGED (SPM-37, decided 2026-10-21): an attendee holding a place in a
  // cancelled event sees why it was cancelled - the reason SPM-53 also sends
  // them. Was in the withheld list above.
  it("[SPM-37][AC8] shows an attendee the cancellation reason", () => {
    const visible = visibleEventFor(attendee, { ...full, status: "cancelled", cancellationReason: "Trainer unavailable" });
    expect(visible.cancellationReason).toBe("Trainer unavailable");
  });

  it("[SPM-38][AC5][AC8] shows an attendee the postponement reason", () => {
    const visible = visibleEventFor(attendee, { ...full, status: "postponed", postponementReason: "Trainer unwell" });
    expect(visible.postponementReason).toBe("Trainer unwell");
  });

  it("[SPM-22][AC5] shows an attendee the client's company name, but not the organiser's own", () => {
    const visible = visibleEventFor(attendee, full);
    expect(visible.organisation).toEqual({ name: "Tanjong Legal Chambers" });
    expect(visible).not.toHaveProperty("organiser");
    expect(visible).not.toHaveProperty("organisationId");
  });

  it("[SPM-22][AC5] [SPM-51][AC4] still tells an attendee what they need in order to register", () => {
    const visible = visibleEventFor(attendee, full);
    expect(visible.title).toBe("Annual conference");
    expect(visible.startsAt).toBe("2026-10-01T09:00:00.000Z");
    expect(visible.status).toBe("confirmed");
    expect(visible.registrationCapacity).toBe(200);
  });

  // CHANGED (SPM-94 AC1): beyond the rejection reason, which only the owner,
  // the assigned coordinator and the Lead receive - see the SPM-94 block.
  it("[SPM-22][AC5] does not narrow the record for anyone else, beyond the rejection reason", () => {
    const withoutReason: Partial<typeof full> = { ...full };
    delete withoutReason.rejectionReason;
    for (const other of [organiserA, coordinator, opsManager]) {
      expect(visibleEventFor(other, full)).toEqual(full);
    }
    for (const other of [colleagueA, otherCoordinator, venueStaff, techSupport]) {
      expect(visibleEventFor(other, full)).toEqual(withoutReason);
    }
  });
});

describe("canBeginPlanning (SPM-54)", () => {
  it("[SPM-54][AC1] lets the assigned coordinator begin planning an approved event (AC1)", () => {
    const approved = event({ status: "approved", coordinatorId: "coordinator-1" });
    expect(canBeginPlanning(coordinator, approved)).toBe(true);
  });

  it("[SPM-54][AC2] only from Approved (AC2)", () => {
    for (const status of [
      "draft", "submitted", "under_review", "planning", "confirmed",
      "postponed", "completed", "rejected", "cancelled",
    ]) {
      expect(canBeginPlanning(coordinator, event({ status, coordinatorId: "coordinator-1" }))).toBe(false);
    }
  });

  it("[SPM-54][AC1] not for a coordinator who is not assigned, nor any other role", () => {
    const approved = event({ status: "approved", coordinatorId: "coordinator-1" });
    for (const other of [otherCoordinator, opsManager, organiserA, attendee]) {
      expect(canBeginPlanning(other, approved)).toBe(false);
    }
  });
});

describe("techSupportSeesEquipment (BPMN: Technical Support's lane is Planning and Confirmed)", () => {
  it("[SPM-47][AC6] is Planning, Safety review and Confirmed only", () => {
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

  it("[SPM-86][AC1] lets the assigned coordinator submit an event in Planning (AC1)", () => {
    expect(canSubmitForSafetyCheck(coordinator, inPlanning)).toBe(true);
  });

  it("[SPM-86][AC6] only from Planning - not again while a check is pending (AC6), nor before planning begins", () => {
    for (const status of [
      "draft", "submitted", "under_review", "approved", "safety_review", "confirmed",
      "postponed", "completed", "rejected", "cancelled",
    ]) {
      expect(canSubmitForSafetyCheck(coordinator, event({ status, coordinatorId: "coordinator-1" })), status).toBe(false);
    }
  });

  it("[SPM-86][AC7] not for a coordinator who is not assigned, nor any other role (AC7)", () => {
    for (const other of [otherCoordinator, opsManager, organiserA, venueStaff, techSupport, attendee]) {
      expect(canSubmitForSafetyCheck(other, inPlanning), other.role).toBe(false);
    }
  });
});

describe("canRecordSafetyDecision (SPM-87)", () => {
  const safetyOfficer = actor("safety_officer");
  const inReview = event({ status: "safety_review", coordinatorId: "coordinator-1" });

  it("[SPM-87][AC12] lets the Safety Officer decide an event in Safety review", () => {
    expect(canRecordSafetyDecision(safetyOfficer, inReview)).toBe(true);
  });

  it("[SPM-87][AC11] SPM-87-TC10: only while it is in Safety review (AC11)", () => {
    for (const status of ["planning", "safety_cleared", "confirmed", "approved", "cancelled"]) {
      expect(canRecordSafetyDecision(safetyOfficer, event({ status, coordinatorId: "coordinator-1" })), status).toBe(false);
    }
  });

  it("[SPM-87][AC12] SPM-87-TC11: for no other role, the assigned coordinator included (AC12)", () => {
    for (const other of [coordinator, otherCoordinator, opsManager, organiserA, venueStaff, techSupport, attendee]) {
      expect(canRecordSafetyDecision(other, inReview), other.role).toBe(false);
    }
  });

  it("[SPM-88][AC9] SPM-87-TC04: lets the assigned coordinator confirm a Safety approved event", () => {
    expect(canConfirmEvent(coordinator, event({ status: "safety_cleared", coordinatorId: "coordinator-1" }))).toBe(true);
  });

  it("[SPM-30][AC6] keeps Safety approved among the statuses a coordinator can be reassigned in", () => {
    expect(REASSIGNABLE_STATUSES).toContain("safety_cleared");
  });
});

describe("REASSIGNABLE_STATUSES (SPM-86)", () => {
  it("[SPM-30][AC6] includes Safety review, so a coordinator can still be replaced while the check is pending", () => {
    expect(REASSIGNABLE_STATUSES).toContain("safety_review");
  });
});

// SPM-85 (Week 7 change #6). The Safety Officer reviews the operational safety
// of planned events: they read what a review needs and change nothing.
describe("the Safety Officer (SPM-85)", () => {
  const safetyOfficer = actor("safety_officer");
  // The kind of event they review: assigned, arranged, and in Safety review.
  const underCheck = event({ coordinatorId: "coordinator-1", status: "safety_review" });

  it("[SPM-85][AC1] AC1: has a defined set of permissions of its own", () => {
    expect(ROLE_PERMISSIONS.safety_officer).toEqual(["event:view", "event:safety_check", "facility:view"]);
  });

  // CHANGED (SPM-94 AC2): from Approved onwards, not every event that has left
  // Draft - a request still in review, or turned down, is not theirs to see.
  it("[SPM-85][AC3] AC3: sees every event from Approved onwards", () => {
    for (const status of ["approved", "planning", "safety_review", "confirmed", "completed"]) {
      expect(canViewEvent(safetyOfficer, event({ status })), status).toBe(true);
    }
  });

  it("[SPM-85][AC3] AC3: never sees an organiser's draft", () => {
    expect(canViewEvent(safetyOfficer, event({ status: "draft" }))).toBe(false);
  });

  it("[SPM-85][AC3] AC3: sees an event's equipment arrangements, whatever stage it is at", () => {
    for (const status of ["approved", "planning", "safety_review", "confirmed"]) {
      expect(canViewEquipmentRequests(safetyOfficer, event({ coordinatorId: "coordinator-1", status })), status).toBe(true);
    }
  });

  it("[SPM-85][AC3] AC3: is given the whole event record, not the attendee's public subset", () => {
    const record = { id: "e1", title: "Forum", expectedAttendance: 200, accessibilityNotes: "Step-free", sessions: [] };
    expect(visibleEventFor(safetyOfficer, record)).toEqual(record);
  });

  it("[SPM-85][AC4] AC4: cannot change an event's information, venue bookings, equipment or registration", () => {
    expect(canEditEventContent(safetyOfficer, event({ status: "draft" }))).toBe(false);
    expect(canUpdateEventInformation(safetyOfficer, underCheck)).toBe(false);
    expect(canRequestVenueBooking(safetyOfficer, underCheck)).toBe(false);
    expect(canManageEquipmentRequests(safetyOfficer, underCheck)).toBe(false);
    expect(canConfigureRegistration(safetyOfficer, underCheck)).toBe(false);
    for (const action of ["event:edit_draft", "venue:manage", "venue_booking:request", "equipment:manage", "equipment_request:manage"] as const) {
      expect(can("safety_officer", action), action).toBe(false);
    }
  });

  it("[SPM-85][AC5] AC5: cannot assign coordinators, review requests, approve bookings, reserve equipment or confirm events", () => {
    expect(canAssignCoordinator(safetyOfficer, event({ status: "submitted" }))).toBe(false);
    expect(canReviewEvent(safetyOfficer, event({ coordinatorId: "safety_officer-1", status: "under_review" }))).toBe(false);
    expect(can("safety_officer", "venue_booking:decide")).toBe(false);
    expect(canReserveEquipment(safetyOfficer)).toBe(false);
    expect(canUpdateEquipmentFulfilment(safetyOfficer)).toBe(false);
    expect(canCheckEquipmentAvailability(safetyOfficer)).toBe(false);
    expect(canConfirmEvent(safetyOfficer, event({ coordinatorId: "safety_officer-1", status: "planning" }))).toBe(false);
    expect(canSubmitForSafetyCheck(safetyOfficer, event({ coordinatorId: "safety_officer-1", status: "planning" }))).toBe(false);
  });

  it("[SPM-85][AC5] AC5: cannot move an event to any status", () => {
    for (const to of Object.keys(STATUS_TRANSITION_ROLES)) {
      expect(canSetEventStatus(safetyOfficer, underCheck, to), to).toBe(false);
    }
  });

  it("[SPM-85][AC6] AC6: cannot see who is registered for an event", () => {
    expect(can("safety_officer", "registration:view_list")).toBe(false);
    expect(can("safety_officer", "registration:create")).toBe(false);
  });

  it("[SPM-85][AC8] AC8: is the only role that works the Operational Safety Check", () => {
    for (const role of ROLES) {
      expect(can(role, "event:safety_check"), role).toBe(role === "safety_officer");
    }
  });
});

describe("canViewRegistrationList (SPM-65)", () => {
  const theirs = event({ coordinatorId: "coordinator-1", status: "confirmed", registrationEnabled: true });

  it("[SPM-65][AC1] AC1: lets the organiser responsible for the event view its registrations", () => {
    expect(canViewRegistrationList(organiserA, theirs)).toBe(true);
  });

  it("[SPM-65][AC1] AC1: lets the coordinator assigned to the event view its registrations", () => {
    expect(canViewRegistrationList(coordinator, theirs)).toBe(true);
  });

  it("[SPM-65][AC8] AC8: stops an organiser who is not responsible for the event - a colleague at the same client included", () => {
    expect(canViewRegistrationList(colleagueA, theirs)).toBe(false);
    expect(canViewRegistrationList(organiserB, theirs)).toBe(false);
  });

  it("[SPM-65][AC1] stops a coordinator who is not assigned to the event, and every coordinator while it has none", () => {
    expect(canViewRegistrationList(otherCoordinator, theirs)).toBe(false);
    expect(canViewRegistrationList(coordinator, event({ coordinatorId: null }))).toBe(false);
  });

  it.each(ROLES.filter((role) => role !== "organiser" && role !== "coordinator"))(
    "[SPM-65][AC9] AC9: stops the %s role, whatever their relationship to the event",
    (role) => {
      expect(canViewRegistrationList(actor(role, "organiser-1", CLIENT_A), theirs)).toBe(false);
    }
  );
});

describe("canAddAttendees (SPM-57)", () => {
  const theirs = event({ coordinatorId: "coordinator-1", status: "confirmed", registrationEnabled: true });

  it("[SPM-57][AC1] lets the coordinator assigned to the event add attendees", () => {
    expect(canAddAttendees(coordinator, theirs)).toBe(true);
  });

  it("[SPM-57][AC1] stops a coordinator who is not assigned to the event, and every coordinator while it has none", () => {
    expect(canAddAttendees(otherCoordinator, theirs)).toBe(false);
    expect(canAddAttendees(coordinator, event({ coordinatorId: null }))).toBe(false);
  });

  it("[SPM-57][AC5] stops the organiser responsible for the event, who only sees who was added", () => {
    expect(canAddAttendees(organiserA, theirs)).toBe(false);
  });

  it.each(ROLES.filter((role) => role !== "coordinator"))("[SPM-57][AC1] stops the %s role", (role) => {
    expect(canAddAttendees(actor(role, "coordinator-1", null), theirs)).toBe(false);
  });
});

describe("[SPM-35] Request Event Change", () => {
  const confirmed = event({ status: "confirmed", coordinatorId: "coordinator-1" });

  it("[SPM-35][AC1] only the organiser who owns the event may request a change", () => {
    expect(canRequestEventChange(organiserA, confirmed)).toBe(true);
    for (const someone of [colleagueA, organiserB, coordinator, opsManager, venueStaff, techSupport, attendee]) {
      expect(canRequestEventChange(someone, confirmed), someone.role).toBe(false);
    }
  });

  it("[SPM-35][AC4] the event's organisers, its assigned coordinator and the Ops Manager see its change requests", () => {
    for (const someone of [organiserA, colleagueA, coordinator, opsManager]) {
      expect(canViewChangeRequests(someone, confirmed), someone.id).toBe(true);
    }
  });

  it("[SPM-35] nobody else sees them: another client, another coordinator, Venue Staff, Technical Support or an attendee", () => {
    const open = event({ status: "confirmed", coordinatorId: "coordinator-1", registrationEnabled: true });
    for (const someone of [organiserB, otherCoordinator, venueStaff, techSupport, attendee]) {
      expect(canViewChangeRequests(someone, open), someone.id).toBe(false);
    }
  });
});

describe("[SPM-32] Process Event Change Request", () => {
  it("[SPM-32][AC1][AC2] only the coordinator assigned to the event processes its change requests", () => {
    const planning = event({ status: "planning", coordinatorId: "coordinator-1" });

    expect(canProcessChangeRequests(coordinator, planning)).toBe(true);
    for (const someone of [otherCoordinator, opsManager, organiserA, colleagueA, venueStaff, techSupport, attendee]) {
      expect(canProcessChangeRequests(someone, planning), someone.id).toBe(false);
    }
  });
});

// SPM-94 (Limit Who Sees a Request's Review Outcome; forum #125): the outcome
// and its reason are for the people involved in the request, not for every
// internal role. Manual cases docs/test-cases/SPM-94_Test_Cases.xlsx.
//
// What these tests pin (written before the code, which now meets it):
//   canSeeRejectionReason(actor, event) in src/lib/permissions.ts - true only
//     for the organiser who owns the event, the coordinator assigned to it and
//     the Event Coordinator Lead (ops_manager), and only for an event they may
//     see at all (canViewEvent).
//   visibleEventFor(actor, event) leaves out `rejectionReason` for everyone
//     else (on top of the Attendee's public subset), so the list and the
//     record drop it in one place.
//   canViewEvent / eventListWhere: Venue Staff, Technical Support and the
//     Safety Officer see no event that is Submitted, Under review, Rejected or
//     Withdrawn; their list filter is
//     { status: { notIn: ["draft", "submitted", "under_review", "rejected", "withdrawn"] } }.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the function name, and that visibleEventFor() is where the reason is dropped
//   - Postponed and Completed count as "from Approved onwards": each is
//     reachable only after approval (canTransition in src/lib/statuses.ts).
//     Cancelled counts only when the status history has an approval: SPM-37
//     cancels from Under review too (CHANGED after review of PR #86).
describe("SPM-94: who sees a request's review outcome", () => {
  const safetyOfficer = actor("safety_officer");
  const rejected = event({ status: "rejected", coordinatorId: "coordinator-1" });
  const BEFORE_APPROVAL = ["submitted", "under_review", "rejected", "withdrawn"];
  // Cancelled is not here: SPM-37 cancels from Under review too, so whether a
  // cancelled event was approved comes from its status history (below).
  const FROM_APPROVAL = ["approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed", "completed"];
  const LATE_STAFF = [venueStaff, techSupport, safetyOfficer];

  it("[SPM-94][AC1] shows the rejection reason to the owning organiser, the assigned coordinator and the Event Coordinator Lead", () => {
    for (const someone of [organiserA, coordinator, opsManager]) {
      expect(canSeeRejectionReason(someone, rejected), someone.id).toBe(true);
    }
  });

  it("[SPM-94][AC1][AC3][AC4] keeps it from everyone else, including those who may see the event", () => {
    for (const someone of [colleagueA, otherCoordinator, organiserB, venueStaff, techSupport, safetyOfficer, attendee]) {
      expect(canSeeRejectionReason(someone, rejected), someone.id).toBe(false);
    }
  });

  it("[SPM-94][AC3] keeps it from every coordinator while the rejected event has none assigned", () => {
    expect(canSeeRejectionReason(coordinator, event({ status: "rejected", coordinatorId: null }))).toBe(false);
  });

  it("[SPM-94][AC3][AC4] still lets an unassigned coordinator and a colleague organiser see the rejected event and its status", () => {
    for (const someone of [otherCoordinator, colleagueA]) {
      expect(canViewEvent(someone, rejected), someone.id).toBe(true);
    }
  });

  it("[SPM-94][AC2] hides an event that has not been approved from Venue Staff, Technical Support and the Safety Officer", () => {
    for (const someone of LATE_STAFF) {
      for (const status of BEFORE_APPROVAL) {
        expect(canViewEvent(someone, event({ status, coordinatorId: "coordinator-1" })), `${someone.role} ${status}`).toBe(false);
      }
    }
  });

  it("[SPM-94][AC2] shows them an event from Approved onwards", () => {
    for (const someone of LATE_STAFF) {
      for (const status of FROM_APPROVAL) {
        expect(canViewEvent(someone, event({ status, coordinatorId: "coordinator-1" })), `${someone.role} ${status}`).toBe(true);
      }
    }
  });

  it("[SPM-94][AC2] shows them a cancelled event only if it was approved before it was cancelled", () => {
    for (const someone of LATE_STAFF) {
      const cancelled = (everApproved?: boolean) => event({ status: "cancelled", coordinatorId: "coordinator-1", everApproved });
      expect(canViewEvent(someone, cancelled(true)), `${someone.role} approved, then cancelled`).toBe(true);
      // SPM-37: cancelled straight from Under review - never approved.
      expect(canViewEvent(someone, cancelled(false)), `${someone.role} cancelled in review`).toBe(false);
      // Not looked up is never approved: a route that forgets the history hides, never leaks.
      expect(canViewEvent(someone, cancelled()), `${someone.role} history unknown`).toBe(false);
    }
  });

  it("[SPM-94][AC2] still shows coordinators and the Lead a cancelled event, approved or not", () => {
    for (const someone of [coordinator, opsManager]) {
      expect(canViewEvent(someone, event({ status: "cancelled", coordinatorId: "coordinator-1" })), someone.role).toBe(true);
    }
  });

  it("[SPM-94][AC2] asks for the status history only for a cancelled event seen by those three roles", () => {
    for (const someone of LATE_STAFF) {
      expect(needsApprovalHistory(someone, event({ status: "cancelled" })), someone.role).toBe(true);
      for (const status of [...FROM_APPROVAL, ...BEFORE_APPROVAL]) {
        expect(needsApprovalHistory(someone, event({ status })), `${someone.role} ${status}`).toBe(false);
      }
    }
    for (const someone of [coordinator, opsManager, organiserA, attendee]) {
      expect(needsApprovalHistory(someone, event({ status: "cancelled" })), someone.role).toBe(false);
    }
  });

  it("[SPM-94][AC2] filters their event lists the same way, a cancelled event by its status history", () => {
    for (const someone of LATE_STAFF) {
      expect(eventListWhere(someone), someone.role).toEqual({
        OR: [
          { status: { notIn: ["draft", ...BEFORE_APPROVAL, "cancelled"] } },
          { status: "cancelled", statusHistory: { some: { toStatus: "approved" } } },
        ],
      });
    }
  });

  it("[SPM-94][AC2] leaves the coordinators' and the Lead's lists at every event that has left draft", () => {
    for (const someone of [coordinator, opsManager]) {
      expect(eventListWhere(someone), someone.role).toEqual({ status: { not: "draft" } });
    }
  });

  it("[SPM-94][AC6] drops the rejection reason from the record for those who may not see it", () => {
    const record = { id: "e1", title: "Gala", ...rejected, rejectionReason: "Ballroom closed for renovation" };
    expect(visibleEventFor(otherCoordinator, record)).not.toHaveProperty("rejectionReason");
    expect(visibleEventFor(colleagueA, record)).not.toHaveProperty("rejectionReason");
    expect(visibleEventFor(otherCoordinator, record)).toMatchObject({ title: "Gala", status: "rejected" });
    expect(visibleEventFor(coordinator, record).rejectionReason).toBe("Ballroom closed for renovation");
  });

  it("[SPM-94][AC7] still shows an Attendee neither the outcome's reason nor any event before it is confirmed", () => {
    expect(canViewEvent(attendee, event({ status: "rejected", registrationEnabled: true }))).toBe(false);
    const open = { id: "e1", ...event({ status: "confirmed", registrationEnabled: true }), rejectionReason: null };
    expect(visibleEventFor(attendee, open)).not.toHaveProperty("rejectionReason");
  });
});

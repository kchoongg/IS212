// The permission model: who may do what, and to which events.
//
// See docs/PERMISSIONS.md for the matrix in prose and where each rule comes
// from in the customer briefing. This file is that document as code.
//
// Everything here is a PURE function over plain data - no Prisma, no
// NextRequest - so the whole model can be unit tested without a database or a
// running server. The route-side helpers that need I/O live in
// src/lib/apiAuth.ts.
//
// Two questions are deliberately kept apart, because the briefing asks both
// (§8b: "access should depend on the user's role AND relationship to an
// event"):
//
//   1. Does this ROLE have this permission at all?        -> can()
//   2. Is this user related to THIS event closely enough? -> canViewEvent(),
//      canEditEventContent(), canSetEventStatus()
//
// A user needs both. Being a coordinator does not let you approve somebody
// else's event; owning an event does not let you approve your own.

import type { Role } from "./roles";
import { isRole } from "./roles";
import { canTransition } from "./statuses";
import { HOLDING_A_PLACE } from "./registrationSettings";

/// Every distinct thing a user can try to do. Keep the `domain:verb` shape -
/// it groups the matrix by the domain that owns the route (DOCUMENTATION.md
/// §"The 5 domains").
export const ACTIONS = [
  "event:create",
  "event:view",
  "event:edit_draft",
  "event:review",
  "event:assign_coordinator",
  "event:confirm",
  "event:cancel",
  "venue:view",
  "venue:manage",
  "venue_booking:request",
  "venue_booking:decide",
  "equipment:view",
  // SPM-55: an item's operational status - how many units are out of
  // service, which kind and why. Internal, unlike the catalogue itself.
  "equipment:view_status",
  "equipment:manage",
  "equipment_request:manage",
  "equipment_request:review",
  "registration:create",
  "registration:view_list",
  "facility:view",
] as const;

export type Action = (typeof ACTIONS)[number];

/// The role half of the model. Traces to the briefing's §5 process steps:
/// organisers draft and submit (1-2), the Ops Manager assigns (3), the
/// coordinator reviews, approves and confirms (4-5, 10), Venue Staff decide
/// bookings (7), Technical Support decides equipment (8), attendees register
/// (11).
///
/// `facility:view` and `equipment:view` are on the organiser deliberately: the
/// event request form (S-08) asks them to tick facility requirements and pick
/// equipment from the catalogue, so those two reference lists are part of
/// making a request, not internal planning information.
export const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  organiser: [
    "event:create",
    "event:view",
    "event:edit_draft",
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
    // ADDED (SPM-47): recording equipment requirements on an event is the
    // coordinator's job, same footing as requesting a venue booking above —
    // neither existed when this file was first written (docs/PERMISSIONS.md
    // §8 only anticipated equipment_request:review, Technical Support's side).
    "equipment_request:manage",
    "registration:view_list",
    "facility:view",
  ],
  ops_manager: [
    "event:view",
    "event:assign_coordinator",
    "venue:view",
    "equipment:view",
    "equipment:view_status",
    "facility:view",
  ],
  venue_staff: [
    "event:view",
    "venue:view",
    "venue:manage",
    "venue_booking:decide",
    "facility:view",
  ],
  tech_support: [
    "event:view",
    "equipment:view",
    "equipment:view_status",
    "equipment:manage",
    "equipment_request:review",
    "facility:view",
  ],
  attendee: ["event:view", "registration:create", "facility:view"],
};

/// An unknown role gets nothing. A role key that is not in ROLES cannot have
/// been granted anything deliberately, so the safe reading is "no".
export function can(role: string, action: Action): boolean {
  if (!isRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(action);
}

/// Who the request is being made by. `organisationId` is what makes "an Event
/// Organiser should not normally be able to view events belonging to
/// unrelated clients" (briefing §8b) checkable, and it is null for internal
/// ConnectSphere staff.
export interface Actor {
  id: string;
  role: string;
  organisationId: string | null;
}

/// The fields of an Event that access decisions depend on. Declared
/// structurally rather than as the Prisma type so these functions can be
/// tested with object literals.
export interface EventAccessFields {
  organiserId: string;
  organisationId: string | null;
  coordinatorId: string | null;
  status: string;
  registrationEnabled?: boolean;
  /// For an attendee: whether they are registered or waitlisted for this
  /// event (SPM-64). Set by the caller, which knows who is asking.
  attendeeHoldsPlace?: boolean;
}

const INTERNAL_ROLES: readonly string[] = [
  "coordinator",
  "ops_manager",
  "venue_staff",
  "tech_support",
];

// ---------------------------------------------------------------------------
// RELATIONSHIP TO AN EVENT
// ---------------------------------------------------------------------------

/// A draft is private to the organiser who owns it - not merely hidden from
/// other clients, but invisible to ConnectSphere staff too, until it is
/// submitted (SPM-24). Callers answer a failed check with 404, never 403: a
/// 403 would confirm that the event exists.
export function ownsEvent(actor: Actor, event: EventAccessFields): boolean {
  return event.organiserId === actor.id;
}

/// Same client organisation. Null on either side is never a match - two
/// unassigned users are not colleagues.
export function sharesOrganisation(actor: Actor, event: EventAccessFields): boolean {
  return actor.organisationId != null && event.organisationId === actor.organisationId;
}

/// A coordinator acts on the events assigned to them, and only those.
///
/// CHANGED (SPM-30): this used to let any coordinator pick up an event with no
/// coordinator yet, so the review queue was reachable before Coordinator
/// Assignment existed. Now that the Ops Manager assigns every submitted event
/// (customer clarifications #94, #101), an unassigned event is nobody's to
/// manage - confirmed 2026-09-28, and already anticipated in DOCUMENTATION.md
/// under SPM-31's decisions.
export function isAssignedCoordinator(actor: Actor, event: EventAccessFields): boolean {
  if (actor.role !== "coordinator") return false;
  return event.coordinatorId !== null && event.coordinatorId === actor.id;
}

/// Can this user see this event at all? Separate from *which fields* they see
/// - that is visibleEventFor() below.
export function canViewEvent(actor: Actor, event: EventAccessFields): boolean {
  if (!can(actor.role, "event:view")) return false;

  // Drafts first: the rule applies to every role, including internal staff.
  if (event.status === "draft") return ownsEvent(actor, event);

  if (actor.role === "organiser") {
    return ownsEvent(actor, event) || sharesOrganisation(actor, event);
  }

  // An attendee is a member of the public, not a planning participant: they
  // see an event only once it is confirmed and open to registration
  // (briefing §4 "Attendee Registration": register for *confirmed* events) -
  // or, once registration is turned off, if they already hold a place in it
  // (SPM-64; #10: attendees "can view events that they register for").
  if (actor.role === "attendee") {
    return event.status === "confirmed" && (event.registrationEnabled === true || event.attendeeHoldsPlace === true);
  }

  return INTERNAL_ROLES.includes(actor.role);
}

/// The same rule as canViewEvent(), expressed as a Prisma `where` clause so a
/// list query filters in the database instead of fetching everything and
/// discarding rows. Keep the two in step: the tests assert they agree.
export function eventListWhere(actor: Actor): Record<string, unknown> {
  if (!can(actor.role, "event:view")) {
    // Matches nothing. Cheaper and safer than special-casing every caller.
    return { id: { equals: "00000000-0000-0000-0000-000000000000" } };
  }

  if (actor.role === "organiser") {
    // Own events including drafts, plus non-draft events of the same client.
    // A colleague's unsubmitted draft is still private to them.
    const clauses: Record<string, unknown>[] = [{ organiserId: actor.id }];
    if (actor.organisationId != null) {
      clauses.push({ organisationId: actor.organisationId, status: { not: "draft" } });
    }
    return { OR: clauses };
  }

  if (actor.role === "attendee") {
    return {
      status: "confirmed",
      OR: [
        { registrationEnabled: true },
        { registrations: { some: { attendeeId: actor.id, status: { in: HOLDING_A_PLACE } } } },
      ],
    };
  }

  return { status: { not: "draft" } };
}

/// SPM-24: a draft's own content is editable only by the organiser who owns
/// it, and only while it is still a draft. Once submitted, changes go through
/// EventChangeRequest.
export function canEditEventContent(actor: Actor, event: EventAccessFields): boolean {
  if (!can(actor.role, "event:edit_draft")) return false;
  return ownsEvent(actor, event) && event.status === "draft";
}

/// SPM-62: an event's information can be updated after approval, while it is
/// being planned, and once confirmed - the window in which arrangements exist
/// or are being made. Not while it is still a request (Under review, SPM-28),
/// not once Postponed (a new date goes through a change request, SPM-38), and
/// never once final.
export const EVENT_INFORMATION_STATUSES: readonly string[] = ["approved", "planning", "confirmed"];

/// SPM-62: only the coordinator assigned to the event updates its
/// information. The organiser asks through a change request (SPM-35,
/// clarification #102). The status window is checked separately, so a refusal
/// can say which rule was broken.
export function canUpdateEventInformation(actor: Actor, event: EventAccessFields): boolean {
  return isAssignedCoordinator(actor, event);
}

/// SPM-64: an event's registration settings are set up by the coordinator
/// assigned to it - "the event coordinator would be in-charge" of the
/// registration period (customer clarification #30). The organiser sees them
/// read-only. The status window is EVENT_INFORMATION_STATUSES, checked
/// separately as for SPM-62, so a refusal can say which rule was broken.
export function canConfigureRegistration(actor: Actor, event: EventAccessFields): boolean {
  return isAssignedCoordinator(actor, event);
}

/// SPM-47: equipment requirements are recorded and revised by the coordinator
/// assigned to the event (SPM-30 removed the "any coordinator while it has
/// none yet" allowance - see isAssignedCoordinator). Unlike canEditEventContent this is not restricted to draft: equipment
/// planning is explicitly a during-planning activity, well past draft.
export function canManageEquipmentRequests(actor: Actor, event: EventAccessFields): boolean {
  if (!can(actor.role, "equipment_request:manage")) return false;
  return isAssignedCoordinator(actor, event);
}

/// SPM-47 AC6 names Technical Support Staff. The Organiser also gets a
/// read-only view of their own event's equipment — confirmed 2026-09-19 this
/// is intended (an Organiser reasonably wants to see what's been recorded
/// against the event they raised), even though it's broader than AC6's own
/// wording. Restricted to the event they own: an Organiser has no reason to
/// see another client's equipment planning (briefing §8b). The Coordinator
/// can see it too, but only because canManageEquipmentRequests already
/// requires that (you cannot manage what you cannot see) — not a second,
/// independent viewing right.
export function canViewEquipmentRequests(actor: Actor, event: EventAccessFields): boolean {
  if (actor.role === "tech_support") return techSupportSeesEquipment(event.status);
  if (actor.role === "organiser") return ownsEvent(actor, event);
  return canManageEquipmentRequests(actor, event);
}

/// Event statuses in which Technical Support sees an event's equipment at all.
/// The BPMN puts their lane after the Coordinator's "Record equipment request":
/// "Check equipment availability" and "Reserve equipment" sit in Planning, and
/// "Prepare equipment / on-site support" in Confirmed. Before Planning the
/// equipment is still part of the organiser's request - the Coordinator has
/// not acted on it yet (team decision, 3 Oct 2026, Kristen). Postponed,
/// cancelled, rejected and completed events have nothing left to arrange.
/// SPM-86: Safety review sits between Planning and Confirmed, so they keep
/// sight of what they reserved while the safety check is pending (read-only:
/// reserving stays a Planning action, eventAllowsReserving()).
export const TECH_SUPPORT_EQUIPMENT_STATUSES: readonly string[] = ["planning", "safety_review", "confirmed"];

export function techSupportSeesEquipment(eventStatus: string): boolean {
  return TECH_SUPPORT_EQUIPMENT_STATUSES.includes(eventStatus);
}

/// SPM-48: "As Technical Support Staff, I want to check whether sufficient
/// suitable equipment is available". Deliberately narrower than
/// canViewEquipmentRequests - a result names the OTHER events holding the
/// equipment ("Held by Gala Dinner until 13 Oct"), which would show an
/// Organiser another client's events (briefing §8b).
export function canCheckEquipmentAvailability(actor: Actor): boolean {
  return actor.role === "tech_support";
}

/// SPM-49: "As Technical Support Staff, I want to reserve available equipment
/// for an event." Uses the `equipment_request:review` action that was already
/// in the permission model (ROLE_PERMISSIONS, tech_support) but unused until
/// now - see DOCUMENTATION.md Known Gaps. Same set of people as
/// canCheckEquipmentAvailability() in practice (only tech_support holds this
/// action), kept as its own function because reserving is a distinct action
/// from viewing, not just a stricter view.
export function canReserveEquipment(actor: Actor): boolean {
  return can(actor.role, "equipment_request:review");
}

/// SPM-50: "As Technical Support Staff, I want to review and update equipment
/// requests." Updating a line's fulfilment status and technical notes is the
/// same `equipment_request:review` action as reserving - the other half of
/// Technical Support's review of a request.
export function canUpdateEquipmentFulfilment(actor: Actor): boolean {
  return can(actor.role, "equipment_request:review");
}

/// SPM-42: a venue booking is requested by the coordinator assigned to the
/// event, the same relationship rule as equipment (canManageEquipmentRequests).
export function canRequestVenueBooking(actor: Actor, event: EventAccessFields): boolean {
  if (!can(actor.role, "venue_booking:request")) return false;
  return isAssignedCoordinator(actor, event);
}

// ---------------------------------------------------------------------------
// COORDINATOR ASSIGNMENT (SPM-30)
// ---------------------------------------------------------------------------

/// A submitted event is waiting for its first coordinator. Assigning one moves
/// it to under_review in the same action (confirmed 2026-09-28; recorded
/// earlier under SPM-31's decisions in DOCUMENTATION.md).
export const ASSIGNABLE_STATUSES: readonly string[] = ["submitted"];

/// An event that already has a coordinator can be handed to another while it
/// is still live - "reassignment may be required when staff responsibilities
/// or availability change" (briefing p.5, clarification #94). Not once it is
/// completed, cancelled or rejected: there is nothing left to coordinate.
export const REASSIGNABLE_STATUSES: readonly string[] = [
  "under_review",
  "approved",
  "planning",
  // SPM-86: still live while the Safety Officer reviews it.
  "safety_review",
  "confirmed",
  "postponed",
];

/// May this user assign (or reassign) this event's coordinator? Only the
/// Event Operations Manager (clarifications #94, #101), and only while the
/// event is waiting for one or still live.
export function canAssignCoordinator(actor: Actor, event: EventAccessFields): boolean {
  if (!can(actor.role, "event:assign_coordinator")) return false;
  if (event.coordinatorId === null) return ASSIGNABLE_STATUSES.includes(event.status);
  return REASSIGNABLE_STATUSES.includes(event.status);
}

// ---------------------------------------------------------------------------
// EVENT REVIEW (SPM-28)
// ---------------------------------------------------------------------------

/// A request can be reviewed only while it is under review. Assignment moves
/// it there (SPM-30), and an approve or reject moves it out, so a request is
/// decided once. A clarification keeps it here (DOCUMENTATION.md 2026-09-22).
export const REVIEWABLE_STATUSES: readonly string[] = ["under_review"];

/// The two outcomes of a review. Nothing else moves an event into these, so
/// the route can hold them to REVIEWABLE_STATUSES (confirmed 2026-09-30):
/// without that, the assigned coordinator could reject an event already in
/// Planning, which STATUS_TRANSITION_ROLES alone does not prevent.
export const REVIEW_OUTCOMES: readonly string[] = ["approved", "rejected"];

/// May this user review (approve or reject) this request right now? Only the
/// coordinator assigned to it, and only while it is under review.
export function canReviewEvent(actor: Actor, event: EventAccessFields): boolean {
  if (!can(actor.role, "event:review")) return false;
  return isAssignedCoordinator(actor, event) && REVIEWABLE_STATUSES.includes(event.status);
}

// ---------------------------------------------------------------------------
// STATUS TRANSITIONS
// ---------------------------------------------------------------------------

/// Which role may move an event INTO each status, from briefing §5:
///   Step 2  submit                      - the organiser who owns it
///   Step 3  assignment (-> under_review) - the Ops Manager, or a coordinator
///                                          picking up the queue
///   Step 5  approve / reject             - the assigned coordinator
///   Step 10 confirm                      - the assigned coordinator
///   Step 14 complete                     - the assigned coordinator
///   §4      cancel                       - the assigned coordinator only
///                                          (customer clarification #68)
///   §4      postpone                     - the coordinator, or the organiser
///                                          for their own event
///   §4      cancel                       - the assigned coordinator ONLY
///
/// Cancellation is deliberately narrower than postponement. Cancelling
/// releases the venue booking and the equipment reservations and drops the
/// attendee list (briefing §4 "Cancellation Management"), so it is the
/// coordinator's call as the event's owner inside ConnectSphere - not the
/// organiser's, and not the Ops Manager's. An organiser who wants to call an
/// event off asks their coordinator; the request route for that is Event
/// Change Requests, not this endpoint. Customer clarification, 2026-09-18.
///
/// Venue Staff and Technical Support appear nowhere here on purpose: they
/// decide their own bookings and equipment requests, not the event's status.
///
/// SPM-27 AC4, "the Event Organiser cannot manually change the event status":
/// the organiser only submits their own request. Postponing is the
/// coordinator's, like cancelling - an organiser asks through a change
/// request. Nothing moves an event back to draft. Decisions 2026-10-01.
/// Withdrawing is the assigned coordinator's too: the organiser asks outside
/// the system and the coordinator records it (customer clarification #103).
///
/// This says WHO may set a status, not which from->to moves are legal - that
/// is canTransition() in statuses.ts.
export const STATUS_TRANSITION_ROLES: Record<string, readonly Role[]> = {
  submitted: ["organiser"],
  withdrawn: ["coordinator"],
  under_review: ["ops_manager", "coordinator"],
  approved: ["coordinator"],
  rejected: ["coordinator"],
  planning: ["coordinator"],
  confirmed: ["coordinator"],
  completed: ["coordinator"],
  postponed: ["coordinator"],
  cancelled: ["coordinator"],
};

/// May this user move this event into `toStatus`? Both halves are checked:
/// the role must own the transition, and the user must be related to the
/// event (the organiser who owns it, or the coordinator responsible for it).
export function canSetEventStatus(
  actor: Actor,
  event: EventAccessFields,
  toStatus: string
): boolean {
  const allowed = STATUS_TRANSITION_ROLES[toStatus];
  if (!allowed || !isRole(actor.role)) return false;
  if (!allowed.includes(actor.role)) return false;

  if (actor.role === "organiser") return ownsEvent(actor, event);
  if (actor.role === "coordinator") return isAssignedCoordinator(actor, event);
  // ops_manager is the internal admin role: no per-event relationship.
  return true;
}

/// SPM-27: does the event page offer this user "Record withdrawal"? The same
/// two checks the PATCH route makes, so the button never offers a refusal.
export function canWithdrawEvent(actor: Actor, event: EventAccessFields): boolean {
  return canSetEventStatus(actor, event, "withdrawn") && canTransition(event.status, "withdrawn");
}

/// SPM-34 (AC4). Whether this actor may even attempt to confirm: the assigned
/// coordinator, on an event the lifecycle allows into Confirmed. Whether the
/// arrangements are ready is a separate question, answered by
/// checkEventConfirmation() - this only decides who sees the button.
export function canConfirmEvent(actor: Actor, event: EventAccessFields): boolean {
  return canSetEventStatus(actor, event, "confirmed") && canTransition(event.status, "confirmed");
}

// ---------------------------------------------------------------------------
// TRACK OUTSTANDING ARRANGEMENTS (SPM-33)
// ---------------------------------------------------------------------------

/// The Readiness list is the coordinator's planning checklist (UI_DESIGN.md
/// 4.3): any coordinator may read it, like the rest of an event they can see.
/// It reuses `event:confirm`, the action the checklist gates, rather than
/// adding one that would always be granted to the same role.
export function canViewArrangements(actor: Actor): boolean {
  return can(actor.role, "event:confirm");
}

/// An arrangement is marked as not required, or as required again, only while
/// the event is being planned (decided 2026-10-08). Not once it is Confirmed:
/// reversing a decision there would leave a confirmed event with something
/// outstanding. An event waiting on its Operational Safety Check (SPM-86) is
/// not here either - add its status only if the team decides arrangements may
/// still be waived while the Safety Officer is reviewing them.
export const ARRANGEMENT_MARKING_STATUSES: readonly string[] = ["planning"];

/// SPM-33 AC8: only the coordinator assigned to the event decides that one of
/// its arrangements is not required. The status window is checked separately,
/// so a refusal can say which rule was broken.
export function canMarkArrangements(actor: Actor, event: EventAccessFields): boolean {
  return isAssignedCoordinator(actor, event);
}

// ---------------------------------------------------------------------------
// OPERATIONAL SAFETY CHECK (SPM-86)
// ---------------------------------------------------------------------------

/// May this user submit this event for an Operational Safety Check? Only the
/// coordinator assigned to it (AC7), and only from Planning - so not again
/// while a check is pending (AC6). Whether the arrangements are ready is a
/// separate question, answered by checkSafetySubmission() - like Confirm
/// event, the button is offered and a refusal says what is outstanding.
/// Not in STATUS_TRANSITION_ROLES: Safety review is entered only through
/// POST /api/events/[id]/safety-check, never the status PATCH.
export function canSubmitForSafetyCheck(actor: Actor, event: EventAccessFields): boolean {
  return isAssignedCoordinator(actor, event) && event.status === "planning";
}

// ---------------------------------------------------------------------------
// BEGIN PLANNING (SPM-54)
// ---------------------------------------------------------------------------

/// "An event can only move to Planning from an Approved status" (SPM-54 AC2).
/// The status route holds a move to Planning to this, the same way it holds
/// approve and reject to REVIEWABLE_STATUSES: without it the assigned
/// coordinator could pull a Confirmed event back to Planning.
export const PLANNING_FROM_STATUSES: readonly string[] = ["approved"];

/// May this user begin planning this event right now? Only the coordinator
/// assigned to it, and only while it is Approved.
export function canBeginPlanning(actor: Actor, event: EventAccessFields): boolean {
  return PLANNING_FROM_STATUSES.includes(event.status) && canSetEventStatus(actor, event, "planning");
}

// ---------------------------------------------------------------------------
// FIELD VISIBILITY
// ---------------------------------------------------------------------------

/// What an Attendee is allowed to know about an event: the public listing.
/// Everything else on the record is internal planning information, which
/// briefing §8b says an Attendee must not see - including who is coordinating
/// it, who personally organised it, why something was rejected, what the
/// client asked for privately, and the venue and equipment arrangements.
///
/// "organisation" is a deliberate exception: an Attendee may see which
/// company is running the event (SPM-31), just not the organiser's own name
/// - "organiser" (which carries the personal name) stays off this list.
///
/// Hiding a tab in the UI does not do this. The API has to withhold the
/// fields, or the whole record is one request away.
export const ATTENDEE_EVENT_FIELDS = [
  "id",
  "sequenceNumber",
  "title",
  "description",
  "category",
  "startsAt",
  "endsAt",
  "status",
  "registrationEnabled",
  "registrationCapacity",
  "registrationOpensAt",
  "registrationClosesAt",
  "organisation",
  // SPM-51: whether they can register now, and if not why (registrationState()),
  // and their own registration for the event, if any.
  "registrationState",
  "myRegistration",
] as const;

/// Narrow an event record to the fields this actor may see. Returns a new
/// object; the caller passes whatever it fetched, relations included.
export function visibleEventFor<T extends Record<string, unknown>>(
  actor: Actor,
  event: T
): Partial<T> {
  if (actor.role !== "attendee") return event;

  const visible: Partial<T> = {};
  for (const field of ATTENDEE_EVENT_FIELDS) {
    if (field in event) {
      visible[field as keyof T] = event[field as keyof T];
    }
  }
  return visible;
}

/// The list form of visibleEventFor().
export function visibleEventsFor<T extends Record<string, unknown>>(
  actor: Actor,
  events: T[]
): Partial<T>[] {
  return events.map((event) => visibleEventFor(actor, event));
}

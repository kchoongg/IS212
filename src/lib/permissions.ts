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
  "equipment:manage",
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
    "event:cancel",
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
    "registration:view_list",
    "facility:view",
  ],
  ops_manager: [
    "event:view",
    "event:assign_coordinator",
    "event:cancel",
    "venue:view",
    "equipment:view",
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

/// A coordinator acts on the events assigned to them. An event nobody is
/// assigned to yet may be picked up by any coordinator - the review queue has
/// to be reachable before Coordinator Assignment is built, and an unassigned
/// event has no coordinator whose work would be trodden on.
export function isAssignedCoordinator(actor: Actor, event: EventAccessFields): boolean {
  if (actor.role !== "coordinator") return false;
  return event.coordinatorId === null || event.coordinatorId === actor.id;
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
  // (briefing §4 "Attendee Registration": register for *confirmed* events).
  if (actor.role === "attendee") {
    return event.status === "confirmed" && event.registrationEnabled === true;
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
    return { status: "confirmed", registrationEnabled: true };
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
///
/// Venue Staff and Technical Support appear nowhere here on purpose: they
/// decide their own bookings and equipment requests, not the event's status.
///
/// This says WHO may set a status, not which from->to moves are legal - the
/// lifecycle graph belongs to Event Status Management, a separate story.
export const STATUS_TRANSITION_ROLES: Record<string, readonly Role[]> = {
  draft: ["organiser"],
  submitted: ["organiser"],
  under_review: ["ops_manager", "coordinator"],
  approved: ["coordinator"],
  rejected: ["coordinator"],
  planning: ["coordinator"],
  confirmed: ["coordinator"],
  completed: ["coordinator"],
  postponed: ["coordinator", "organiser"],
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

// ---------------------------------------------------------------------------
// FIELD VISIBILITY
// ---------------------------------------------------------------------------

/// What an Attendee is allowed to know about an event: the public listing.
/// Everything else on the record is internal planning information, which
/// briefing §8b says an Attendee must not see - including who is coordinating
/// it, why something was rejected, what the client asked for privately, and
/// the venue and equipment arrangements.
///
/// Hiding a tab in the UI does not do this. The API has to withhold the
/// fields, or the whole record is one request away.
export const ATTENDEE_EVENT_FIELDS = [
  "id",
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

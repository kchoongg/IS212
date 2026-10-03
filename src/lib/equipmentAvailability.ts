// SPM-48 — Check Equipment Availability. Pure rules only: no database, no
// Next.js. The API route loads the rows; everything that decides "is there
// enough?" lives here so it can be unit-tested and reused by every screen that
// shows availability (the briefing asks that users never see contradictory
// equipment availability).
//
// Rules, and where each comes from (customer Q&A, IS212-2026 discussions):
//  * #5   Equipment is collected the day before the event (D-1). After the
//         event it is returned, checked and prepared, so it is only available
//         again from Return Day+1. Events on the same day cannot share it.
//  * #2   Transfer + preparation time applies BEFORE the event, when the
//         equipment has to move to the venue. After the event only the
//         Return Day+1 rule applies - nothing is added after the event.
//  * #113 There is no fixed Return Day; the team decides. Here it is the
//         event's own end date (the day the kit comes back).
//  * SCHEMA_REFERENCE.md: only `reserved` and `partially_fulfilled` requests
//         count against availability, by quantityReserved.
//  * SPM-37 / SPM-38: cancelling or postponing releases equipment. Until those
//         stories cascade that onto the request rows, requests belonging to
//         cancelled / postponed / rejected / draft events are ignored here
//         (TEMPORARY - see COMMITTING_EVENT_STATUSES).

import { EQUIPMENT_LOAD_WINDOW_MS } from "@/lib/eventSessions";

/// Fixed transfer + preparation time before an event (team proposal; Q&A #2
/// leaves the representation to the team). One value for every item.
export const EQUIPMENT_TRANSFER_PREP_MS = EQUIPMENT_LOAD_WINDOW_MS;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/// Calendar days are Singapore days (UTC+8, no daylight saving). The codebase
/// has no other timezone convention yet, so this is stated here rather than
/// leaving a UTC "day" that starts at 08:00 local time.
const SINGAPORE_OFFSET_MS = 8 * HOUR_MS;

/// Whole days since 1970-01-01, counted in Singapore time.
export function dayIndex(at: Date): number {
  return Math.floor((at.getTime() + SINGAPORE_OFFSET_MS) / DAY_MS);
}

/// The instant a Singapore calendar day starts.
export function dayStart(index: number): Date {
  return new Date(index * DAY_MS - SINGAPORE_OFFSET_MS);
}

export interface BlockedDays {
  /// First blocked day: the collection day (D-1), or earlier if the transfer
  /// lead time reaches back further than that.
  firstDay: number;
  /// Last blocked day: the Return Day. Equipment is available again from the
  /// day after.
  lastDay: number;
}

/// The whole calendar days one commitment holds the equipment for. `endsAt` is
/// treated as exclusive, so an event finishing at exactly 00:00 belongs to the
/// day before.
export function blockedDays(startsAt: Date, endsAt: Date, transferLeadMs = 0): BlockedDays {
  const collectionDay = dayIndex(startsAt) - 1;
  const leavesDay = dayIndex(new Date(startsAt.getTime() - transferLeadMs));
  const returnDay = dayIndex(new Date(endsAt.getTime() - 1));
  return { firstDay: Math.min(collectionDay, leavesDay), lastDay: Math.max(returnDay, dayIndex(startsAt)) };
}

export function daysOverlap(a: BlockedDays, b: BlockedDays): boolean {
  return a.firstDay <= b.lastDay && b.firstDay <= a.lastDay;
}

/// When the equipment has to leave for an event: the start minus transfer time.
export function equipmentLeavesAt(startsAt: Date, transferLeadMs: number): Date {
  return new Date(startsAt.getTime() - transferLeadMs);
}

export interface TransferLead {
  leadMs: number;
  /// False when the event has no venue yet: no transfer time can be worked out,
  /// so none is applied and the screen says so ("venue not yet chosen").
  venueChosen: boolean;
}

/// Equipment with no location is at ConnectSphere storage (null). It needs no
/// transfer time only when it already sits at the event's venue.
export function transferLeadFor(
  equipmentLocationVenueId: string | null,
  eventVenueId: string | null
): TransferLead {
  if (!eventVenueId) return { leadMs: 0, venueChosen: false };
  return {
    leadMs: equipmentLocationVenueId === eventVenueId ? 0 : EQUIPMENT_TRANSFER_PREP_MS,
    venueChosen: true,
  };
}

export const COMMITTING_REQUEST_STATUSES = ["reserved", "partially_fulfilled"];
/// TEMPORARY: SPM-37/38 should release these requests themselves. Revisit then.
export const RELEASED_EVENT_STATUSES = ["cancelled", "postponed", "rejected", "draft"];

/// Does this request hold stock, and how many units?
export function committedQuantity(request: {
  status: string;
  quantityReserved: number | null;
  eventStatus: string;
}): number {
  if (!COMMITTING_REQUEST_STATUSES.includes(request.status)) return 0;
  if (RELEASED_EVENT_STATUSES.includes(request.eventStatus)) return 0;
  return Math.max(0, request.quantityReserved ?? 0);
}

export interface Commitment {
  eventTitle: string;
  quantity: number;
  startsAt: Date;
  endsAt: Date;
  transferLeadMs: number;
}

export type AvailabilityStatus = "available" | "partial" | "unavailable";

export interface AvailabilityInput {
  totalQuantity: number;
  quantityInMaintenance: number;
  isActive: boolean;
  requested: number;
  /// The event (or session) being checked - its own times, not the widened
  /// request window.
  startsAt: Date;
  endsAt: Date;
  transferLeadMs: number;
  /// Other events' commitments for the SAME equipment item. The caller leaves
  /// out the event being checked, so it never blocks itself.
  commitments: Commitment[];
}

export interface HeldBy {
  eventTitle: string;
  quantity: number;
  /// First day the equipment is free again (Return Day+1), as the start of that
  /// Singapore day.
  availableAgainFrom: Date;
}

export interface AvailabilityResult {
  status: AvailabilityStatus;
  total: number;
  inMaintenance: number;
  reservedElsewhere: number;
  available: number;
  requested: number;
  shortfall: number;
  heldBy: HeldBy[];
  /// When the equipment leaves for this event.
  leavesAt: Date;
}

/// available = total - in maintenance - reserved elsewhere, where "reserved
/// elsewhere" is the most units other commitments hold on any single day this
/// one needs. Units are pooled and interchangeable, so two commitments that
/// never share a day can use the same units: adding them up would report a
/// shortfall that isn't there.
export function checkAvailability(input: AvailabilityInput): AvailabilityResult {
  const mine = blockedDays(input.startsAt, input.endsAt, input.transferLeadMs);
  const overlapping = input.commitments
    .filter((c) => c.quantity > 0)
    .map((c) => ({ c, days: blockedDays(c.startsAt, c.endsAt, c.transferLeadMs) }))
    .filter(({ days }) => daysOverlap(mine, days));

  let reservedElsewhere = 0;
  for (let day = mine.firstDay; day <= mine.lastDay; day++) {
    const heldThatDay = overlapping
      .filter(({ days }) => days.firstDay <= day && day <= days.lastDay)
      .reduce((sum, { c }) => sum + c.quantity, 0);
    reservedElsewhere = Math.max(reservedElsewhere, heldThatDay);
  }
  const inMaintenance = Math.max(0, input.quantityInMaintenance);
  const total = Math.max(0, input.totalQuantity);
  // A retired item is never available, whatever total is still recorded.
  const available = input.isActive ? Math.max(0, total - inMaintenance - reservedElsewhere) : 0;

  let status: AvailabilityStatus;
  if (available >= input.requested) status = "available";
  else if (available === 0) status = "unavailable";
  else status = "partial";

  return {
    status,
    total,
    inMaintenance,
    reservedElsewhere,
    available,
    requested: input.requested,
    shortfall: Math.max(0, input.requested - available),
    heldBy: overlapping.map(({ c, days }) => ({
      eventTitle: c.eventTitle,
      quantity: c.quantity,
      availableAgainFrom: dayStart(days.lastDay + 1),
    })),
    leavesAt: equipmentLeavesAt(input.startsAt, input.transferLeadMs),
  };
}

/// The request-level banner: shown when any line is not fully available.
export function allLinesAvailable(results: Pick<AvailabilityResult, "status">[]): boolean {
  return results.every((r) => r.status === "available");
}

/// SPM-49 AC1/AC5. There is no quantity box: clicking Reserve always takes the
/// smaller of what was requested and what is available - never more than
/// either one (team decision, replacing an earlier "type a number" design).
export function reserveQuantity(requested: number, available: number): number {
  return Math.max(0, Math.min(requested, available));
}

/// SPM-49 / SPM-50: Technical Support's work on an event's equipment - checking
/// and reserving it, and updating its fulfilment status - happens while the
/// event is in Planning, where the BPMN puts "Check equipment availability" and
/// "Reserve equipment". A Confirmed event's equipment is still shown to them
/// (to prepare it) but is final; a change to it goes back through a change
/// request. One rule for the routes, which refuse, and the Equipment request
/// screen, which hides the buttons and says why.
export function eventAllowsReserving(eventStatus: string): boolean {
  return eventStatus === "planning";
}

export function reservingClosedMessage(eventStatus: string): string {
  if (eventStatus === "confirmed") {
    return "This event is confirmed — its equipment is final. A change now goes through a change request.";
  }
  return `This event is ${eventStatus.replace(/_/g, " ")} — equipment can be reserved and updated while the event is in planning.`;
}

// Join and Respond to Waiting List (SPM-66). The rules; waitingListService.ts
// applies them to the database.
//
// A full event's waiting list is first in, first out (#26), with the assigned
// coordinator able to override the order. A free place is offered to the
// first attendee waiting, who has 3 days to accept it (#44) - or until the
// event starts, if that is sooner (AC10; #116 leaves the cut-off to the team).
// A place under offer is held: nobody can register into it (AC8).
//
// A registration is "waitlisted" while it waits; an offer is the
// offerExpiresAt column being set on it. Declining or letting an offer lapse
// leaves the list (decided 2026-10-23), so the place is not offered to them
// again at once; an offer ended by the event starting does not - that was
// nobody's choice.

import { formatDateTime } from "./format";
import { isTerminalEventStatus } from "./statuses";
import {
  REGISTRATION_REFUSALS,
  WITHDRAW_REFUSALS,
  type RegistrationState,
  type WithdrawEventFields,
} from "./registrationEligibility";

/// #44: how long an attendee has to accept an offer.
export const OFFER_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

/// How an offer ended without being accepted (Registration.offerEndedReason).
export type OfferEndedReason = "declined" | "expired" | "event_started" | "moved" | "left";

export const WAITING_LIST_MESSAGES = {
  notFull: "This event still has places, so register instead.",
  alreadyRegistered: "You're already registered for this event.",
  alreadyWaiting: "You're already on the waiting list for this event.",
  noOffer: "There is no place on offer to you for this event.",
  offerEnded: "This offer has ended.",
  started: "This event has started, so places are no longer offered.",
  notWaiting: "Only an attendee on the waiting list can be offered a place.",
  alreadyOffered: "A place is already on offer to this attendee.",
  noPlaceOnOffer: "There is no place on offer to give to someone else.",
  coordinatorOnly: "Only the event's assigned coordinator can offer a place out of turn.",
} as const;

/// When an offer made now ends: 3 days later, or when the event starts if that
/// is sooner (AC6, AC10).
export function offerExpiry(now: Date, eventStartsAt: Date | null): Date {
  const threeDays = new Date(now.getTime() + OFFER_WINDOW_DAYS * DAY_MS);
  return eventStartsAt && eventStartsAt < threeDays ? new Date(eventStartsAt) : threeDays;
}

/// AC10: no offer once the event has started (or if it has no start).
export function hasStarted(startsAt: Date | string | null | undefined, now: Date): boolean {
  return !startsAt || new Date(startsAt).getTime() <= now.getTime();
}

export interface PlaceCounts {
  /// Registered or attended (SEAT_TAKING).
  taken: number;
  /// Waitlisted with an offer standing (AC8: held, not free).
  underOffer: number;
  /// Waitlisted with no offer.
  waiting: number;
}

/// How many places can be offered now: the capacity less the places taken and
/// under offer. None without a capacity - such an event is never full.
export function freePlaces(capacity: number | null, counts: PlaceCounts): number {
  if (capacity == null) return 0;
  return Math.max(0, capacity - counts.taken - counts.underOffer);
}

/// AC1, AC8: the event is full for a newcomer when its places are taken or
/// under offer - or while anyone is still waiting, so a newcomer never
/// overtakes the waiting list.
export function isFullForNewcomers(capacity: number | null, counts: PlaceCounts): boolean {
  if (capacity == null) return false;
  return counts.waiting > 0 || counts.taken + counts.underOffer >= capacity;
}

/// What registrationState() is given as the seats taken, so that "full"
/// follows isFullForNewcomers().
export function seatsHeld(capacity: number | null, counts: PlaceCounts): number {
  if (capacity != null && isFullForNewcomers(capacity, counts)) return capacity;
  return counts.taken + counts.underOffer;
}

/// AC1, AC2: why this attendee can't join the waiting list now, or null. The
/// event must be full while registration is open - registrationState() is
/// "full" exactly then.
export function joinRefusal(state: RegistrationState, existingStatus: string | null): string | null {
  if (existingStatus === "registered" || existingStatus === "attended") return WAITING_LIST_MESSAGES.alreadyRegistered;
  if (existingStatus === "waitlisted") return WAITING_LIST_MESSAGES.alreadyWaiting;
  if (state.kind === "open") return WAITING_LIST_MESSAGES.notFull;
  if (state.kind !== "full") return REGISTRATION_REFUSALS[state.kind];
  return null;
}

export interface WaitingRow {
  id: string;
  waitlistedAt: Date | string | null;
  registeredAt: Date | string;
}

const joined = (r: WaitingRow) => new Date(r.waitlistedAt ?? r.registeredAt).getTime();

/// First in, first out (#26): earliest to join first; ties by id, so the
/// order never changes between two reads.
export function waitingOrder<T extends WaitingRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => joined(a) - joined(b) || a.id.localeCompare(b.id));
}

/// AC3: an attendee's place in the queue, counting from 1, or null if they
/// are not on it. Those ahead who leave move everyone behind up (AC4), since
/// the position is counted, not stored.
export function waitingPosition(rows: readonly WaitingRow[], registrationId: string): number | null {
  const index = waitingOrder(rows).findIndex((r) => r.id === registrationId);
  return index < 0 ? null : index + 1;
}

/// AC4: why the attendee can't leave the waiting list now, or null. As with
/// withdrawing (SPM-52), an event that is over or cancelled keeps its list as
/// it was.
export function leaveRefusal(event: WithdrawEventFields, now: Date): string | null {
  if (event.status === "cancelled") return WITHDRAW_REFUSALS.cancelled;
  if (isTerminalEventStatus(event.status)) return WITHDRAW_REFUSALS.over;
  if (event.endsAt && new Date(event.endsAt) <= now) return WITHDRAW_REFUSALS.over;
  return null;
}

/// AC6: may the offer be accepted now?
export function offerStands(offerExpiresAt: Date | string | null | undefined, now: Date): boolean {
  return offerExpiresAt != null && new Date(offerExpiresAt).getTime() > now.getTime();
}

/// The notifications SPM-66 sends (AC5).
export function offerMadeNotice(eventTitle: string | null, expiresAt: Date) {
  return {
    type: "waitlist_offer",
    title: "A place is available",
    body: `A place is available for "${eventTitle || "an event"}". Accept it by ${formatDateTime(expiresAt)}, or it goes to the next person on the waiting list.`,
  };
}

export function offerEndedNotice(eventTitle: string | null, reason: Exclude<OfferEndedReason, "declined" | "left">) {
  const title = eventTitle || "an event";
  const body = {
    expired: `Your offer of a place for "${title}" has ended because it wasn't accepted in time, and you have left the waiting list.`,
    event_started: `Your offer of a place for "${title}" has ended because the event has started. You're still on the waiting list.`,
    moved: `The coordinator has offered the place for "${title}" to someone else. You're still on the waiting list, in the same position.`,
  }[reason];
  return { type: "waitlist_offer_ended", title: "Your offer has ended", body };
}

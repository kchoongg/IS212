// Register for Event (SPM-51): whether an attendee may register for an event
// right now, and if not, why.
//
// AC3: "An event is eligible only when it is Confirmed, registration is
// enabled, and the current date falls within its registration period." The
// period is Configure Event Registration's (SPM-64); without one there is no
// period to fall within, so the event is not eligible (decided 2026-10-10).
// AC9: registration stops once the capacity is reached - a capacity that isn't
// set means no limit, as before.
//
// PURE, like the rest of src/lib: the register route (POST /api/registrations)
// and the screens call it, so the reason a button is missing and the reason a
// request is refused are the same rule.

import { isTerminalEventStatus } from "./statuses";

/// The registration statuses that take a seat. A waitlisted attendee is
/// waiting for one, and a withdrawn one gave theirs back.
export const SEAT_TAKING = ["registered", "attended"];

export type RegistrationState =
  | { kind: "open" }
  | { kind: "not_confirmed" }
  | { kind: "disabled" }
  | { kind: "no_period" }
  | { kind: "not_open"; opensAt: Date }
  | { kind: "closed"; closesAt: Date }
  | { kind: "full" };

export type RegistrationRefusal = Exclude<RegistrationState["kind"], "open">;

/// What the register route answers with for each refusal. The first five
/// predate SPM-51 and are unchanged.
export const REGISTRATION_REFUSALS: Record<RegistrationRefusal, string> = {
  not_confirmed: "Event is not open for registration yet",
  disabled: "Registration is not enabled for this event",
  no_period: "Registration dates haven't been set for this event",
  not_open: "Registration has not opened yet",
  closed: "Registration has closed",
  full: "This event is full",
};

export interface EligibilityFields {
  status: string;
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
}

/// In the order an attendee would want to be told: an event that isn't
/// happening yet, then one with no registration at all, then the period, and
/// only then whether there is room. The opening and closing moments
/// themselves are inside the period.
export function registrationState(event: EligibilityFields, seatsTaken: number, now: Date): RegistrationState {
  if (event.status !== "confirmed") return { kind: "not_confirmed" };
  if (!event.registrationEnabled) return { kind: "disabled" };

  const opensAt = event.registrationOpensAt;
  const closesAt = event.registrationClosesAt;
  if (!opensAt || !closesAt) return { kind: "no_period" };
  if (now < opensAt) return { kind: "not_open", opensAt };
  if (now > closesAt) return { kind: "closed", closesAt };

  if (event.registrationCapacity != null && seatsTaken >= event.registrationCapacity) return { kind: "full" };
  return { kind: "open" };
}

/// Withdraw from Event (SPM-52): only a registration that holds a seat now can
/// be withdrawn. Leaving the waiting list is Join and Respond to Waiting List
/// (SPM-66); an attended or already withdrawn one has nothing to give back.
export const WITHDRAWABLE = ["registered"];

export const WITHDRAW_REFUSALS = {
  not_active: "Only an active registration can be withdrawn",
  cancelled: "This event has been cancelled, so there is nothing to withdraw from",
  over: "This event is over, so the registration can no longer be withdrawn",
};

export interface WithdrawEventFields {
  status: string;
  /// A Date on the server, an ISO string on the screens.
  endsAt: Date | string | null;
}

/// Why this registration can't be withdrawn now, or null if it can. An event
/// that is cancelled, completed or past its end keeps its registrations as
/// they were - its history must not change.
export function withdrawRefusal(status: string, event: WithdrawEventFields, now: Date): string | null {
  if (!WITHDRAWABLE.includes(status)) return WITHDRAW_REFUSALS.not_active;
  if (event.status === "cancelled") return WITHDRAW_REFUSALS.cancelled;
  if (isTerminalEventStatus(event.status)) return WITHDRAW_REFUSALS.over;
  if (event.endsAt && new Date(event.endsAt) <= now) return WITHDRAW_REFUSALS.over;
  return null;
}

export function canWithdraw(status: string, event: WithdrawEventFields, now: Date): boolean {
  return withdrawRefusal(status, event, now) === null;
}

export const WITHDRAW_WARNINGS = {
  disabled:
    "Registration for this event has been turned off, so you can't register again. Once you withdraw, you won't be able to open this event any more.",
  closed: "Registration for this event has closed, so you can't register again.",
};

export interface WithdrawWarningFields {
  registrationEnabled: boolean;
  /// A Date on the server, an ISO string on the screens.
  registrationClosesAt: Date | string | null;
}

/// SPM-52: said in the Withdraw question when the attendee couldn't register
/// again afterwards, or null when they could. With registration turned off they
/// only see the event while they hold a place (#10, canViewEvent()), so they
/// lose it too.
export function withdrawWarning(event: WithdrawWarningFields, now: Date): string | null {
  if (!event.registrationEnabled) return WITHDRAW_WARNINGS.disabled;
  if (event.registrationClosesAt && new Date(event.registrationClosesAt) < now) return WITHDRAW_WARNINGS.closed;
  return null;
}

export interface RegistrationCounts {
  /// Seats held now (SEAT_TAKING).
  taken: number;
  /// SPM-65 AC5: on the waiting list, holding no seat yet.
  waitlisted: number;
  withdrawn: number;
}

/// SPM-52 AC5: what the organiser and coordinator see on the Registration
/// card, from the event's registrations counted by status. SPM-65 AC5: and on
/// the registration list.
export function registrationCounts(byStatus: { status: string; count: number }[]): RegistrationCounts {
  const sum = (statuses: string[]) =>
    byStatus.filter((s) => statuses.includes(s.status)).reduce((total, s) => total + s.count, 0);
  return { taken: sum(SEAT_TAKING), waitlisted: sum(["waitlisted"]), withdrawn: sum(["withdrawn"]) };
}

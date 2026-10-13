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

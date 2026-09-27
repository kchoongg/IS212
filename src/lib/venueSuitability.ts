// Is this venue suitable for this event? (SPM-41)
//
// The acceptance criteria this exists for:
//   - attendance is compared with the venue's capacity for the event's selected
//     LAYOUT, never with the single venue-wide maxCapacity;
//   - required facilities, required accessibility features and the required
//     layout are each checked;
//   - a venue failing a mandatory requirement is unsuitable, and the result
//     says which requirement it failed.
//
// Everything here is a PURE function over plain data - no Prisma, no
// NextRequest - like src/lib/venueImpact.ts and src/lib/permissions.ts, so the
// rules can be tested without a database. The route in
// src/app/api/events/[id]/venue-suitability/route.ts loads the rows and calls
// assessVenues().

/// A requirement the venue does not meet. Structured, not prose, so a screen can
/// group or filter by `kind`; describeUnmet() is the wording.
export type UnmetRequirement =
  | {
      kind: "capacity";
      layoutName: string;
      layoutCapacity: number;
      expectedAttendance: number;
    }
  | { kind: "layout"; layoutName: string }
  | {
      kind: "facility";
      facilityId: string;
      name: string;
      /// `facility` or `accessibility` (Facility.category).
      category: string;
    };

/// What the event asks of a venue. `expectedAttendance` and `preferredLayout`
/// are nullable because a draft can be incomplete; a null skips the check that
/// needs it rather than guessing (see missingEventInputs()).
export interface EventNeeds {
  expectedAttendance: number | null;
  preferredLayout: string | null;
  requirements: readonly {
    facilityId: string;
    name: string;
    category: string;
    isMandatory: boolean;
  }[];
}

/// The parts of a venue the check depends on. Declared structurally rather than
/// as the Prisma type so tests can use object literals.
export interface VenueCapabilities {
  layouts: readonly { layoutName: string; capacity: number }[];
  facilityIds: readonly string[];
}

export interface Suitability {
  /// True only when every mandatory requirement is met.
  suitable: boolean;
  /// Mandatory requirements not met. Empty when suitable.
  unmet: UnmetRequirement[];
  /// Nice-to-have facilities the venue lacks. Shown, but never disqualifying
  /// (EventFacilityRequirement.isMandatory in schema.prisma).
  optionalMissing: UnmetRequirement[];
}

export function checkVenueSuitability(event: EventNeeds, venue: VenueCapabilities): Suitability {
  const unmet: UnmetRequirement[] = [];
  const optionalMissing: UnmetRequirement[] = [];

  // Layout and capacity. One layout row answers both questions: does the venue
  // offer this layout, and how many does it seat in it. When the layout is not
  // offered there is no capacity to compare, and venue.maxCapacity is never a
  // fallback - the whole point of the story.
  if (event.preferredLayout != null) {
    const layout = venue.layouts.find((l) => l.layoutName === event.preferredLayout);
    if (!layout) {
      unmet.push({ kind: "layout", layoutName: event.preferredLayout });
    } else if (event.expectedAttendance != null && layout.capacity < event.expectedAttendance) {
      unmet.push({
        kind: "capacity",
        layoutName: layout.layoutName,
        layoutCapacity: layout.capacity,
        expectedAttendance: event.expectedAttendance,
      });
    }
  }

  // Facilities and accessibility features are the same table with a category,
  // so one loop covers AC2 and AC3.
  for (const req of event.requirements) {
    if (venue.facilityIds.includes(req.facilityId)) continue;
    const missing: UnmetRequirement = {
      kind: "facility",
      facilityId: req.facilityId,
      name: req.name,
      category: req.category,
    };
    (req.isMandatory ? unmet : optionalMissing).push(missing);
  }

  return { suitable: unmet.length === 0, unmet, optionalMissing };
}

/// What the event has not said yet, so the check could not run in full. A venue
/// shown as suitable while the layout is unknown would be a promise nobody made.
export function missingEventInputs(
  event: Pick<EventNeeds, "expectedAttendance" | "preferredLayout">
): ("expectedAttendance" | "preferredLayout")[] {
  const missing: ("expectedAttendance" | "preferredLayout")[] = [];
  if (event.expectedAttendance == null) missing.push("expectedAttendance");
  if (event.preferredLayout == null) missing.push("preferredLayout");
  return missing;
}

/// "u_shape" -> "U shape", "theatre" -> "Theatre".
export function layoutLabel(layoutName: string): string {
  const spaced = layoutName.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/// The sentence shown against a failing venue: names the requirement and, for
/// capacity, both figures.
export function describeUnmet(unmet: UnmetRequirement): string {
  switch (unmet.kind) {
    case "capacity":
      return (
        `${layoutLabel(unmet.layoutName)} capacity is ${unmet.layoutCapacity} - ` +
        `your event expects ${unmet.expectedAttendance}.`
      );
    case "layout":
      return `${layoutLabel(unmet.layoutName)} layout is not offered.`;
    case "facility":
      return unmet.category === "accessibility"
        ? `Missing accessibility feature: ${unmet.name}.`
        : `Missing facility: ${unmet.name}.`;
  }
}

export interface VenueAssessment<V> extends Suitability {
  venue: V;
}

/// Every venue with its verdict, best first: suitable venues, then the ones
/// closest to suitable, then by name. Unsuitable venues stay in the list - a
/// coordinator may still want to ask about one (VenueSearch mockup, §7.4).
export function assessVenues<V extends VenueCapabilities & { name: string }>(
  event: EventNeeds,
  venues: readonly V[]
): VenueAssessment<V>[] {
  return venues
    .map((venue) => ({ venue, ...checkVenueSuitability(event, venue) }))
    .sort(
      (a, b) =>
        Number(b.suitable) - Number(a.suitable) ||
        a.unmet.length - b.unmet.length ||
        a.venue.name.localeCompare(b.venue.name)
    );
}

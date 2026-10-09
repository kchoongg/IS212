// Shared by the "add venue" and "edit venue" screens (S-19/S-20, SPM-39). The
// two forms are the same fields validated the same way — one copy means a rule
// changed here cannot drift between create and edit. Same arrangement as
// src/lib/eventForm.ts, which this deliberately mirrors.

import type { FieldErrors } from "@/lib/formErrors";

// The layout vocabulary comes from the events form rather than being written
// out again: VenueLayout.layoutName is matched against Event.preferredLayout,
// so if the two lists ever disagreed, suitability checking would silently stop
// matching. One list, imported.
export { LAYOUTS, toOptions } from "@/lib/eventForm";
import { LAYOUTS } from "@/lib/eventForm";
import { BOOKING_STEP_MINUTES } from "@/lib/venueTime";

/// Numbers are held as strings while typing: a number input mid-edit is
/// legitimately "" or "4", neither of which should become NaN.
export interface LayoutRow {
  layoutName: string;
  capacity: string;
}

export interface VenueFormValues {
  code: string;
  name: string;
  description: string;
  building: string;
  floor: string;
  address: string;
  maxCapacity: string;
  opensAt: string;
  closesAt: string;
  setupMinutes: string;
  teardownMinutes: string;
  /// Facility ids from GET /api/facilities — both categories in one list,
  /// because that is how the API takes them.
  facilityIds: string[];
  layouts: LayoutRow[];
}

export interface Facility {
  id: string;
  name: string;
  category: string;
}

export const INITIAL_VENUE: VenueFormValues = {
  code: "",
  name: "",
  description: "",
  building: "",
  floor: "",
  address: "",
  maxCapacity: "",
  // The schema's own defaults, so a new venue starts from the normal working
  // day rather than from blank fields the user has to guess at.
  opensAt: "08:00",
  closesAt: "22:00",
  setupMinutes: "0",
  teardownMinutes: "0",
  facilityIds: [],
  layouts: [],
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;

/// Mirrors createVenueSchema / updateVenueSchema, so the user is told before
/// the round trip rather than after it.
export function validateVenueForm(values: VenueFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.code.trim()) {
    errors.code = "Give the venue a short code, e.g. MAR-GH.";
  } else if (values.code.trim().length > 20) {
    errors.code = "Keep the code to 20 characters or fewer.";
  }

  if (!values.name.trim()) errors.name = "Enter the venue's name.";
  if (!values.building.trim()) errors.building = "Enter which building this room is in.";

  const capacity = Number(values.maxCapacity);
  if (!values.maxCapacity) {
    errors.maxCapacity = "Enter the room's maximum capacity.";
  } else if (!Number.isInteger(capacity) || capacity < 1) {
    errors.maxCapacity = "Enter a whole number, at least 1.";
  }

  // Required, because Venue.opensAt/closesAt are NOT NULL in the schema -
  // "clear the opening time" has no valid meaning. Without this, an emptied
  // field was sent as undefined, which PATCH reads as "leave this alone", so
  // the old value silently came back with no feedback.
  //
  // The HH:MM check is unreachable from a native time input, which reports
  // either a well-formed value or an empty one. It is kept for a caller that
  // builds these values some other way.
  for (const field of ["opensAt", "closesAt"] as const) {
    if (!values[field]) {
      errors[field] =
        field === "opensAt" ? "Enter when the venue opens." : "Enter when the venue closes.";
    } else if (!TIME_PATTERN.test(values[field])) {
      errors[field] = "Use 24-hour HH:MM, e.g. 08:00.";
    }
  }
  // Zero-padded times compare correctly as strings (schema.prisma). This one is
  // checked here only - createVenueSchema validates the format but not the
  // order, so the API would currently accept a room that closes before it
  // opens. Worth tightening server-side in its own change.
  if (
    values.opensAt &&
    values.closesAt &&
    TIME_PATTERN.test(values.opensAt) &&
    TIME_PATTERN.test(values.closesAt) &&
    values.closesAt <= values.opensAt
  ) {
    errors.closesAt = "Closing time must be after opening time.";
  }

  for (const field of ["setupMinutes", "teardownMinutes"] as const) {
    if (values[field] === "") continue;
    const minutes = Number(values[field]);
    if (!Number.isInteger(minutes) || minutes < 0) {
      errors[field] = "Enter a whole number of minutes, 0 or more.";
    } else if (minutes % BOOKING_STEP_MINUTES !== 0) {
      // SPM-93 AC5: the smallest unit of booking (#126, #128).
      errors[field] = "Enter minutes in 15-minute steps: 0, 15, 30, 45 and so on.";
    }
  }

  // Layout rows: the picker prevents most of this, but a row left half-filled
  // still has to be caught.
  if (values.layouts.length > 0) {
    if (values.layouts.some((row) => !row.layoutName)) {
      errors.layouts = "Choose a layout for every row, or remove the empty ones.";
    } else if (values.layouts.some((row) => !Number.isInteger(Number(row.capacity)) || Number(row.capacity) < 1)) {
      errors.layouts = "Every layout needs a capacity of at least 1.";
    } else {
      const names = values.layouts.map((row) => row.layoutName);
      if (new Set(names).size !== names.length) {
        // VenueLayout is unique on (venueId, layoutName), and updateVenueSchema
        // rejects duplicates too.
        errors.layouts = "Each layout can only be listed once — change its capacity instead.";
      }
    }
  }

  return errors;
}

/// Which layouts a given row's picker should offer: every layout except those
/// another row already uses. Requesting the same layout twice is never valid,
/// so the picker itself is the validation — the same approach
/// availableEquipmentOptions() takes on the events form.
export function availableLayoutOptions(
  layouts: LayoutRow[],
  rowIndex: number
): { value: string; label: string }[] {
  const takenElsewhere = new Set(
    layouts.filter((_, i) => i !== rowIndex).map((row) => row.layoutName).filter(Boolean)
  );
  return LAYOUTS.filter((name) => !takenElsewhere.has(name)).map((name) => ({
    value: name,
    label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, "-"),
  }));
}

/// The shape GET /api/venues/[id] returns, trimmed to what the form needs.
export interface VenueRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  building: string;
  floor: string | null;
  address: string | null;
  maxCapacity: number;
  opensAt: string;
  closesAt: string;
  setupMinutes: number;
  teardownMinutes: number;
  isActive: boolean;
  layouts: { layoutName: string; capacity: number }[];
  facilities: { facilityId: string }[];
}

/// Prefills the edit form from a saved venue. The inverse of venuePayload().
export function toVenueFormValues(venue: VenueRecord): VenueFormValues {
  return {
    code: venue.code,
    name: venue.name,
    description: venue.description ?? "",
    building: venue.building,
    floor: venue.floor ?? "",
    address: venue.address ?? "",
    maxCapacity: String(venue.maxCapacity),
    opensAt: venue.opensAt,
    closesAt: venue.closesAt,
    setupMinutes: String(venue.setupMinutes),
    teardownMinutes: String(venue.teardownMinutes),
    facilityIds: venue.facilities.map((f) => f.facilityId),
    layouts: venue.layouts.map((l) => ({
      layoutName: l.layoutName,
      capacity: String(l.capacity),
    })),
  };
}

/// The request body for POST /api/venues and PATCH /api/venues/[id].
///
/// `layouts` and `facilityIds` are always sent, never omitted when empty: on
/// PATCH a present array is a full replacement and an absent one means "leave
/// this alone", so omitting an emptied list would silently keep the layouts the
/// user just deleted.
export function venuePayload(values: VenueFormValues) {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    description: values.description.trim() || undefined,
    building: values.building.trim(),
    floor: values.floor.trim() || undefined,
    address: values.address.trim() || undefined,
    maxCapacity: Number(values.maxCapacity),
    // Sent as-is rather than `|| undefined`: these are required, so an empty
    // one is a bug worth surfacing as a server rejection, not something to
    // quietly drop from the payload and leave unchanged.
    opensAt: values.opensAt,
    closesAt: values.closesAt,
    setupMinutes: values.setupMinutes === "" ? undefined : Number(values.setupMinutes),
    teardownMinutes: values.teardownMinutes === "" ? undefined : Number(values.teardownMinutes),
    facilityIds: values.facilityIds,
    layouts: values.layouts.map((row) => ({
      layoutName: row.layoutName,
      capacity: Number(row.capacity),
    })),
  };
}

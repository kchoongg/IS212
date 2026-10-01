// SPM-28 AC3: "The Event Coordinator can identify incomplete or unclear
// information." The review page flags what the organiser left empty; it
// never blocks Approve. Whether a request has "sufficient information for
// planning to proceed" is the coordinator's judgment (discussion #80), and
// no field list is mandated (#72) - confirmed 2026-09-30.

/// The parts of a request the review page checks. Structural, so it can be
/// tested with object literals.
export interface ReviewableRequest {
  purpose: string | null;
  description: string | null;
  category: string | null;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  accessibilityNotes: string | null;
  specialRequirements: string | null;
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  facilityRequirements: unknown[];
  equipmentRequests: unknown[];
}

/// Labels exactly as the review page shows them, so the summary at the top
/// names the same rows that carry the "Not provided" marker.
export const REVIEW_FIELD_LABELS = {
  purpose: "Purpose",
  description: "Description",
  category: "Category",
  when: "When",
  expectedAttendance: "Expected attendance",
  preferredLayout: "Preferred layout",
  accessibilityNotes: "Accessibility needs",
  specialRequirements: "Special requirements",
  registrationCapacity: "Registration capacity",
  facilities: "Facilities",
  equipment: "Equipment",
} as const;

function blank(value: string | null): boolean {
  return value == null || value.trim() === "";
}

/// Which parts of the request were not provided, in page order. Registration
/// capacity counts only when registration is enabled - "not enabled" is a
/// choice, not a gap.
export function missingRequestFields(request: ReviewableRequest): string[] {
  const L = REVIEW_FIELD_LABELS;
  const missing: string[] = [];
  if (blank(request.category)) missing.push(L.category);
  if (blank(request.purpose)) missing.push(L.purpose);
  if (blank(request.description)) missing.push(L.description);
  if (!request.startsAt || !request.endsAt) missing.push(L.when);
  if (request.expectedAttendance == null) missing.push(L.expectedAttendance);
  if (blank(request.preferredLayout)) missing.push(L.preferredLayout);
  if (blank(request.accessibilityNotes)) missing.push(L.accessibilityNotes);
  if (blank(request.specialRequirements)) missing.push(L.specialRequirements);
  if (request.registrationEnabled && request.registrationCapacity == null) missing.push(L.registrationCapacity);
  if (request.facilityRequirements.length === 0) missing.push(L.facilities);
  if (request.equipmentRequests.length === 0) missing.push(L.equipment);
  return missing;
}

/// Shown under the Reason for rejection field when it is empty or only
/// spaces - the same rule the API applies (reason?.trim()).
export const REJECTION_REASON_REQUIRED = "A reason is required when rejecting. The organiser sees this message.";

export function isBlankReason(reason: string): boolean {
  return reason.trim() === "";
}

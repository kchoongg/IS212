// The one way to add reasons to a review flag's `reviewReason` column
// (VenueBooking, EquipmentRequest, Event.registrationReviewReason).
//
// Several stories write to the same column: Manage Venue Catalogue (SPM-39),
// Update Event Information (SPM-62), and later Record Venue Unavailability
// (SPM-45), Record Equipment Unavailability (SPM-55), Configure Event
// Registration (SPM-64) and Re-check Bookings (SPM-80). Each knows only its
// own reason codes, so a writer that parsed the column into ITS codes before
// merging would silently drop everyone else's. Every writer adds through
// addReviewReasons() instead, which keeps every code already there.
//
// Reading the codes for display (e.g. venueImpact.parseReviewReason()) may
// filter to the codes the reader understands - but never before a write.

/// The stored codes plus the new ones, each once: the stored ones first, in
/// their order, then any new ones in the order given.
export function addReviewReasons(existing: string | null | undefined, added: readonly string[]): string {
  const codes = (existing ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  for (const code of added) {
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.join(",");
}

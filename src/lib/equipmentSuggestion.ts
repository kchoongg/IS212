// SPM-77 — Suggest Alternative Equipment. "As Technical Support Staff, I want
// to suggest alternative equipment when a requested item cannot be fully
// provided so that the Event Coordinator can decide how to meet the
// requirement." (Customer Q&A #90: highlight unavailable items or suggest
// alternatives; the Coordinator decides.)
//
// The rules for the suggestion routes (.../suggestion and
// .../suggestion/availability) and both screens, kept here so they share them:
//
//  * Only a line Technical Support marked "Cannot be provided" or reserved in
//    part can get one (AC1), and one at a time - a second waits until the
//    Coordinator has decided on the first.
//  * The alternative must be another active catalogue item the event does not
//    already request, and fully available for the event's dates (AC2; team
//    decision - the Coordinator only ever accepts something that can be
//    reserved). The note is required, as AC1 lists it.
//  * A suggestion reserves nothing and changes nothing by itself (AC7).
//  * Accepting turns an Unavailable line into the alternative. A partly
//    fulfilled line keeps what it has reserved and the alternative is added as
//    a line of its own, so equipment already reserved stays reserved (AC5,
//    AC8; team decision). Either way the alternative goes to Technical Support
//    as Requested, to reserve.
//  * Accept and decline happen in Planning, the window in which Technical
//    Support works on the equipment (team decision).

import { STAFF_NOTES_MAX_LENGTH } from "@/lib/equipmentFulfilment";
import type { NotificationContent } from "@/lib/notifications";

export const SUGGESTION_NOTIFICATION_TYPE = "equipment_alternative_suggested";

/// Same cap as Technical Support's notes.
export const SUGGESTION_NOTE_MAX_LENGTH = STAFF_NOTES_MAX_LENGTH;

const SUGGESTABLE_STATUSES = ["unavailable", "partially_fulfilled"];

export function canSuggestFor(requestStatus: string): boolean {
  return SUGGESTABLE_STATUSES.includes(requestStatus);
}

/// What the quantity box starts from: whatever the line is still missing.
export function suggestedQuantityFor(line: {
  requestStatus: string;
  quantityRequested: number;
  quantityReserved: number | null;
}): number {
  if (line.requestStatus !== "partially_fulfilled") return line.quantityRequested;
  return Math.max(1, line.quantityRequested - (line.quantityReserved ?? 0));
}

export function checkSuggestionNote(note: string): string | null {
  const trimmed = note.trim();
  if (trimmed.length === 0) return "Add a note for the Coordinator.";
  if (trimmed.length > SUGGESTION_NOTE_MAX_LENGTH) {
    return `The note must be ${SUGGESTION_NOTE_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export interface SuggestionCheck {
  requestStatus: string;
  /// The item the line asks for now.
  requestEquipmentId: string;
  /// Whether the line already has a suggestion waiting for a decision.
  hasPending: boolean;
  /// The suggested item; null when it is not in the catalogue.
  alternative: { id: string; isActive: boolean } | null;
  /// Whether the event already requests the suggested item (for the same session).
  alreadyRequested: boolean;
  quantity: number;
  note: string;
  /// How many of the alternative are free for the line's dates; null when the
  /// event has no dates yet.
  available: number | null;
}

/// Why this suggestion cannot be recorded, or null if it can.
export function checkSuggestion(c: SuggestionCheck): string | null {
  if (!canSuggestFor(c.requestStatus)) {
    return "An alternative can only be suggested for an item that cannot be provided or is only partly fulfilled.";
  }
  if (c.hasPending) return "This item already has a suggestion waiting for the Coordinator's decision.";
  if (!c.alternative) return "Choose an item from the equipment catalogue.";
  if (!c.alternative.isActive) return "This equipment has been retired and cannot be suggested.";
  if (c.alternative.id === c.requestEquipmentId) return "Suggest a different item from the one requested.";
  if (c.alreadyRequested) return "This item is already requested for this event.";
  const noteRefusal = checkSuggestionNote(c.note);
  if (noteRefusal) return noteRefusal;
  if (c.available === null) return "Set the event date and time before suggesting equipment";
  if (c.quantity > c.available) return `Only ${c.available} available for this event's dates.`;
  return null;
}

/// Why the Coordinator cannot accept now, or null if they can. Declining is
/// always possible: it changes nothing.
export function checkAcceptance(requestStatus: string): string | null {
  if (canSuggestFor(requestStatus)) return null;
  return "This item has changed since the alternative was suggested and no longer needs one. Decline the suggestion instead.";
}

export function eventAllowsDecision(eventStatus: string): boolean {
  return eventStatus === "planning";
}

export const DECISION_CLOSED_MESSAGE = "A suggestion can be accepted or declined while the event is in planning.";

export interface AcceptPlan {
  /// What to write to the line the suggestion is about.
  update: Record<string, unknown>;
  /// A new line to add for the alternative, or null when the line itself becomes it.
  add: { equipmentId: string; quantityRequested: number } | null;
}

export function acceptChanges(
  line: { status: string; quantityReserved: number | null },
  suggestion: { equipmentId: string; quantity: number }
): AcceptPlan {
  const reserved = line.quantityReserved ?? 0;
  if (line.status === "partially_fulfilled" && reserved > 0) {
    return {
      update: { quantityRequested: reserved, status: "reserved" },
      add: { equipmentId: suggestion.equipmentId, quantityRequested: suggestion.quantity },
    };
  }
  // A fresh request for the alternative: Technical Support's review of the
  // item that could not be provided no longer applies, and nor does the
  // Coordinator's "not required" (SPM-33) or a flag (SPM-68) on it - otherwise
  // the event could be confirmed without the alternative ever being reserved.
  return {
    update: {
      equipmentId: suggestion.equipmentId,
      quantityRequested: suggestion.quantity,
      status: "requested",
      quantityReserved: null,
      staffNotes: null,
      reviewedBy: null,
      reviewedAt: null,
      notRequired: false,
      notRequiredBy: null,
      notRequiredAt: null,
      needsReview: false,
      reviewReason: null,
    },
    add: null,
  };
}

/// AC4: what the assigned Coordinator is told.
export function suggestedNotification(ref: {
  eventId: string;
  eventTitle: string | null;
  equipmentName: string;
  alternativeName: string;
  quantity: number;
  note: string;
}): NotificationContent {
  return {
    type: SUGGESTION_NOTIFICATION_TYPE,
    title: "Alternative equipment suggested",
    body: `Technical Support suggested ${ref.quantity} ${ref.alternativeName} in place of ${ref.equipmentName} for ${ref.eventTitle ?? "Untitled event"}. Note: ${ref.note}`,
    eventId: ref.eventId,
  };
}

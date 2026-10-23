// SPM-29 - Request Event Clarification. The coordinator assigned to an event
// that is Under review asks the organiser to clarify parts of the request.
// The event stays Under review; there is no Clarification Required status
// (DOCUMENTATION.md, 2026-09-22). One clarification is open at a time.

import { z } from "zod";
import { REVIEW_FIELD_LABELS } from "@/lib/eventReview";

type ClarificationField = keyof typeof REVIEW_FIELD_LABELS;

/// What a coordinator can point at (AC1): the parts of the request the review
/// page shows, labelled as it labels them.
export const CLARIFICATION_FIELDS = Object.keys(REVIEW_FIELD_LABELS) as ClarificationField[];

export const CLARIFICATION_FIELDS_REQUIRED = "Choose at least one item that needs clarification.";
export const CLARIFICATION_MESSAGE_REQUIRED = "Write a message for the organiser.";
export const CLARIFICATION_FORBIDDEN_MESSAGE = "Only the coordinator assigned to this event can request clarification.";
export const CLARIFICATION_NOT_UNDER_REVIEW = "Clarification can only be requested while the event is under review.";
export const CLARIFICATION_ALREADY_OPEN = "This event already has an open clarification.";

// SPM-26 - the organiser answers by updating and resubmitting the request.
export const CLARIFICATION_RESPOND_FORBIDDEN = "Only the organiser who raised this request can update it.";
export const CLARIFICATION_NONE_OPEN = "This request has no open clarification to answer, so it can't be changed here.";
export const CLARIFICATION_NO_LONGER_UNDER_REVIEW = "This request is no longer under review. Reload the page to see what changed.";

/// The shape of a request. The rules a person can break from the form -
/// nothing ticked, no message - are clarificationProblem()'s, so the page and
/// the route word them the same way.
export const clarificationSchema = z
  .object({
    fields: z.array(z.enum(CLARIFICATION_FIELDS as [ClarificationField, ...ClarificationField[]])),
    message: z.string(),
  })
  .strict();

/// The first rule the request breaks, or null (AC1, AC2).
export function clarificationProblem({ fields, message }: { fields: readonly string[]; message: string }): string | null {
  if (fields.length === 0) return CLARIFICATION_FIELDS_REQUIRED;
  if (message.trim() === "") return CLARIFICATION_MESSAGE_REQUIRED;
  return null;
}

function known(codes: readonly string[]): ClarificationField[] {
  return CLARIFICATION_FIELDS.filter((field) => codes.includes(field));
}

/// The codes as stored in ClarificationRequest.fields: comma-separated, once
/// each, in the review page's order.
export function encodeFields(codes: readonly string[]): string {
  return known(codes).join(",");
}

/// The stored column read back. A code the app no longer knows is dropped
/// rather than shown raw; a row from before SPM-29 has none.
export function decodeFields(stored: string | null): ClarificationField[] {
  return known((stored ?? "").split(","));
}

export function clarificationFieldLabels(codes: readonly string[]): string[] {
  return known(codes).map((field) => REVIEW_FIELD_LABELS[field]);
}

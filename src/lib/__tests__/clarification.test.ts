// SPM-29 - Request Event Clarification: the pure rules.
//
// CONTRACT (SPM-29, written before the code) - what these tests expect to exist:
//   src/lib/clarification.ts
//     CLARIFICATION_FIELDS - the codes of the information a coordinator can point at (AC1):
//       the keys of REVIEW_FIELD_LABELS (src/lib/eventReview.ts), in that order
//     clarificationSchema - Zod, strict: { fields: CLARIFICATION_FIELDS[], message: string }
//     clarificationProblem({ fields, message }) - the first rule broken, or null:
//       CLARIFICATION_FIELDS_REQUIRED when nothing is ticked, CLARIFICATION_MESSAGE_REQUIRED
//       when the message is empty or only spaces (AC1, AC2)
//     encodeFields(codes) / decodeFields(stored) - the codes <-> the comma-separated column,
//       as VenueBooking.reviewReason (src/lib/reviewFlags.ts)
//     clarificationFieldLabels(codes) - the codes as the review page labels them
//     CLARIFICATION_FORBIDDEN_MESSAGE, CLARIFICATION_NOT_UNDER_REVIEW, CLARIFICATION_ALREADY_OPEN
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the field codes are SPM-28's review labels, so the coordinator picks from the rows they just read
//   - every message's wording
//   - one open clarification per event at a time (confirmed with Sammi 2026-10-19)

import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  CLARIFICATION_ALREADY_OPEN,
  CLARIFICATION_FIELDS,
  CLARIFICATION_FIELDS_REQUIRED,
  CLARIFICATION_FORBIDDEN_MESSAGE,
  CLARIFICATION_MESSAGE_REQUIRED,
  CLARIFICATION_NOT_UNDER_REVIEW,
  clarificationFieldLabels,
  clarificationProblem,
  clarificationSchema,
  decodeFields,
  encodeFields,
} from "@/lib/clarification";
import { REVIEW_FIELD_LABELS } from "@/lib/eventReview";

describe("what a coordinator can ask about (AC1)", () => {
  it("[SPM-29][AC1] is each part of the request the review page shows, in the same order", () => {
    expect(CLARIFICATION_FIELDS).toEqual(Object.keys(REVIEW_FIELD_LABELS));
  });

  it("[SPM-29][AC1] names the codes the way the review page labels them", () => {
    expect(clarificationFieldLabels(["purpose", "when", "equipment"])).toEqual(["Purpose", "When", "Equipment"]);
  });
});

describe("the messages", () => {
  it("[SPM-29] are worded for the coordinator", () => {
    expect(CLARIFICATION_FIELDS_REQUIRED).toBe("Choose at least one item that needs clarification.");
    expect(CLARIFICATION_MESSAGE_REQUIRED).toBe("Write a message for the organiser.");
    expect(CLARIFICATION_FORBIDDEN_MESSAGE).toBe(
      "Only the coordinator assigned to this event can request clarification."
    );
    expect(CLARIFICATION_NOT_UNDER_REVIEW).toBe(
      "Clarification can only be requested while the event is under review."
    );
    expect(CLARIFICATION_ALREADY_OPEN).toBe("This event already has an open clarification.");
  });
});

describe("clarificationSchema", () => {
  it("[SPM-29][AC1][AC2] accepts the fields to clarify and a message", () => {
    expect(clarificationSchema.parse({ fields: ["purpose", "when"], message: "Which day?" })).toEqual({
      fields: ["purpose", "when"],
      message: "Which day?",
    });
  });

  it.each([
    ["an unknown field", { fields: ["budget"], message: "x" }],
    ["fields that are not a list", { fields: "purpose", message: "x" }],
    ["no message", { fields: ["purpose"] }],
    ["a message that is not text", { fields: ["purpose"], message: 42 }],
    ["anything else", { fields: ["purpose"], message: "x", status: "closed" }],
  ])("[SPM-29][AC1][AC2] refuses %s", (_case, body) => {
    expect(() => clarificationSchema.parse(body)).toThrow(ZodError);
  });
});

describe("clarificationProblem (AC1, AC2)", () => {
  it("[SPM-29][AC1][AC2] is null when at least one field is ticked and there is a message", () => {
    expect(clarificationProblem({ fields: ["purpose"], message: "What is the purpose?" })).toBeNull();
  });

  it("[SPM-29][AC1] asks for at least one field when none is ticked", () => {
    expect(clarificationProblem({ fields: [], message: "Anything" })).toBe(CLARIFICATION_FIELDS_REQUIRED);
  });

  it.each(["", "   ", "\n\t"])("[SPM-29][AC2] asks for a message when it is %j", (message) => {
    expect(clarificationProblem({ fields: ["when"], message })).toBe(CLARIFICATION_MESSAGE_REQUIRED);
  });
});

describe("storing the fields", () => {
  it("[SPM-29][AC1] joins the codes with commas, once each, in the review page's order", () => {
    expect(encodeFields(["when", "purpose", "when"])).toBe("purpose,when");
  });

  it("[SPM-29][AC1] reads them back as the same codes", () => {
    expect(decodeFields(encodeFields(["equipment", "category"]))).toEqual(["category", "equipment"]);
  });

  it("[SPM-29][AC1] reads nothing stored as no fields - a clarification raised before SPM-29 had none", () => {
    expect(decodeFields(null)).toEqual([]);
    expect(decodeFields("")).toEqual([]);
  });

  it("[SPM-29][AC1] drops a code the app no longer knows rather than showing it raw", () => {
    expect(decodeFields("purpose,budget")).toEqual(["purpose"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  SUGGESTION_NOTE_MAX_LENGTH,
  SUGGESTION_NOTIFICATION_TYPE,
  acceptChanges,
  canSuggestFor,
  checkAcceptance,
  checkSuggestion,
  checkSuggestionNote,
  eventAllowsDecision,
  suggestedNotification,
  suggestedQuantityFor,
  type SuggestionCheck,
} from "../equipmentSuggestion";

// CONTRACT (SPM-77, written before the code) - src/lib/equipmentSuggestion.ts:
//   canSuggestFor(requestStatus)              -> whether a line may get a suggested alternative (AC1)
//   suggestedQuantityFor(line)                -> the quantity the form starts from: what is still missing
//   checkSuggestion(check)                    -> refusal message | null, for the route and the screen
//   checkSuggestionNote(note)                 -> refusal message | null (the note alone, for the form)
//   checkAcceptance(requestStatus)            -> refusal message | null, before accepting (AC5)
//   acceptChanges(line, suggestion)           -> { update, add }: what accepting writes (AC5, AC8)
//   eventAllowsDecision(eventStatus)          -> accept / decline only while in Planning
//   suggestedNotification(ref)                -> NotificationContent for the Coordinator (AC4)
// Decided with the team, not in the story (change the test if the team wants otherwise):
//   - only an Unavailable or Partially fulfilled line can get one (AC1's two cases), one pending at a time
//   - an alternative that is not fully available for the event's dates is refused, not just warned about
//   - the note is required (AC1 lists it), up to 500 characters like Technical Support's notes
//   - the alternative must be another active catalogue item, not one the event already requests
//   - accepting on a partly fulfilled line keeps what is reserved and adds the alternative as a new line
//   - accept / decline only in Planning
//   - the wording of every refusal and of the notification

describe("canSuggestFor", () => {
  it.each(["unavailable", "partially_fulfilled"])("[SPM-77][AC1] allows a suggestion on a line that is %s", (status) => {
    expect(canSuggestFor(status)).toBe(true);
  });

  it.each(["requested", "under_review", "reserved", "released", "cancelled"])(
    "[SPM-77][AC1] allows none on a line that is %s - it is not short of anything",
    (status) => {
      expect(canSuggestFor(status)).toBe(false);
    }
  );
});

describe("suggestedQuantityFor", () => {
  it("[SPM-77][AC1] starts from the whole quantity when nothing could be provided", () => {
    expect(suggestedQuantityFor({ requestStatus: "unavailable", quantityRequested: 4, quantityReserved: null })).toBe(4);
  });

  it("[SPM-77][AC1] starts from what is still missing on a partly fulfilled line", () => {
    expect(suggestedQuantityFor({ requestStatus: "partially_fulfilled", quantityRequested: 4, quantityReserved: 3 })).toBe(1);
  });

  it("[SPM-77][AC1] starts from the whole quantity on a partly fulfilled line with no quantity recorded", () => {
    expect(suggestedQuantityFor({ requestStatus: "partially_fulfilled", quantityRequested: 4, quantityReserved: null })).toBe(4);
  });

  it("[SPM-77][AC1] never starts below 1, even if more is reserved than was requested", () => {
    expect(suggestedQuantityFor({ requestStatus: "partially_fulfilled", quantityRequested: 2, quantityReserved: 3 })).toBe(1);
  });
});

describe("checkSuggestion", () => {
  function check(overrides: Partial<SuggestionCheck> = {}): SuggestionCheck {
    return {
      requestStatus: "unavailable",
      requestEquipmentId: "eq-projector",
      hasPending: false,
      alternative: { id: "eq-screen", isActive: true },
      alreadyRequested: false,
      quantity: 2,
      note: "Two LED screens instead.",
      available: 5,
      ...overrides,
    };
  }

  it("[SPM-77][AC1] accepts another available item, with a quantity and a note", () => {
    expect(checkSuggestion(check())).toBeNull();
  });

  it("[SPM-77][AC2] accepts exactly the quantity that is available", () => {
    expect(checkSuggestion(check({ quantity: 5, available: 5 }))).toBeNull();
  });

  it("[SPM-77][AC2] refuses more than is available for the event's dates", () => {
    expect(checkSuggestion(check({ quantity: 6, available: 5 }))).toBe("Only 5 available for this event's dates.");
  });

  it("[SPM-77][AC2] refuses when nothing at all is available", () => {
    expect(checkSuggestion(check({ quantity: 1, available: 0 }))).toBe("Only 0 available for this event's dates.");
  });

  it("[SPM-77][AC2] refuses when the event has no dates to check against", () => {
    expect(checkSuggestion(check({ available: null }))).toBe("Set the event date and time before suggesting equipment");
  });

  it.each(["requested", "reserved", "released"])("[SPM-77][AC1] refuses on a line that is %s", (requestStatus) => {
    expect(checkSuggestion(check({ requestStatus }))).toBe(
      "An alternative can only be suggested for an item that cannot be provided or is only partly fulfilled."
    );
  });

  it("[SPM-77] refuses a second suggestion while one is waiting for the Coordinator", () => {
    expect(checkSuggestion(check({ hasPending: true }))).toBe(
      "This item already has a suggestion waiting for the Coordinator's decision."
    );
  });

  it("[SPM-77][AC1] refuses an item that is not in the catalogue", () => {
    expect(checkSuggestion(check({ alternative: null }))).toBe("Choose an item from the equipment catalogue.");
  });

  it("[SPM-77][AC1] refuses a retired item", () => {
    expect(checkSuggestion(check({ alternative: { id: "eq-screen", isActive: false } }))).toBe(
      "This equipment has been retired and cannot be suggested."
    );
  });

  it("[SPM-77][AC1] refuses the very item that could not be provided", () => {
    expect(checkSuggestion(check({ alternative: { id: "eq-projector", isActive: true } }))).toBe(
      "Suggest a different item from the one requested."
    );
  });

  it("[SPM-77][AC5] refuses an item the event already requests - accepting it would request it twice", () => {
    expect(checkSuggestion(check({ alreadyRequested: true }))).toBe("This item is already requested for this event.");
  });

  it("[SPM-77][AC1] refuses a missing note", () => {
    expect(checkSuggestion(check({ note: "   " }))).toBe("Add a note for the Coordinator.");
  });
});

describe("checkSuggestionNote", () => {
  it("[SPM-77][AC1] accepts a note of exactly the limit, ignoring surrounding spaces", () => {
    expect(checkSuggestionNote(`  ${"x".repeat(SUGGESTION_NOTE_MAX_LENGTH)}  `)).toBeNull();
  });

  it("[SPM-77][AC1] refuses a note one character over the limit", () => {
    expect(checkSuggestionNote("x".repeat(SUGGESTION_NOTE_MAX_LENGTH + 1))).toBe("The note must be 500 characters or fewer.");
  });

  it("[SPM-77][AC1] refuses an empty note", () => {
    expect(checkSuggestionNote("")).toBe("Add a note for the Coordinator.");
  });
});

describe("checkAcceptance", () => {
  it.each(["unavailable", "partially_fulfilled"])("[SPM-77][AC5] allows accepting while the line is still %s", (status) => {
    expect(checkAcceptance(status)).toBeNull();
  });

  it.each(["reserved", "requested", "cancelled"])(
    "[SPM-77][AC5] refuses once the line has become %s - it no longer needs an alternative",
    (status) => {
      expect(checkAcceptance(status)).toBe(
        "This item has changed since the alternative was suggested and no longer needs one. Decline the suggestion instead."
      );
    }
  );
});

describe("acceptChanges", () => {
  const suggestion = { equipmentId: "eq-screen", quantity: 2 };

  it("[SPM-77][AC5] turns an Unavailable line into the alternative, back to Technical Support to reserve", () => {
    expect(acceptChanges({ status: "unavailable", quantityReserved: null }, suggestion)).toEqual({
      update: {
        equipmentId: "eq-screen",
        quantityRequested: 2,
        status: "requested",
        quantityReserved: null,
        staffNotes: null,
        reviewedBy: null,
        reviewedAt: null,
      },
      add: null,
    });
  });

  it("[SPM-77][AC5][AC8] keeps what a partly fulfilled line has reserved and adds the alternative as its own line", () => {
    expect(acceptChanges({ status: "partially_fulfilled", quantityReserved: 3 }, suggestion)).toEqual({
      update: { quantityRequested: 3, status: "reserved" },
      add: { equipmentId: "eq-screen", quantityRequested: 2 },
    });
  });
});

describe("eventAllowsDecision", () => {
  it("[SPM-77][AC5][AC6] allows a decision while the event is in planning", () => {
    expect(eventAllowsDecision("planning")).toBe(true);
  });

  it.each(["approved", "safety_review", "safety_cleared", "confirmed", "cancelled"])(
    "[SPM-77][AC5][AC6] allows none while the event is %s",
    (status) => {
      expect(eventAllowsDecision(status)).toBe(false);
    }
  );
});

describe("suggestedNotification", () => {
  it("[SPM-77][AC4] tells the Coordinator what was suggested, for which item and why", () => {
    expect(
      suggestedNotification({
        eventId: "event-id",
        eventTitle: "Gala Dinner",
        equipmentName: "Projector",
        alternativeName: "LED Screen",
        quantity: 2,
        note: "Two LED screens instead.",
      })
    ).toEqual({
      type: SUGGESTION_NOTIFICATION_TYPE,
      title: "Alternative equipment suggested",
      body: "Technical Support suggested 2 LED Screen in place of Projector for Gala Dinner. Note: Two LED screens instead.",
      eventId: "event-id",
    });
  });

  it("[SPM-77][AC4] names an untitled event as such", () => {
    expect(
      suggestedNotification({
        eventId: "event-id",
        eventTitle: null,
        equipmentName: "Projector",
        alternativeName: "LED Screen",
        quantity: 1,
        note: "n",
      }).body
    ).toContain("for Untitled event.");
  });

  it("[SPM-77][AC4] uses the type the notification list links to the Equipment tab", () => {
    expect(SUGGESTION_NOTIFICATION_TYPE).toBe("equipment_alternative_suggested");
  });
});

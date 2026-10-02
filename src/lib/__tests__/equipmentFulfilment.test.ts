import { describe, it, expect } from "vitest";
import {
  checkFulfilmentUpdate,
  eventAllowsFulfilmentUpdate,
  fulfilmentChanges,
  fulfilmentOptionsFor,
  fulfilmentUpdateClosedMessage,
} from "../equipmentFulfilment";

describe("fulfilmentOptionsFor (SPM-50 AC2)", () => {
  it("SPM-50-TC03: offers Requested, Under review and Unavailable on an open line - never Reserved or Partially fulfilled", () => {
    expect(fulfilmentOptionsFor("requested")).toEqual(["requested", "under_review", "unavailable"]);
    expect(fulfilmentOptionsFor("under_review")).toEqual(["requested", "under_review", "unavailable"]);
    expect(fulfilmentOptionsFor("unavailable")).toEqual(["requested", "under_review", "unavailable"]);
  });

  it("SPM-50-TC03: a line holding stock can only stay as it is or become Unavailable", () => {
    expect(fulfilmentOptionsFor("reserved")).toEqual(["reserved", "unavailable"]);
    expect(fulfilmentOptionsFor("partially_fulfilled")).toEqual(["partially_fulfilled", "unavailable"]);
  });

  it("offers nothing on a withdrawn line", () => {
    expect(fulfilmentOptionsFor("cancelled")).toEqual([]);
  });
});

describe("checkFulfilmentUpdate", () => {
  it("SPM-50-TC02: accepts Requested -> Under review without notes", () => {
    expect(checkFulfilmentUpdate("requested", "under_review", "")).toBeNull();
  });

  it("SPM-50-TC02: accepts undoing Under review back to Requested", () => {
    expect(checkFulfilmentUpdate("under_review", "requested", "")).toBeNull();
  });

  it("SPM-50-TC05: accepts Unavailable with a reason", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "Only 1 working unit")).toBeNull();
  });

  it("SPM-50-TC06: refuses Unavailable with no reason", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "")).toEqual({ message: "Give a reason when equipment cannot be provided.", field: "staffNotes" });
  });

  it("SPM-50-TC06: treats a reason of only spaces as empty", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "   ")).toEqual({ message: "Give a reason when equipment cannot be provided.", field: "staffNotes" });
  });

  it("SPM-50-TC09: accepts exactly 500 characters of notes", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "A".repeat(500))).toBeNull();
  });

  it("SPM-50-TC09: refuses 501 characters of notes", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "A".repeat(501))).toEqual({ message: "Technical notes must be 500 characters or fewer.", field: "staffNotes" });
  });

  it("SPM-50-TC03: refuses setting Reserved or Partially fulfilled by hand", () => {
    expect(checkFulfilmentUpdate("under_review", "reserved", "")).toEqual({ message: "Use Reserve to commit equipment to this event.", field: null });
    expect(checkFulfilmentUpdate("under_review", "partially_fulfilled", "")).toEqual({ message: "Use Reserve to commit equipment to this event.", field: null });
  });

  it("SPM-50-TC03: refuses moving a reserved line back to Requested or Under review", () => {
    expect(checkFulfilmentUpdate("reserved", "under_review", "")).toEqual({ message: "A reserved item can only be marked Unavailable.", field: null });
    expect(checkFulfilmentUpdate("partially_fulfilled", "requested", "")).toEqual({ message: "A reserved item can only be marked Unavailable.", field: null });
  });

  it("refuses a status that is not on offer, without blaming a reservation that isn't there", () => {
    expect(checkFulfilmentUpdate("requested", "cancelled", "")).toEqual({
      message: "That status cannot be chosen here.",
      field: null,
    });
  });

  it("SPM-50-TC07: accepts marking a reserved line Unavailable with a reason", () => {
    expect(checkFulfilmentUpdate("reserved", "unavailable", "Battery failed inspection")).toBeNull();
  });

  it("accepts a notes-only update on a reserved line", () => {
    expect(checkFulfilmentUpdate("reserved", "reserved", "Packed in kit bag 2")).toBeNull();
  });

  it("refuses any update to a withdrawn line", () => {
    expect(checkFulfilmentUpdate("cancelled", "under_review", "")).toEqual({ message: "This request has been withdrawn and can no longer be updated.", field: null });
  });
});

describe("fulfilmentChanges", () => {
  it("trims the notes it stores", () => {
    expect(fulfilmentChanges("under_review", "  Fresh batteries  ")).toEqual({
      status: "under_review",
      staffNotes: "Fresh batteries",
    });
  });

  it("SPM-50-TC08: stores cleared notes as nothing", () => {
    expect(fulfilmentChanges("under_review", "")).toEqual({ status: "under_review", staffNotes: null });
  });

  it("SPM-50-TC07: clears the reserved quantity when a line is marked Unavailable", () => {
    expect(fulfilmentChanges("unavailable", "Battery failed inspection")).toEqual({
      status: "unavailable",
      staffNotes: "Battery failed inspection",
      quantityReserved: null,
    });
  });
});

describe("eventAllowsFulfilmentUpdate", () => {
  it("allows updates once the event is approved, through to confirmed", () => {
    for (const status of ["approved", "planning", "confirmed"]) {
      expect(eventAllowsFulfilmentUpdate(status)).toBe(true);
    }
  });

  it("SPM-50-TC14: refuses updates before the event is approved", () => {
    for (const status of ["draft", "submitted", "under_review"]) {
      expect(eventAllowsFulfilmentUpdate(status)).toBe(false);
    }
    expect(fulfilmentUpdateClosedMessage("under_review")).toBe(
      "This event is under review — equipment requests can be updated once the event is approved."
    );
  });

  it("SPM-50-TC13: refuses updates once the event is finished, abandoned or postponed", () => {
    for (const status of ["completed", "cancelled", "rejected", "postponed"]) {
      expect(eventAllowsFulfilmentUpdate(status)).toBe(false);
    }
    expect(fulfilmentUpdateClosedMessage("cancelled")).toBe(
      "This event is cancelled — equipment requests can no longer be updated."
    );
  });
});

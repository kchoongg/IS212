import { describe, it, expect } from "vitest";
import {
  checkFulfilmentUpdate,
  eventAllowsFulfilmentUpdate,
  fulfilmentChanges,
  fulfilmentOptionsFor,
  fulfilmentUpdateClosedMessage,
  reserveClearsStaffNotes,
} from "../equipmentFulfilment";

describe("fulfilmentOptionsFor (SPM-50 AC2)", () => {
  it("[SPM-50][AC2] SPM-50-TC03: offers Requested, Under review and Cannot be provided on an open line - never Reserved or Partially fulfilled", () => {
    expect(fulfilmentOptionsFor("requested")).toEqual(["requested", "under_review", "unavailable"]);
    expect(fulfilmentOptionsFor("under_review")).toEqual(["requested", "under_review", "unavailable"]);
    expect(fulfilmentOptionsFor("unavailable")).toEqual(["requested", "under_review", "unavailable"]);
  });

  it("[SPM-50][AC2] SPM-50-TC03: a line holding stock can only stay as it is or become Cannot be provided", () => {
    expect(fulfilmentOptionsFor("reserved")).toEqual(["reserved", "unavailable"]);
    expect(fulfilmentOptionsFor("partially_fulfilled")).toEqual(["partially_fulfilled", "unavailable"]);
  });

  it("[SPM-50][AC2] offers nothing on a withdrawn line", () => {
    expect(fulfilmentOptionsFor("cancelled")).toEqual([]);
  });
});

describe("checkFulfilmentUpdate", () => {
  it("[SPM-50][AC2] SPM-50-TC02: accepts Requested -> Under review without notes", () => {
    expect(checkFulfilmentUpdate("requested", "under_review", "")).toBeNull();
  });

  it("[SPM-50][AC2] SPM-50-TC02: accepts undoing Under review back to Requested", () => {
    expect(checkFulfilmentUpdate("under_review", "requested", "")).toBeNull();
  });

  it("[SPM-50][AC3] SPM-50-TC05: accepts Cannot be provided with a reason", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "Only 1 working unit")).toBeNull();
  });

  it("[SPM-50][AC3] SPM-50-TC06: refuses Cannot be provided with no reason", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "")).toEqual({ message: "Give a reason when equipment cannot be provided.", field: "staffNotes" });
  });

  it("[SPM-50][AC3] SPM-50-TC06: treats a reason of only spaces as empty", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "   ")).toEqual({ message: "Give a reason when equipment cannot be provided.", field: "staffNotes" });
  });

  it("[SPM-50][AC4] SPM-50-TC09: accepts exactly 500 characters of notes", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "A".repeat(500))).toBeNull();
  });

  it("[SPM-50][AC4] SPM-50-TC09: refuses 501 characters of notes", () => {
    expect(checkFulfilmentUpdate("requested", "unavailable", "A".repeat(501))).toEqual({ message: "Technical notes must be 500 characters or fewer.", field: "staffNotes" });
  });

  it("[SPM-50][AC2] SPM-50-TC03: refuses setting Reserved or Partially fulfilled by hand", () => {
    expect(checkFulfilmentUpdate("under_review", "reserved", "")).toEqual({ message: "Use Reserve to commit equipment to this event.", field: null });
    expect(checkFulfilmentUpdate("under_review", "partially_fulfilled", "")).toEqual({ message: "Use Reserve to commit equipment to this event.", field: null });
  });

  it("[SPM-50][AC2] SPM-50-TC03: refuses moving a reserved line back to Requested or Under review", () => {
    expect(checkFulfilmentUpdate("reserved", "under_review", "")).toEqual({ message: 'A reserved item can only be changed to "Cannot be provided".', field: null });
    expect(checkFulfilmentUpdate("partially_fulfilled", "requested", "")).toEqual({ message: 'A reserved item can only be changed to "Cannot be provided".', field: null });
  });

  it("[SPM-50][AC2] refuses a status that is not on offer, without blaming a reservation that isn't there", () => {
    expect(checkFulfilmentUpdate("requested", "cancelled", "")).toEqual({
      message: "That status cannot be chosen here.",
      field: null,
    });
  });

  it("[SPM-50][AC3] SPM-50-TC07: accepts marking a reserved line Cannot be provided with a reason", () => {
    expect(checkFulfilmentUpdate("reserved", "unavailable", "Battery failed inspection")).toBeNull();
  });

  it("[SPM-50][AC4] accepts a notes-only update on a reserved line", () => {
    expect(checkFulfilmentUpdate("reserved", "reserved", "Packed in kit bag 2")).toBeNull();
  });

  it("[SPM-50][AC2] refuses any update to a withdrawn line", () => {
    expect(checkFulfilmentUpdate("cancelled", "under_review", "")).toEqual({ message: "This request has been withdrawn and can no longer be updated.", field: null });
  });
});

describe("fulfilmentChanges", () => {
  it("[SPM-50][AC4] trims the notes it stores", () => {
    expect(fulfilmentChanges("under_review", "  Fresh batteries  ")).toEqual({
      status: "under_review",
      staffNotes: "Fresh batteries",
    });
  });

  it("[SPM-50][AC4] SPM-50-TC08: stores cleared notes as nothing", () => {
    expect(fulfilmentChanges("under_review", "")).toEqual({ status: "under_review", staffNotes: null });
  });

  it("[SPM-50][AC3] SPM-50-TC07: clears the reserved quantity when a line is marked Cannot be provided", () => {
    expect(fulfilmentChanges("unavailable", "Battery failed inspection")).toEqual({
      status: "unavailable",
      staffNotes: "Battery failed inspection",
      quantityReserved: null,
    });
  });
});

describe("eventAllowsFulfilmentUpdate", () => {
  it("[SPM-50] allows updates only while the event is in planning (BPMN)", () => {
    expect(eventAllowsFulfilmentUpdate("planning")).toBe(true);
  });

  it("[SPM-50] SPM-50-TC14: refuses updates before planning - including an approved event the Coordinator has not started", () => {
    for (const status of ["draft", "submitted", "under_review", "approved"]) {
      expect(eventAllowsFulfilmentUpdate(status)).toBe(false);
    }
  });

  it("[SPM-50] SPM-50-TC13: refuses updates on a confirmed event - its equipment is final", () => {
    expect(eventAllowsFulfilmentUpdate("confirmed")).toBe(false);
    expect(fulfilmentUpdateClosedMessage("confirmed")).toBe(
      "This event is confirmed — its equipment is final. A change now goes through a change request."
    );
  });

  it("[SPM-50] refuses updates once the event is finished, abandoned or postponed", () => {
    for (const status of ["completed", "cancelled", "rejected", "postponed", "withdrawn"]) {
      expect(eventAllowsFulfilmentUpdate(status)).toBe(false);
    }
  });
});

describe("reserveClearsStaffNotes", () => {
  it("[SPM-50][AC3] SPM-50-TC07: clears the old reason when a line marked Cannot be provided is reserved", () => {
    expect(reserveClearsStaffNotes("unavailable")).toBe(true);
  });

  it("[SPM-69][AC1] clears the release reason when a released line is reserved again", () => {
    expect(reserveClearsStaffNotes("released")).toBe(true);
  });

  it("[SPM-50][AC4] keeps notes on a line reserved from any other status", () => {
    for (const status of ["requested", "under_review", "partially_fulfilled"]) {
      expect(reserveClearsStaffNotes(status)).toBe(false);
    }
  });
});

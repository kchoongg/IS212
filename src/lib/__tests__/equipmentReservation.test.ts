import { describe, it, expect } from "vitest";
import {
  RESERVATION_NOTIFICATION_TYPES,
  adjustedNotification,
  adjustedStatus,
  checkAdjustment,
  checkRelease,
  checkReleaseReason,
  releasedNotification,
  sendBackChanges,
} from "../equipmentReservation";

// CONTRACT (SPM-69, written before the code) - src/lib/equipmentReservation.ts:
//   checkRelease(status, quantityReserved)              -> refusal message | null
//   checkAdjustment(line, quantity, available | null)   -> refusal message | null
//   adjustedStatus(quantity, quantityRequested)         -> "reserved" | "partially_fulfilled"
//   sendBackChanges(existing, change)                   -> the fields to write when the Coordinator's
//                                                          change sends a line back (AC7); {} when it doesn't
//   checkReleaseReason(reason)                          -> refusal message | null
//   releasedNotification / adjustedNotification         -> NotificationContent for the Coordinator (AC6)
// Decided here, not in the story (change the test if the team wants otherwise):
//   - a reservation can never be more than the quantity requested
//   - the wording of every refusal and notification
//   - a release needs a reason (up to 500 characters), saved as Technical Support's notes
//   - changing the quantity of a released line sends it back as a fresh request

describe("checkRelease", () => {
  it.each([
    ["reserved", 4],
    ["partially_fulfilled", 2],
    // AC7: back with Technical Support after a Coordinator change, still holding stock.
    ["requested", 4],
    ["under_review", 4],
  ])("[SPM-69][AC1] allows releasing a %s line that holds %i", (status, quantityReserved) => {
    expect(checkRelease(status, quantityReserved)).toBeNull();
  });

  it.each([
    ["requested", null],
    ["under_review", null],
    ["unavailable", null],
    ["cancelled", null],
    ["released", 4],
  ])("[SPM-69][AC1] refuses to release a %s line, which holds nothing", (status, quantityReserved) => {
    expect(checkRelease(status, quantityReserved)).toBe("Only reserved equipment can be released.");
  });
});

describe("checkAdjustment", () => {
  const reserved = { status: "reserved", quantityRequested: 4, quantityReserved: 4 };
  const partial = { status: "partially_fulfilled", quantityRequested: 4, quantityReserved: 2 };

  it("[SPM-69][AC2] allows reducing a reservation", () => {
    expect(checkAdjustment(reserved, 3, 6)).toBeNull();
  });

  it("[SPM-69][AC2] allows reducing even when nothing more is free - it frees units, it takes none", () => {
    expect(checkAdjustment(reserved, 1, 0)).toBeNull();
  });

  it("[SPM-69][AC3] allows increasing up to exactly what is available", () => {
    expect(checkAdjustment(partial, 3, 3)).toBeNull();
  });

  it("[SPM-69][AC3] refuses an increase one beyond what is available for the event's dates", () => {
    expect(checkAdjustment(partial, 4, 3)).toBe("Only 3 available for this event's dates.");
  });

  it("[SPM-69][AC3] refuses more than the event requested", () => {
    expect(checkAdjustment(reserved, 5, 10)).toBe("The event requested 4 — a reservation cannot be more than that.");
  });

  it("[SPM-69][AC3] refuses an increase while the event has no dates to check against", () => {
    expect(checkAdjustment(partial, 3, null)).toBe("Set the event date and time before reserving equipment");
  });

  it("[SPM-69][AC2] reduces without dates, since nothing needs checking", () => {
    expect(checkAdjustment(reserved, 2, null)).toBeNull();
  });

  it("[SPM-69] refuses a change to the quantity already reserved", () => {
    expect(checkAdjustment(reserved, 4, 10)).toBe("That is already the reserved quantity.");
  });

  it("[SPM-69][AC7] lets Technical Support keep the same quantity on a line sent back for review - that confirms it", () => {
    expect(checkAdjustment({ status: "requested", quantityRequested: 4, quantityReserved: 4 }, 4, 6)).toBeNull();
  });

  it.each([
    ["requested", null],
    ["unavailable", null],
    ["cancelled", null],
    ["released", 4],
  ])("[SPM-69][AC2][AC3] refuses to adjust a %s line, which holds nothing", (status, quantityReserved) => {
    expect(checkAdjustment({ status, quantityRequested: 4, quantityReserved }, 2, 10)).toBe(
      "Only reserved equipment can be adjusted."
    );
  });
});

describe("adjustedStatus", () => {
  it("[SPM-69][AC5] is Reserved when everything requested is reserved", () => {
    expect(adjustedStatus(4, 4)).toBe("reserved");
  });

  it("[SPM-69][AC5] is Partially fulfilled when less than requested is reserved", () => {
    expect(adjustedStatus(3, 4)).toBe("partially_fulfilled");
  });
});

describe("sendBackChanges", () => {
  const held = { status: "reserved", quantityReserved: 4, quantityRequested: 4, technicalRequirements: "HDMI" };
  const released = { ...held, status: "released" };
  const BACK = { status: "requested" };

  it("[SPM-69][AC7] sends a reserved line back when its quantity changes, keeping what is reserved", () => {
    expect(sendBackChanges(held, { quantityRequested: 6 })).toEqual(BACK);
  });

  it("[SPM-69][AC7] sends a reserved line back when its technical requirements change", () => {
    expect(sendBackChanges(held, { technicalRequirements: "VGA" })).toEqual(BACK);
  });

  it("[SPM-69][AC7] sends a reserved line back when technical requirements are added where there were none", () => {
    expect(sendBackChanges({ ...held, technicalRequirements: null }, { technicalRequirements: "VGA" })).toEqual(BACK);
  });

  it("[SPM-69][AC7] treats clearing requirements that were never set as no change", () => {
    expect(sendBackChanges({ ...held, technicalRequirements: null }, { technicalRequirements: "" })).toEqual({});
  });

  it("[SPM-69][AC7] sends a partly fulfilled line back too", () => {
    expect(sendBackChanges({ ...held, status: "partially_fulfilled", quantityReserved: 2 }, { quantityRequested: 2 })).toEqual(BACK);
  });

  it("[SPM-69][AC7] does not send it back when the save changes nothing", () => {
    expect(sendBackChanges(held, { quantityRequested: 4, technicalRequirements: "HDMI" })).toEqual({});
  });

  it("[SPM-69][AC7] sends a released line back as a fresh request when its quantity changes, clearing what it held and why", () => {
    expect(sendBackChanges(released, { quantityRequested: 2 })).toEqual({
      status: "requested",
      quantityReserved: null,
      staffNotes: null,
    });
  });

  it("[SPM-69][AC7] leaves a released line released when only its technical requirements change", () => {
    expect(sendBackChanges(released, { quantityRequested: 4, technicalRequirements: "VGA" })).toEqual({});
  });

  it.each(["requested", "under_review", "unavailable"])(
    "[SPM-69][AC7] leaves a %s line that holds nothing as it is",
    (status) => {
      expect(sendBackChanges({ ...held, status, quantityReserved: null }, { quantityRequested: 6 })).toEqual({});
    }
  );
});

describe("checkReleaseReason", () => {
  it("[SPM-69][AC1] accepts a reason", () => {
    expect(checkReleaseReason("Client is bringing their own")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])("[SPM-69][AC1] refuses a reason that is %s", (_case, reason) => {
    expect(checkReleaseReason(reason)).toBe("Give a reason for releasing this reservation.");
  });

  it("[SPM-69][AC1] accepts a reason of exactly 500 characters", () => {
    expect(checkReleaseReason("x".repeat(500))).toBeNull();
  });

  it("[SPM-69][AC1] refuses a reason of 501 characters", () => {
    expect(checkReleaseReason("x".repeat(501))).toBe("The reason must be 500 characters or fewer.");
  });

  it("[SPM-69][AC1] measures the reason without the spaces around it", () => {
    expect(checkReleaseReason(`  ${"x".repeat(500)}  `)).toBeNull();
  });
});

describe("notifications to the assigned Coordinator", () => {
  it("[SPM-69][AC6] says what was released, for which event, and why", () => {
    expect(
      releasedNotification({
        eventId: "event-id",
        eventTitle: "Gala Dinner",
        equipmentName: "Projector",
        quantity: 4,
        reason: "Client is bringing their own",
      })
    ).toEqual({
      type: RESERVATION_NOTIFICATION_TYPES.released,
      title: "Equipment reservation released",
      body: "Technical Support released the 4 Projector reserved for Gala Dinner. Reason: Client is bringing their own",
      eventId: "event-id",
    });
  });

  it("[SPM-69][AC6] says how a reservation changed, from and to", () => {
    expect(
      adjustedNotification({ eventId: "event-id", eventTitle: "Gala Dinner", equipmentName: "Projector", from: 4, to: 2 })
    ).toEqual({
      type: RESERVATION_NOTIFICATION_TYPES.adjusted,
      title: "Equipment reservation changed",
      body: "Technical Support changed the Projector reserved for Gala Dinner from 4 to 2.",
      eventId: "event-id",
    });
  });

  it("[SPM-69][AC6] names an untitled event sensibly", () => {
    expect(
      releasedNotification({ eventId: "event-id", eventTitle: null, equipmentName: "Projector", quantity: 1, reason: "Not needed" }).body
    ).toBe("Technical Support released the 1 Projector reserved for Untitled event. Reason: Not needed");
  });
});

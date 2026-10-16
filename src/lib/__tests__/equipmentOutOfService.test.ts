// SPM-55 - Record Equipment Unavailability: the pure rules.
//
// CONTRACT (SPM-55, written before the code):
//   src/lib/equipmentOutOfService.ts
//     OUT_OF_SERVICE_TYPES = ["unavailable", "damaged", "under_maintenance"]
//     outOfServiceTypeLabel(type)                 -> "Unavailable" | "Damaged" | "Under maintenance"
//     operationalStatus({ totalQuantity, quantityInMaintenance })
//                                                 -> "available" | "partly_out_of_service" | "out_of_service"
//     outOfServiceSummary(type, reason)           -> "Under maintenance - Lamp replacement" | "Damaged" | null
//     newlyShortReservations(item, before, after, reservations)
//       -> the reservations that the units LEFT after the change can no longer cover but could
//          before it, each with how many are available to it now (AC4).
//   statuses.ts: "partly_out_of_service" -> "Partly out of service" (warning),
//                "out_of_service" -> "Out of service" (danger)
// Decided here, not in the story: the wording above, and "newly" - a reservation already short
// before this change was flagged then, so it is not flagged or notified again.

import { describe, expect, it } from "vitest";
import {
  OUT_OF_SERVICE_TYPES,
  newlyShortReservations,
  operationalStatus,
  outOfServiceSummary,
  outOfServiceTypeLabel,
} from "@/lib/equipmentOutOfService";
import { statusLabel, statusTone } from "@/lib/statuses";

const sgt = (iso: string) => new Date(`${iso}:00+08:00`);

function reservation(requestId: string, quantityReserved: number, day: string, eventTitle = requestId) {
  return {
    requestId,
    eventTitle,
    quantityReserved,
    startsAt: sgt(`${day}T09:00`),
    endsAt: sgt(`${day}T13:00`),
    transferLeadMs: 0,
  };
}

const item = (totalQuantity: number) => ({ totalQuantity, isActive: true });

describe("the three kinds of unavailability (AC1)", () => {
  it("are unavailable, damaged and under maintenance", () => {
    expect(OUT_OF_SERVICE_TYPES).toEqual(["unavailable", "damaged", "under_maintenance"]);
    expect(OUT_OF_SERVICE_TYPES.map(outOfServiceTypeLabel)).toEqual(["Unavailable", "Damaged", "Under maintenance"]);
  });

  it("shows a type it does not know as stored", () => {
    expect(outOfServiceTypeLabel("lost")).toBe("lost");
  });
});

describe("operationalStatus (AC6)", () => {
  it.each([
    [4, 0, "available"],
    [4, 2, "partly_out_of_service"],
    [4, 3, "partly_out_of_service"],
    [4, 4, "out_of_service"],
  ])("%i units with %i out of service is %s", (totalQuantity, quantityInMaintenance, expected) => {
    expect(operationalStatus({ totalQuantity, quantityInMaintenance })).toBe(expected);
  });

  it("calls an item with no units at all available rather than out of service", () => {
    expect(operationalStatus({ totalQuantity: 0, quantityInMaintenance: 0 })).toBe("available");
  });

  it("reads each status in words, with its own tone", () => {
    expect(statusLabel("partly_out_of_service")).toBe("Partly out of service");
    expect(statusTone("partly_out_of_service")).toBe("warning");
    expect(statusLabel("out_of_service")).toBe("Out of service");
    expect(statusTone("out_of_service")).toBe("danger");
    expect(statusLabel("available")).toBe("Available");
  });
});

describe("outOfServiceSummary (AC1, AC2)", () => {
  it("gives the type and the reason", () => {
    expect(outOfServiceSummary("under_maintenance", "Lamp replacement")).toBe("Under maintenance - Lamp replacement");
  });

  it("gives the type alone when no reason was recorded", () => {
    expect(outOfServiceSummary("damaged", null)).toBe("Damaged");
  });

  it("is empty when nothing is out of service", () => {
    expect(outOfServiceSummary(null, null)).toBeNull();
  });
});

describe("newlyShortReservations (AC4)", () => {
  it("SPM-55-TC06: finds the reservation the units left no longer cover, and not one they still do", () => {
    const launch = reservation("launch", 4, "2027-08-10", "SPM55 Harbour Product Launch");
    const board = reservation("board", 2, "2027-08-24", "SPM55 Quiet Board Meeting");

    expect(newlyShortReservations(item(6), 0, 3, [launch, board])).toEqual([
      { ...launch, available: 3 },
    ]);
  });

  it("SPM-55-TC07: leaves a reservation the units left cover exactly", () => {
    const launch = reservation("launch", 4, "2027-08-10");

    expect(newlyShortReservations(item(6), 0, 2, [launch])).toEqual([]);
  });

  it("SPM-55-TC08: finds both reservations sharing the days when the units left cannot cover them both", () => {
    const morning = reservation("morning", 3, "2027-08-17");
    const evening = reservation("evening", 3, "2027-08-17");

    expect(newlyShortReservations(item(6), 0, 1, [morning, evening]).map((r) => [r.requestId, r.available])).toEqual([
      ["morning", 2],
      ["evening", 2],
    ]);
  });

  it("counts an untitled event's reservation like any other", () => {
    const morning = reservation("morning", 3, "2027-08-17");
    const untitled = { ...reservation("untitled", 3, "2027-08-17"), eventTitle: null };

    expect(newlyShortReservations(item(6), 0, 1, [morning, untitled]).map((r) => r.requestId)).toEqual(["morning", "untitled"]);
  });

  it("counts another event on different days as no competition", () => {
    const a = reservation("a", 3, "2027-08-03");
    const b = reservation("b", 3, "2027-08-17");

    expect(newlyShortReservations(item(6), 0, 3, [a, b])).toEqual([]);
  });

  it("does not report a reservation that was already short before this change", () => {
    const launch = reservation("launch", 4, "2027-08-10");

    expect(newlyShortReservations(item(6), 3, 4, [launch])).toEqual([]);
  });

  it("finds nothing when units are returned (AC5)", () => {
    const launch = reservation("launch", 4, "2027-08-10");

    expect(newlyShortReservations(item(6), 4, 1, [launch])).toEqual([]);
  });

  it("finds nothing when there are no reservations", () => {
    expect(newlyShortReservations(item(6), 0, 6, [])).toEqual([]);
  });
});

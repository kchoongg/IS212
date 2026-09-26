import { describe, it, expect } from "vitest";
import { assembleLines, type OtherRequest, type RequestedLine } from "../equipmentAvailabilityLines";

const sgt = (iso: string) => new Date(`${iso}:00+08:00`);

const rig = { id: "rig", name: "Lighting Rig", totalQuantity: 1, quantityInMaintenance: 0, isActive: true, locationVenueId: null };

function line(overrides: Partial<RequestedLine> = {}): RequestedLine {
  return {
    requestId: "req-1",
    quantityRequested: 1,
    equipment: rig,
    sessionId: null,
    sessionLabel: null,
    startsAt: sgt("2026-10-13T18:00"),
    endsAt: sgt("2026-10-13T21:00"),
    venueId: "hall-a",
    ...overrides,
  };
}

function other(overrides: Partial<OtherRequest> = {}): OtherRequest {
  return {
    equipmentId: "rig",
    eventTitle: "Gala Dinner",
    requestStatus: "reserved",
    quantityReserved: 1,
    eventStatus: "confirmed",
    startsAt: sgt("2026-10-12T10:00"),
    endsAt: sgt("2026-10-12T16:00"),
    venueId: "hall-b",
    ...overrides,
  };
}

describe("assembleLines", () => {
  it("returns one line per requested item, with the rules' result", () => {
    const { lines, allAvailable } = assembleLines([line()], [other()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ requestId: "req-1", equipmentName: "Lighting Rig" });
    expect(lines[0].result?.status).toBe("unavailable");
    expect(lines[0].result?.heldBy[0].eventTitle).toBe("Gala Dinner");
    expect(allAvailable).toBe(false);
  });

  it("is all available when nothing else holds the equipment", () => {
    const { lines, allAvailable } = assembleLines([line()], []);
    expect(lines[0].result?.status).toBe("available");
    expect(allAvailable).toBe(true);
  });

  it("only counts other events' requests for the same equipment item", () => {
    const { lines } = assembleLines([line()], [other({ equipmentId: "mic" })]);
    expect(lines[0].result?.status).toBe("available");
  });

  it("ignores requests that do not hold stock or whose event is released", () => {
    const { lines } = assembleLines(
      [line()],
      [
        other({ requestStatus: "under_review" }),
        other({ eventStatus: "cancelled" }),
        other({ eventStatus: "postponed" }),
      ]
    );
    expect(lines[0].result?.status).toBe("available");
  });

  it("uses quantity reserved for a partially fulfilled request", () => {
    const item = { ...rig, totalQuantity: 5 };
    const { lines } = assembleLines(
      [line({ equipment: item, quantityRequested: 3 })],
      [other({ requestStatus: "partially_fulfilled", quantityReserved: 2, startsAt: sgt("2026-10-13T10:00"), endsAt: sgt("2026-10-13T12:00") })]
    );
    expect(lines[0].result).toMatchObject({ reservedElsewhere: 2, available: 3, status: "available" });
  });

  it("says no venue is chosen, and adds no transfer time, when the event has no venue", () => {
    const { lines } = assembleLines([line({ venueId: null })], []);
    expect(lines[0].venueChosen).toBe(false);
    expect(lines[0].transferMinutes).toBe(0);
    expect(lines[0].result?.leavesAt).toEqual(sgt("2026-10-13T18:00"));
  });

  it("adds the transfer time for equipment kept in storage", () => {
    const { lines } = assembleLines([line()], []);
    expect(lines[0].venueChosen).toBe(true);
    expect(lines[0].transferMinutes).toBe(120);
    expect(lines[0].result?.leavesAt).toEqual(sgt("2026-10-13T16:00"));
  });

  it("adds no transfer time when the equipment is already at the event's venue", () => {
    const atHall = { ...rig, locationVenueId: "hall-a" };
    const { lines } = assembleLines([line({ equipment: atHall })], []);
    expect(lines[0].transferMinutes).toBe(0);
    expect(lines[0].result?.leavesAt).toEqual(sgt("2026-10-13T18:00"));
  });

  it("checks a session line against its own dates", () => {
    const day1 = line({ requestId: "s1", sessionId: "day-1", sessionLabel: "Day 1", startsAt: sgt("2026-10-05T09:00"), endsAt: sgt("2026-10-05T17:00") });
    const day2 = line({ requestId: "s2", sessionId: "day-2", sessionLabel: "Day 2", startsAt: sgt("2026-10-20T09:00"), endsAt: sgt("2026-10-20T17:00") });
    const openHouse = other({ eventTitle: "Open House", startsAt: sgt("2026-10-05T09:00"), endsAt: sgt("2026-10-05T17:00") });
    const { lines, allAvailable } = assembleLines([day1, day2], [openHouse]);
    expect(lines.map((l) => [l.sessionLabel, l.result?.status])).toEqual([
      ["Day 1", "unavailable"],
      ["Day 2", "available"],
    ]);
    expect(allAvailable).toBe(false);
  });

  it("cannot check a line while the event has no dates, and does not claim all is well", () => {
    const { lines, allAvailable } = assembleLines([line({ startsAt: null, endsAt: null })], []);
    expect(lines[0].result).toBeNull();
    expect(allAvailable).toBe(false);
  });

  it("skips another event that has no dates rather than guessing", () => {
    const { lines } = assembleLines([line()], [other({ startsAt: null, endsAt: null })]);
    expect(lines[0].result?.status).toBe("available");
  });

  it("names an untitled event holding the equipment", () => {
    const { lines } = assembleLines([line()], [other({ eventTitle: null })]);
    expect(lines[0].result?.heldBy[0].eventTitle).toBe("Untitled event");
  });

  it("treats a request with no lines as nothing missing", () => {
    expect(assembleLines([], [])).toEqual({ lines: [], allAvailable: true });
  });
});

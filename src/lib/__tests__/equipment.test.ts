import { describe, it, expect } from "vitest";
import { checkOutOfService, outOfServiceReasonFor } from "../equipment";
import { checkAvailability } from "../equipmentAvailability";

describe("checkOutOfService (SPM-48 AC7)", () => {
  it("[SPM-48][AC7] allows any number up to the total", () => {
    expect(checkOutOfService(5, 0)).toBeNull();
    expect(checkOutOfService(5, 3)).toBeNull();
    expect(checkOutOfService(5, 5)).toBeNull();
  });

  it("[SPM-48][AC7] refuses more units out of service than the item has", () => {
    expect(checkOutOfService(5, 6)).toBe("Only 5 units in total - cannot mark 6 as out of service");
  });

  it("[SPM-48][AC7] uses the singular for a single unit", () => {
    expect(checkOutOfService(1, 2)).toBe("Only 1 unit in total - cannot mark 2 as out of service");
  });
});

describe("outOfServiceReasonFor", () => {
  it("[SPM-55][AC2] keeps the reason while units are out of service", () => {
    expect(outOfServiceReasonFor(2, "Cracked lens")).toBe("Cracked lens");
  });

  it("[SPM-55][AC2] clears the reason when nothing is out of service any more", () => {
    expect(outOfServiceReasonFor(0, "Cracked lens")).toBeNull();
  });

  it("[SPM-55][AC2] stores nothing when no reason was given", () => {
    expect(outOfServiceReasonFor(2, undefined)).toBeNull();
    expect(outOfServiceReasonFor(2, "")).toBeNull();
  });
});

describe("recording units out of service lowers availability (AC7 end to end)", () => {
  const event = { startsAt: new Date("2026-10-12T10:00:00+08:00"), endsAt: new Date("2026-10-12T16:00:00+08:00") };
  const check = (quantityInMaintenance: number, requested = 3) =>
    checkAvailability({
      totalQuantity: 5,
      quantityInMaintenance,
      isActive: true,
      requested,
      transferLeadMs: 0,
      commitments: [],
      ...event,
    });

  it("[SPM-48][AC7] counts the recorded units off the available quantity", () => {
    expect(check(0).available).toBe(5);
    expect(check(2).available).toBe(3);
  });

  it("[SPM-48][AC7] turns an Available line into Partial, then Unavailable, as more units are recorded", () => {
    expect(check(0).status).toBe("available");
    expect(check(3)).toMatchObject({ status: "partial", available: 2, shortfall: 1 });
    expect(check(5)).toMatchObject({ status: "unavailable", available: 0 });
  });

  it("[SPM-48][AC7] returns the line to Available once the units are back in service", () => {
    expect(check(3).status).toBe("partial");
    expect(check(0).status).toBe("available");
  });
});

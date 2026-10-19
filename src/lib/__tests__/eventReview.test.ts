import { describe, it, expect } from "vitest";
import { isBlankReason, missingRequestFields, type ReviewableRequest } from "../eventReview";

// SPM-28 AC3 (flag incomplete information) and AC5 (a rejection needs a reason).

function request(over: Partial<ReviewableRequest> = {}): ReviewableRequest {
  return {
    purpose: "Regional product launch and press event",
    description: "Press event with livestream and product demonstration area.",
    category: "exhibition",
    startsAt: "2026-12-29T07:00:00.000Z",
    endsAt: "2026-12-29T11:00:00.000Z",
    expectedAttendance: 200,
    preferredLayout: "theatre",
    accessibilityNotes: "Step-free access",
    specialRequirements: "Press area near the stage",
    registrationEnabled: false,
    registrationCapacity: null,
    facilityRequirements: [{}],
    equipmentRequests: [{}],
    ...over,
  };
}

describe("missingRequestFields", () => {
  it("[SPM-28][AC3] flags nothing on a complete request", () => {
    expect(missingRequestFields(request())).toEqual([]);
  });

  it("[SPM-28][AC3] flags empty text, a missing schedule and empty lists, in page order", () => {
    expect(
      missingRequestFields(
        request({ description: null, accessibilityNotes: null, startsAt: null, facilityRequirements: [] })
      )
    ).toEqual(["Description", "When", "Accessibility needs", "Facilities"]);
  });

  it("[SPM-28][AC3] treats whitespace as empty", () => {
    expect(missingRequestFields(request({ description: "   " }))).toEqual(["Description"]);
  });

  it("[SPM-28][AC3] flags registration capacity only when registration is enabled", () => {
    expect(missingRequestFields(request({ registrationEnabled: false, registrationCapacity: null }))).toEqual([]);
    expect(missingRequestFields(request({ registrationEnabled: true, registrationCapacity: null }))).toEqual([
      "Registration capacity",
    ]);
  });

  it("[SPM-28][AC3] does not treat zero attendance as missing", () => {
    expect(missingRequestFields(request({ expectedAttendance: 0 }))).toEqual([]);
  });
});

describe("isBlankReason", () => {
  it("[SPM-28][AC5] rejects empty and whitespace-only reasons", () => {
    expect(isBlankReason("")).toBe(true);
    expect(isBlankReason("   ")).toBe(true);
    expect(isBlankReason("\n\t")).toBe(true);
  });

  it("[SPM-28][AC5] accepts any real text", () => {
    expect(isBlankReason("Headcount not confirmed")).toBe(false);
  });
});

// SPM-57 Manually Add Attendee - the rules, apart from the route and the
// screen (src/lib/manualRegistration.ts) and the form's schema
// (addAttendeeSchema, src/lib/validation/registrations.ts).
import { describe, it, expect } from "vitest";
import {
  addAttendeeRefusal,
  addedMessage,
  alreadyHoldsPlace,
  venueCapacity,
  venueCapacityLine,
  venueFullError,
} from "@/lib/manualRegistration";
import { addAttendeeSchema } from "@/lib/validation";
import { validate } from "@/lib/formErrors";

const salon = (overrides: Record<string, unknown> = {}) => ({
  id: "salon",
  status: "approved",
  layoutName: "theatre" as string | null,
  venue: {
    name: "SPM57 Salon",
    code: "SPM57-SAL",
    layouts: [
      { layoutName: "theatre", capacity: 4 },
      { layoutName: "u_shape", capacity: 3 },
    ],
  },
  ...overrides,
});
const hall = () => ({
  ...salon({ id: "hall" }),
  venue: { name: "SPM57 Hall", code: "SPM57-HAL", layouts: [{ layoutName: "theatre", capacity: 60 }] },
});

const SALON = { capacity: 4, venue: "SPM57 Salon (SPM57-SAL)", layout: "Theatre" };

const NOW = new Date("2026-10-29T02:00:00.000Z");
const open = (overrides: Record<string, unknown> = {}) => ({
  status: "confirmed",
  registrationEnabled: true,
  startsAt: new Date("2028-03-14T01:00:00.000Z") as Date | string | null,
  ...overrides,
});

describe("[SPM-57][AC1] when attendees can be added", () => {
  it("is while the event is Confirmed with registration turned on, before it starts", () => {
    expect(addAttendeeRefusal(open(), SALON, NOW)).toBeNull();
  });

  it.each(["draft", "approved", "planning", "safety_approved", "postponed", "cancelled", "completed"])(
    "is not while it is %s",
    (status) => {
      expect(addAttendeeRefusal(open({ status }), SALON, NOW)).toBe("Attendees can only be added to a Confirmed event.");
    }
  );

  it("is not while registration is turned off", () => {
    expect(addAttendeeRefusal(open({ registrationEnabled: false }), SALON, NOW)).toBe(
      "Registration is not enabled for this event"
    );
  });

  it.each([
    ["the moment it starts", NOW.toISOString()],
    ["once it has started", "2026-10-20T01:00:00.000Z"],
  ])("is not %s", (_when, startsAt) => {
    expect(addAttendeeRefusal(open({ startsAt }), SALON, NOW)).toBe(
      "This event has started, so attendees can no longer be added."
    );
  });

  it("is up to a minute before it starts", () => {
    expect(addAttendeeRefusal(open({ startsAt: new Date(NOW.getTime() + 60_000) }), SALON, NOW)).toBeNull();
  });

  it("is not while its venue capacity isn't known, before the form is filled in", () => {
    expect(addAttendeeRefusal(open(), null, NOW)).toBe(
      "This event's venue capacity isn't known, so attendees can't be added. Choose the venue booking registration is measured against in the Registration settings first."
    );
  });

  it("gives the status before the start, and the start before the capacity", () => {
    const started = open({ startsAt: "2026-10-20T01:00:00.000Z" });
    expect(addAttendeeRefusal({ ...started, status: "planning" }, null, NOW)).toBe(
      "Attendees can only be added to a Confirmed event."
    );
    expect(addAttendeeRefusal(started, null, NOW)).toBe("This event has started, so attendees can no longer be added.");
  });
});

describe("[SPM-57][AC3] the venue capacity an addition is measured against", () => {
  it("is the measured booking's room in its booked layout", () => {
    expect(venueCapacity([hall(), salon()], "salon")).toEqual(SALON);
  });

  it("is the event's only active booking when none was chosen", () => {
    expect(venueCapacity([salon(), hall()].map((b, i) => (i ? { ...b, status: "rejected" } : b)), null)).toEqual(SALON);
  });

  it("names the layout as the screens do", () => {
    expect(venueCapacity([salon({ layoutName: "u_shape" })], null)).toEqual({ ...SALON, capacity: 3, layout: "U shape" });
  });

  it.each([
    ["no active booking", [salon({ status: "cancelled" })], null],
    ["several active bookings and none chosen", [salon(), hall()], null],
    ["a booking with no layout", [salon({ layoutName: null })], "salon"],
    ["a layout the room no longer offers", [salon({ layoutName: "banquet" })], "salon"],
  ])("is not known with %s", (_what, bookings, measured) => {
    expect(venueCapacity(bookings, measured)).toBeNull();
  });

  it("is shown under the places line", () => {
    expect(venueCapacityLine(SALON)).toBe("Venue capacity: 4 · SPM57 Salon (SPM57-SAL), Theatre layout");
  });

  it.each([
    [0, 0],
    [3, 0],
    [2, 1],
  ])("lets an attendee in with %i seats taken and %i on offer, of 4", (taken, underOffer) => {
    expect(venueFullError(SALON, { taken, underOffer })).toBeNull();
  });

  it.each([4, 5])("refuses one more with %i seats taken of 4", (taken) => {
    expect(venueFullError(SALON, { taken, underOffer: 0 })).toBe(
      "This event has reached its venue capacity: 4 attendees in SPM57 Salon (SPM57-SAL), Theatre layout. No more attendees can be added."
    );
  });

  it("counts a place on offer to the waiting list (SPM-66) as taken", () => {
    expect(venueFullError(SALON, { taken: 3, underOffer: 1 })).toBe(
      "This event has reached its venue capacity: 4 attendees in SPM57 Salon (SPM57-SAL), Theatre layout, counting 1 place on offer to the waiting list. No more attendees can be added."
    );
  });

  it("names several places on offer", () => {
    expect(venueFullError(SALON, { taken: 2, underOffer: 2 })).toContain("counting 2 places on offer to the waiting list.");
  });
});

describe("[SPM-57][AC1][AC4] an attendee who already has a registration", () => {
  it.each([
    ["registered", "Lee Wei Ming is already registered for this event."],
    ["attended", "Lee Wei Ming is already registered for this event."],
    ["waitlisted", "Lee Wei Ming is on the waiting list for this event."],
    ["withdrawn", null],
  ])("who is %s: %s", (status, expected) => {
    expect(alreadyHoldsPlace("Lee Wei Ming", status)).toBe(expected);
  });

  it("is told about once added", () => {
    expect(addedMessage("Lee Wei Ming")).toBe("Lee Wei Ming has been added to the registration list.");
  });
});

describe("[SPM-57][AC1] the form", () => {
  it("takes the email lower-case and trimmed, and drops blank requirements", () => {
    expect(
      addAttendeeSchema.parse({ email: " Lee.Wei.Ming@Example.com ", dietaryRequirements: " Vegetarian ", accessibilityRequirements: "  " })
    ).toEqual({ email: "lee.wei.ming@example.com", dietaryRequirements: "Vegetarian", accessibilityRequirements: undefined });
  });

  it.each([
    [{}, "Enter the attendee's email address"],
    [{ email: "" }, "Enter the attendee's email address"],
    [{ email: "lee.wei.ming" }, "Enter a valid email address"],
  ])("refuses %j on the email field", (value, message) => {
    expect(validate(addAttendeeSchema, value)).toEqual({ email: message });
  });
});

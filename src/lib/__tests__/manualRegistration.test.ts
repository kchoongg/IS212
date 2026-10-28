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

describe("[SPM-57][AC1] when attendees can be added", () => {
  it("is while the event is Confirmed with registration turned on", () => {
    expect(addAttendeeRefusal({ status: "confirmed", registrationEnabled: true })).toBeNull();
  });

  it.each(["draft", "approved", "planning", "safety_approved", "postponed", "cancelled", "completed"])(
    "is not while it is %s",
    (status) => {
      expect(addAttendeeRefusal({ status, registrationEnabled: true })).toBe(
        "Attendees can only be added to a Confirmed event."
      );
    }
  );

  it("is not while registration is turned off", () => {
    expect(addAttendeeRefusal({ status: "confirmed", registrationEnabled: false })).toBe(
      "Registration is not enabled for this event"
    );
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
    [0, null],
    [3, null],
  ])("lets an attendee in with %i seats taken of 4", (taken, expected) => {
    expect(venueFullError(SALON, taken)).toBe(expected);
  });

  it.each([4, 5])("refuses one more with %i seats taken of 4", (taken) => {
    expect(venueFullError(SALON, taken)).toBe(
      "This event has reached its venue capacity: 4 attendees in SPM57 Salon (SPM57-SAL), Theatre layout. No more attendees can be added."
    );
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

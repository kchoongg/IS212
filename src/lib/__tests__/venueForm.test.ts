import { describe, it, expect } from "vitest";
import { INITIAL_VENUE, validateVenueForm, venuePayload, type VenueFormValues } from "../venueForm";

// Opening hours only. Venue.opensAt/closesAt are NOT NULL in the schema, and an
// emptied field used to be sent as undefined - which PATCH reads as "leave this
// alone", so the old value silently came back with nothing shown to the user.
// These lock that fix in.

const VALID: VenueFormValues = {
  ...INITIAL_VENUE,
  code: "TEST-01",
  name: "Test Meeting Room",
  building: "Marina Bay",
  maxCapacity: "24",
};

describe("validateVenueForm - opening hours", () => {
  it("accepts the defaults a new venue starts with", () => {
    expect(validateVenueForm(VALID)).toEqual({});
  });

  it("requires an opening time", () => {
    expect(validateVenueForm({ ...VALID, opensAt: "" }).opensAt).toMatch(/when the venue opens/i);
  });

  it("requires a closing time", () => {
    expect(validateVenueForm({ ...VALID, closesAt: "" }).closesAt).toMatch(/when the venue closes/i);
  });

  it("rejects a closing time that is not after the opening time", () => {
    expect(validateVenueForm({ ...VALID, opensAt: "18:00", closesAt: "09:00" }).closesAt).toMatch(
      /after opening time/i
    );
    // Equal is not "after" either - a room open for zero minutes is not usable.
    expect(validateVenueForm({ ...VALID, opensAt: "09:00", closesAt: "09:00" }).closesAt).toMatch(
      /after opening time/i
    );
  });

  it("accepts one minute of opening", () => {
    expect(validateVenueForm({ ...VALID, opensAt: "09:00", closesAt: "09:01" })).toEqual({});
  });
});

describe("venuePayload - opening hours", () => {
  it("always sends both times, so an empty one cannot be silently dropped", () => {
    // `undefined` here would mean "leave this alone" to PATCH, which is how the
    // old value used to come back after a user cleared the field.
    const payload = venuePayload({ ...VALID, opensAt: "", closesAt: "" });
    expect(payload.opensAt).toBe("");
    expect(payload.closesAt).toBe("");
    expect("opensAt" in payload).toBe(true);
    expect("closesAt" in payload).toBe(true);
  });

  it("passes the 24-hour value through unchanged", () => {
    // <input type="time"> reports 24-hour "HH:mm" whatever the browser renders,
    // so no conversion happens anywhere.
    const payload = venuePayload({ ...VALID, opensAt: "07:00", closesAt: "23:00" });
    expect(payload.opensAt).toBe("07:00");
    expect(payload.closesAt).toBe("23:00");
  });
});

import { describe, it, expect } from "vitest";


import {
  registerSchema,
  loginSchema,
  createEventSchema,
  updateEventStatusSchema,
  updateEventDraftSchema,
  updateVenueSchema,
  addEquipmentRequestSchema,
  updateEquipmentRequestSchema,
  recordOutOfServiceSchema,
} from "../validation";

import { SELF_REGISTERABLE_ROLES } from "../roles";


describe("registerSchema", () => {
  it("accepts a valid registration", () => {
    const result = registerSchema.safeParse({
      name: "Kristen",
      email: "kristen@test.com",
      password: "password123",
      role: "organiser",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a short password", () => {
    const result = registerSchema.safeParse({
      name: "Kristen",
      email: "kristen@test.com",
      password: "short",
      role: "organiser",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid role", () => {
    const result = registerSchema.safeParse({
      name: "Kristen",
      email: "kristen@test.com",
      password: "password123",
      role: "superadmin",
    });
    expect(result.success).toBe(false);
  });

  // SPM-21 AC4. POST /api/auth/register takes no session, so this schema is
  // the only thing standing between an anonymous caller and an internal
  // account. A self-assigned `ops_manager` would read every client's events.
  it("refuses to let a stranger claim an internal staff role", () => {
    for (const role of ["ops_manager", "coordinator", "venue_staff", "tech_support"]) {
      const result = registerSchema.safeParse({
        name: "Mallory",
        email: "mallory@test.com",
        password: "password123",
        role,
      });
      expect(result.success, `${role} must not be self-registerable`).toBe(false);
    }
  });

  it("still accepts the two external roles", () => {
    for (const role of SELF_REGISTERABLE_ROLES) {
      const result = registerSchema.safeParse({
        name: "Kristen",
        email: "kristen@test.com",
        password: "password123",
        role,
      });
      expect(result.success, `${role} should be self-registerable`).toBe(true);
    }
  });
});

// SPM-21 AC1/AC2: what the login endpoint will and will not accept before it
// ever reaches the database.
describe("registerSchema email normalisation", () => {
  it("stores the email lower-cased, so the account can be found again", () => {
    const result = registerSchema.safeParse({
      name: "Casey Tan",
      email: "Casey.Tan@Example.com",
      password: "password123",
      role: "organiser",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("casey.tan@example.com");
  });
});

describe("loginSchema", () => {
  it("accepts a well-formed email and password", () => {
    const result = loginSchema.safeParse({
      email: "daniel.tan@connectsphere.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = loginSchema.safeParse({ email: "notanemail", password: "password123" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing field rather than treating it as blank", () => {
    expect(loginSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
    expect(loginSchema.safeParse({ password: "password123" }).success).toBe(false);
  });

  // Deliberately NOT the 8-character minimum registerSchema uses: an existing
  // account may predate that rule, and rejecting a short password at login
  // would tell an attacker their guess was too short to be real.
  it("does not impose the registration password length on login", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(true);
  });

  // An address is not case sensitive. Before this, a user who capitalised the
  // first letter of their own email was told their password was wrong
  // (SPM-21 TC11).
  it("lower-cases the email so capitalisation does not change who you are", () => {
    const result = loginSchema.safeParse({
      email: "Daniel.Tan@ConnectSphere.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("daniel.tan@connectsphere.com");
  });

  it("trims surrounding whitespace before checking the email", () => {
    const result = loginSchema.safeParse({
      email: "  daniel.tan@connectsphere.com  ",
      password: "password123",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("daniel.tan@connectsphere.com");
  });

  // The messages are rendered against the field on the login form, so they are
  // written for the person reading them (SPM-21 TC07, TC08).
  it("names the field and the problem in its messages", () => {
    const bad = loginSchema.safeParse({ email: "notanemail", password: "" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const fields = bad.error.flatten().fieldErrors;
      expect(fields.email?.[0]).toBe("Enter a valid email address");
      expect(fields.password?.[0]).toBe("Enter your password");
    }
  });
});

describe("createEventSchema", () => {
  it("requires a title", () => {
    const result = createEventSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid event", () => {
    const result = createEventSchema.safeParse({ title: "Orientation Day" });
    expect(result.success).toBe(true);
  });

  it("rejects a title that is only whitespace", () => {
    const result = createEventSchema.safeParse({ title: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/cannot be blank/i);
    }
  });

  it("trims leading and trailing whitespace from a valid title", () => {
    const result = createEventSchema.safeParse({ title: "  Orientation Day  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Orientation Day");
    }
  });

  it("accepts a fully specified event request", () => {
    const result = createEventSchema.safeParse({
      title: "Orientation Day",
      purpose: "Welcome new students",
      description: "Campus tour and info sessions",
      category: "orientation",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T17:00:00.000Z",
      expectedAttendance: 200,
      preferredLayout: "theatre",
      accessibilityNotes: "Wheelchair access required",
      facilityIds: [
        "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "3fa85f64-5717-4562-b3fc-2c963f66afa7",
      ],
      equipment: [{ equipmentId: "3fa85f64-5717-4562-b3fc-2c963f66afa8", quantityRequested: 2 }],
      specialRequirements: "Catering for dietary restrictions",
      registrationEnabled: true,
      registrationCapacity: 150,
      registrationOpensAt: "2026-09-01T00:00:00.000Z",
      registrationClosesAt: "2026-09-25T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects endsAt before startsAt", () => {
    const result = createEventSchema.safeParse({
      title: "Orientation Day",
      startsAt: "2026-10-01T17:00:00.000Z",
      endsAt: "2026-10-01T09:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("requires registrationCapacity when registration is enabled", () => {
    const result = createEventSchema.safeParse({
      title: "Orientation Day",
      registrationEnabled: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects registrationClosesAt before registrationOpensAt", () => {
    const result = createEventSchema.safeParse({
      title: "Orientation Day",
      registrationOpensAt: "2026-09-25T00:00:00.000Z",
      registrationClosesAt: "2026-09-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a registration window that closes before the event starts", () => {
    const result = createEventSchema.safeParse({
      title: "Orientation Day",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T17:00:00.000Z",
      registrationOpensAt: "2026-09-01T00:00:00.000Z",
      registrationClosesAt: "2026-09-25T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a registrationOpensAt on or after the event start", () => {
    const result = createEventSchema.safeParse({
      title: "Orientation Day",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T17:00:00.000Z",
      registrationOpensAt: "2026-10-01T10:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a registrationClosesAt on or after the event start", () => {
    const result = createEventSchema.safeParse({
      title: "Orientation Day",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-01T17:00:00.000Z",
      registrationClosesAt: "2026-10-02T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateEventStatusSchema", () => {
  it("only accepts known statuses", () => {
    expect(updateEventStatusSchema.safeParse({ status: "confirmed" }).success).toBe(true);
    expect(updateEventStatusSchema.safeParse({ status: "made_up_status" }).success).toBe(false);
  });
});

// ---- SPM-24: editing a saved draft. Every field is optional here, unlike
// createEventSchema — an edit may only be touching one thing — and cross-field
// rules that depend on the record already stored are the route's job, not
// this schema's (see handleDraftEdit in src/app/api/events/[id]/route.ts). ----

describe("updateEventDraftSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateEventDraftSchema.safeParse({}).success).toBe(true);
  });

  it("does not require a title", () => {
    const result = updateEventDraftSchema.safeParse({ description: "Updated description" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const result = updateEventDraftSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a title that is only whitespace", () => {
    const result = updateEventDraftSchema.safeParse({ title: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts a partial schedule update", () => {
    const result = updateEventDraftSchema.safeParse({ startsAt: "2026-10-01T09:00:00.000Z" });
    expect(result.success).toBe(true);
  });

  it("rejects the same equipment item twice", () => {
    const item = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f10";
    const result = updateEventDraftSchema.safeParse({
      equipment: [
        { equipmentId: item, quantityRequested: 1 },
        { equipmentId: item, quantityRequested: 2 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/only be requested once/i);
    }
  });

  it("does not require startsAt/endsAt in the same payload as equipment", () => {
    // Unlike createEventSchema: dates may already be saved from an earlier
    // edit, so the payload-only check would wrongly reject this. The route
    // checks the merged record instead.
    const result = updateEventDraftSchema.safeParse({
      equipment: [{ equipmentId: "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f10", quantityRequested: 1 }],
    });
    expect(result.success).toBe(true);
  });
});

// ---- Event requirements (closes the AC4 gap: facilities and equipment are
// stored as rows, not prose, so venue suitability can match them) ----

describe("createEventSchema — facility requirements", () => {
  const base = {
    title: "Regional Nursing Symposium",
    startsAt: "2026-10-03T01:00:00.000Z",
    endsAt: "2026-10-03T09:00:00.000Z",
  };

  it("accepts a list of facility ids", () => {
    const result = createEventSchema.safeParse({
      ...base,
      facilityIds: [
        "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f01",
        "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f02",
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects ids that are not uuids", () => {
    const result = createEventSchema.safeParse({ ...base, facilityIds: ["hearing loop"] });
    expect(result.success).toBe(false);
  });

  it("is optional — a draft need not pick any", () => {
    expect(createEventSchema.safeParse(base).success).toBe(true);
  });
});

describe("createEventSchema — equipment requests", () => {
  const base = {
    title: "Regional Nursing Symposium",
    startsAt: "2026-10-03T01:00:00.000Z",
    endsAt: "2026-10-03T09:00:00.000Z",
  };
  const projector = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f10";
  const microphone = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f11";

  it("accepts items with quantities", () => {
    const result = createEventSchema.safeParse({
      ...base,
      equipment: [
        { equipmentId: projector, quantityRequested: 2 },
        { equipmentId: microphone, quantityRequested: 4, technicalRequirements: "Lapel, not handheld" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a quantity below one", () => {
    const result = createEventSchema.safeParse({
      ...base,
      equipment: [{ equipmentId: projector, quantityRequested: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects the same item twice, because (eventId, equipmentId) is unique", () => {
    // Without this the insert fails at the database with an opaque constraint
    // error instead of a message naming the problem.
    const result = createEventSchema.safeParse({
      ...base,
      equipment: [
        { equipmentId: projector, quantityRequested: 1 },
        { equipmentId: projector, quantityRequested: 2 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/only be requested once/i);
    }
  });

  it("rejects equipment on an event with no dates", () => {
    // EquipmentRequest.startsAt/endsAt are NOT NULL and are derived from the
    // event's own times, so equipment without dates has nowhere to hang.
    const result = createEventSchema.safeParse({
      title: "Regional Nursing Symposium",
      equipment: [{ equipmentId: projector, quantityRequested: 1 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/date and time/i);
    }
  });

  it("still accepts an event with dates and no equipment", () => {
    expect(createEventSchema.safeParse(base).success).toBe(true);
  });

  it("says what to do when an equipment row has no item, not Zod's raw 'Invalid uuid'", () => {
    // What reaches the user when a draft is saved with an empty equipment row.
    const result = createEventSchema.safeParse({ ...base, equipment: [{ equipmentId: "", quantityRequested: 1 }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.equipment).toEqual([
        "Choose an item for every equipment row, or remove the empty ones.",
      ]);
      expect(JSON.stringify(result.error.issues)).not.toMatch(/invalid uuid/i);
    }
  });

  it("says what to do when a quantity is below one or not whole, not 'Number must be greater than 0'", () => {
    for (const quantityRequested of [0, -2, 1.5]) {
      const result = createEventSchema.safeParse({ ...base, equipment: [{ equipmentId: projector, quantityRequested }] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.equipment).toEqual([
          "Every equipment row needs a quantity of at least 1.",
        ]);
      }
    }
  });

  it("uses the same wording on the edit-draft schema and for a session's equipment rows", () => {
    const edit = updateEventDraftSchema.safeParse({ equipment: [{ equipmentId: "", quantityRequested: 1 }] });
    expect(edit.success).toBe(false);
    if (!edit.success) {
      expect(edit.error.flatten().fieldErrors.equipment?.[0]).toMatch(/^Choose an item/);
    }

    const session = createEventSchema.safeParse({
      title: "Regional Nursing Symposium",
      sessions: [
        { startsAt: "2026-10-03T01:00:00.000Z", endsAt: "2026-10-03T09:00:00.000Z", equipment: [{ equipmentId: "", quantityRequested: 1 }] },
        { startsAt: "2026-10-04T01:00:00.000Z", endsAt: "2026-10-04T09:00:00.000Z" },
      ],
    });
    expect(session.success).toBe(false);
    if (!session.success) {
      expect(session.error.flatten().fieldErrors.sessions?.[0]).toMatch(/^Choose an item/);
    }
  });
});

// ---- Multi-session events (SPM-23, class clarification #74: sessions may have
// different timings, attendance limits, venues and equipment) ----

describe("createEventSchema — sessions", () => {
  const projector = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f10";
  const microphone = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f11";
  const day1 = { startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z" };
  const day2 = { startsAt: "2026-12-06T01:00:00.000Z", endsAt: "2026-12-06T09:00:00.000Z" };

  it("accepts an event with two sessions and no event-level dates", () => {
    // The event's own start/end/headcount are derived from the sessions by the
    // route, so a sessions-only body is complete on its own.
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      sessions: [
        { ...day1, label: "Day 1", expectedAttendance: 300, preferredLayout: "theatre" },
        { ...day2, label: "Day 2", expectedAttendance: 80, preferredLayout: "classroom" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a single session — one session is just an event", () => {
    const result = createEventSchema.safeParse({ title: "Nusantara Summit", sessions: [day1] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least two sessions/i);
    }
  });

  it("names the session whose end is not after its start", () => {
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      sessions: [day1, { startsAt: day2.endsAt, endsAt: day2.startsAt }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Session 2: ends at must be after starts at");
      expect(result.error.issues[0].path).toEqual(["sessions", 1, "endsAt"]);
    }
  });

  it("requires every session to have its own start and end", () => {
    // event_sessions.starts_at / ends_at are NOT NULL, so a session cannot be
    // stored without them - not even inside a draft.
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      sessions: [day1, { label: "Day 2" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a session attendance of zero", () => {
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      sessions: [{ ...day1, expectedAttendance: 0 }, day2],
    });
    expect(result.success).toBe(false);
  });

  it("accepts per-session equipment", () => {
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      sessions: [
        { ...day1, equipment: [{ equipmentId: projector, quantityRequested: 2 }] },
        { ...day2, equipment: [{ equipmentId: microphone, quantityRequested: 4 }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects the same equipment item in two sessions, because (eventId, equipmentId) is unique", () => {
    // The unique index does not include sessionId, so two sessions of one event
    // cannot each request the same item yet. Better a message than an opaque
    // constraint failure on insert.
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      sessions: [
        { ...day1, equipment: [{ equipmentId: projector, quantityRequested: 2 }] },
        { ...day2, equipment: [{ equipmentId: projector, quantityRequested: 1 }] },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/once per event, across all sessions/i);
      expect(result.error.issues[0].path).toEqual(["sessions"]);
    }
  });

  it("rejects an item requested both event-wide and on a session", () => {
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      equipment: [{ equipmentId: projector, quantityRequested: 1 }],
      sessions: [{ ...day1, equipment: [{ equipmentId: projector, quantityRequested: 2 }] }, day2],
    });
    expect(result.success).toBe(false);
  });

  it("accepts event-wide equipment when the dates come from the sessions", () => {
    // "Set the event date and time before requesting equipment" is satisfied by
    // the sessions' dates - the event's own are derived from them.
    const result = createEventSchema.safeParse({
      title: "Nusantara Summit",
      equipment: [{ equipmentId: projector, quantityRequested: 1 }],
      sessions: [day1, day2],
    });
    expect(result.success).toBe(true);
  });

  it("measures the registration window against the FIRST session, not the last", () => {
    const base = {
      title: "Nusantara Summit",
      sessions: [day1, day2],
      registrationEnabled: true,
      registrationCapacity: 300,
    };

    // Opens before day 1 starts: fine.
    expect(
      createEventSchema.safeParse({ ...base, registrationOpensAt: "2026-11-01T00:00:00.000Z" }).success
    ).toBe(true);

    // Opens between the two sessions: after the event has already begun.
    const opensMidEvent = createEventSchema.safeParse({
      ...base,
      registrationOpensAt: "2026-12-05T12:00:00.000Z",
    });
    expect(opensMidEvent.success).toBe(false);
    if (!opensMidEvent.success) {
      expect(opensMidEvent.error.issues[0].message).toMatch(/must be before the event starts/i);
    }

    // Closes between the two sessions: same rule.
    expect(
      createEventSchema.safeParse({ ...base, registrationClosesAt: "2026-12-05T12:00:00.000Z" }).success
    ).toBe(false);
  });
});

describe("updateEventDraftSchema — sessions", () => {
  const day1 = { startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z" };
  const day2 = { startsAt: "2026-12-06T01:00:00.000Z", endsAt: "2026-12-06T09:00:00.000Z" };

  it("accepts two or more sessions", () => {
    expect(updateEventDraftSchema.safeParse({ sessions: [day1, day2] }).success).toBe(true);
  });

  it("accepts an empty list, which is how multi-session is turned off", () => {
    expect(updateEventDraftSchema.safeParse({ sessions: [] }).success).toBe(true);
  });

  it("leaves sessions untouched when omitted", () => {
    const result = updateEventDraftSchema.safeParse({ title: "Renamed" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sessions).toBeUndefined();
  });

  it("rejects a single session", () => {
    expect(updateEventDraftSchema.safeParse({ sessions: [day1] }).success).toBe(false);
  });

  it("rejects the same equipment item in two sessions", () => {
    const projector = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f10";
    const result = updateEventDraftSchema.safeParse({
      sessions: [
        { ...day1, equipment: [{ equipmentId: projector, quantityRequested: 1 }] },
        { ...day2, equipment: [{ equipmentId: projector, quantityRequested: 1 }] },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("updateVenueSchema", () => {
  it("accepts a single field on its own", () => {
    expect(updateVenueSchema.safeParse({ maxCapacity: 40 }).success).toBe(true);
  });

  it("accepts retiring a venue", () => {
    const result = updateVenueSchema.safeParse({ isActive: false, reason: "Renovation" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    // Nothing to change is a mistake worth reporting, not a silent no-op that
    // still writes an audit trail and notifies people.
    const result = updateVenueSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least one field/i);
    }
  });

  it("rejects a body of nothing but unknown fields", () => {
    expect(updateVenueSchema.safeParse({ capacity: 40 }).success).toBe(false);
  });

  it("rejects a duplicate layout name", () => {
    // VenueLayout is unique on (venueId, layoutName), and a replacement list
    // is written as delete-then-create - so a duplicate here would fail
    // mid-transaction as a 500 instead of a 400.
    const result = updateVenueSchema.safeParse({
      layouts: [
        { layoutName: "classroom", capacity: 40 },
        { layoutName: "classroom", capacity: 30 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/only once/i);
    }
  });

  it("accepts an empty layouts array, which clears every layout", () => {
    // Deliberate: removing the last layout is a legitimate edit, and it is one
    // that flags every booking that named a layout.
    expect(updateVenueSchema.safeParse({ layouts: [] }).success).toBe(true);
  });

  it("still enforces the field rules it inherits from createVenueSchema", () => {
    expect(updateVenueSchema.safeParse({ maxCapacity: 0 }).success).toBe(false);
    expect(updateVenueSchema.safeParse({ opensAt: "8am" }).success).toBe(false);
    expect(updateVenueSchema.safeParse({ facilityIds: ["not-a-uuid"] }).success).toBe(false);
  });
});

// ---- Equipment requirements recorded after the event exists (SPM-47, S-16) ----

describe("addEquipmentRequestSchema", () => {
  const projector = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f10";

  it("accepts an item with a quantity", () => {
    const result = addEquipmentRequestSchema.safeParse({
      equipmentId: projector,
      quantityRequested: 2,
      technicalRequirements: "Ceiling-mounted",
    });
    expect(result.success).toBe(true);
  });

  it("technical requirements are optional", () => {
    expect(
      addEquipmentRequestSchema.safeParse({ equipmentId: projector, quantityRequested: 1 }).success
    ).toBe(true);
  });

  it("rejects a quantity below one", () => {
    expect(
      addEquipmentRequestSchema.safeParse({ equipmentId: projector, quantityRequested: 0 }).success
    ).toBe(false);
  });

  it("rejects a non-uuid equipment id", () => {
    expect(
      addEquipmentRequestSchema.safeParse({ equipmentId: "projector", quantityRequested: 1 }).success
    ).toBe(false);
  });

  // SPM-47 multi-session events (class clarification #74): sessionId scopes
  // a requirement to one EventSession instead of the whole event.
  it("sessionId is optional — most events have no sessions", () => {
    expect(
      addEquipmentRequestSchema.safeParse({ equipmentId: projector, quantityRequested: 1 }).success
    ).toBe(true);
  });

  it("accepts a sessionId alongside the usual fields", () => {
    const session = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f11";
    expect(
      addEquipmentRequestSchema.safeParse({
        equipmentId: projector,
        quantityRequested: 1,
        sessionId: session,
      }).success
    ).toBe(true);
  });

  it("rejects a non-uuid sessionId", () => {
    expect(
      addEquipmentRequestSchema.safeParse({
        equipmentId: projector,
        quantityRequested: 1,
        sessionId: "not-a-uuid",
      }).success
    ).toBe(false);
  });
});

describe("updateEquipmentRequestSchema", () => {
  it("accepts a quantity change alone", () => {
    expect(updateEquipmentRequestSchema.safeParse({ quantityRequested: 5 }).success).toBe(true);
  });

  it("accepts a technical requirements change alone", () => {
    expect(
      updateEquipmentRequestSchema.safeParse({ technicalRequirements: "Needs two power outlets" }).success
    ).toBe(true);
  });

  it("rejects an empty update — nothing to change", () => {
    expect(updateEquipmentRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a quantity below one", () => {
    expect(updateEquipmentRequestSchema.safeParse({ quantityRequested: 0 }).success).toBe(false);
  });
});

describe("recordOutOfServiceSchema (SPM-48 AC7)", () => {
  it("accepts a number of units and a reason", () => {
    const parsed = recordOutOfServiceSchema.parse({ quantityOutOfService: 2, reason: "  Cracked lens  " });
    expect(parsed).toEqual({ quantityOutOfService: 2, reason: "Cracked lens" });
  });

  it("accepts zero units, to record that everything is back in service", () => {
    expect(recordOutOfServiceSchema.safeParse({ quantityOutOfService: 0 }).success).toBe(true);
  });

  it("does not need a reason", () => {
    expect(recordOutOfServiceSchema.safeParse({ quantityOutOfService: 1 }).success).toBe(true);
  });

  it.each([-1, 1.5, "2", null])("rejects %s as the number of units", (value) => {
    expect(recordOutOfServiceSchema.safeParse({ quantityOutOfService: value }).success).toBe(false);
  });

  it("rejects a missing number of units", () => {
    expect(recordOutOfServiceSchema.safeParse({ reason: "Broken" }).success).toBe(false);
  });

  it("rejects a reason longer than 500 characters", () => {
    expect(recordOutOfServiceSchema.safeParse({ quantityOutOfService: 1, reason: "x".repeat(501) }).success).toBe(false);
  });
});

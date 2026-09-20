import { describe, it, expect } from "vitest";
import {
  registerSchema,
  createEventSchema,
  updateEventStatusSchema,
  updateEventDraftSchema,
  updateVenueSchema,
  addEquipmentRequestSchema,
  updateEquipmentRequestSchema,
} from "../validation";

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

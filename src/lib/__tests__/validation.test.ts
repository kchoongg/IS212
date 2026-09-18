import { describe, it, expect } from "vitest";
import { registerSchema, loginSchema, createEventSchema, updateEventStatusSchema, updateEventDraftSchema } from "../validation";
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
});

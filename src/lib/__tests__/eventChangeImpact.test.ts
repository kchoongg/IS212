// CONTRACT (SPM-62, written before the code) - what these tests expect to exist:
//   src/lib/eventChangeImpact.ts, pure (no Prisma), exporting:
//     IMPORTANT_CHANGES = ["schedule", "attendance", "venue_requirements", "equipment"]
//     CHANGE_LABELS: Record<ImportantChange, string>
//       schedule "Date and time", attendance "Expected attendance",
//       venue_requirements "Venue requirements", equipment "Equipment requirements"
//     importantChanges(before: EventInfo, after: EventInfo): ImportantChange[]
//       EventInfo = { startsAt, endsAt: Date | null; expectedAttendance: number | null;
//                     preferredLayout: string | null; facilityIds: string[] }
//       always in IMPORTANT_CHANGES order; never "equipment" (that comes from the Equipment tab)
//     CHANGE_REASONS = ["event_schedule_changed", "event_attendance_changed", "event_requirements_changed"]
//     CHANGE_REASON_PROSE: Record<ChangeReason, string>
//     affectedArrangements(changes, arrangements, now) -> { venueBookings, equipmentRequests, registrations }
//       arrangements = { venueBookings: {id,status,endsAt}[], equipmentRequests: {id,status,endsAt}[], registrationCount }
//       the reasons THIS change adds; merging with reasons already stored (SPM-39's included) is the route's job
//     revertsConfirmation(status, affected): boolean
//     reviewLine(reasons): string       - "the date or time changed; the venue requirements changed"
// Decided here, not in the story (see docs/test-cases/SPM-62_test_cases.json open_questions):
//   - which fields are important, and which arrangements each one flags
//   - a Confirmed event reverts only when a venue booking or equipment request is flagged
//   - all wording above
import { describe, it, expect } from "vitest";
import {
  CHANGE_LABELS,
  CHANGE_REASON_PROSE,
  IMPORTANT_CHANGES,
  affectedArrangements,
  importantChanges,
  reviewLine,
  revertsConfirmation,
  type EventInfo,
} from "@/lib/eventChangeImpact";

const NOW = new Date("2027-01-01T00:00:00.000Z");

function info(overrides: Partial<EventInfo> = {}): EventInfo {
  return {
    startsAt: new Date("2027-03-17T01:00:00.000Z"),
    endsAt: new Date("2027-03-17T09:00:00.000Z"),
    expectedAttendance: 80,
    preferredLayout: "theatre",
    facilityIds: ["f-projector", "f-loop"],
    ...overrides,
  };
}

describe("importantChanges", () => {
  it("finds nothing when nothing important changed", () => {
    expect(importantChanges(info(), info())).toEqual([]);
  });

  it("compares dates by the moment, not by object identity", () => {
    const before = info();
    const after = info({
      startsAt: new Date(before.startsAt!.getTime()),
      endsAt: new Date(before.endsAt!.getTime()),
    });

    expect(importantChanges(before, after)).toEqual([]);
  });

  it.each([
    ["the start", { startsAt: new Date("2027-03-24T01:00:00.000Z") }],
    ["the end", { endsAt: new Date("2027-03-17T10:00:00.000Z") }],
    ["the start by one minute", { startsAt: new Date("2027-03-17T01:01:00.000Z") }],
  ])("counts a change to %s as a schedule change", (_what, change) => {
    expect(importantChanges(info(), info(change))).toEqual(["schedule"]);
  });

  it.each([
    ["up", 81],
    ["down", 79],
  ])("counts attendance going %s as an attendance change", (_direction, expectedAttendance) => {
    expect(importantChanges(info(), info({ expectedAttendance }))).toEqual(["attendance"]);
  });

  it.each([
    ["the preferred layout", { preferredLayout: "classroom" }],
    ["clearing the preferred layout", { preferredLayout: null }],
    ["adding a facility", { facilityIds: ["f-projector", "f-loop", "f-stage"] }],
    ["removing a facility", { facilityIds: ["f-projector"] }],
  ])("counts %s as a venue requirements change", (_what, change) => {
    expect(importantChanges(info(), info(change))).toEqual(["venue_requirements"]);
  });

  it("ignores the order the facilities are listed in", () => {
    expect(importantChanges(info(), info({ facilityIds: ["f-loop", "f-projector"] }))).toEqual([]);
  });

  it("lists several changes in a fixed order, whatever changed first", () => {
    const after = info({
      facilityIds: [],
      expectedAttendance: 95,
      startsAt: new Date("2027-03-24T01:00:00.000Z"),
    });

    expect(importantChanges(info(), after)).toEqual(["schedule", "attendance", "venue_requirements"]);
  });

  it("counts setting a value that was empty", () => {
    expect(importantChanges(info({ expectedAttendance: null }), info())).toEqual(["attendance"]);
  });
});

describe("affectedArrangements", () => {
  const booking = (overrides = {}) => ({
    id: "b1",
    status: "approved",
    endsAt: new Date("2027-03-17T09:00:00.000Z"),
    ...overrides,
  });
  const equipment = (overrides = {}) => ({
    id: "r1",
    status: "reserved",
    endsAt: new Date("2027-03-17T11:00:00.000Z"),
    ...overrides,
  });
  const all = (overrides = {}) => ({
    venueBookings: [booking()],
    equipmentRequests: [equipment()],
    registrationCount: 12,
    ...overrides,
  });

  it("flags nothing for an ordinary edit", () => {
    expect(affectedArrangements([], all(), NOW)).toEqual({
      venueBookings: [],
      equipmentRequests: [],
      registrations: null,
    });
  });

  it("flags the venue booking, the equipment and the registrations when the date or time changes", () => {
    expect(affectedArrangements(["schedule"], all(), NOW)).toEqual({
      venueBookings: [{ id: "b1", reasons: ["event_schedule_changed"] }],
      equipmentRequests: [{ id: "r1", reasons: ["event_schedule_changed"] }],
      registrations: { reasons: ["event_schedule_changed"] },
    });
  });

  it.each([["attendance"], ["venue_requirements"]] as const)(
    "flags only the venue booking when the %s changes",
    (change) => {
      const result = affectedArrangements([change], all(), NOW);

      expect(result.venueBookings).toHaveLength(1);
      expect(result.equipmentRequests).toEqual([]);
      expect(result.registrations).toBeNull();
    }
  );

  it("gives a booking every reason that applies, in a fixed order", () => {
    const result = affectedArrangements(["venue_requirements", "attendance"], all(), NOW);

    expect(result.venueBookings).toEqual([
      { id: "b1", reasons: ["event_attendance_changed", "event_requirements_changed"] },
    ]);
  });

  it.each(["pending", "approved"])("flags a %s booking", (status) => {
    expect(affectedArrangements(["schedule"], all({ venueBookings: [booking({ status })] }), NOW).venueBookings).toHaveLength(1);
  });

  it.each(["rejected", "cancelled"])("leaves a %s booking alone", (status) => {
    expect(affectedArrangements(["schedule"], all({ venueBookings: [booking({ status })] }), NOW).venueBookings).toEqual([]);
  });

  it("leaves a booking that has already ended alone, but not one ending later", () => {
    const ended = booking({ id: "ended", endsAt: NOW });
    const later = booking({ id: "later", endsAt: new Date(NOW.getTime() + 1) });

    const result = affectedArrangements(["schedule"], all({ venueBookings: [ended, later] }), NOW);

    expect(result.venueBookings.map((b) => b.id)).toEqual(["later"]);
  });

  it.each(["requested", "under_review", "reserved", "partially_fulfilled"])("flags %s equipment", (status) => {
    expect(
      affectedArrangements(["schedule"], all({ equipmentRequests: [equipment({ status })] }), NOW).equipmentRequests
    ).toHaveLength(1);
  });

  it.each(["unavailable", "cancelled"])("leaves %s equipment alone", (status) => {
    expect(
      affectedArrangements(["schedule"], all({ equipmentRequests: [equipment({ status })] }), NOW).equipmentRequests
    ).toEqual([]);
  });

  it("does not flag registrations when nobody has registered", () => {
    expect(affectedArrangements(["schedule"], all({ registrationCount: 0 }), NOW).registrations).toBeNull();
  });
});

describe("revertsConfirmation", () => {
  const none = { venueBookings: [], equipmentRequests: [], registrations: null };
  const booking = { ...none, venueBookings: [{ id: "b1", reasons: ["event_schedule_changed" as const] }] };
  const equipment = { ...none, equipmentRequests: [{ id: "r1", reasons: ["event_schedule_changed" as const] }] };
  const registrationsOnly = { ...none, registrations: { reasons: ["event_schedule_changed" as const] } };

  it.each([
    ["a flagged venue booking", booking],
    ["flagged equipment", equipment],
  ])("reverts a Confirmed event with %s", (_what, affected) => {
    expect(revertsConfirmation("confirmed", affected)).toBe(true);
  });

  it("does not revert a Confirmed event when nothing is flagged", () => {
    expect(revertsConfirmation("confirmed", none)).toBe(false);
  });

  it("does not revert for registrations alone - confirmation does not depend on them", () => {
    expect(revertsConfirmation("confirmed", registrationsOnly)).toBe(false);
  });

  it.each(["approved", "planning"])("never reverts an event that is %s", (status) => {
    expect(revertsConfirmation(status, booking)).toBe(false);
  });
});

describe("wording", () => {
  it("labels every important change for the form's warning", () => {
    expect(IMPORTANT_CHANGES.map((c) => CHANGE_LABELS[c])).toEqual([
      "Date and time",
      "Expected attendance",
      "Venue requirements",
      "Equipment requirements",
    ]);
  });

  it("words each reason for the Arrangements to review list", () => {
    expect(CHANGE_REASON_PROSE).toEqual({
      event_schedule_changed: "the date or time changed",
      event_attendance_changed: "the expected attendance changed",
      event_requirements_changed: "the venue requirements changed",
    });
  });

  it("joins several reasons with semicolons, in a fixed order", () => {
    expect(reviewLine(["event_requirements_changed", "event_attendance_changed"])).toBe(
      "the expected attendance changed; the venue requirements changed"
    );
  });
});

// SPM-35 Request Event Change - the rules, apart from the routes and screens.
// Written before the code (src/lib/eventChangeRequest.ts).
import { describe, it, expect } from "vitest";
import {
  CHANGE_REQUEST_STATUSES,
  FIELD_LABELS,
  REQUESTABLE_FIELDS,
  canRequestChangeIn,
  describeChangeRequest,
  fieldChanges,
  importantFor,
  showValue,
  type EventSnapshot,
} from "@/lib/eventChangeRequest";

const STAGE = { id: "f-stage", name: "Raised stage" };
const RAMP = { id: "f-ramp", name: "Step-free access" };

const snapshot = (overrides: Partial<EventSnapshot> = {}): EventSnapshot => ({
  title: "SPM35 Harbour Townhall",
  category: "meeting",
  purpose: "Quarterly all-hands",
  description: "Leadership update and Q&A.",
  startsAt: new Date("2027-04-12T01:00:00.000Z"), // 12 Apr 2027, 09:00 in Singapore
  endsAt: new Date("2027-04-12T04:00:00.000Z"),
  expectedAttendance: 80,
  preferredLayout: "theatre",
  facilities: [STAGE],
  accessibilityNotes: null,
  specialRequirements: null,
  ...overrides,
});
const names = new Map([STAGE, RAMP].map((f) => [f.id, f.name]));

describe("[SPM-35][AC1] the statuses a change can be requested in", () => {
  it.each(["approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed"])("allows %s", (status) => {
    expect(canRequestChangeIn(status)).toBe(true);
  });

  it.each(["draft", "submitted", "under_review", "rejected", "withdrawn", "cancelled", "completed"])("refuses %s", (status) => {
    expect(canRequestChangeIn(status)).toBe(false);
  });

  it("lists exactly the six statuses of the story", () => {
    expect([...CHANGE_REQUEST_STATUSES]).toEqual(["approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed"]);
  });
});

describe("[SPM-35][AC1][AC2] which fields a request changes", () => {
  it("offers every field Update Event Information edits, in the form's order", () => {
    expect([...REQUESTABLE_FIELDS]).toEqual([
      "title", "category", "purpose", "description", "startsAt", "endsAt", "expectedAttendance",
      "preferredLayout", "facilityIds", "accessibilityNotes", "specialRequirements",
    ]);
    expect(FIELD_LABELS.title).toBe("Event name");
    expect(FIELD_LABELS.facilityIds).toBe("Facilities and accessibility needs");
  });

  it("records each changed field with its current and proposed value", () => {
    const changes = fieldChanges(snapshot(), { title: "SPM35 Harbour Townhall and Awards", expectedAttendance: 95 }, names);

    expect(changes).toEqual([
      { field: "title", current: "SPM35 Harbour Townhall", proposed: "SPM35 Harbour Townhall and Awards" },
      { field: "expectedAttendance", current: 80, proposed: 95 },
    ]);
  });

  it("leaves out a field sent with the value it already has", () => {
    expect(fieldChanges(snapshot(), { title: "SPM35 Harbour Townhall", expectedAttendance: 80, preferredLayout: "theatre" }, names)).toEqual([]);
  });

  it("treats a blank text and a missing one as the same, and trims the event name", () => {
    expect(fieldChanges(snapshot(), { accessibilityNotes: "  ", title: " SPM35 Harbour Townhall " }, names)).toEqual([]);
    expect(fieldChanges(snapshot(), { purpose: "" }, names)).toEqual([{ field: "purpose", current: "Quarterly all-hands", proposed: null }]);
  });

  it("compares times as moments and stores them as ISO strings", () => {
    const changes = fieldChanges(snapshot(), { startsAt: "2027-04-12T01:00:00.000Z", endsAt: "2027-04-19T04:00:00.000Z" }, names);

    expect(changes).toEqual([{ field: "endsAt", current: "2027-04-12T04:00:00.000Z", proposed: "2027-04-19T04:00:00.000Z" }]);
  });

  it("records 'No preference' as a layout of null", () => {
    expect(fieldChanges(snapshot(), { preferredLayout: null }, names)).toEqual([
      { field: "preferredLayout", current: "theatre", proposed: null },
    ]);
  });

  it("compares facilities as a set and stores them with their names", () => {
    expect(fieldChanges(snapshot({ facilities: [STAGE, RAMP] }), { facilityIds: [RAMP.id, STAGE.id] }, names)).toEqual([]);
    expect(fieldChanges(snapshot(), { facilityIds: [RAMP.id, STAGE.id] }, names)).toEqual([
      { field: "facilityIds", current: [STAGE], proposed: [STAGE, RAMP] },
    ]);
  });

  it("records a value proposed for a field the event has none in", () => {
    const empty = snapshot({ startsAt: null, endsAt: null, expectedAttendance: null, preferredLayout: null });

    expect(fieldChanges(empty, { startsAt: "2027-04-12T01:00:00.000Z", expectedAttendance: 50, preferredLayout: "banquet" }, names)).toEqual([
      { field: "startsAt", current: null, proposed: "2027-04-12T01:00:00.000Z" },
      { field: "expectedAttendance", current: null, proposed: 50 },
      { field: "preferredLayout", current: null, proposed: "banquet" },
    ]);
  });

  it("names a facility it was given no name for by its id", () => {
    expect(fieldChanges(snapshot({ facilities: [] }), { facilityIds: ["f-unknown"] }, names)).toEqual([
      { field: "facilityIds", current: [], proposed: [{ id: "f-unknown", name: "f-unknown" }] },
    ]);
  });

  it("keeps the request's own field order whatever order the payload has", () => {
    const fields = fieldChanges(snapshot(), { specialRequirements: "Lectern", title: "New name", category: "conference" }, names).map((c) => c.field);

    expect(fields).toEqual(["title", "category", "specialRequirements"]);
  });
});

describe("[SPM-35][AC4] which requests are Important", () => {
  const change = (field: string) => ({ field, current: null, proposed: null }) as never;

  it.each([
    [["startsAt"], ["schedule"]],
    [["endsAt"], ["schedule"]],
    [["expectedAttendance"], ["attendance"]],
    [["preferredLayout"], ["venue_requirements"]],
    [["facilityIds"], ["venue_requirements"]],
  ])("a change to %j is %j", (fields, expected) => {
    expect(importantFor(fields.map(change), null)).toEqual(expected);
  });

  it("any equipment change is Important", () => {
    expect(importantFor([], "Two more handheld microphones")).toEqual(["equipment"]);
  });

  it("names each kind of important change once, in SPM-62's order", () => {
    expect(importantFor(["facilityIds", "startsAt", "endsAt", "expectedAttendance"].map(change), "One projector")).toEqual([
      "schedule", "attendance", "venue_requirements", "equipment",
    ]);
  });

  it.each([["title"], ["category"], ["purpose"], ["description"], ["accessibilityNotes"], ["specialRequirements"]])(
    "a change to %s alone is not Important",
    (field) => {
      expect(importantFor([change(field)], null)).toEqual([]);
    }
  );

  it("blank equipment text is no equipment change", () => {
    expect(importantFor([], "   ")).toEqual([]);
  });
});

describe("[SPM-35][AC2] how a value reads", () => {
  it.each([
    ["startsAt", "2027-05-17T01:00:00.000Z", "17 May 2027, 09:00"],
    ["expectedAttendance", 150, "150"],
    ["preferredLayout", "banquet", "Banquet"],
    ["preferredLayout", null, "No preference"],
    ["category", "meeting", "Meeting"],
    ["facilityIds", [STAGE, RAMP], "Raised stage, Step-free access"],
    ["facilityIds", [], "None"],
    ["facilityIds", null, "None"],
    ["description", null, "Not set"],
    ["title", "SPM35 Harbour Townhall", "SPM35 Harbour Townhall"],
  ])("%s %j reads %j", (field, value, expected) => {
    expect(showValue(field as never, value as never)).toBe(expected);
  });
});

describe("[SPM-35] a stored request, described for the screens", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "cr-1",
    kind: "change",
    status: "pending",
    reason: "Registrations are ahead of forecast.",
    requestedAt: new Date("2026-10-20T02:00:00.000Z"),
    requester: { fullName: "Rachel Ng" },
    changes: [{ field: "expectedAttendance", current: 100, proposed: 150 }],
    equipmentChanges: null,
    isSignificant: true,
    proposedStartsAt: null,
    proposedEndsAt: null,
    proposedAttendance: null,
    ...overrides,
  });

  it("[AC2][AC4] gives each field's label, current and proposed value, and why it is Important", () => {
    expect(describeChangeRequest(row(), snapshot())).toEqual({
      id: "cr-1",
      kind: "change",
      kindLabel: "Change of details",
      status: "pending",
      reason: "Registrations are ahead of forecast.",
      requestedAt: "2026-10-20T02:00:00.000Z",
      requestedBy: "Rachel Ng",
      important: true,
      affects: ["Expected attendance"],
      rows: [{ field: "expectedAttendance", label: "Expected attendance", current: "100", proposed: "150", outcome: null, outcomeReason: null }],
      equipmentChanges: null,
      equipmentOutcome: null,
      equipmentOutcomeReason: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    });
  });

  it("[AC1][AC4] shows the equipment change and counts it as Important", () => {
    const described = describeChangeRequest(row({ changes: [], equipmentChanges: "Two more microphones" }), snapshot());

    expect(described).toMatchObject({ important: true, affects: ["Equipment requirements"], rows: [], equipmentChanges: "Two more microphones" });
  });

  it("[AC4] a request that only renames the event is not Important", () => {
    const described = describeChangeRequest(
      row({ changes: [{ field: "title", current: "A", proposed: "B" }], isSignificant: false }),
      snapshot()
    );

    expect(described).toMatchObject({ important: false, affects: [] });
  });

  it.each([
    ["postpone", "Postponement"],
    ["cancel", "Cancellation"],
  ])("[AC5] a %s request has no fields and is not Important", (kind, label) => {
    expect(describeChangeRequest(row({ kind, changes: null, isSignificant: false }), snapshot())).toMatchObject({
      kind,
      kindLabel: label,
      important: false,
      affects: [],
      rows: [],
    });
  });

  it("shows a request made before SPM-35 from its proposed start, end and attendance, against the event now", () => {
    const described = describeChangeRequest(
      row({
        changes: null,
        proposedStartsAt: new Date("2027-04-12T06:00:00.000Z"),
        proposedEndsAt: new Date("2027-04-12T09:00:00.000Z"),
        proposedAttendance: 180,
      }),
      snapshot()
    );

    expect(described.rows).toEqual([
      { field: "startsAt", label: "Starts at", current: "12 Apr 2027, 09:00", proposed: "12 Apr 2027, 14:00", outcome: null, outcomeReason: null },
      { field: "endsAt", label: "Ends at", current: "12 Apr 2027, 12:00", proposed: "12 Apr 2027, 17:00", outcome: null, outcomeReason: null },
      { field: "expectedAttendance", label: "Expected attendance", current: "80", proposed: "180", outcome: null, outcomeReason: null },
    ]);
    expect(described).toMatchObject({ important: true, affects: ["Date and time", "Expected attendance"] });
  });

  it("shows a request made before SPM-35 that only asked for more places", () => {
    const described = describeChangeRequest(row({ changes: null, proposedAttendance: 180 }), snapshot());

    expect(described.rows).toEqual([{ field: "expectedAttendance", label: "Expected attendance", current: "80", proposed: "180", outcome: null, outcomeReason: null }]);
  });

  it("shows a request made before SPM-35 that only moved the time", () => {
    const described = describeChangeRequest(
      row({ changes: null, proposedStartsAt: new Date("2027-04-12T06:00:00.000Z"), proposedEndsAt: new Date("2027-04-12T09:00:00.000Z") }),
      snapshot()
    );

    expect(described.rows.map((r) => r.field)).toEqual(["startsAt", "endsAt"]);
  });

  it("labels a kind of request it does not know in words", () => {
    expect(describeChangeRequest(row({ kind: "split_event", changes: null }), snapshot()).kindLabel).toBe("Split event");
  });

  it("[SPM-32][AC3] gives each field's outcome, the equipment's, and who processed it and when", () => {
    const described = describeChangeRequest(
      row({
        status: "partially_approved",
        changes: [
          { field: "title", current: "A", proposed: "B" },
          { field: "expectedAttendance", current: 100, proposed: 150 },
        ],
        equipmentChanges: "A lectern",
        decisions: {
          title: { outcome: "rejected", reason: "Printed already." },
          expectedAttendance: { outcome: "approved", reason: null },
          equipment: { outcome: "rejected", reason: "None free." },
        },
        reviewer: { fullName: "Daniel Tan" },
        reviewedAt: new Date("2026-10-25T03:00:00.000Z"),
      }),
      snapshot()
    );

    expect(described.rows.map((r) => [r.field, r.outcome, r.outcomeReason])).toEqual([
      ["title", "rejected", "Printed already."],
      ["expectedAttendance", "approved", null],
    ]);
    expect(described).toMatchObject({
      equipmentOutcome: "rejected",
      equipmentOutcomeReason: "None free.",
      reviewedBy: "Daniel Tan",
      reviewedAt: "2026-10-25T03:00:00.000Z",
    });
  });

  it("[SPM-32] gives a postponement or cancellation's request-level note", () => {
    expect(describeChangeRequest(row({ kind: "cancel", changes: null, status: "rejected", reviewNotes: "Paid for already." }), snapshot())).toMatchObject({
      reviewNotes: "Paid for already.",
      rows: [],
    });
  });

  it("names a requester whose account is gone as 'Unknown'", () => {
    expect(describeChangeRequest(row({ requester: null }), snapshot()).requestedBy).toBe("Unknown");
  });
});

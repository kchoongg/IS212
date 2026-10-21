// SPM-84 - Event Coordinator Lead: Rename Role and View Assignments. The pure rules.
//
// CONTRACT (SPM-84, written before the code):
//   src/lib/coordinatorAssignments.ts
//     ACTIVE_EVENT_STATUSES - every status but Draft, Rejected, Withdrawn, Cancelled, Completed (AC6)
//     isActiveEvent(status)
//     coordinatorWorkload(coordinators, events) - each coordinator with their active-event count,
//       A to Z; zero included (AC10); a deactivated one only while they hold an active event (AC4)
//     filterActiveEvents(events, { coordinator, status }) - coordinator "all" | "unassigned" | id,
//       status "all" | a status key (AC7)
//     LEAD_ONLY_MESSAGE, LEAD_ONLY_REASON - the refusals, naming the Lead (AC1)
//   roleLabel("ops_manager") is "Event Coordinator Lead" (AC1).
// Wording: docs/test-cases/SPM-84_test_cases.json, DECIDED 2026-10-20.

import { describe, expect, it } from "vitest";
import {
  ACTIVE_EVENT_STATUSES,
  LEAD_ONLY_MESSAGE,
  LEAD_ONLY_REASON,
  coordinatorWorkload,
  filterActiveEvents,
  isActiveEvent,
} from "@/lib/coordinatorAssignments";
import { roleLabel } from "@/lib/roles";

const aisha = { id: "c1", fullName: "Aisha Karim", isActive: true };
const benjamin = { id: "c2", fullName: "Benjamin Lau", isActive: true };
const clara = { id: "c3", fullName: "Clara Tay", isActive: true };
const dennis = { id: "c4", fullName: "Dennis Ho", isActive: false };
const eric = { id: "c5", fullName: "Eric Ng", isActive: false };

const ev = (id: string, status: string, coordinator: { id: string } | null) => ({ id, status, coordinator });

describe("the role's name (AC1)", () => {
  it("[SPM-84][AC1] shows the Event Operations Manager as the Event Coordinator Lead", () => {
    expect(roleLabel("ops_manager")).toBe("Event Coordinator Lead");
  });

  it("[SPM-84][AC1] names the Lead in the refusals", () => {
    expect(LEAD_ONLY_MESSAGE).toBe("Only the Event Coordinator Lead can assign coordinators");
    expect(LEAD_ONLY_REASON).toBe("Assigning coordinators is the Event Coordinator Lead's role.");
  });
});

describe("which events are active (AC6)", () => {
  it("[SPM-84][AC6] is every status but Draft, Rejected, Withdrawn, Cancelled and Completed", () => {
    expect(ACTIVE_EVENT_STATUSES).toEqual([
      "submitted",
      "under_review",
      "approved",
      "planning",
      "safety_review",
      "safety_cleared",
      "confirmed",
      "postponed",
    ]);
  });

  it.each(["draft", "rejected", "withdrawn", "cancelled", "completed"])("[SPM-84][AC6] does not count a %s event", (status) => {
    expect(isActiveEvent(status)).toBe(false);
  });

  it.each(["submitted", "planning", "postponed"])("[SPM-84][AC6] counts a %s event", (status) => {
    expect(isActiveEvent(status)).toBe(true);
  });
});

describe("coordinatorWorkload (AC4, AC10)", () => {
  const events = [
    ev("e1", "planning", aisha),
    ev("e2", "under_review", aisha),
    ev("e3", "postponed", aisha),
    ev("e4", "completed", aisha),
    ev("e5", "cancelled", aisha),
    ev("e6", "confirmed", benjamin),
    ev("e7", "planning", dennis),
    ev("e8", "submitted", null),
  ];

  it("[SPM-84][AC4] SPM-84-TC02: counts each coordinator's active events, A to Z", () => {
    expect(coordinatorWorkload([clara, benjamin, aisha], events)).toEqual([
      { id: "c1", fullName: "Aisha Karim", isActive: true, activeEvents: 3 },
      { id: "c2", fullName: "Benjamin Lau", isActive: true, activeEvents: 1 },
      { id: "c3", fullName: "Clara Tay", isActive: true, activeEvents: 0 },
    ]);
  });

  it("[SPM-84][AC10] lists a coordinator with no active events, with zero", () => {
    expect(coordinatorWorkload([clara], [ev("e9", "completed", clara)])).toEqual([
      { id: "c3", fullName: "Clara Tay", isActive: true, activeEvents: 0 },
    ]);
  });

  it("[SPM-84][AC4] lists a deactivated coordinator only while they still hold an active event", () => {
    expect(coordinatorWorkload([dennis, eric], events)).toEqual([
      { id: "c4", fullName: "Dennis Ho", isActive: false, activeEvents: 1 },
    ]);
  });

  it("[SPM-84][AC4] counts an event with no coordinator towards nobody", () => {
    expect(coordinatorWorkload([], events)).toEqual([]);
  });
});

describe("filterActiveEvents (AC7)", () => {
  const events = [
    ev("e1", "planning", aisha),
    ev("e2", "under_review", aisha),
    ev("e6", "confirmed", benjamin),
    ev("e8", "submitted", null),
  ];
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("[SPM-84][AC7] keeps everything with no filter", () => {
    expect(ids(filterActiveEvents(events, { coordinator: "all", status: "all" }))).toEqual(["e1", "e2", "e6", "e8"]);
  });

  it("[SPM-84][AC7] SPM-84-TC03: keeps one coordinator's events", () => {
    expect(ids(filterActiveEvents(events, { coordinator: "c1", status: "all" }))).toEqual(["e1", "e2"]);
  });

  it("[SPM-84][AC7] SPM-84-TC04: keeps the events with no coordinator", () => {
    expect(ids(filterActiveEvents(events, { coordinator: "unassigned", status: "all" }))).toEqual(["e8"]);
  });

  it("[SPM-84][AC7] SPM-84-TC04: combines the coordinator and the status", () => {
    expect(ids(filterActiveEvents(events, { coordinator: "c1", status: "planning" }))).toEqual(["e1"]);
  });

  it("[SPM-84][AC7] SPM-84-TC04: keeps nothing when nothing matches", () => {
    expect(filterActiveEvents(events, { coordinator: "c2", status: "planning" })).toEqual([]);
  });
});

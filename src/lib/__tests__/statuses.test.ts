import { describe, it, expect } from "vitest";
import { isBeforeApproval, isTerminalEventStatus, statusLabel, statusTone } from "../statuses";

// Traces to SPM-7: a consistent interface. Every status in the system resolves
// through this map, so these tests are what stop "under_review" reaching a
// user's screen.

const EVENT_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "planning",
  "confirmed",
  "completed",
  "postponed",
  "rejected",
  "cancelled",
];

describe("statusLabel", () => {
  it("gives every event status from the schema a human label", () => {
    for (const status of EVENT_STATUSES) {
      const label = statusLabel(status);
      expect(label).not.toContain("_");
      expect(label).toMatch(/^[A-Z]/);
    }
  });

  it("humanises an unknown status rather than blanking the page", () => {
    // A status added server-side before the UI knows about it should degrade,
    // not break.
    expect(statusLabel("awaiting_arrangements")).toBe("Awaiting arrangements");
  });
});

describe("statusTone", () => {
  it("marks the statuses that mean something went wrong as danger", () => {
    expect(statusTone("rejected")).toBe("danger");
    expect(statusTone("cancelled")).toBe("danger");
    expect(statusTone("unavailable")).toBe("danger");
    // SPM-48 availability chips
    expect(statusTone("available")).toBe("success");
    expect(statusTone("partial")).toBe("warning");
  });

  it("marks settled, good outcomes as success", () => {
    expect(statusTone("confirmed")).toBe("success");
    expect(statusTone("reserved")).toBe("success");
    expect(statusTone("registered")).toBe("success");
  });

  it("marks states waiting on somebody as warning", () => {
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("waitlisted")).toBe("warning");
    expect(statusTone("partially_fulfilled")).toBe("warning");
  });

  it("falls back to neutral for an unknown status", () => {
    expect(statusTone("awaiting_arrangements")).toBe("neutral");
  });
});

describe("isTerminalEventStatus", () => {
  it("recognises finished and abandoned events", () => {
    expect(isTerminalEventStatus("completed")).toBe(true);
    expect(isTerminalEventStatus("cancelled")).toBe(true);
    expect(isTerminalEventStatus("rejected")).toBe(true);
  });

  it("treats in-flight events as live, so their actions stay available", () => {
    expect(isTerminalEventStatus("draft")).toBe(false);
    expect(isTerminalEventStatus("confirmed")).toBe(false);
    expect(isTerminalEventStatus("postponed")).toBe(false);
  });
});

describe("isBeforeApproval", () => {
  // SPM-54: venue and equipment arrangements wait for approval.
  it("is true only for the statuses a request passes through before approval", () => {
    for (const status of ["draft", "submitted", "under_review"]) {
      expect(isBeforeApproval(status)).toBe(true);
    }
    for (const status of ["approved", "planning", "confirmed", "postponed", "completed", "rejected", "cancelled"]) {
      expect(isBeforeApproval(status)).toBe(false);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  canTransition,
  isTerminalEventStatus,
  statusLabel,
  statusTone,
  transitionError,
} from "../statuses";

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

  it("SPM-27-TC08: treats a withdrawn request as finished", () => {
    expect(isTerminalEventStatus("withdrawn")).toBe(true);
  });
});

// SPM-27: the event lifecycle. Decisions agreed 2026-10-01, see the
// DOCUMENTATION.md changelog.
describe("canTransition", () => {
  const LEGAL: [string, string][] = [
    ["draft", "submitted"],
    ["submitted", "under_review"],
    ["submitted", "withdrawn"],
    ["under_review", "approved"],
    ["under_review", "rejected"],
    ["under_review", "withdrawn"],
    ["approved", "planning"],
    ["approved", "cancelled"],
    ["planning", "confirmed"],
    ["planning", "postponed"],
    ["planning", "cancelled"],
    ["confirmed", "completed"],
    ["confirmed", "postponed"],
    ["confirmed", "cancelled"],
    ["postponed", "planning"],
    ["postponed", "cancelled"],
  ];

  it("SPM-27-TC07: allows every move on the lifecycle", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("SPM-27-TC07: refuses every move that is not on the lifecycle", () => {
    const statuses = [...EVENT_STATUSES, "withdrawn"];
    for (const from of statuses) {
      for (const to of statuses) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(legal);
      }
    }
  });

  it("SPM-27-TC07: refuses skipping steps and going back to draft", () => {
    expect(canTransition("draft", "confirmed")).toBe(false);
    expect(canTransition("submitted", "approved")).toBe(false);
    expect(canTransition("submitted", "draft")).toBe(false);
    expect(canTransition("approved", "withdrawn")).toBe(false);
  });

  it("SPM-27-TC07: nothing moves out of a final status, including to itself", () => {
    for (const from of ["completed", "rejected", "cancelled", "withdrawn"]) {
      for (const to of [...EVENT_STATUSES, "withdrawn"]) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("SPM-27-TC07: refuses unknown statuses", () => {
    expect(canTransition("deleted", "submitted")).toBe(false);
    expect(canTransition("draft", "deleted")).toBe(false);
  });
});

describe("transitionError", () => {
  it("SPM-27-TC07: names both statuses by their labels", () => {
    expect(transitionError("withdrawn", "withdrawn")).toBe(
      "This event is Withdrawn and can't be moved to Withdrawn."
    );
    expect(transitionError("under_review", "confirmed")).toBe(
      "This event is Under review and can't be moved to Confirmed."
    );
  });
});

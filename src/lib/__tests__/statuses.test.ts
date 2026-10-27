import { describe, it, expect } from "vitest";
import {
  availabilityStatusKey,
  isBeforeApproval,
  canTransition,
  CLOSED_EVENT_STATUSES_PHRASE,
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
  "safety_review",
  "safety_cleared",
  "confirmed",
  "completed",
  "postponed",
  "rejected",
  "cancelled",
  "withdrawn",
];

describe("statusLabel", () => {
  it("[SPM-27][AC3] gives every event status from the schema a human label", () => {
    for (const status of EVENT_STATUSES) {
      const label = statusLabel(status);
      expect(label).not.toContain("_");
      expect(label).toMatch(/^[A-Z]/);
    }
  });

  it("[SPM-27][AC3] humanises an unknown status rather than blanking the page", () => {
    // A status added server-side before the UI knows about it should degrade,
    // not break.
    expect(statusLabel("awaiting_arrangements")).toBe("Awaiting arrangements");
  });
});

describe("Withdrawn and released venue bookings (SPM-67)", () => {
  it("[SPM-67][AC6] SPM-67-TC07: labels both in grey, apart from pending, approved and rejected", () => {
    expect(statusLabel("withdrawn")).toBe("Withdrawn");
    expect(statusLabel("released")).toBe("Released");
    expect(statusTone("withdrawn")).toBe("neutral");
    expect(statusTone("released")).toBe("neutral");
    for (const other of ["pending", "approved", "rejected"]) {
      expect(statusTone(other)).not.toBe("neutral");
    }
  });
});

describe("Expired venue holds (SPM-82)", () => {
  it("[SPM-82][AC8] AC8: reads 'Expired', grey like the other bookings that hold nothing", () => {
    expect(statusLabel("expired")).toBe("Expired");
    expect(statusTone("expired")).toBe("neutral");
  });
});

describe("Safety approved (SPM-87)", () => {
  it("[SPM-87][AC7] reads 'Safety approved', a step on the way to Confirmed like Approved", () => {
    expect(statusLabel("safety_cleared")).toBe("Safety approved");
    expect(statusTone("safety_cleared")).toBe("progress");
  });

  it("[SPM-87][AC7] is entered only from Safety review, and cannot be reviewed again", () => {
    for (const from of ["planning", "approved", "confirmed", "under_review"]) {
      expect(canTransition(from, "safety_cleared"), from).toBe(false);
    }
    expect(canTransition("safety_cleared", "safety_review")).toBe(false);
  });
});

describe("Safety review (SPM-86)", () => {
  it("[SPM-86][AC4] reads 'Safety review' as a status awaiting someone else's review, like Under review", () => {
    expect(statusLabel("safety_review")).toBe("Safety review");
    expect(statusTone("safety_review")).toBe("info");
  });

  it("[SPM-86][AC3] cannot be confirmed straight from Safety review", () => {
    expect(canTransition("safety_review", "confirmed")).toBe(false);
  });

  it("[SPM-86][AC3] is entered from Planning only", () => {
    for (const from of ["approved", "confirmed", "postponed", "under_review"]) {
      expect(canTransition(from, "safety_review"), from).toBe(false);
    }
  });
});

describe("statusTone", () => {
  it("[SPM-27][AC3] marks the statuses that mean something went wrong as danger", () => {
    expect(statusTone("rejected")).toBe("danger");
    expect(statusTone("cancelled")).toBe("danger");
    expect(statusTone("unavailable")).toBe("danger");
    expect(statusTone("none_available")).toBe("danger");
    // SPM-48 availability chips
    expect(statusTone("available")).toBe("success");
    expect(statusTone("partial")).toBe("warning");
  });

  it("[SPM-27][AC3] marks settled, good outcomes as success", () => {
    expect(statusTone("confirmed")).toBe("success");
    expect(statusTone("reserved")).toBe("success");
    expect(statusTone("registered")).toBe("success");
  });

  it("[SPM-27][AC3] marks states waiting on somebody as warning", () => {
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("waitlisted")).toBe("warning");
    expect(statusTone("partially_fulfilled")).toBe("warning");
  });

  it("[SPM-27][AC3] falls back to neutral for an unknown status", () => {
    expect(statusTone("awaiting_arrangements")).toBe("neutral");
  });
});

describe("isTerminalEventStatus", () => {
  it("[SPM-5][AC2] recognises finished and abandoned events", () => {
    expect(isTerminalEventStatus("completed")).toBe(true);
    expect(isTerminalEventStatus("cancelled")).toBe(true);
    expect(isTerminalEventStatus("rejected")).toBe(true);
  });

  it("[SPM-5][AC2] treats in-flight events as live, so their actions stay available", () => {
    expect(isTerminalEventStatus("draft")).toBe(false);
    expect(isTerminalEventStatus("confirmed")).toBe(false);
    expect(isTerminalEventStatus("postponed")).toBe(false);
  });

  it("[SPM-5][AC2] SPM-27-TC07: treats a withdrawn request as finished", () => {
    expect(isTerminalEventStatus("withdrawn")).toBe(true);
  });
});

// SPM-27: the event lifecycle. Decisions agreed 2026-10-01, see the
// DOCUMENTATION.md changelog.
describe("canTransition", () => {
  const LEGAL: [string, string][] = [
    ["draft", "submitted"],
    ["submitted", "under_review"],
    ["under_review", "approved"],
    ["under_review", "rejected"],
    ["under_review", "withdrawn"],
    // SPM-37 (AC1): cancelled at any stage that has an assigned coordinator
    // (#68; decided 2026-10-21, docs/test-cases/SPM-37_test_cases.json).
    ["under_review", "cancelled"],
    ["approved", "planning"],
    // SPM-38 (decided 2026-10-26): postponed at any stage after approval that
    // is not final, Safety review and Safety approved included.
    ["approved", "postponed"],
    ["approved", "cancelled"],
    ["planning", "confirmed"],
    ["planning", "postponed"],
    ["planning", "cancelled"],
    // SPM-86: submitted for an Operational Safety Check. The Safety Officer's
    // decision (SPM-87) or a significant edit (SPM-88) returns it to Planning;
    // otherwise it can only be cancelled (decided 2026-10-09).
    ["planning", "safety_review"],
    ["safety_review", "planning"],
    ["safety_review", "postponed"],
    ["safety_review", "cancelled"],
    // SPM-87: the Safety Officer approves (AC7), or rejects / requests changes (AC8).
    ["safety_review", "safety_cleared"],
    ["safety_cleared", "confirmed"],
    ["safety_cleared", "planning"],
    ["safety_cleared", "postponed"],
    ["safety_cleared", "cancelled"],
    ["confirmed", "completed"],
    ["confirmed", "postponed"],
    ["confirmed", "cancelled"],
    ["postponed", "approved"],
    ["postponed", "cancelled"],
  ];

  it("[SPM-5][AC2] SPM-27-TC04: allows every move on the lifecycle", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("[SPM-5][AC2] SPM-27-TC05: refuses every move that is not on the lifecycle", () => {
    const statuses = EVENT_STATUSES;
    for (const from of statuses) {
      for (const to of statuses) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(legal);
      }
    }
  });

  it("[SPM-5][AC2] SPM-27-TC05: refuses skipping steps and going back to draft", () => {
    expect(canTransition("draft", "confirmed")).toBe(false);
    expect(canTransition("submitted", "approved")).toBe(false);
    expect(canTransition("submitted", "draft")).toBe(false);
    expect(canTransition("approved", "withdrawn")).toBe(false);
    // #103: a withdrawal is recorded while the request is under review.
    expect(canTransition("submitted", "withdrawn")).toBe(false);
    // Resuming a postponed event goes back through Approved.
    expect(canTransition("postponed", "planning")).toBe(false);
  });

  it("[SPM-5][AC2] SPM-27-TC05: nothing moves out of a final status, including to itself", () => {
    for (const from of ["completed", "rejected", "cancelled", "withdrawn"]) {
      for (const to of EVENT_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("[SPM-5][AC2] SPM-27-TC05: refuses unknown statuses", () => {
    expect(canTransition("deleted", "submitted")).toBe(false);
    expect(canTransition("draft", "deleted")).toBe(false);
  });
});

describe("transitionError", () => {
  it("[SPM-5][AC2] SPM-27-TC05: names both statuses by their labels", () => {
    expect(transitionError("withdrawn", "withdrawn")).toBe(
      "This event is Withdrawn and can't be moved to Withdrawn."
    );
    expect(transitionError("under_review", "confirmed")).toBe(
      "This event is Under review and can't be moved to Confirmed."
    );
  });
});

describe("isBeforeApproval", () => {
  // SPM-54: venue and equipment arrangements wait for approval.
  it("[SPM-5][AC1] is true only for the statuses a request passes through before approval", () => {
    for (const status of ["draft", "submitted", "under_review"]) {
      expect(isBeforeApproval(status)).toBe(true);
    }
    for (const status of ["approved", "planning", "confirmed", "postponed", "completed", "rejected", "cancelled"]) {
      expect(isBeforeApproval(status)).toBe(false);
    }
  });
});

describe("equipment labels (SPM-50)", () => {
  it("[SPM-50][AC3] shows a request Technical Support can't provide as 'Cannot be provided'", () => {
    expect(statusLabel("unavailable")).toBe("Cannot be provided");
  });

  it("[SPM-50][AC3] shows no stock free as 'None available', so the two never read the same", () => {
    expect(statusLabel(availabilityStatusKey("unavailable"))).toBe("None available");
    expect(statusLabel(availabilityStatusKey("unavailable"))).not.toBe(statusLabel("unavailable"));
  });

  it("[SPM-50][AC3] leaves the other availability results as they were", () => {
    expect(statusLabel(availabilityStatusKey("available"))).toBe("Available");
    expect(statusLabel(availabilityStatusKey("partial"))).toBe("Partial");
  });
});

// SPM-33 (written before the code): the three states of an arrangement on the
// Readiness tab go through statuses.ts like every other status, so a
// completed, an outstanding and a not-required arrangement never look alike
// (AC7, AC10). The wording and tones are decided here, not in the story.
describe("arrangement states (SPM-33)", () => {
  it("[SPM-33][AC7][AC10] labels the three states an arrangement can be in", () => {
    expect(statusLabel("complete")).toBe("Complete");
    expect(statusLabel("outstanding")).toBe("Outstanding");
    expect(statusLabel("not_required")).toBe("Not required");
  });

  it("[SPM-33][AC7][AC10] gives each state its own tone, so they can be told apart at a glance", () => {
    expect(statusTone("complete")).toBe("success");
    expect(statusTone("outstanding")).toBe("warning");
    expect(statusTone("not_required")).toBe("neutral");
  });
});

// SPM-33 AC6 (written before the code): what the Readiness tab calls each
// state of the Operational Safety Check. Kept apart from the booking statuses
// - a pending check reads "Awaiting review", never "Pending".
describe("safety check labels on the Readiness tab (SPM-33)", () => {
  it.each([
    ["safety_not_submitted", "Not submitted", "warning"],
    ["safety_awaiting_review", "Awaiting review", "info"],
    ["safety_approved", "Approved", "success"],
    ["safety_changes_requested", "Changes requested", "warning"],
    ["safety_rejected", "Rejected", "danger"],
  ])("[SPM-33][AC6] shows %s as %s", (key, label, tone) => {
    expect(statusLabel(key)).toBe(label);
    expect(statusTone(key)).toBe(tone);
  });
});

// SPM-65 AC3: on the registration list, registered, waitlisted, withdrawn and
// checked-in (attended) attendees must be told apart - by label and by colour.
describe("registration statuses on the registration list (SPM-65)", () => {
  it.each([
    ["registered", "Registered", "success"],
    ["waitlisted", "Waiting list", "warning"],
    ["withdrawn", "Withdrawn", "neutral"],
    ["attended", "Attended", "info"],
  ])("[SPM-65][AC3] shows %s as %s", (key, label, tone) => {
    expect(statusLabel(key)).toBe(label);
    expect(statusTone(key)).toBe(tone);
  });

  it("[SPM-65][AC3] gives each of the four its own tone", () => {
    const tones = ["registered", "waitlisted", "withdrawn", "attended"].map(statusTone);
    expect(new Set(tones).size).toBe(4);
  });
});

describe("[SPM-59] a withdrawn request", () => {
  it("[SPM-59][AC3] is labelled Withdrawn, unlike a Draft, Submitted, Approved or Rejected request", () => {
    const labels = ["draft", "submitted", "approved", "rejected", "withdrawn"].map(statusLabel);

    expect(statusLabel("withdrawn")).toBe("Withdrawn");
    expect(new Set(labels).size).toBe(5);
  });

  it("[SPM-59][AC2] is reached from Under review only", () => {
    for (const from of EVENT_STATUSES) {
      expect(canTransition(from, "withdrawn"), from).toBe(from === "under_review");
    }
  });

  it("[SPM-59][AC4] is named, with every other final status, in the messages that refuse a closed event", () => {
    expect(CLOSED_EVENT_STATUSES_PHRASE).toBe("completed, cancelled, rejected or withdrawn");
  });

  it("[SPM-59][AC4] is final: it goes nowhere else", () => {
    expect(isTerminalEventStatus("withdrawn")).toBe(true);
    for (const to of EVENT_STATUSES) {
      expect(canTransition("withdrawn", to), to).toBe(false);
    }
  });
});

describe("Postponed (SPM-38)", () => {
  it("[SPM-38][AC1][AC4] can be entered from every stage after approval that is not final", () => {
    for (const from of ["approved", "planning", "safety_review", "safety_cleared", "confirmed"]) {
      expect(canTransition(from, "postponed"), from).toBe(true);
    }
  });

  it("[SPM-38][AC1] cannot be entered before approval, from a final status, or from Postponed itself", () => {
    for (const from of ["draft", "submitted", "under_review", "completed", "rejected", "withdrawn", "cancelled", "postponed"]) {
      expect(canTransition(from, "postponed"), from).toBe(false);
    }
  });
});

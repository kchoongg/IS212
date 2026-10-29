// SPM-32 Process Event Change Request - the decision rules, apart from the
// route and the screen. Written before the code (src/lib/changeRequestDecision.ts).
import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_ITEM,
  approvedPayload,
  changeRequestOutcomeNotification,
  checkApprovedTimes,
  checkDecisions,
  decisionItems,
  itemLabel,
  outcomeStatus,
  reschedules,
} from "@/lib/changeRequestDecision";
import type { FieldChange } from "@/lib/eventChangeRequest";

const TITLE: FieldChange = { field: "title", current: "SPM32 Harbour Briefing", proposed: "SPM32 Harbour Briefing and Lunch" };
const ATTENDANCE: FieldChange = { field: "expectedAttendance", current: 80, proposed: 110 };
const START: FieldChange = { field: "startsAt", current: "2027-07-12T10:00:00.000Z", proposed: "2027-07-19T10:00:00.000Z" };
const END: FieldChange = { field: "endsAt", current: "2027-07-12T14:00:00.000Z", proposed: "2027-07-19T14:00:00.000Z" };
const PURPOSE_CLEARED: FieldChange = { field: "purpose", current: "Client briefing", proposed: null };
const LAYOUT: FieldChange = { field: "preferredLayout", current: "classroom", proposed: null };
const FACILITIES: FieldChange = {
  field: "facilityIds",
  current: [{ id: "f-stage", name: "Raised stage" }],
  proposed: [{ id: "f-stage", name: "Raised stage" }, { id: "f-loop", name: "Hearing loop" }],
};

const approve = { outcome: "approved" as const, reason: null };
const reject = (reason: string | null = "Not this time.") => ({ outcome: "rejected" as const, reason });

describe("[SPM-32][AC3] what is decided item by item", () => {
  it("is each changed field, then the equipment change if there is one", () => {
    expect(decisionItems([TITLE, ATTENDANCE], "Two more microphones")).toEqual(["title", "expectedAttendance", EQUIPMENT_ITEM]);
    expect(decisionItems([TITLE], null)).toEqual(["title"]);
    expect(decisionItems([TITLE], "   ")).toEqual(["title"]);
  });

  it("labels each item as the request shows it", () => {
    expect(itemLabel("expectedAttendance")).toBe("Expected attendance");
    expect(itemLabel(EQUIPMENT_ITEM)).toBe("Equipment changes");
    expect(itemLabel("colour")).toBe("colour");
  });
});

describe("[SPM-32][AC2][AC3] checking a decision", () => {
  const items = ["title", "expectedAttendance"];

  it("accepts every item decided, trimming each reason", () => {
    expect(checkDecisions(items, { title: { outcome: "rejected", reason: "  Already printed.  " }, expectedAttendance: approve })).toEqual({
      ok: true,
      decisions: { title: { outcome: "rejected", reason: "Already printed." }, expectedAttendance: { outcome: "approved", reason: null } },
    });
  });

  it("drops a reason given for an approved item", () => {
    const result = checkDecisions(["title"], { title: { outcome: "approved", reason: "Fine" } });
    expect(result).toEqual({ ok: true, decisions: { title: { outcome: "approved", reason: null } } });
  });

  it("refuses a decision that leaves an item undecided", () => {
    expect(checkDecisions(items, { title: approve })).toEqual({ ok: false, error: "Approve or reject every change before saving." });
  });

  it("refuses an item the request does not have", () => {
    expect(checkDecisions(["title"], { title: approve, category: approve })).toEqual({
      ok: false,
      error: "Type of event is not part of this change request.",
    });
  });

  it.each([[null], [""], ["   "]])("[AC3] refuses a rejection whose reason is %j, naming the field", (reason) => {
    expect(checkDecisions(items, { title: reject(reason as never), expectedAttendance: approve })).toEqual({
      ok: false,
      error: "Give a reason for rejecting Event name.",
      fieldErrors: { title: "Give a reason for rejecting Event name." },
    });
  });

  it("names every rejection that has no reason", () => {
    const result = checkDecisions(items, { title: reject(null), expectedAttendance: reject("") });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        title: "Give a reason for rejecting Event name.",
        expectedAttendance: "Give a reason for rejecting Expected attendance.",
      },
    });
  });
});

describe("[SPM-32][AC2][AC3] the request's outcome", () => {
  it.each([
    [{ a: approve, b: approve }, "approved"],
    [{ a: reject(), b: reject() }, "rejected"],
    [{ a: approve, b: reject() }, "partially_approved"],
  ])("%j is %s", (decisions, status) => {
    expect(outcomeStatus(decisions)).toBe(status);
  });
});

describe("[SPM-32][AC4][AC6] what an approval changes", () => {
  it("[AC4] gives the approved fields in Update Event Information's shape, and nothing rejected", () => {
    const payload = approvedPayload([TITLE, ATTENDANCE, START, END], {
      title: reject(),
      expectedAttendance: approve,
      startsAt: approve,
      endsAt: approve,
    });

    expect(payload).toEqual({
      expectedAttendance: 110,
      startsAt: "2027-07-19T10:00:00.000Z",
      endsAt: "2027-07-19T14:00:00.000Z",
    });
  });

  it("[AC6] gives nothing when every field is rejected", () => {
    expect(approvedPayload([TITLE, ATTENDANCE], { title: reject(), expectedAttendance: reject() })).toEqual({});
  });

  it("sends a cleared text as empty, 'No preference' as null, and the facilities as their ids", () => {
    expect(approvedPayload([PURPOSE_CLEARED, LAYOUT, FACILITIES], { purpose: approve, preferredLayout: approve, facilityIds: approve })).toEqual({
      purpose: "",
      preferredLayout: null,
      facilityIds: ["f-stage", "f-loop"],
    });
  });

  it("sends no facilities when the proposed list is empty", () => {
    expect(approvedPayload([{ ...FACILITIES, proposed: null }], { facilityIds: approve })).toEqual({ facilityIds: [] });
  });

  it("ignores the equipment change, which the coordinator makes on the Equipment tab", () => {
    expect(approvedPayload([TITLE], { title: approve, [EQUIPMENT_ITEM]: approve })).toEqual({
      title: "SPM32 Harbour Briefing and Lunch",
    });
  });
});

describe("[SPM-32][AC5] rescheduling a Postponed event", () => {
  it.each([
    ["postponed", { startsAt: "2027-08-23T02:00:00.000Z" }, true],
    ["postponed", { endsAt: "2027-08-23T08:00:00.000Z" }, true],
    ["postponed", { title: "New name" }, false],
    ["planning", { startsAt: "2027-08-23T02:00:00.000Z" }, false],
  ])("a %s event approved %j moves to Approved: %s", (status, payload, expected) => {
    expect(reschedules(status, payload)).toBe(expected);
  });
});

describe("[SPM-32][AC4] the approved times together", () => {
  const event = {
    startsAt: new Date("2027-07-12T10:00:00.000Z"),
    endsAt: new Date("2027-07-12T14:00:00.000Z"),
    registrationOpensAt: null,
    registrationClosesAt: null,
  };

  it("accepts an approved start and end that still make sense", () => {
    expect(checkApprovedTimes(event, { startsAt: START.proposed as string, endsAt: END.proposed as string })).toBeNull();
    expect(checkApprovedTimes(event, { title: "x" })).toBeNull();
  });

  it("refuses a decision that would end the event before it starts", () => {
    expect(checkApprovedTimes(event, { startsAt: "2027-07-19T10:00:00.000Z" })).toBe(
      "With these decisions the event would end before it starts. Decide Starts at and Ends at together."
    );
  });

  it("refuses a start before registration has closed, as Update Event Information does", () => {
    const registering = { ...event, registrationOpensAt: new Date("2027-07-01T00:00:00.000Z"), registrationClosesAt: new Date("2027-07-11T00:00:00.000Z") };

    expect(checkApprovedTimes(registering, { startsAt: "2027-07-10T10:00:00.000Z", endsAt: "2027-07-10T14:00:00.000Z" })).toBe(
      "Registration closes after this start time. Change the registration period first."
    );
    expect(checkApprovedTimes(registering, { endsAt: "2027-07-12T16:00:00.000Z" })).toBeNull();
  });

  it("checks a start against the registration opening too", () => {
    const opensLate = { ...event, registrationOpensAt: new Date("2027-07-20T00:00:00.000Z"), registrationClosesAt: null };
    expect(checkApprovedTimes(opensLate, { startsAt: START.proposed as string, endsAt: END.proposed as string })).toBe(
      "Registration closes after this start time. Change the registration period first."
    );
  });

  it("accepts times on an event that has none saved yet", () => {
    const undated = { ...event, startsAt: null, endsAt: null };
    expect(checkApprovedTimes(undated, { startsAt: START.proposed as string })).toBeNull();
  });
});

describe("changeRequestOutcomeNotification (SPM-53)", () => {
  it("[SPM-53][AC13] names an event with no title as 'Untitled event'", () => {
    const told = changeRequestOutcomeNotification({
      eventId: "e1",
      eventTitle: null,
      kind: "change",
      decisions: { title: { outcome: "approved", reason: null } },
      items: ["title"],
    });

    expect(told.body).toBe('Your change request for "Untitled event" was approved. Event name: approved.');
  });
});

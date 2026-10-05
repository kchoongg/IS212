// @vitest-environment jsdom
//
// SPM-62 Update Event Information - the screen these tests pin down (written test-first):
//   src/app/events/[id]/update/page.tsx, default export: "Edit event information"
//   Loads GET /api/events/<ref> and GET /api/facilities.
//   Refuses (red alert "You can't edit this event's information", a "Back to event" button, no form):
//     - anyone but the assigned coordinator: "Only the coordinator assigned to this event can change its information."
//     - any status but approved / planning / confirmed:
//       "Event information can only be changed while the event is Approved, Planning or Confirmed."
//   Fields: the draft form's labels and validation messages, minus equipment, sessions and the
//     Registration section (registration settings are Configure Event Registration, SPM-64);
//     an info message "Equipment is changed on the Equipment tab."
//   A start before registration closes is refused under Starts at:
//     "Registration closes after this start time. Change the registration period first."
//   Live amber alert "These changes affect existing arrangements":
//     "You've changed: <labels>. Any venue booking, equipment or registrations already arranged will be
//      flagged for review, not changed."
//   "Save changes" sends PATCH /api/events/<ref>/information with ONLY the fields that changed. On success
//     the form is replaced, on this page, by the result: "Event information updated." (plus " The event is
//     back in Planning and needs to be confirmed again." when the answer says statusReverted), an amber
//     "Flagged for review" alert - "These were arranged for the event's earlier details and have not been
//     changed." - listing the answer's `flagged` lines (none -> no alert), and a "Back to event" link.
//     Showing flags afterwards is SPM-33 / SPM-68's, not this page's.
//   Confirmed + an important change: ConfirmDialog "Move this event back to Planning?" first,
//     buttons "Keep editing" / "Save and move to Planning".
//   "Cancel" -> router.push("/events/<ref>").
// Decided here, not in the story: see docs/test-cases/SPM-62_test_cases.json open_questions.

import { describe, it, expect } from "vitest";
import UpdateEventPage from "@/app/events/[id]/update/page";
import { ROLES } from "@/lib/roles";
import {
  fireEvent,
  mockApi,
  render,
  reply,
  router,
  screen,
  setRoute,
  signedInAs,
  signedOut,
  userEvent,
  waitFor,
  within,
} from "@/test/ui";

const REF = "EVT-000007";
const EVENT = `GET /api/events/${REF}`;
const SAVE = `PATCH /api/events/${REF}/information`;
const ASSIGNED = { id: "c1" };
const iso = (local: string) => new Date(local).toISOString();

const START = "2027-03-17T09:00";
const END = "2027-03-17T17:00";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-id",
    sequenceNumber: 7,
    title: "Harbour Leadership Summit",
    category: "conference",
    purpose: "Leadership offsite",
    description: "Keynotes and panels",
    status: "planning",
    startsAt: iso(START),
    endsAt: iso(END),
    expectedAttendance: 80,
    preferredLayout: "theatre",
    accessibilityNotes: null,
    specialRequirements: null,
    registrationEnabled: true,
    registrationCapacity: 100,
    registrationOpensAt: null,
    registrationClosesAt: null,
    organiserId: "organiser-id",
    organisationId: "org-id",
    coordinatorId: "c1",
    facilityRequirements: [
      { facilityId: "f-projector", isMandatory: true, facility: { id: "f-projector", name: "Fixed ceiling projector", category: "facility" } },
    ],
    equipmentRequests: [],
    sessions: [],
    ...overrides,
  };
}

const facilities = [
  { id: "f-projector", name: "Fixed ceiling projector", category: "facility" },
  { id: "f-stage", name: "Raised stage", category: "facility" },
  { id: "f-loop", name: "Hearing induction loop", category: "accessibility" },
];

const WARNING = "These changes affect existing arrangements";
const warningText = (labels: string) =>
  `You've changed: ${labels}. Any venue booking, equipment or registrations already arranged will be flagged for review, not changed.`;

function open(eventRow: unknown = event(), routes: Record<string, unknown> = {}, role = "coordinator", who: object = ASSIGNED) {
  setRoute(`/events/${REF}/update`, { id: REF });
  const api = mockApi({
    ...signedInAs(role, who),
    [EVENT]: eventRow,
    "GET /api/facilities": facilities,
    [SAVE]: { statusReverted: false, flagged: [] },
    ...routes,
  });
  render(<UpdateEventPage />);
  return api;
}

const set = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const formReady = () => screen.findByLabelText(/^Event name/);
const save = () => userEvent.click(screen.getByRole("button", { name: "Save changes" }));
const dialogTitled = (title: string) =>
  screen.getByText(title, { selector: "dialog h2" }).closest("dialog") as HTMLDialogElement;

describe("Edit event information - who may open it", () => {
  it("sends an anonymous visitor to log in, remembering the page", async () => {
    setRoute(`/events/${REF}/update`, { id: REF });
    mockApi(signedOut());

    render(<UpdateEventPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fupdate"));
  });

  const refusedRoles = ROLES.filter((role) => role !== "coordinator" && role !== "attendee");

  it.each([
    ...refusedRoles.map((role) => [role, role, {}] as const),
    ["a coordinator who is not assigned", "coordinator", { id: "c2" }] as const,
  ])("refuses %s, with no form", async (_who, role, who) => {
    const api = open(event(), {}, role, who);

    expect(await screen.findByText("You can't edit this event's information")).toBeInTheDocument();
    expect(screen.getByText("Only the coordinator assigned to this event can change its information.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
    expect(api.sent(SAVE)).toHaveLength(0);
  });

  it.each(["submitted", "under_review", "postponed", "completed", "cancelled", "rejected", "withdrawn"])(
    "refuses an event that is %s, even for the assigned coordinator",
    async (status) => {
      open(event({ status }));

      expect(await screen.findByText("You can't edit this event's information")).toBeInTheDocument();
      expect(
        screen.getByText("Event information can only be changed while the event is Approved, Planning or Confirmed.")
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
    }
  );

  it("offers a way back to the event from a refusal", async () => {
    open(event({ status: "completed" }));

    await userEvent.click(await screen.findByRole("button", { name: "Back to event" }));

    expect(router.push).toHaveBeenCalledWith(`/events/${REF}`);
  });

  it("explains a 404 without confirming the event exists", async () => {
    open(reply(404, { error: "Event not found" }));

    expect(await screen.findByText("This event doesn't exist, or you don't have access to it.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
  });

  it("says when it could not load, and Retry loads again", async () => {
    const api = open(reply(500, {}));

    expect(await screen.findByText("Could not load this event.")).toBeInTheDocument();
    api.on(EVENT, event());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await formReady()).toBeInTheDocument();
  });
});

describe("Edit event information - the form", () => {
  it.each(["approved", "planning", "confirmed"])("opens for the assigned coordinator on a %s event", async (status) => {
    open(event({ status }));

    expect(await formReady()).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Edit event information" })).toBeInTheDocument();
  });

  it("is filled in with the event's current information", async () => {
    open();
    await formReady();

    expect(screen.getByLabelText(/^Event name/)).toHaveValue("Harbour Leadership Summit");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Keynotes and panels");
    expect(screen.getByLabelText(/^Starts at/)).toHaveValue(START);
    expect(screen.getByLabelText(/^Ends at/)).toHaveValue(END);
    expect(screen.getByLabelText(/^Expected attendance/)).toHaveValue(80);
    expect(screen.getByLabelText(/^Preferred room layout/)).toHaveValue("theatre");
    expect(await screen.findByRole("checkbox", { name: "Fixed ceiling projector" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Hearing induction loop" })).not.toBeChecked();
  });

  it("offers no way to change the organiser, coordinator, status, equipment or registration", async () => {
    open();
    await formReady();

    for (const label of [/^Organiser/, /^Company/, /^Coordinator/, /^Status/]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Add equipment" })).not.toBeInTheDocument();
    expect(screen.getByText("Equipment is changed on the Equipment tab.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Attendees need to register for this event" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Registration capacity/)).not.toBeInTheDocument();
  });

  it("shows a multi-session event's schedule without letting it change here", async () => {
    open(
      event({
        sessions: [
          { id: "s1", label: "Day 1", startsAt: iso(START), endsAt: iso(END), expectedAttendance: 80, preferredLayout: null },
          { id: "s2", label: "Day 2", startsAt: iso("2027-03-18T09:00"), endsAt: iso("2027-03-18T17:00"), expectedAttendance: 60, preferredLayout: null },
        ],
      })
    );
    await formReady();

    expect(screen.queryByLabelText(/^Starts at/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Expected attendance/)).not.toBeInTheDocument();
    expect(screen.getByText("Session times and attendance can't be changed here yet.")).toBeInTheDocument();
  });

  it("goes back to the event on Cancel, sending nothing", async () => {
    const api = open();
    await formReady();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(router.push).toHaveBeenCalledWith(`/events/${REF}`);
    expect(api.sent(SAVE)).toHaveLength(0);
  });
});

describe("Edit event information - saying what a change affects", () => {
  it("says nothing for an ordinary change", async () => {
    open();
    await formReady();

    set(/^Description/, "Updated programme");
    set(/^Anything else about the space/, "Front row for speakers");

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("names each kind of important change as it is made", async () => {
    open();
    await formReady();

    set(/^Starts at/, "2027-03-24T09:00");
    expect(screen.getByText(WARNING)).toBeInTheDocument();
    expect(screen.getByText(warningText("Date and time"))).toBeInTheDocument();

    set(/^Expected attendance/, "95");
    expect(screen.getByText(warningText("Date and time, Expected attendance"))).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Hearing induction loop" }));
    expect(screen.getByText(warningText("Date and time, Expected attendance, Venue requirements"))).toBeInTheDocument();
  });

  it("counts the preferred layout as a venue requirement", async () => {
    open();
    await formReady();

    set(/^Preferred room layout/, "classroom");

    expect(screen.getByText(warningText("Venue requirements"))).toBeInTheDocument();
  });

  it("drops the warning when a value is changed back", async () => {
    open();
    await formReady();

    set(/^Expected attendance/, "45");
    expect(screen.getByText(WARNING)).toBeInTheDocument();

    set(/^Expected attendance/, "80");
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });
});

describe("Edit event information - saving", () => {
  it("sends only what changed, then says it is saved, with a way back to the event", async () => {
    const api = open();
    await formReady();

    set(/^Purpose/, "Brief clients on the 2027 outlook");
    set(/^Description/, "Keynote and Q&A");
    await save();

    expect(await screen.findByText("Event information updated.")).toBeInTheDocument();
    expect(api.sent(SAVE).map((c) => c.body)).toEqual([
      { purpose: "Brief clients on the 2027 outlook", description: "Keynote and Q&A" },
    ]);
    expect(screen.getByRole("link", { name: "Back to event" })).toHaveAttribute("href", `/events/${REF}`);
    expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("lists what the save flagged for review", async () => {
    const flagged = [
      "Venue booking: Orchard Seminar Room (ORC-SEM) – the date or time changed",
      "Equipment: 4K Portable Projector × 2 – the date or time changed",
      "Registrations: 12 attendees – the date or time changed",
    ];
    open(event(), { [SAVE]: { statusReverted: false, flagged } });
    await formReady();

    set(/^Starts at/, "2027-03-24T09:00");
    set(/^Ends at/, "2027-03-24T17:00");
    await save();

    expect(await screen.findByText("Flagged for review")).toBeInTheDocument();
    expect(
      screen.getByText("These were arranged for the event's earlier details and have not been changed.")
    ).toBeInTheDocument();
    for (const line of flagged) expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("shows no flagged list when the save flagged nothing", async () => {
    open();
    await formReady();

    set(/^Description/, "Keynote and Q&A");
    await save();

    await screen.findByText("Event information updated.");
    expect(screen.queryByText("Flagged for review")).not.toBeInTheDocument();
  });

  it("sends a new schedule as instants", async () => {
    const api = open();
    await formReady();

    set(/^Starts at/, "2027-03-24T09:00");
    set(/^Ends at/, "2027-03-24T17:00");
    await save();

    await waitFor(() => expect(api.sent(SAVE)).toHaveLength(1));
    expect(api.sent(SAVE)[0].body).toEqual({
      startsAt: iso("2027-03-24T09:00"),
      endsAt: iso("2027-03-24T17:00"),
    });
  });

  it("sends the whole list of facilities when one is ticked", async () => {
    const api = open();
    await formReady();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Hearing induction loop" }));
    await save();

    await waitFor(() => expect(api.sent(SAVE)).toHaveLength(1));
    expect(api.sent(SAVE)[0].body).toEqual({ facilityIds: ["f-projector", "f-loop"] });
  });

  it("does not ask before an important change to a Planning event", async () => {
    const api = open();
    await formReady();

    set(/^Starts at/, "2027-03-24T09:00");
    set(/^Ends at/, "2027-03-24T17:00");
    await save();

    await waitFor(() => expect(api.sent(SAVE)).toHaveLength(1));
    expect(screen.queryByText("Move this event back to Planning?", { selector: "dialog[open] h2" })).not.toBeInTheDocument();
  });

  it("does not ask before an ordinary change to a Confirmed event", async () => {
    const api = open(event({ status: "confirmed" }));
    await formReady();

    set(/^Description/, "Keynote and Q&A");
    await save();

    await waitFor(() => expect(api.sent(SAVE)).toHaveLength(1));
    expect(await screen.findByText("Event information updated.")).toBeInTheDocument();
  });

  describe("an important change to a Confirmed event", () => {
    const TITLE = "Move this event back to Planning?";

    async function changeSchedule() {
      const api = open(event({ status: "confirmed" }), { [SAVE]: { statusReverted: true, flagged: [] } });
      await formReady();
      set(/^Starts at/, "2027-03-24T09:00");
      set(/^Ends at/, "2027-03-24T17:00");
      await save();
      return api;
    }

    it("asks first, saying what will happen, and sends nothing yet", async () => {
      const api = await changeSchedule();

      expect(dialogTitled(TITLE).open).toBe(true);
      expect(dialogTitled(TITLE)).toHaveTextContent(
        "Harbour Leadership Summit is Confirmed. Saving these changes moves it back to Planning so it can be confirmed again."
      );
      expect(api.sent(SAVE)).toHaveLength(0);
    });

    it("saves nothing when the coordinator keeps editing", async () => {
      const api = await changeSchedule();

      await userEvent.click(within(dialogTitled(TITLE)).getByRole("button", { name: "Keep editing", hidden: true }));

      expect(dialogTitled(TITLE).open).toBe(false);
      expect(api.sent(SAVE)).toHaveLength(0);
      expect(screen.getByLabelText(/^Starts at/)).toHaveValue("2027-03-24T09:00");
    });

    it("saves, then says the event is back in Planning", async () => {
      const api = await changeSchedule();

      await userEvent.click(
        within(dialogTitled(TITLE)).getByRole("button", { name: "Save and move to Planning", hidden: true })
      );

      expect(
        await screen.findByText("Event information updated. The event is back in Planning and needs to be confirmed again.")
      ).toBeInTheDocument();
      expect(api.sent(SAVE)).toHaveLength(1);
    });
  });

  describe("refusing what is not valid, without sending it", () => {
    it.each([
      ["a blank event name", /^Event name/, "", "Give the event a name so you can find it again."],
      ["an attendance of zero", /^Expected attendance/, "0", "Enter a whole number of people, at least 1."],
      ["a blank attendance", /^Expected attendance/, "", "Enter how many people you expect."],
      ["an end before the start", /^Ends at/, "2027-03-17T08:00", "Ends at must be after starts at."],
      [
        "a start before registration closes",
        /^Starts at/,
        "2027-03-10T09:00",
        "Registration closes after this start time. Change the registration period first.",
      ],
    ])("%s", async (_case, label, value, message) => {
      const api = open(event({ registrationClosesAt: iso("2027-03-10T18:00") }));
      await formReady();

      set(label, value);
      await save();

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(api.sent(SAVE)).toHaveLength(0);
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  it("shows the server's field errors under their fields", async () => {
    const message = "Registration closes after this start time. Change the registration period first.";
    open(event(), {
      [SAVE]: reply(400, { error: message, details: { fieldErrors: { startsAt: [message] } } }),
    });
    await formReady();

    set(/^Starts at/, "2027-03-24T09:00");
    set(/^Ends at/, "2027-03-24T17:00");
    await save();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Starts at/)).toHaveAttribute("aria-invalid", "true");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows a refusal it cannot pin on a field above the form", async () => {
    open(event(), {
      [SAVE]: reply(403, { error: "Only the coordinator assigned to this event can change its information" }),
    });
    await formReady();

    set(/^Description/, "Keynote and Q&A");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the coordinator assigned to this event can change its information"
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("says when the server cannot be reached", async () => {
    open(event(), { [SAVE]: () => Promise.reject(new Error("offline")) });
    await formReady();

    set(/^Description/, "Keynote and Q&A");
    await save();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the server. Check your connection and try again."
    );
  });
});

describe("Edit event information - more of what it loads, sends and checks", () => {
  it("sends a visitor whose session expired while loading to log in", async () => {
    open(reply(401, { error: "Not authenticated" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fupdate"));
  });

  it("says when the server cannot be reached while loading", async () => {
    open(() => Promise.reject(new Error("offline")));

    expect(
      await screen.findByText("Could not reach the server. Check your connection and try again.")
    ).toBeInTheDocument();
  });

  it("sends every other field that changed, a cleared layout as no preference", async () => {
    const api = open();
    await formReady();

    set(/^Event name/, "  Harbour Leaders Forum  ");
    set(/^Type of event/, "seminar");
    set(/^Expected attendance/, "95");
    set(/^Preferred room layout/, "");
    set(/^Other accessibility notes/, "Two wheelchair users");
    set(/^Anything else about the space/, "Front row for speakers");
    await save();

    await waitFor(() => expect(api.sent(SAVE)).toHaveLength(1));
    expect(api.sent(SAVE)[0].body).toEqual({
      title: "Harbour Leaders Forum",
      category: "seminar",
      expectedAttendance: 95,
      preferredLayout: null,
      accessibilityNotes: "Two wheelchair users",
      specialRequirements: "Front row for speakers",
    });
  });

  it("sends the list without a facility that is unticked", async () => {
    const api = open();
    await formReady();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Fixed ceiling projector" }));
    await save();

    await waitFor(() => expect(api.sent(SAVE)).toHaveLength(1));
    expect(api.sent(SAVE)[0].body).toEqual({ facilityIds: [] });
  });

  it.each([
    [/^Starts at/, "Enter when the event starts."],
    [/^Ends at/, "Enter when the event ends."],
  ])("refuses a cleared %s", async (label, message) => {
    const api = open();
    await formReady();

    set(label, "");
    await save();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(api.sent(SAVE)).toHaveLength(0);
  });

  it("refuses a start on or before registration opens", async () => {
    const api = open(event({ registrationOpensAt: iso("2027-03-12T09:00") }));
    await formReady();

    set(/^Starts at/, "2027-03-12T09:00");
    await save();

    expect(
      await screen.findByText("Registration closes after this start time. Change the registration period first.")
    ).toBeInTheDocument();
    expect(api.sent(SAVE)).toHaveLength(0);
  });

  it("clears a field's message once it is edited", async () => {
    open();
    await formReady();
    set(/^Event name/, "");
    await save();
    expect(await screen.findByText("Give the event a name so you can find it again.")).toBeInTheDocument();

    set(/^Event name/, "Harbour Leaders Forum");

    expect(screen.queryByText("Give the event a name so you can find it again.")).not.toBeInTheDocument();
  });

  it("saves a multi-session event's description without sending its schedule", async () => {
    const api = open(
      event({
        sessions: [
          { id: "s1", label: "Day 1", startsAt: iso(START), endsAt: iso(END), expectedAttendance: 80, preferredLayout: null },
          { id: "s2", label: "Day 2", startsAt: iso("2027-03-18T09:00"), endsAt: iso("2027-03-18T17:00"), expectedAttendance: 60, preferredLayout: null },
        ],
      })
    );
    await formReady();

    set(/^Description/, "Two-day programme");
    await save();

    await waitFor(() => expect(api.sent(SAVE)).toHaveLength(1));
    expect(api.sent(SAVE)[0].body).toEqual({ description: "Two-day programme" });
  });

  it("refuses an empty type of event", async () => {
    const api = open();
    await formReady();

    set(/^Type of event/, "");
    await save();

    expect(await screen.findByText("Choose the type of event.")).toBeInTheDocument();
    expect(api.sent(SAVE)).toHaveLength(0);
  });

  it("lists a multi-session event's sessions", async () => {
    open(
      event({
        sessions: [
          { id: "s1", label: "Day 1", startsAt: iso(START), endsAt: iso(END), expectedAttendance: 80, preferredLayout: null },
          { id: "s2", label: null, startsAt: iso("2027-03-18T09:00"), endsAt: iso("2027-03-18T17:00"), expectedAttendance: null, preferredLayout: null },
        ],
      })
    );
    await formReady();

    expect(screen.getByText(/^Day 1: 17 Mar 2027, 09:00–17:00 · 80 expected$/)).toBeInTheDocument();
    expect(screen.getByText(/^18 Mar 2027, 09:00–17:00$/)).toBeInTheDocument();
  });
});

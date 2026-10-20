// @vitest-environment jsdom
//
// The event request form, in both places it lives: "New event request" (S-08)
// and "Edit draft" (SPM-24). The two screens share their fields and rules, so
// most behaviour is tested once and run against both; what differs (how each
// loads, and what it sends) is tested per screen at the bottom.
//
// Dates are typed as local wall-clock values, as a person would, and expected
// values are derived from them - so the tests pass in any timezone.

import { describe, it, expect } from "vitest";
import NewEventPage from "@/app/events/new/page";
import EditDraftPage from "@/app/events/[id]/edit/page";
import { ROLES } from "@/lib/roles";
import {
  breadcrumb,
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
  type ApiCall,
  type MockApi,
} from "@/test/ui";

const REF = "EVT-000007";
const START = "2030-03-04T09:00";
const END = "2030-03-04T17:00";
const iso = (local: string) => new Date(local).toISOString();

const PROJECTOR = "11111111-1111-4111-8111-111111111111";
const LECTERN = "22222222-2222-4222-8222-222222222222";

const reference = {
  "GET /api/facilities": [
    { id: "f-stage", name: "Stage", category: "facility" },
    { id: "f-loop", name: "Hearing loop", category: "accessibility" },
  ],
  "GET /api/equipment": [
    { id: PROJECTOR, name: "Projector", category: "av" },
    { id: LECTERN, name: "Lectern", category: null },
  ],
};

/// A saved draft with nothing filled in, so the edit form starts where the
/// new form does.
function blankDraft(overrides: Record<string, unknown> = {}) {
  return {
    status: "draft",
    title: null,
    category: null,
    purpose: null,
    description: null,
    startsAt: null,
    endsAt: null,
    expectedAttendance: null,
    preferredLayout: null,
    accessibilityNotes: null,
    specialRequirements: null,
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    facilityRequirements: [],
    equipmentRequests: [],
    sessions: [],
    ...overrides,
  };
}

const isStatusChange = (call: ApiCall) => typeof call.body === "object" && call.body !== null && "status" in call.body;

interface FormUnderTest {
  name: string;
  /// Renders the form, ready to type into. `save` and `submit` answer the
  /// content save and the status change that follows a Submit.
  open: (answers?: { save?: unknown; submit?: unknown; routes?: Record<string, unknown> }) => Promise<MockApi>;
  /// The content the form sent on its (first) save.
  saved: (api: MockApi) => Record<string, unknown>;
  saves: (api: MockApi) => ApiCall[];
  statusChanges: (api: MockApi) => ApiCall[];
  afterSubmit: string;
  saveFallback: string;
  submitFailureSuffix: string;
}

const NEW: FormUnderTest = {
  name: "New event request",
  async open({ save = reply(201, { id: "event-id", sequenceNumber: 42 }), submit = { status: "submitted" }, routes = {} } = {}) {
    setRoute("/events/new");
    const api = mockApi({
      ...signedInAs("organiser"),
      ...reference,
      "POST /api/events": save,
      "PATCH /api/events/EVT-000042": submit,
      ...routes,
    });
    render(<NewEventPage />);
    await screen.findByRole("checkbox", { name: "Stage" });
    return api;
  },
  saves: (api) => api.sent("POST /api/events"),
  saved: (api) => api.sent("POST /api/events")[0].body as Record<string, unknown>,
  statusChanges: (api) => api.sent("PATCH /api/events/EVT-000042"),
  afterSubmit: "/events/EVT-000042",
  saveFallback: "Could not save this request",
  submitFailureSuffix: "Your draft has been saved.",
};

const EDIT: FormUnderTest = {
  name: "Edit draft",
  async open({ save = { id: "event-id" }, submit = { status: "submitted" }, routes = {} } = {}) {
    setRoute(`/events/${REF}/edit`, { id: REF });
    const api = mockApi({
      ...signedInAs("organiser"),
      ...reference,
      [`GET /api/events/${REF}`]: blankDraft(),
      // One URL serves both the content save and the status change.
      [`PATCH /api/events/${REF}`]: (call: ApiCall) => {
        const answer = isStatusChange(call) ? submit : save;
        return typeof answer === "function" ? answer(call) : answer;
      },
      ...routes,
    });
    render(<EditDraftPage />);
    await screen.findByRole("checkbox", { name: "Stage" });
    return api;
  },
  saves: (api) => api.sent(`PATCH /api/events/${REF}`).filter((c) => !isStatusChange(c)),
  saved: (api) => EDIT.saves(api)[0].body as Record<string, unknown>,
  statusChanges: (api) => api.sent(`PATCH /api/events/${REF}`).filter(isStatusChange),
  afterSubmit: `/events/${REF}`,
  saveFallback: "Could not save this draft",
  submitFailureSuffix: "Your changes have been saved as a draft.",
};

// ---- Driving the form --------------------------------------------------------

const set = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });
const field = (label: RegExp | string, scope: HTMLElement = document.body) => within(scope).getByLabelText(label);
const group = (name: string) => screen.getByRole("group", { name });
const queryGroup = (name: string) => screen.queryByRole("group", { name });
const button = (name: string, scope: HTMLElement = document.body) => within(scope).getByRole("button", { name });

const saveDraft = () => userEvent.click(button("Save draft"));
const submit = () => userEvent.click(button("Submit request"));

/// The five fields a request needs before it may be submitted.
function fillRequired() {
  set(field(/^Event name/), "Gala Dinner");
  set(field(/^Type of event/), "conference");
  set(field(/^Starts at/), START);
  set(field(/^Ends at/), END);
  set(field(/^Expected attendance/), "200");
}

async function turnOnSessions() {
  await userEvent.click(screen.getByRole("checkbox", { name: "This event has multiple sessions" }));
}

function fillSession(index: number, values: { start?: string; end?: string; attendance?: string }) {
  const session = group(`Session ${index}`);
  if (values.start !== undefined) set(field(/^Starts at/, session), values.start);
  if (values.end !== undefined) set(field(/^Ends at/, session), values.end);
  if (values.attendance !== undefined) set(field(/^Expected attendance/, session), values.attendance);
}

describe.each([NEW, EDIT])("$name: the form", (form) => {
  describe("saving a draft", () => {
    it("[SPM-24][AC1] needs only a name", async () => {
      const api = await form.open();
      set(field(/^Event name/), "  Gala Dinner  ");

      await saveDraft();

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/events"));
      expect(form.saved(api)).toMatchObject({ title: "Gala Dinner", registrationEnabled: false });
      expect(form.statusChanges(api)).toHaveLength(0);
    });

    it.each(["", "   "])("[SPM-24][AC1] refuses a name of %j, focuses the field, and sends nothing", async (title) => {
      const api = await form.open();
      set(field(/^Event name/), title);

      await saveDraft();

      expect(screen.getByText("Give the event a name so you can find it again.")).toBeInTheDocument();
      expect(field(/^Event name/)).toHaveFocus();
      expect(form.saves(api)).toHaveLength(0);
    });

    it("[SPM-24][AC1] does not ask for the fields only a submission needs", async () => {
      await form.open();
      set(field(/^Event name/), "Gala Dinner");

      await saveDraft();

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/events"));
      expect(screen.queryByText("Choose the type of event.")).not.toBeInTheDocument();
    });

    it("[SPM-24] shows 'Saving…' and cannot be pressed twice while the save is in flight", async () => {
      let finish: (value: unknown) => void = () => {};
      const api = await form.open({ save: () => new Promise((resolve) => (finish = resolve)) });
      set(field(/^Event name/), "Gala Dinner");

      await saveDraft();

      expect(button("Saving…")).toBeDisabled();
      finish({ sequenceNumber: 42 });
      await waitFor(() => expect(router.push).toHaveBeenCalled());
      expect(form.saves(api)).toHaveLength(1);
    });
  });

  describe("submitting", () => {
    it("[SPM-23][AC7] names every missing field and sends nothing", async () => {
      const api = await form.open();
      set(field(/^Event name/), "Gala Dinner");

      await submit();

      expect(screen.getByText("Choose the type of event.")).toBeInTheDocument();
      expect(screen.getByText("Enter when the event starts.")).toBeInTheDocument();
      expect(screen.getByText("Enter when the event ends.")).toBeInTheDocument();
      expect(screen.getByText("Enter how many people you expect.")).toBeInTheDocument();
      expect(field(/^Type of event/)).toHaveFocus();
      expect(form.saves(api)).toHaveLength(0);
    });

    it("[SPM-25][AC1] saves the request, then submits it, then opens it", async () => {
      const api = await form.open();
      fillRequired();
      set(field("Purpose"), "Annual client event");
      set(field("Description"), "Dinner and awards");
      set(field("Preferred room layout"), "theatre");

      await submit();

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(form.afterSubmit));
      expect(form.saved(api)).toMatchObject({
        title: "Gala Dinner",
        category: "conference",
        purpose: "Annual client event",
        description: "Dinner and awards",
        startsAt: iso(START),
        endsAt: iso(END),
        expectedAttendance: 200,
        preferredLayout: "theatre",
      });
      expect(form.statusChanges(api).map((c) => c.body)).toEqual([{ status: "submitted" }]);
    });

    it("[SPM-25][AC1] submits when Enter is pressed in a field", async () => {
      const api = await form.open();
      fillRequired();

      await userEvent.type(field(/^Event name/), "{Enter}");

      await waitFor(() => expect(form.statusChanges(api)).toHaveLength(1));
    });

    it("[SPM-25] if saved but not submitted, says the work is safe as a draft", async () => {
      await form.open({ submit: reply(400, { error: "Cannot submit an incomplete event. Missing: category" }) });
      fillRequired();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        `Cannot submit an incomplete event. Missing: category ${form.submitFailureSuffix}`
      );
      expect(router.push).not.toHaveBeenCalled();
    });

    it("[SPM-25] says so even when the server gives no reason for refusing the submission", async () => {
      await form.open({ submit: reply(500, {}) });
      fillRequired();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        `Could not submit this request ${form.submitFailureSuffix}`
      );
    });
  });

  describe("when the save is refused", () => {
    it("[SPM-23][AC7] puts the server's field errors under their fields", async () => {
      await form.open({
        save: reply(400, { error: "Validation failed", details: { fieldErrors: { title: ["Title cannot be blank"] } } }),
      });
      set(field(/^Event name/), "Gala Dinner");

      await saveDraft();

      expect(await screen.findByText("Title cannot be blank")).toBeInTheDocument();
      expect(field(/^Event name/)).toBeInvalid();
      expect(field(/^Event name/)).toHaveFocus();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(router.push).not.toHaveBeenCalled();
    });

    it("[SPM-23] shows an error that belongs to no field at the top of the form", async () => {
      await form.open({ save: reply(400, { error: "Projector has been retired and can no longer be requested" }) });
      set(field(/^Event name/), "Gala Dinner");

      await saveDraft();

      expect(await screen.findByRole("alert")).toHaveTextContent("Projector has been retired");
    });

    it("[SPM-23] falls back to a general message", async () => {
      await form.open({ save: reply(500, {}) });
      set(field(/^Event name/), "Gala Dinner");

      await saveDraft();

      expect(await screen.findByRole("alert")).toHaveTextContent(form.saveFallback);
    });

    it("[SPM-23] explains a network failure, and leaves the form usable", async () => {
      await form.open({ save: () => Promise.reject(new Error("Failed to fetch")) });
      set(field(/^Event name/), "Gala Dinner");

      await saveDraft();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not reach the server. Check your connection and try again."
      );
      expect(button("Save draft")).toBeEnabled();
      expect(field(/^Event name/)).toHaveValue("Gala Dinner");
    });
  });

  describe("schedule and attendance rules", () => {
    it("[SPM-23][AC3][AC7] refuses an end that is not after the start", async () => {
      const api = await form.open();
      fillRequired();
      set(field(/^Ends at/), START);

      await submit();

      expect(screen.getByText("Ends at must be after starts at.")).toBeInTheDocument();
      expect(form.saves(api)).toHaveLength(0);
    });

    it("[SPM-23][AC3][AC7] refuses a start in the past", async () => {
      await form.open();
      fillRequired();
      set(field(/^Starts at/), "2020-01-01T09:00");

      await submit();

      expect(screen.getByText("The start date is in the past.")).toBeInTheDocument();
    });

    it.each(["0", "1.5"])("[SPM-23][AC4][AC7] refuses an attendance of %s", async (attendance) => {
      await form.open();
      fillRequired();
      set(field(/^Expected attendance/), attendance);

      await submit();

      expect(screen.getByText("Enter a whole number of people, at least 1.")).toBeInTheDocument();
    });

    it("[SPM-23][AC7] clears a field's error as soon as it is changed", async () => {
      await form.open();
      set(field(/^Event name/), "Gala Dinner");
      await submit();
      expect(field(/^Type of event/)).toBeInvalid();

      set(field(/^Type of event/), "workshop");

      expect(screen.queryByText("Choose the type of event.")).not.toBeInTheDocument();
      // The other errors stay until their own fields are fixed.
      expect(screen.getByText("Enter when the event starts.")).toBeInTheDocument();
    });
  });

  describe("venue requirements", () => {
    it("[SPM-23][AC5] offers facilities and accessibility needs as two separate groups", async () => {
      await form.open();

      expect(within(group("The venue must have")).getByRole("checkbox", { name: "Stage" })).toBeInTheDocument();
      expect(within(group("Accessibility needs")).getByRole("checkbox", { name: "Hearing loop" })).toBeInTheDocument();
      expect(within(group("The venue must have")).queryByRole("checkbox", { name: "Hearing loop" })).not.toBeInTheDocument();
    });

    it("[SPM-23][AC5] sends what is ticked, and not what is unticked again", async () => {
      const api = await form.open();
      set(field(/^Event name/), "Gala Dinner");
      set(field("Other accessibility notes"), "Quiet room");
      set(field("Anything else about the space"), "Signage at the entrance");

      await userEvent.click(screen.getByRole("checkbox", { name: "Stage" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Hearing loop" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Stage" }));
      await saveDraft();

      await waitFor(() => expect(form.saves(api)).toHaveLength(1));
      expect(form.saved(api)).toMatchObject({
        facilityIds: ["f-loop"],
        accessibilityNotes: "Quiet room",
        specialRequirements: "Signage at the entrance",
      });
    });
  });

  describe("equipment", () => {
    const equipment = () => group("Equipment");
    const addRow = () => userEvent.click(button("Add equipment", equipment()));

    function withDates() {
      set(field(/^Event name/), "Gala Dinner");
      set(field(/^Starts at/), START);
      set(field(/^Ends at/), END);
    }

    it("[SPM-23][AC5] cannot be requested until the event has dates", async () => {
      await form.open();

      expect(equipment()).toHaveTextContent("Add the event date and time above, then you can request equipment here.");
      expect(within(equipment()).queryByRole("button", { name: "Add equipment" })).not.toBeInTheDocument();
    });

    it("[SPM-23][AC5] starts empty once the event has dates", async () => {
      await form.open();
      withDates();

      expect(equipment()).toHaveTextContent("Nothing requested yet.");
    });

    it("[SPM-23][AC5] sends each row's item, quantity and technical requirements", async () => {
      const api = await form.open();
      withDates();

      await addRow();
      set(field("Equipment", equipment()), PROJECTOR);
      set(field("Quantity", equipment()), "3");
      set(field("Technical requirements", equipment()), "HDMI on stage left");
      await saveDraft();

      await waitFor(() => expect(form.saves(api)).toHaveLength(1));
      expect(form.saved(api).equipment).toEqual([
        { equipmentId: PROJECTOR, quantityRequested: 3, technicalRequirements: "HDMI on stage left" },
      ]);
    });

    it("[SPM-23][AC5] labels an item with its category when it has one", async () => {
      await form.open();
      withDates();

      await addRow();
      const options = within(field("Equipment", equipment())).getAllByRole("option").map((o) => o.textContent);

      expect(options).toEqual(["Choose an item", "Projector — av", "Lectern"]);
    });

    it("[SPM-23][AC5] does not offer an item that another row has already chosen", async () => {
      await form.open();
      withDates();
      await addRow();
      set(field("Equipment", equipment()), PROJECTOR);

      await addRow();
      const second = within(equipment()).getAllByLabelText("Equipment")[1];

      expect(within(second).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an item", "Lectern"]);
    });

    it("[SPM-23][AC5] stops offering Add equipment once every catalogue item is requested", async () => {
      await form.open();
      withDates();
      await addRow();
      set(field("Equipment", equipment()), PROJECTOR);
      await addRow();
      set(within(equipment()).getAllByLabelText("Equipment")[1], LECTERN);

      expect(button("Add equipment", equipment())).toBeDisabled();
      expect(equipment()).toHaveTextContent("Every catalogue item is already in your request.");
    });

    it("[SPM-23][AC5] removes a row", async () => {
      const api = await form.open();
      withDates();
      await addRow();
      set(field("Equipment", equipment()), PROJECTOR);
      await addRow();
      set(within(equipment()).getAllByLabelText("Equipment")[1], LECTERN);

      await userEvent.click(within(equipment()).getAllByRole("button", { name: "Remove" })[0]);
      await saveDraft();

      await waitFor(() => expect(form.saves(api)).toHaveLength(1));
      expect(form.saved(api).equipment).toEqual([{ equipmentId: LECTERN, quantityRequested: 1 }]);
    });

    it("[SPM-23][AC5] refuses a row with no item chosen, even on a draft", async () => {
      const api = await form.open();
      withDates();
      await addRow();

      await saveDraft();

      expect(within(equipment()).getByRole("alert")).toHaveTextContent(
        "Choose an item for every equipment row, or remove the empty ones."
      );
      expect(form.saves(api)).toHaveLength(0);
    });

    it.each(["0", "", "2.5"])("[SPM-23][AC5] refuses a quantity of %j", async (quantity) => {
      await form.open();
      withDates();
      await addRow();
      set(field("Equipment", equipment()), PROJECTOR);
      set(field("Quantity", equipment()), quantity);

      await saveDraft();

      expect(within(equipment()).getByRole("alert")).toHaveTextContent(
        "Every equipment row needs a quantity of at least 1."
      );
    });

    it("[SPM-23][AC5] clears the equipment error when a row is changed or removed", async () => {
      await form.open();
      withDates();
      await addRow();
      await saveDraft();
      expect(within(equipment()).getByRole("alert")).toBeInTheDocument();

      set(field("Equipment", equipment()), PROJECTOR);
      expect(within(equipment()).queryByRole("alert")).not.toBeInTheDocument();

      set(field("Quantity", equipment()), "0");
      await saveDraft();
      expect(within(equipment()).getByRole("alert")).toBeInTheDocument();
      await userEvent.click(button("Remove", equipment()));
      expect(within(equipment()).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("[SPM-23][AC5][AC7] on submit, refuses equipment left over on an event whose dates were cleared", async () => {
      await form.open();
      fillRequired();
      await addRow();
      set(field("Equipment", equipment()), PROJECTOR);
      set(field(/^Ends at/), "");

      await submit();

      expect(screen.getByText("Enter when the event ends.")).toBeInTheDocument();
    });
  });

  describe("registration", () => {
    const enable = () => userEvent.click(screen.getByRole("checkbox", { name: "Attendees need to register for this event" }));

    it("[SPM-23][AC5] hides its fields until it is switched on", async () => {
      await form.open();

      expect(screen.queryByLabelText(/^Registration capacity/)).not.toBeInTheDocument();
      await enable();

      expect(field(/^Registration capacity/)).toBeInTheDocument();
      expect(field("Registration opens")).toBeInTheDocument();
      expect(field("Registration closes")).toBeInTheDocument();
    });

    it("[SPM-23][AC5] sends the capacity and window when switched on", async () => {
      const api = await form.open();
      fillRequired();
      await enable();
      set(field(/^Registration capacity/), "150");
      set(field("Registration opens"), "2030-02-01T09:00");
      set(field("Registration closes"), "2030-03-01T09:00");

      await submit();

      await waitFor(() => expect(form.saves(api)).toHaveLength(1));
      expect(form.saved(api)).toMatchObject({
        registrationEnabled: true,
        registrationCapacity: 150,
        registrationOpensAt: iso("2030-02-01T09:00"),
        registrationClosesAt: iso("2030-03-01T09:00"),
      });
    });

    it("[SPM-23][AC5] sends no capacity or window when switched off again", async () => {
      const api = await form.open();
      set(field(/^Event name/), "Gala Dinner");
      await enable();
      set(field(/^Registration capacity/), "150");

      await enable();
      await saveDraft();

      await waitFor(() => expect(form.saves(api)).toHaveLength(1));
      expect(form.saved(api).registrationEnabled).toBe(false);
      expect(form.saved(api)).not.toHaveProperty("registrationCapacity");
    });

    it.each([
      ["", "Enter how many attendees can register."],
      ["0", "Enter a whole number, at least 1."],
      ["2.5", "Enter a whole number, at least 1."],
    ])("[SPM-23][AC5][AC7] on submit, refuses a capacity of %j", async (capacity, message) => {
      const api = await form.open();
      fillRequired();
      await enable();
      set(field(/^Registration capacity/), capacity);

      await submit();

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(form.saves(api)).toHaveLength(0);
    });

    it.each([
      ["closing before it opens", "2030-02-10T09:00", "2030-02-01T09:00", "Registration closes at must be after it opens."],
      ["opening after the event starts", "2030-03-05T09:00", "", "Registration must open before the event starts."],
      ["closing after the event starts", "", "2030-03-05T09:00", "Registration must close before the event starts."],
    ])("[SPM-23][AC5][AC7] on submit, refuses a window %s", async (_case, opens, closes, message) => {
      await form.open();
      fillRequired();
      await enable();
      set(field(/^Registration capacity/), "150");
      set(field("Registration opens"), opens);
      set(field("Registration closes"), closes);

      await submit();

      expect(screen.getByText(message)).toBeInTheDocument();
    });
  });

  describe("multi-session events", () => {
    it("[SPM-23][AC6] moves what was typed for the event into Session 1, and hides the event-level sections", async () => {
      await form.open();
      fillRequired();
      set(field("Preferred room layout"), "theatre");

      await turnOnSessions();

      expect(queryGroup("Schedule")).not.toBeInTheDocument();
      expect(queryGroup("Attendance")).not.toBeInTheDocument();
      expect(queryGroup("Equipment")).not.toBeInTheDocument();
      expect(group("Venue requirements")).toHaveTextContent("These apply to every session.");
      const first = group("Session 1");
      expect(field(/^Starts at/, first)).toHaveValue(START);
      expect(field(/^Ends at/, first)).toHaveValue(END);
      expect(field(/^Expected attendance/, first)).toHaveValue(200);
      expect(field("Preferred room layout", first)).toHaveValue("theatre");
      expect(field(/^Starts at/, group("Session 2"))).toHaveValue("");
    });

    it("[SPM-23][AC6] moves the event's equipment onto Session 1 too", async () => {
      await form.open();
      fillRequired();
      await userEvent.click(button("Add equipment", group("Equipment")));
      set(field("Equipment", group("Equipment")), PROJECTOR);

      await turnOnSessions();

      expect(field("Equipment", group("Session 1"))).toHaveValue(PROJECTOR);
    });

    it("[SPM-23][AC6] starts with two sessions, the fewest a multi-session event can have", async () => {
      await form.open();

      await turnOnSessions();

      expect(screen.getAllByRole("group", { name: /^Session \d$/ })).toHaveLength(2);
      screen.getAllByRole("button", { name: "Remove session" }).forEach((b) => expect(b).toBeDisabled());
    });

    it("[SPM-23][AC6] adds sessions, and removes them down to two", async () => {
      await form.open();
      await turnOnSessions();
      fillSession(1, { start: START });

      await userEvent.click(button("Add session"));
      expect(screen.getAllByRole("group", { name: /^Session \d$/ })).toHaveLength(3);
      await userEvent.click(button("Remove session", group("Session 2")));

      expect(screen.getAllByRole("group", { name: /^Session \d$/ })).toHaveLength(2);
      expect(field(/^Starts at/, group("Session 1"))).toHaveValue(START);
    });

    it("[SPM-23][AC6][AC7] needs each session's times even to save a draft", async () => {
      const api = await form.open();
      set(field(/^Event name/), "Summit");
      await turnOnSessions();

      await saveDraft();

      expect(screen.getAllByText("Enter when this session starts.")).toHaveLength(2);
      expect(screen.getAllByText("Enter when this session ends.")).toHaveLength(2);
      expect(field(/^Starts at/, group("Session 1"))).toHaveFocus();
      expect(form.saves(api)).toHaveLength(0);
    });

    it("[SPM-23][AC6] drops every session's messages when a session is removed, as they would land on the wrong card", async () => {
      await form.open();
      set(field(/^Event name/), "Summit");
      await turnOnSessions();
      await userEvent.click(button("Add session"));
      await saveDraft();
      expect(screen.getAllByText("Enter when this session starts.")).toHaveLength(3);

      await userEvent.click(button("Remove session", group("Session 3")));

      expect(screen.queryByText("Enter when this session starts.")).not.toBeInTheDocument();
    });

    it("[SPM-23][AC6] shows the server's message about the sessions as a whole above them", async () => {
      const message = "Each item can only be requested once per event, across all sessions - change the quantity instead";
      await form.open({ save: reply(400, { error: "Validation failed", details: { fieldErrors: { sessions: [message] } } }) });
      set(field(/^Event name/), "Summit");
      await turnOnSessions();
      fillSession(1, { start: START, end: END });
      fillSession(2, { start: "2030-03-05T09:00", end: "2030-03-05T17:00" });

      await saveDraft();

      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it("[SPM-23][AC6][AC7] needs each session's attendance to submit, but not to save a draft", async () => {
      const api = await form.open();
      set(field(/^Event name/), "Summit");
      set(field(/^Type of event/), "conference");
      await turnOnSessions();
      fillSession(1, { start: START, end: END, attendance: "80" });
      fillSession(2, { start: "2030-03-05T09:00", end: "2030-03-05T17:00" });

      await submit();
      expect(within(group("Session 2")).getByText("Enter how many people you expect.")).toBeInTheDocument();
      expect(form.saves(api)).toHaveLength(0);
      await saveDraft();

      await waitFor(() => expect(form.saves(api)).toHaveLength(1));
    });

    it.each(["0", "1.5"])("[SPM-23][AC6][AC7] on submit, refuses a session attendance of %s", async (attendance) => {
      await form.open();
      set(field(/^Event name/), "Summit");
      set(field(/^Type of event/), "conference");
      await turnOnSessions();
      fillSession(1, { start: START, end: END, attendance });
      fillSession(2, { start: "2030-03-05T09:00", end: "2030-03-05T17:00", attendance: "40" });

      await submit();

      expect(within(group("Session 1")).getByText("Enter a whole number of people, at least 1.")).toBeInTheDocument();
    });

    it("[SPM-23][AC6][AC7] refuses a session that ends before it starts, and one that starts in the past", async () => {
      await form.open();
      set(field(/^Event name/), "Summit");
      set(field(/^Type of event/), "conference");
      await turnOnSessions();
      fillSession(1, { start: END, end: START, attendance: "80" });
      fillSession(2, { start: "2020-01-01T09:00", end: "2020-01-01T17:00", attendance: "40" });

      await submit();

      expect(within(group("Session 1")).getByText("Ends at must be after starts at.")).toBeInTheDocument();
      expect(within(group("Session 2")).getByText("The start date is in the past.")).toBeInTheDocument();
    });

    it("[SPM-23][AC6] clears a session's error when that field is changed", async () => {
      await form.open();
      set(field(/^Event name/), "Summit");
      await turnOnSessions();
      await saveDraft();

      fillSession(1, { start: START });

      expect(within(group("Session 1")).queryByText("Enter when this session starts.")).not.toBeInTheDocument();
      expect(within(group("Session 1")).getByText("Enter when this session ends.")).toBeInTheDocument();
      expect(within(group("Session 2")).getByText("Enter when this session starts.")).toBeInTheDocument();
    });

    it("[SPM-23][AC6] sends the sessions instead of the event's own schedule", async () => {
      const api = await form.open();
      set(field(/^Event name/), "Summit");
      set(field(/^Type of event/), "conference");
      await turnOnSessions();
      set(field("Session name", group("Session 1")), "  Day 1  ");
      fillSession(1, { start: START, end: END, attendance: "80" });
      set(field("Preferred room layout", group("Session 1")), "theatre");
      fillSession(2, { start: "2030-03-05T09:00", end: "2030-03-05T17:00", attendance: "40" });

      await submit();

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(form.afterSubmit));
      const body = form.saved(api);
      expect(body.sessions).toEqual([
        { label: "Day 1", startsAt: iso(START), endsAt: iso(END), expectedAttendance: 80, preferredLayout: "theatre" },
        { startsAt: iso("2030-03-05T09:00"), endsAt: iso("2030-03-05T17:00"), expectedAttendance: 40 },
      ]);
      expect(body).not.toHaveProperty("startsAt");
      expect(body).not.toHaveProperty("expectedAttendance");
    });

    it("[SPM-23][AC6] measures the registration window against the first session's start", async () => {
      await form.open();
      set(field(/^Event name/), "Summit");
      set(field(/^Type of event/), "conference");
      await turnOnSessions();
      fillSession(1, { start: "2030-03-05T09:00", end: "2030-03-05T17:00", attendance: "40" });
      fillSession(2, { start: START, end: END, attendance: "80" });
      await userEvent.click(screen.getByRole("checkbox", { name: "Attendees need to register for this event" }));
      set(field(/^Registration capacity/), "100");
      // After the earlier session (the 4th) has started, before the later one.
      set(field("Registration closes"), "2030-03-04T12:00");

      await submit();

      expect(screen.getByText("Registration must close before the event starts.")).toBeInTheDocument();
    });

    it("[SPM-23][AC6] brings the event-level sections back when switched off, and remembers the sessions", async () => {
      await form.open();
      await turnOnSessions();
      fillSession(1, { start: START });

      await turnOnSessions();
      expect(group("Schedule")).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Session 1" })).not.toBeInTheDocument();
      await turnOnSessions();

      expect(field(/^Starts at/, group("Session 1"))).toHaveValue(START);
    });

    it("[SPM-23][AC6] takes the schedule errors away with the section they belonged to", async () => {
      await form.open();
      set(field(/^Event name/), "Summit");
      await submit();
      expect(screen.getByText("Enter when the event starts.")).toBeInTheDocument();

      await turnOnSessions();

      expect(screen.queryByText("Enter when the event starts.")).not.toBeInTheDocument();
      expect(screen.queryByText("Enter how many people you expect.")).not.toBeInTheDocument();
      // An error for a field that is still on the form stays.
      expect(screen.getByText("Choose the type of event.")).toBeInTheDocument();
    });

    describe("equipment for a session", () => {
      async function twoDatedSessions() {
        const api = await form.open();
        set(field(/^Event name/), "Summit");
        await turnOnSessions();
        fillSession(1, { start: START, end: END });
        fillSession(2, { start: "2030-03-05T09:00", end: "2030-03-05T17:00" });
        return api;
      }
      const addTo = (index: number) => userEvent.click(button("Add equipment", group(`Session ${index}`)));

      it("[SPM-23][AC6] cannot be requested until the session has its times", async () => {
        await form.open();
        await turnOnSessions();

        expect(group("Session 1")).toHaveTextContent(
          "Add this session's start and end above, then you can request equipment for it."
        );
      });

      it("[SPM-23][AC6] is sent with its session", async () => {
        const api = await twoDatedSessions();
        expect(group("Session 2")).toHaveTextContent("Nothing requested for this session yet.");

        await addTo(2);
        set(field("Equipment", group("Session 2")), LECTERN);
        set(field("Quantity", group("Session 2")), "2");
        set(field("Technical requirements", group("Session 2")), "Centre stage");
        await saveDraft();

        await waitFor(() => expect(form.saves(api)).toHaveLength(1));
        const sessions = form.saved(api).sessions as Array<Record<string, unknown>>;
        expect(sessions[0]).not.toHaveProperty("equipment");
        expect(sessions[1].equipment).toEqual([
          { equipmentId: LECTERN, quantityRequested: 2, technicalRequirements: "Centre stage" },
        ]);
      });

      it("[SPM-23][AC6] keeps each of a session's rows as entered", async () => {
        const api = await twoDatedSessions();
        await addTo(1);
        await addTo(1);
        const items = within(group("Session 1")).getAllByLabelText("Equipment");
        set(items[0], PROJECTOR);
        set(items[1], LECTERN);
        set(within(group("Session 1")).getAllByLabelText("Quantity")[1], "3");
        await saveDraft();

        await waitFor(() => expect(form.saves(api)).toHaveLength(1));
        const sessions = form.saved(api).sessions as Array<Record<string, unknown>>;
        expect(sessions[0].equipment).toEqual([
          expect.objectContaining({ equipmentId: PROJECTOR, quantityRequested: 1 }),
          expect.objectContaining({ equipmentId: LECTERN, quantityRequested: 3 }),
        ]);
      });

      it("[SPM-23][AC6] does not offer an item another session has already requested", async () => {
        await twoDatedSessions();
        await addTo(1);
        set(field("Equipment", group("Session 1")), PROJECTOR);

        await addTo(2);
        const options = within(field("Equipment", group("Session 2"))).getAllByRole("option").map((o) => o.textContent);

        expect(options).toEqual(["Choose an item", "Lectern"]);
      });

      it("[SPM-23][AC6] stops offering Add equipment once every item is requested somewhere on the event", async () => {
        await twoDatedSessions();
        await addTo(1);
        set(field("Equipment", group("Session 1")), PROJECTOR);
        await addTo(2);
        set(field("Equipment", group("Session 2")), LECTERN);

        expect(button("Add equipment", group("Session 1"))).toBeDisabled();
        expect(button("Add equipment", group("Session 2"))).toBeDisabled();
        expect(group("Session 1")).toHaveTextContent("Every catalogue item is already in your request.");
      });

      it("[SPM-23][AC6] refuses a row with no item, and clears the error when the row is removed", async () => {
        const api = await twoDatedSessions();
        await addTo(1);

        await saveDraft();
        expect(within(group("Session 1")).getByRole("alert")).toHaveTextContent(
          "Choose an item for every equipment row, or remove the empty ones."
        );
        expect(form.saves(api)).toHaveLength(0);
        await userEvent.click(button("Remove", group("Session 1")));

        expect(within(group("Session 1")).queryByRole("alert")).not.toBeInTheDocument();
        expect(group("Session 1")).toHaveTextContent("Nothing requested for this session yet.");
      });

      it("[SPM-23][AC6] clears the error when the row is filled in", async () => {
        await twoDatedSessions();
        await addTo(1);
        await saveDraft();

        set(field("Equipment", group("Session 1")), PROJECTOR);

        expect(within(group("Session 1")).queryByRole("alert")).not.toBeInTheDocument();
      });
    });
  });

  it("[SPM-23] Cancel goes back to the events list without saving", async () => {
    const api = await form.open();
    set(field(/^Event name/), "Gala Dinner");

    await userEvent.click(button("Cancel"));

    expect(router.push).toHaveBeenCalledWith("/events");
    expect(form.saves(api)).toHaveLength(0);
  });
});

describe("New event request: this screen only", () => {
  it.each(ROLES.filter((r) => r !== "organiser"))("[SPM-22][AC4] refuses %s at the door, before any form is shown", async (role) => {
    setRoute("/events/new");
    const api = mockApi(signedInAs(role));

    render(<NewEventPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Only an Event Organiser can raise an event request.");
    expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
    expect(api.sent("GET /api/facilities")).toHaveLength(0);
  });

  // SPM-98: <list> / New request - no record yet.
  it("[SPM-23][BUG-98] names the organiser's list 'My Events' in the breadcrumb", async () => {
    await NEW.open();

    expect(breadcrumb()).toEqual([
      ["My Events", "/events"],
      ["New request", null],
    ]);
  });

  it("[SPM-23][BUG-98] keeps the same breadcrumb, starting 'Events', for a role it refuses", async () => {
    setRoute("/events/new");
    mockApi(signedInAs("coordinator"));
    render(<NewEventPage />);
    await screen.findByRole("alert");

    expect(breadcrumb()).toEqual([
      ["Events", "/events"],
      ["New request", null],
    ]);
  });

  it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
    setRoute("/events/new");
    mockApi(signedOut());

    render(<NewEventPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2Fnew"));
  });

  it("[SPM-24][AC1] a title-only draft sends the title and nothing it was not given", async () => {
    const api = await NEW.open();
    set(field(/^Event name/), "Gala Dinner");

    await saveDraft();

    await waitFor(() => expect(NEW.saves(api)).toHaveLength(1));
    expect(NEW.saved(api)).toEqual({ title: "Gala Dinner", registrationEnabled: false });
  });

  it("[SPM-23] shows placeholders for the pickers while the reference data loads", async () => {
    setRoute("/events/new");
    mockApi({
      ...signedInAs("organiser"),
      "GET /api/facilities": () => new Promise(() => {}),
      "GET /api/equipment": () => new Promise(() => {}),
    });

    render(<NewEventPage />);
    await screen.findByLabelText(/^Event name/);

    expect(screen.queryByRole("checkbox", { name: "Stage" })).not.toBeInTheDocument();
    expect(screen.queryByText("None available.")).not.toBeInTheDocument();
  });

  it.each([
    ["answers with an error", { "GET /api/facilities": reply(500, {}), "GET /api/equipment": [] }],
    ["cannot be reached", { "GET /api/facilities": () => Promise.reject(new Error("offline")), "GET /api/equipment": [] }],
  ])("[SPM-24][AC1] still lets a draft be saved when the reference data %s", async (_case, routes) => {
    setRoute("/events/new");
    const api = mockApi({ ...signedInAs("organiser"), ...routes, "POST /api/events": reply(201, { sequenceNumber: 42 }) });
    render(<NewEventPage />);
    set(await screen.findByLabelText(/^Event name/), "Gala Dinner");
    set(field(/^Starts at/), START);
    set(field(/^Ends at/), END);

    expect(button("Add equipment", group("Equipment"))).toBeDisabled();
    await saveDraft();

    await waitFor(() => expect(api.sent("POST /api/events")).toHaveLength(1));
  });
});

describe("Edit draft: this screen only", () => {
  const DRAFT = `GET /api/events/${REF}`;

  function openWith(draft: unknown, routes: Record<string, unknown> = {}) {
    setRoute(`/events/${REF}/edit`, { id: REF });
    const api = mockApi({ ...signedInAs("organiser"), ...reference, [DRAFT]: draft, ...routes });
    render(<EditDraftPage />);
    return api;
  }

  it("[SPM-22][AC4] sends an anonymous visitor to log in, remembering the draft", async () => {
    setRoute(`/events/${REF}/edit`, { id: REF });
    mockApi(signedOut());

    render(<EditDraftPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fedit"));
  });

  // SPM-98: My Events / <draft's title> / Edit draft, in every state.
  describe("its breadcrumb", () => {
    const trail = (title: string) => [
      ["My Events", "/events"],
      [title, `/events/${REF}`],
      ["Edit draft", null],
    ];

    it("[SPM-24][BUG-98] names the draft by its saved title, not what is being typed", async () => {
      openWith(blankDraft({ title: "Gala Dinner" }));
      set(await screen.findByLabelText(/^Event name/), "Gala Dinner 2030");

      expect(breadcrumb()).toEqual(trail("Gala Dinner"));
    });

    it("[SPM-24][BUG-98] reads 'Event' for a draft with no title yet", async () => {
      openWith(blankDraft({ title: null }));
      await screen.findByLabelText(/^Event name/);

      expect(breadcrumb()).toEqual(trail("Event"));
    });

    it.each([
      ["loading", () => new Promise(() => {})],
      ["in error", reply(404, {})],
    ])("[SPM-24][BUG-98] reads 'Event' while %s", async (_case, draft) => {
      openWith(draft);
      await screen.findByRole("navigation", { name: "Breadcrumb" });

      expect(breadcrumb()).toEqual(trail("Event"));
    });
  });

  it("[SPM-24] shows a placeholder while the draft loads", async () => {
    openWith(() => new Promise(() => {}));

    expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
  });

  it.each([
    ["is not found", reply(404, {}), "This draft could not be found. It may have been removed, or it isn't yours."],
    ["cannot be loaded", reply(500, {}), "Could not load this draft."],
    [
      "has already been submitted",
      blankDraft({ status: "submitted" }),
      "This request has already been submitted, so it can no longer be edited here.",
    ],
    [
      "cannot be reached",
      () => Promise.reject(new Error("offline")),
      "Could not reach the server. Check your connection and try again.",
    ],
  ])("[SPM-24] refuses to open a draft that %s, and offers the way back", async (_case, draft, message) => {
    openWith(draft);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByLabelText(/^Event name/)).not.toBeInTheDocument();
    await userEvent.click(button("Back to My Events"));
    expect(router.push).toHaveBeenCalledWith("/events");
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    openWith(reply(401, {}));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fedit"));
  });

  it("[SPM-24][AC3][AC4] fills the form from the saved draft", async () => {
    openWith(
      blankDraft({
        title: "Gala Dinner",
        category: "conference",
        purpose: "Annual client event",
        description: "Dinner and awards",
        startsAt: iso(START),
        endsAt: iso(END),
        expectedAttendance: 200,
        preferredLayout: "banquet",
        accessibilityNotes: "Quiet room",
        specialRequirements: "Signage",
        registrationEnabled: true,
        registrationCapacity: 150,
        registrationOpensAt: iso("2030-02-01T09:00"),
        registrationClosesAt: iso("2030-03-01T09:00"),
        facilityRequirements: [{ facilityId: "f-loop" }],
        equipmentRequests: [{ equipmentId: PROJECTOR, quantityRequested: 3, technicalRequirements: "HDMI", sessionId: null }],
      })
    );

    expect(await screen.findByLabelText(/^Event name/)).toHaveValue("Gala Dinner");
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(field(/^Type of event/)).toHaveValue("conference");
    expect(field("Purpose")).toHaveValue("Annual client event");
    expect(field(/^Starts at/)).toHaveValue(START);
    expect(field(/^Ends at/)).toHaveValue(END);
    expect(field(/^Expected attendance/)).toHaveValue(200);
    expect(field("Preferred room layout")).toHaveValue("banquet");
    expect(field(/^Registration capacity/)).toHaveValue(150);
    expect(field("Registration opens")).toHaveValue("2030-02-01T09:00");
    expect(await screen.findByRole("checkbox", { name: "Hearing loop" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Stage" })).not.toBeChecked();
    expect(field("Equipment", group("Equipment"))).toHaveValue(PROJECTOR);
    expect(field("Quantity", group("Equipment"))).toHaveValue(3);
    expect(field("Technical requirements", group("Equipment"))).toHaveValue("HDMI");
  });

  it("[SPM-24][AC3] [SPM-23][AC6] opens a multi-session draft with its sessions, each with its own equipment", async () => {
    openWith(
      blankDraft({
        title: "Summit",
        sessions: [
          { id: "s1", label: "Day 1", startsAt: iso(START), endsAt: iso(END), expectedAttendance: 80, preferredLayout: "theatre" },
          { id: "s2", label: null, startsAt: iso("2030-03-05T09:00"), endsAt: iso("2030-03-05T17:00"), expectedAttendance: null, preferredLayout: null },
        ],
        equipmentRequests: [{ equipmentId: LECTERN, quantityRequested: 1, technicalRequirements: null, sessionId: "s2" }],
      })
    );

    await screen.findByRole("checkbox", { name: "Stage" });

    expect(screen.getByRole("checkbox", { name: "This event has multiple sessions" })).toBeChecked();
    expect(field("Session name", group("Session 1"))).toHaveValue("Day 1");
    expect(field(/^Starts at/, group("Session 1"))).toHaveValue(START);
    expect(field(/^Expected attendance/, group("Session 1"))).toHaveValue(80);
    expect(field("Session name", group("Session 2"))).toHaveValue("");
    expect(field("Equipment", group("Session 2"))).toHaveValue(LECTERN);
    expect(within(group("Session 1")).queryByLabelText("Equipment")).not.toBeInTheDocument();
  });

  it("[SPM-24][AC3][AC4] still lets the draft be saved when the reference data fails to load", async () => {
    const api = openWith(blankDraft({ title: "Gala Dinner" }), {
      "GET /api/facilities": reply(500, {}),
      [`PATCH /api/events/${REF}`]: { id: "event-id" },
    });
    await screen.findByLabelText(/^Event name/);

    await saveDraft();

    await waitFor(() => expect(api.sent(`PATCH /api/events/${REF}`)).toHaveLength(1));
    expect(screen.queryByRole("checkbox", { name: "Stage" })).not.toBeInTheDocument();
  });

  it("[SPM-24][AC3][AC4] always sends every field, so a value cleared on the form is cleared on the draft", async () => {
    const api = openWith(
      blankDraft({
        title: "Gala Dinner",
        purpose: "Annual client event",
        description: "Dinner and awards",
        facilityRequirements: [{ facilityId: "f-loop" }],
      }),
      { [`PATCH /api/events/${REF}`]: { id: "event-id" } }
    );
    await screen.findByRole("checkbox", { name: "Hearing loop" });

    set(field("Purpose"), "");
    await userEvent.click(screen.getByRole("checkbox", { name: "Hearing loop" }));
    await saveDraft();

    await waitFor(() => expect(api.sent(`PATCH /api/events/${REF}`)).toHaveLength(1));
    expect(api.sent(`PATCH /api/events/${REF}`)[0].body).toEqual({
      title: "Gala Dinner",
      purpose: "",
      description: "Dinner and awards",
      accessibilityNotes: "",
      specialRequirements: "",
      registrationEnabled: false,
      facilityIds: [],
      equipment: [],
      sessions: [],
    });
  });

  it("[SPM-24][AC3][AC4] turning multi-session off sends an empty session list, which drops the saved sessions", async () => {
    const api = openWith(
      blankDraft({
        title: "Summit",
        sessions: [
          { id: "s1", label: "Day 1", startsAt: iso(START), endsAt: iso(END), expectedAttendance: 80, preferredLayout: null },
          { id: "s2", label: "Day 2", startsAt: iso("2030-03-05T09:00"), endsAt: iso("2030-03-05T17:00"), expectedAttendance: 40, preferredLayout: null },
        ],
      }),
      { [`PATCH /api/events/${REF}`]: { id: "event-id" } }
    );
    await screen.findByRole("checkbox", { name: "Stage" });

    await turnOnSessions();
    await saveDraft();

    await waitFor(() => expect(api.sent(`PATCH /api/events/${REF}`)).toHaveLength(1));
    expect(api.sent(`PATCH /api/events/${REF}`)[0].body).toMatchObject({ sessions: [] });
  });

  it("[SPM-24][AC3][AC4] saving a multi-session draft sends an empty event-wide equipment list", async () => {
    const api = await EDIT.open();
    set(field(/^Event name/), "Summit");
    await turnOnSessions();
    fillSession(1, { start: START, end: END });
    fillSession(2, { start: "2030-03-05T09:00", end: "2030-03-05T17:00" });

    await saveDraft();

    await waitFor(() => expect(EDIT.saves(api)).toHaveLength(1));
    expect(EDIT.saved(api).equipment).toEqual([]);
    expect(EDIT.saved(api).sessions).toHaveLength(2);
  });
});

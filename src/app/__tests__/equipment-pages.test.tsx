// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import EventEquipmentPage from "@/app/events/[id]/equipment/page";
import EquipmentRequestDetailPage from "@/app/equipment/requests/[id]/page";
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
const set = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-id",
    sequenceNumber: 7,
    title: "Gala Dinner",
    status: "planning",
    startsAt: "2027-03-04T01:00:00.000Z",
    endsAt: "2027-03-04T09:00:00.000Z",
    expectedAttendance: 200,
    submittedAt: "2027-01-10T02:00:00.000Z",
    coordinator: { fullName: "Daniel Tan" },
    sessions: [],
    ...overrides,
  };
}

describe("Event equipment tab", () => {
  const LIST = `GET /api/events/${REF}/equipment`;
  const ADD = `POST /api/events/${REF}/equipment`;
  const row = (id: string) => `/api/events/${REF}/equipment/${id}`;

  const catalogue = [
    { id: "eq-projector", name: "Projector", category: "av" },
    { id: "eq-lectern", name: "Lectern", category: null },
    { id: "eq-mic", name: "Microphone", category: "audio" },
  ];

  function request(id: string, equipment: (typeof catalogue)[number], overrides: Record<string, unknown> = {}) {
    return {
      id,
      equipmentId: equipment.id,
      quantityRequested: 2,
      quantityReserved: null,
      technicalRequirements: null,
      status: "requested",
      equipment,
      session: null,
      ...overrides,
    };
  }
  const projectorRow = (overrides = {}) => request("r1", catalogue[0], overrides);
  const lecternRow = (overrides = {}) => request("r2", catalogue[1], overrides);

  function open(role = "coordinator", routes: Record<string, unknown> = {}) {
    setRoute(`/events/${REF}/equipment`, { id: REF });
    const api = mockApi({
      ...signedInAs(role),
      [EVENT]: event(),
      [LIST]: [projectorRow(), lecternRow()],
      "GET /api/equipment": catalogue,
      ...routes,
    });
    render(<EventEquipmentPage />);
    return api;
  }

  /// The requested-items row for an item. Its name can also appear as an option
  /// in the Add equipment picker, so look for the row's own heading.
  const itemRow = async (name: string) =>
    (await screen.findAllByText(name)).find((el) => el.tagName === "P")!.closest("div.p-4") as HTMLElement;
  const addForm = () => screen.getByRole("group", { name: "Add equipment" });
  /// The page holds two dialogs - the removal question and "Begin planning?".
  const dialog = (title = "Remove this equipment requirement?") =>
    screen.getByText(title, { selector: "dialog h2" }).closest("dialog") as HTMLDialogElement;
  const planningDialog = () => dialog("Begin planning?");

  describe("who can open it", () => {
    it("sends an anonymous visitor to log in", async () => {
      setRoute(`/events/${REF}/equipment`, { id: REF });
      mockApi(signedOut());

      render(<EventEquipmentPage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fequipment"));
    });

    it("renders nothing until it knows who is looking", () => {
      setRoute(`/events/${REF}/equipment`, { id: REF });
      mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

      const { container } = render(<EventEquipmentPage />);

      expect(container).toBeEmptyDOMElement();
    });

    it.each(["ops_manager", "venue_staff", "attendee"])("turns %s away", async (role) => {
      open(role);

      expect(await screen.findByRole("alert")).toHaveTextContent("You don't have access to this event.");
      expect(screen.queryByText("Projector")).not.toBeInTheDocument();
    });
  });

  describe("read-only, for the organiser and Technical Support", () => {
    it.each(["organiser", "tech_support"])("shows %s each item as plain text, with nothing to edit", async (role) => {
      const api = open(role, { [LIST]: [projectorRow({ technicalRequirements: "HDMI on stage left" }), lecternRow()] });

      const projector = await itemRow("Projector");

      expect(projector).toHaveTextContent("av");
      expect(projector).toHaveTextContent("Quantity2");
      expect(projector).toHaveTextContent("HDMI on stage left");
      expect(await itemRow("Lectern")).toHaveTextContent("Technical requirements—");
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Add equipment" })).not.toBeInTheDocument();
      expect(api.sent("GET /api/equipment")).toHaveLength(0);
    });

    it("gives Technical Support the way to the availability check, and nobody else", async () => {
      open("tech_support");

      expect(await screen.findByRole("link", { name: "Check availability" })).toHaveAttribute(
        "href",
        "/equipment/requests/EVT-000007"
      );
    });

    it("does not show the organiser a Check availability link", async () => {
      open("organiser");

      await itemRow("Projector");

      expect(screen.queryByRole("link", { name: "Check availability" })).not.toBeInTheDocument();
    });

    it("says nothing has been recorded when the list is empty", async () => {
      open("organiser", { [LIST]: [] });

      expect(await screen.findByText("Nothing requested yet")).toBeInTheDocument();
      expect(screen.getByText("Nothing has been recorded for this event.")).toBeInTheDocument();
    });
  });

  // SPM-85 (AC3, AC4): the Safety Officer reads the equipment arrangements
  // for a safety review, and changes none of them.
  describe("read-only, for the Safety Officer (SPM-85)", () => {
    it("shows each item, its quantity and status, with nothing to edit", async () => {
      const api = open("safety_officer", {
        [LIST]: [projectorRow({ status: "reserved", quantityReserved: 2 }), lecternRow()],
      });

      const projector = await itemRow("Projector");

      expect(projector).toHaveTextContent("Quantity2");
      expect(projector).toHaveTextContent("Reserved");
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Add equipment" })).not.toBeInTheDocument();
      // The catalogue is only loaded to add a row, which is not theirs to do.
      expect(api.sent("GET /api/equipment")).toHaveLength(0);
    });

    it("does not offer the availability check, which is Technical Support's", async () => {
      open("safety_officer");

      await itemRow("Projector");

      expect(screen.queryByRole("link", { name: "Check availability" })).not.toBeInTheDocument();
    });
  });

  describe("for the assigned coordinator", () => {
    it("shows the event, its tabs, the item count and a summary of the event", async () => {
      open();

      await itemRow("Projector");

      expect(screen.getByRole("heading", { level: 1, name: "Equipment requirements" })).toBeInTheDocument();
      expect(screen.getByText("EVT-000007")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Equipment" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByText("2 items")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Event at a glance" })).toBeInTheDocument();
    });

    it("counts a single item in the singular", async () => {
      open("coordinator", { [LIST]: [projectorRow()] });

      expect(await screen.findByText("1 item")).toBeInTheDocument();
    });

    it("shows each item's status, what is reserved, and which session it is for", async () => {
      open("coordinator", {
        [LIST]: [
          projectorRow({
            status: "partially_fulfilled",
            quantityReserved: 1,
            session: { id: "s1", label: "Day 1", startsAt: "2027-03-04T01:00:00.000Z", endsAt: "2027-03-04T05:00:00.000Z" },
          }),
          lecternRow({
            session: { id: "s2", label: null, startsAt: "2027-03-05T01:00:00.000Z", endsAt: "2027-03-05T05:00:00.000Z" },
          }),
        ],
      });

      const projector = await itemRow("Projector");

      expect(projector).toHaveTextContent("Partially fulfilled");
      expect(projector).toHaveTextContent("1 reserved");
      expect(projector).toHaveTextContent(/Day 1 — .*4 Mar 2027/);
      // An unlabelled session is shown by its times alone, with no label or dash before them.
      const chip = (await itemRow("Lectern")).querySelector("span.rounded-full")!;
      expect(chip).toHaveTextContent(/^5 Mar 2027/);
    });

    it("invites the coordinator to add something when nothing is requested", async () => {
      open("coordinator", { [LIST]: [] });

      expect(await screen.findByText(/Add projectors, microphones, video conferencing/)).toBeInTheDocument();
    });

    describe("editing a row", () => {
      it("offers Save only once the row differs from what is saved", async () => {
        open();
        const projector = await itemRow("Projector");
        expect(within(projector).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

        set(within(projector).getByLabelText("Quantity"), "5");
        expect(within(projector).getByRole("button", { name: "Save" })).toBeInTheDocument();
        set(within(projector).getByLabelText("Quantity"), "2");

        expect(within(projector).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      });

      it("saves the new quantity and technical requirements, then shows the saved row", async () => {
        const api = open("coordinator", {
          [`PATCH ${row("r1")}`]: projectorRow({ quantityRequested: 5, technicalRequirements: "HDMI" }),
        });
        const projector = await itemRow("Projector");

        set(within(projector).getByLabelText("Quantity"), "5");
        set(within(projector).getByLabelText("Technical requirements"), "HDMI");
        await userEvent.click(within(projector).getByRole("button", { name: "Save" }));

        await waitFor(() => expect(within(projector).queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
        expect(api.sent(`PATCH ${row("r1")}`)[0].body).toEqual({ quantityRequested: 5, technicalRequirements: "HDMI" });
        expect(within(projector).getByLabelText("Quantity")).toHaveValue(5);
      });

      it.each(["0", "", "1.5"])("refuses a quantity of %j without sending it", async (quantity) => {
        const api = open();
        const projector = await itemRow("Projector");

        set(within(projector).getByLabelText("Technical requirements"), "x");
        set(within(projector).getByLabelText("Quantity"), quantity);
        await userEvent.click(within(projector).getByRole("button", { name: "Save" }));

        expect(within(projector).getByRole("alert")).toHaveTextContent("Enter a whole number, at least 1.");
        expect(api.sent(`PATCH ${row("r1")}`)).toHaveLength(0);
      });

      it("clears a row's error when the row is changed", async () => {
        open();
        const projector = await itemRow("Projector");
        set(within(projector).getByLabelText("Quantity"), "0");
        await userEvent.click(within(projector).getByRole("button", { name: "Save" }));

        set(within(projector).getByLabelText("Quantity"), "3");

        expect(within(projector).queryByRole("alert")).not.toBeInTheDocument();
      });

      it.each([
        ["the server's reason", reply(400, { error: "Cannot update equipment for a completed, cancelled, or rejected event" }), "Cannot update equipment for a completed"],
        ["a general message when there is none", reply(500, {}), "Could not save this row."],
        ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server."],
      ])("shows %s against the row, and keeps the edit", async (_case, answer, message) => {
        open("coordinator", { [`PATCH ${row("r1")}`]: answer });
        const projector = await itemRow("Projector");

        set(within(projector).getByLabelText("Quantity"), "5");
        await userEvent.click(within(projector).getByRole("button", { name: "Save" }));

        expect(await within(projector).findByRole("alert")).toHaveTextContent(message);
        expect(within(projector).getByLabelText("Quantity")).toHaveValue(5);
        expect(within(await itemRow("Lectern")).queryByRole("alert")).not.toBeInTheDocument();
      });
    });

    describe("removing a row", () => {
      it("asks first, saying what Technical Support will no longer see", async () => {
        const api = open();

        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        expect(dialog().open).toBe(true);
        expect(dialog()).toHaveTextContent("Technical Support will no longer see this item requested for this event.");
        expect(dialog()).not.toHaveTextContent("Approved to Planning");
        expect(api.sent(`DELETE ${row("r1")}`)).toHaveLength(0);
      });

      it("copes with a removal the server answers with no body", async () => {
        open("coordinator", { [`DELETE ${row("r1")}`]: reply(204) });
        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        await userEvent.click(within(dialog()).getByRole("button", { name: "Remove", hidden: true }));

        await waitFor(() => expect(screen.queryByText("Projector")).not.toBeInTheDocument());
        expect(screen.queryByText("Planning has started")).not.toBeInTheDocument();
      });

      it("removes it once confirmed", async () => {
        const api = open("coordinator", { [`DELETE ${row("r1")}`]: { planningStarted: false } });
        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        await userEvent.click(within(dialog()).getByRole("button", { name: "Remove", hidden: true }));

        await waitFor(() => expect(screen.queryByText("Projector")).not.toBeInTheDocument());
        expect(api.sent(`DELETE ${row("r1")}`)).toHaveLength(1);
        expect(screen.getByText("Lectern")).toBeInTheDocument();
        expect(dialog().open).toBe(false);
      });

      it("keeps it when the confirmation is cancelled", async () => {
        const api = open();
        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

        expect(screen.getByText("Projector")).toBeInTheDocument();
        expect(api.sent(`DELETE ${row("r1")}`)).toHaveLength(0);
      });

      it.each([
        ["the server's reason", reply(400, { error: "Cannot update equipment for a completed, cancelled, or rejected event" }), "Cannot update equipment for a completed"],
        ["a general message when there is none", reply(500, {}), "Could not remove this row."],
        ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server."],
      ])("shows %s when the removal fails", async (_case, answer, message) => {
        open("coordinator", { [`DELETE ${row("r1")}`]: answer });
        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        await userEvent.click(within(dialog()).getByRole("button", { name: "Remove", hidden: true }));

        expect(await screen.findByText(message, { exact: false })).toBeInTheDocument();
        expect(dialog().open).toBe(false);
      });
    });

    describe("adding a row", () => {
      const picker = () => within(addForm()).getByLabelText("Equipment");
      const add = () => userEvent.click(within(addForm()).getByRole("button", { name: "Add" }));
      const optionLabels = () => within(picker()).getAllByRole("option").map((o) => o.textContent);

      it("offers only catalogue items the event has not already requested", async () => {
        open();
        await itemRow("Projector");

        await waitFor(() => expect(optionLabels()).toEqual(["Choose an item", "Microphone — audio"]));
      });

      it("adds the item and resets the form", async () => {
        const mic = request("r3", catalogue[2], { quantityRequested: 4, technicalRequirements: "Handheld" });
        const api = open("coordinator", { [ADD]: reply(201, mic) });
        await itemRow("Projector");
        await waitFor(() => expect(picker()).toBeEnabled());

        set(picker(), "eq-mic");
        set(within(addForm()).getByLabelText("Quantity"), "4");
        set(within(addForm()).getByLabelText("Technical requirements"), "Handheld");
        await add();

        expect(await itemRow("Microphone")).toHaveTextContent("audio");
        expect(api.sent(ADD)[0].body).toEqual({
          equipmentId: "eq-mic",
          quantityRequested: 4,
          technicalRequirements: "Handheld",
        });
        expect(screen.getByText("3 items")).toBeInTheDocument();
        expect(picker()).toHaveValue("");
        expect(within(addForm()).getByLabelText("Quantity")).toHaveValue(1);
      });

      it("refuses to add with no item chosen", async () => {
        const api = open();
        await itemRow("Projector");
        await waitFor(() => expect(picker()).toBeEnabled());

        await add();

        expect(within(addForm()).getByRole("alert")).toHaveTextContent("Choose an item to add.");
        expect(api.sent(ADD)).toHaveLength(0);
      });

      it.each(["0", "", "2.5"])("refuses a quantity of %j", async (quantity) => {
        const api = open();
        await itemRow("Projector");
        await waitFor(() => expect(picker()).toBeEnabled());

        set(picker(), "eq-mic");
        set(within(addForm()).getByLabelText("Quantity"), quantity);
        await add();

        expect(within(addForm()).getByRole("alert")).toHaveTextContent("Enter a whole number, at least 1.");
        expect(api.sent(ADD)).toHaveLength(0);
      });

      it.each([
        ["the server's reason", reply(400, { error: "This equipment has been retired and can no longer be requested" }), "This equipment has been retired"],
        ["a general message when there is none", reply(500, {}), "Could not add this item."],
        ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server."],
      ])("shows %s when the add fails, and keeps what was typed", async (_case, answer, message) => {
        open("coordinator", { [ADD]: answer });
        await itemRow("Projector");
        await waitFor(() => expect(picker()).toBeEnabled());

        set(picker(), "eq-mic");
        await add();

        expect(await within(addForm()).findByRole("alert")).toHaveTextContent(message);
        expect(picker()).toHaveValue("eq-mic");
      });

      it("clears the previous add error on the next attempt", async () => {
        open("coordinator", { [ADD]: reply(201, request("r3", catalogue[2])) });
        await itemRow("Projector");
        await waitFor(() => expect(picker()).toBeEnabled());
        await add();
        expect(within(addForm()).getByRole("alert")).toBeInTheDocument();

        set(picker(), "eq-mic");
        await add();

        await itemRow("Microphone");
        expect(within(addForm()).queryByRole("alert")).not.toBeInTheDocument();
      });

      it("waits for the catalogue before it can be used", async () => {
        open("coordinator", { "GET /api/equipment": () => new Promise(() => {}) });
        await itemRow("Projector");

        expect(picker()).toBeDisabled();
        expect(within(picker()).getByRole("option", { name: "Loading…" })).toBeInTheDocument();
        expect(within(addForm()).getByRole("button", { name: "Add" })).toBeDisabled();
      });

      it.each([
        ["answers with an error", reply(500, {})],
        ["cannot be reached", () => Promise.reject(new Error("offline"))],
      ])("stays disabled, with the list still usable, when the catalogue %s", async (_case, answer) => {
        open("coordinator", { "GET /api/equipment": answer });

        const projector = await itemRow("Projector");

        expect(within(addForm()).getByRole("button", { name: "Add" })).toBeDisabled();
        expect(within(projector).getByLabelText("Quantity")).toBeEnabled();
      });

      describe("on a multi-session event", () => {
        const sessions = [
          { id: "s1", label: "Day 1", startsAt: "2027-03-04T01:00:00.000Z", endsAt: "2027-03-04T05:00:00.000Z" },
          { id: "s2", label: null, startsAt: "2027-03-05T01:00:00.000Z", endsAt: "2027-03-05T05:00:00.000Z" },
        ];
        const sessionPicker = () => within(addForm()).getByLabelText("Session");

        function openMultiSession(routes: Record<string, unknown> = {}) {
          return open("coordinator", {
            [EVENT]: event({ sessions }),
            // Projector for the whole event; Lectern for Day 1.
            [LIST]: [projectorRow(), lecternRow({ session: sessions[0] })],
            ...routes,
          });
        }

        it("has no session picker on an ordinary event", async () => {
          open();
          await itemRow("Projector");

          expect(within(addForm()).queryByLabelText("Session")).not.toBeInTheDocument();
        });

        it("offers 'Whole event' and each session", async () => {
          openMultiSession();
          await itemRow("Projector");

          const options = within(sessionPicker()).getAllByRole("option").map((o) => o.textContent);

          expect(options[0]).toBe("Whole event");
          expect(options[1]).toMatch(/^Day 1 — /);
          expect(options).toHaveLength(3);
        });

        it("offers an item again for a session that has not requested it", async () => {
          openMultiSession();
          await itemRow("Projector");
          await waitFor(() => expect(picker()).toBeEnabled());
          // Whole event: Projector is taken, Lectern (Day 1 only) is still free.
          expect(optionLabels()).toEqual(["Choose an item", "Lectern", "Microphone — audio"]);

          set(sessionPicker(), "s1");

          expect(optionLabels()).toEqual(["Choose an item", "Projector — av", "Microphone — audio"]);
        });

        it("sends the chosen session with the request", async () => {
          const api = openMultiSession({ [ADD]: reply(201, request("r3", catalogue[2], { session: sessions[1] })) });
          await itemRow("Projector");
          await waitFor(() => expect(picker()).toBeEnabled());

          set(sessionPicker(), "s2");
          set(picker(), "eq-mic");
          await add();

          await waitFor(() => expect(api.sent(ADD)).toHaveLength(1));
          expect(api.sent(ADD)[0].body).toEqual({ equipmentId: "eq-mic", quantityRequested: 1, sessionId: "s2" });
        });

        it("un-chooses an item when the session is switched to one that already has it", async () => {
          openMultiSession();
          await itemRow("Projector");
          await waitFor(() => expect(picker()).toBeEnabled());
          set(picker(), "eq-lectern");

          set(sessionPicker(), "s1");

          expect(picker()).toHaveValue("");
        });

        it("keeps the chosen item when the new session does not have it", async () => {
          openMultiSession();
          await itemRow("Projector");
          await waitFor(() => expect(picker()).toBeEnabled());
          set(picker(), "eq-mic");

          set(sessionPicker(), "s2");

          expect(picker()).toHaveValue("eq-mic");
        });
      });
    });
  });

  describe("Technical Support's notes on a line", () => {
    it.each(["coordinator", "organiser", "tech_support"])("are shown to %s on the item they are about", async (role) => {
      open(role, { [LIST]: [projectorRow({ staffNotes: "Spare unit on standby." }), lecternRow({ staffNotes: null })] });

      expect(await itemRow("Projector")).toHaveTextContent("Technical Support notes: Spare unit on standby.");
      expect(await itemRow("Lectern")).not.toHaveTextContent("Technical Support notes");
    });
  });

  describe("on an approved event, where the first change begins planning", () => {
    const approved = (routes: Record<string, unknown> = {}) =>
      open("coordinator", { [EVENT]: event({ status: "approved" }), ...routes });
    const picker = () => within(addForm()).getByLabelText("Equipment");
    const add = () => userEvent.click(within(addForm()).getByRole("button", { name: "Add" }));
    const proceed = () =>
      userEvent.click(within(planningDialog()).getByRole("button", { name: "Continue", hidden: true }));
    const mic = (extra = {}) => ({ ...request("r3", catalogue[2]), ...extra });
    async function chooseMic() {
      await itemRow("Projector");
      await waitFor(() => expect(picker()).toBeEnabled());
      set(picker(), "eq-mic");
    }

    describe("adding", () => {
      it("asks first, and sends nothing until the coordinator continues", async () => {
        const api = approved({ [ADD]: reply(201, mic({ planningStarted: true })) });
        await chooseMic();

        await add();

        expect(planningDialog().open).toBe(true);
        expect(planningDialog()).toHaveTextContent("it will move from Approved to Planning");
        expect(api.sent(ADD)).toHaveLength(0);
      });

      it("on Continue, adds the item and says planning has started", async () => {
        const api = approved({ [ADD]: reply(201, mic({ planningStarted: true })) });
        await chooseMic();
        await add();

        await proceed();

        expect(await itemRow("Microphone")).toBeInTheDocument();
        expect(screen.getByText("Planning has started")).toBeInTheDocument();
        expect(api.sent(ADD)).toHaveLength(1);
        expect(planningDialog().open).toBe(false);
      });

      it("on Cancel, adds nothing and keeps what was chosen", async () => {
        const api = approved({ [ADD]: reply(201, mic({ planningStarted: true })) });
        await chooseMic();
        await add();

        await userEvent.click(within(planningDialog()).getByRole("button", { name: "Cancel", hidden: true }));

        expect(planningDialog().open).toBe(false);
        expect(api.sent(ADD)).toHaveLength(0);
        expect(picker()).toHaveValue("eq-mic");
        expect(screen.queryByText("Planning has started")).not.toBeInTheDocument();
      });

      it("does not ask about an addition the form refuses", async () => {
        approved();
        await itemRow("Projector");

        await add();

        expect(planningDialog().open).toBe(false);
        expect(within(addForm()).getByRole("alert")).toBeInTheDocument();
      });

      it("does not ask again once planning has begun", async () => {
        const api = approved({ [ADD]: reply(201, mic({ planningStarted: true })) });
        await chooseMic();
        await add();
        await proceed();
        await itemRow("Microphone");
        const projector = await itemRow("Projector");
        api.on(`PATCH ${row("r1")}`, projectorRow({ quantityRequested: 5, planningStarted: false }));

        set(within(projector).getByLabelText("Quantity"), "5");
        await userEvent.click(within(projector).getByRole("button", { name: "Save" }));

        await waitFor(() => expect(api.sent(`PATCH ${row("r1")}`)).toHaveLength(1));
        expect(planningDialog().open).toBe(false);
      });

      it("says nothing about planning when the server reports it had already begun", async () => {
        approved({ [ADD]: reply(201, mic({ planningStarted: false })) });
        await chooseMic();
        await add();

        await proceed();

        expect(await itemRow("Microphone")).toBeInTheDocument();
        expect(screen.queryByText("Planning has started")).not.toBeInTheDocument();
      });
    });

    describe("saving a change to a row", () => {
      const PATCH = `PATCH ${row("r1")}`;
      async function changeQuantity(quantity = "5") {
        const projector = await itemRow("Projector");
        set(within(projector).getByLabelText("Quantity"), quantity);
        await userEvent.click(within(projector).getByRole("button", { name: "Save" }));
        return projector;
      }

      it("asks first, then saves and says planning has started", async () => {
        const api = approved({ [PATCH]: projectorRow({ quantityRequested: 5, planningStarted: true }) });

        await changeQuantity();
        expect(planningDialog().open).toBe(true);
        expect(api.sent(PATCH)).toHaveLength(0);
        await proceed();

        expect(await screen.findByText("Planning has started")).toBeInTheDocument();
        expect(api.sent(PATCH)[0].body).toMatchObject({ quantityRequested: 5 });
      });

      it("saves nothing when the question is cancelled, and keeps the edit", async () => {
        const api = approved({ [PATCH]: projectorRow({ quantityRequested: 5 }) });

        const projector = await changeQuantity();
        await userEvent.click(within(planningDialog()).getByRole("button", { name: "Cancel", hidden: true }));

        expect(api.sent(PATCH)).toHaveLength(0);
        expect(within(projector).getByLabelText("Quantity")).toHaveValue(5);
        expect(within(projector).getByRole("button", { name: "Save" })).toBeInTheDocument();
      });

      it("does not ask about a quantity it refuses", async () => {
        approved();

        const projector = await changeQuantity("0");

        expect(planningDialog().open).toBe(false);
        expect(within(projector).getByRole("alert")).toHaveTextContent("Enter a whole number, at least 1.");
      });
    });

    describe("removing a row", () => {
      const DELETE = `DELETE ${row("r1")}`;

      it("asks once, in the removal question itself, not a second time", async () => {
        approved({ [DELETE]: { planningStarted: true } });

        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        expect(dialog()).toHaveTextContent("it will also move from Approved to Planning");
        expect(dialog()).toHaveTextContent("This cannot be undone.");
        expect(planningDialog().open).toBe(false);
      });

      it("removes it and says planning has started", async () => {
        const api = approved({ [DELETE]: { planningStarted: true } });
        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        await userEvent.click(within(dialog()).getByRole("button", { name: "Remove", hidden: true }));

        expect(await screen.findByText("Planning has started")).toBeInTheDocument();
        expect(api.sent(DELETE)).toHaveLength(1);
        expect(screen.queryByText("Projector")).not.toBeInTheDocument();
        expect(planningDialog().open).toBe(false);
      });
    });

    it("never asks on an event already in planning", async () => {
      const api = open("coordinator", { [ADD]: reply(201, mic({ planningStarted: false })) });
      await chooseMic();

      await add();

      expect(await itemRow("Microphone")).toBeInTheDocument();
      expect(api.sent(ADD)).toHaveLength(1);
      expect(planningDialog().open).toBe(false);
    });
  });

  describe("before the request is approved", () => {
    it.each(["submitted", "under_review"])("tells the coordinator a %s request must be approved first, read-only", async (status) => {
      open("coordinator", { [EVENT]: event({ status }) });

      await itemRow("Projector");

      expect(screen.getByText("Equipment can be recorded once this request has been approved.")).toBeInTheDocument();
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Add equipment" })).not.toBeInTheDocument();
    });

    it("does not say so to the organiser, who never records equipment", async () => {
      open("organiser", { [EVENT]: event({ status: "under_review" }) });

      await itemRow("Projector");

      expect(screen.queryByText("Equipment can be recorded once this request has been approved.")).not.toBeInTheDocument();
    });

    it("does not say so once the request is approved", async () => {
      open("coordinator", { [EVENT]: event({ status: "approved" }) });

      await itemRow("Projector");

      expect(screen.queryByText("Equipment can be recorded once this request has been approved.")).not.toBeInTheDocument();
      expect(addForm()).toBeInTheDocument();
    });

    it("gives the reason they cannot see the equipment instead, to a coordinator who is not assigned", async () => {
      open("coordinator", { [EVENT]: event({ status: "under_review" }), [LIST]: reply(403, { error: "forbidden" }) });

      expect(
        await screen.findByText("Only the coordinator assigned to this event can view and manage its equipment requirements.")
      ).toBeInTheDocument();
      expect(screen.queryByText("Equipment can be recorded once this request has been approved.")).not.toBeInTheDocument();
    });
  });

  describe("when equipment can no longer be changed", () => {
    it.each(["completed", "cancelled", "rejected", "withdrawn"])("shows a %s event read-only, even to its coordinator", async (status) => {
      open("coordinator", { [EVENT]: event({ status }) });

      await itemRow("Projector");

      expect(screen.getByText(new RegExp(`This event is ${status} — equipment\\s+requirements can no longer be changed.`))).toBeInTheDocument();
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Add equipment" })).not.toBeInTheDocument();
    });

    it("tells a coordinator who is not assigned why they cannot see the equipment", async () => {
      open("coordinator", { [LIST]: reply(403, { error: "forbidden" }) });

      expect(
        await screen.findByText("Only the coordinator assigned to this event can view and manage its equipment requirements.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Add equipment" })).not.toBeInTheDocument();
      expect(screen.getByText("EVT-000007")).toBeInTheDocument();
    });
  });

  describe("when it cannot be loaded", () => {
    it("says so when the event fails to load", async () => {
      open("coordinator", { [EVENT]: reply(404, {}) });

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this event.");
    });

    it("says so when the equipment list fails to load, and Retry loads again", async () => {
      const api = open("coordinator", { [LIST]: reply(500, {}) });
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load equipment requirements.");

      api.on(LIST, [projectorRow()]);
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await itemRow("Projector")).toBeInTheDocument();
    });

    it("shows a general error when the request fails without a reason", async () => {
      open("coordinator", { [LIST]: () => Promise.reject("offline") });

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("sends the user to log in when their session has expired", async () => {
      open("coordinator", { [LIST]: reply(401, {}) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fequipment"));
    });
  });

  // SPM-62 (AC4, AC6): equipment requirements are
  // important information, so a change to a Confirmed event's equipment moves
  // it back to Planning. Like the edit form, the tab asks first - "Cancel" /
  // "Continue", as its "Begin planning?" question does (SPM-54) - and Remove
  // adds the notice to its own question rather than asking twice. The routes
  // answer `confirmationReverted: true`, and the tab says so afterwards.
  // Decided 2026-10-05, see docs/test-cases/SPM-62_test_cases.json.
  describe("on a Confirmed event, where a change unconfirms it", () => {
    const QUESTION = "Move this event back to Planning?";
    const ASKS =
      "Gala Dinner is Confirmed. Changing its equipment moves it back to Planning so it can be confirmed again.";
    const DONE = "This event is no longer confirmed";
    const DONE_BODY =
      "Changing its equipment moved it back to Planning so it can be confirmed again.";
    const PATCH = `PATCH ${row("r1")}`;
    const DELETE = `DELETE ${row("r1")}`;

    const confirmed = (routes: Record<string, unknown> = {}) =>
      open("coordinator", { [EVENT]: event({ status: "confirmed", title: "Gala Dinner" }), ...routes });
    const mic = (extra = {}) => ({ ...request("r3", catalogue[2]), ...extra });
    const reverted = { planningStarted: false, confirmationReverted: true };
    const question = () => dialog(QUESTION);
    const isAsking = () => screen.queryByText(QUESTION, { selector: "dialog[open] h2" }) !== null;
    const answer = (name: "Cancel" | "Continue") =>
      userEvent.click(within(question()).getByRole("button", { name, hidden: true }));

    async function chooseMicAndAdd() {
      await itemRow("Projector");
      const picker = within(addForm()).getByLabelText("Equipment");
      await waitFor(() => expect(picker).toBeEnabled());
      set(picker, "eq-mic");
      await userEvent.click(within(addForm()).getByRole("button", { name: "Add" }));
    }

    describe("adding", () => {
      it("asks first, saying what will happen, and sends nothing yet", async () => {
        const api = confirmed({ [ADD]: reply(201, mic(reverted)) });

        await chooseMicAndAdd();

        expect(question().open).toBe(true);
        expect(question()).toHaveTextContent(ASKS);
        expect(api.sent(ADD)).toHaveLength(0);
      });

      it("on Cancel, adds nothing and keeps what was chosen", async () => {
        const api = confirmed({ [ADD]: reply(201, mic(reverted)) });
        await chooseMicAndAdd();

        await answer("Cancel");

        expect(question().open).toBe(false);
        expect(api.sent(ADD)).toHaveLength(0);
        expect(within(addForm()).getByLabelText("Equipment")).toHaveValue("eq-mic");
        expect(screen.queryByText(DONE)).not.toBeInTheDocument();
      });

      it("on Continue, adds the item and says the event is no longer confirmed", async () => {
        const api = confirmed({ [ADD]: reply(201, mic(reverted)) });
        await chooseMicAndAdd();

        await answer("Continue");

        expect(await itemRow("Microphone")).toBeInTheDocument();
        expect(screen.getByText(DONE)).toBeInTheDocument();
        expect(screen.getByText(DONE_BODY)).toBeInTheDocument();
        expect(screen.queryByText("Planning has started")).not.toBeInTheDocument();
        expect(api.sent(ADD)).toHaveLength(1);
        expect(question().open).toBe(false);
      });
    });

    it("asks before saving a changed quantity", async () => {
      const api = confirmed({ [PATCH]: { ...projectorRow({ quantityRequested: 5 }), ...reverted } });
      const projector = await itemRow("Projector");
      set(within(projector).getByLabelText("Quantity"), "5");

      await userEvent.click(within(projector).getByRole("button", { name: "Save" }));

      expect(question().open).toBe(true);
      expect(api.sent(PATCH)).toHaveLength(0);
      await answer("Continue");
      expect(await screen.findByText(DONE)).toBeInTheDocument();
      expect(api.sent(PATCH)[0].body).toMatchObject({ quantityRequested: 5 });
    });

    describe("removing", () => {
      it("says so in the removal question itself, not a second time", async () => {
        confirmed({ [DELETE]: reverted });

        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        expect(dialog()).toHaveTextContent(
          "It will also move from Confirmed back to Planning."
        );
        expect(isAsking()).toBe(false);
      });

      it("removes it and says the event is no longer confirmed", async () => {
        const api = confirmed({ [DELETE]: reverted });
        await userEvent.click(within(await itemRow("Projector")).getByRole("button", { name: "Remove" }));

        await userEvent.click(within(dialog()).getByRole("button", { name: "Remove", hidden: true }));

        expect(await screen.findByText(DONE)).toBeInTheDocument();
        expect(api.sent(DELETE)).toHaveLength(1);
      });
    });

    it("never asks, or says so, on an event that is not Confirmed", async () => {
      const api = open("coordinator", { [ADD]: reply(201, mic({ planningStarted: false, confirmationReverted: false })) });

      await chooseMicAndAdd();

      expect(await itemRow("Microphone")).toBeInTheDocument();
      expect(isAsking()).toBe(false);
      expect(screen.queryByText(DONE)).not.toBeInTheDocument();
      expect(api.sent(ADD)).toHaveLength(1);
    });
  });
});

describe("Equipment request (availability and reserve)", () => {
  const AVAILABILITY = `GET /api/events/${REF}/equipment/availability`;
  const reserveRoute = (id: string) => `POST /api/events/${REF}/equipment/${id}/reserve`;

  function result(overrides: Record<string, unknown> = {}) {
    return {
      status: "available",
      total: 10,
      inMaintenance: 1,
      reservedElsewhere: 2,
      available: 7,
      requested: 4,
      shortfall: 0,
      heldBy: [],
      leavesAt: "2027-03-03T23:00:00.000Z",
      ...overrides,
    };
  }

  function line(requestId: string, overrides: Record<string, unknown> = {}) {
    return {
      requestId,
      requestStatus: "requested",
      quantityRequested: 4,
      quantityReserved: null,
      equipmentName: "Projector",
      sessionLabel: null,
      venueChosen: true,
      transferMinutes: 120,
      result: result(),
      technicalRequirements: null,
      staffNotes: null,
      reviewedByName: null,
      reviewedAt: null,
      ...overrides,
    };
  }

  function open(lines: object[] = [line("r1")], routes: Record<string, unknown> = {}, role = "tech_support") {
    setRoute(`/equipment/requests/${REF}`, { id: REF });
    const api = mockApi({
      ...signedInAs(role),
      [EVENT]: event(),
      [AVAILABILITY]: { lines, allAvailable: lines.every((l) => (l as { result: { status: string } | null }).result?.status === "available") },
      ...routes,
    });
    render(<EquipmentRequestDetailPage />);
    return api;
  }

  const lineRow = async (name = "Projector") => (await screen.findByText(name)).closest("li") as HTMLElement;

  it("sends an anonymous visitor to log in", async () => {
    setRoute(`/equipment/requests/${REF}`, { id: REF });
    mockApi(signedOut());

    render(<EquipmentRequestDetailPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests%2FEVT-000007"));
  });

  it("tells any other role that availability is Technical Support's, and explains the refusal", async () => {
    open([], { [AVAILABILITY]: reply(403, {}) }, "coordinator");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only Technical Support Staff can check equipment availability."
    );
    expect(screen.getByText("Equipment availability is for Technical Support Staff.")).toBeInTheDocument();
  });

  describe("what each line shows", () => {
    it("the sum behind the number available", async () => {
      open();

      const row = await lineRow();

      expect(row).toHaveTextContent("10 total − 1 out of service − 2 reserved elsewhere = 7 available for these dates");
      expect(row).toHaveTextContent("Available");
      expect(screen.getByText(/Gala Dinner · /)).toBeInTheDocument();
    });

    it("what was requested and reserved, with a dash until something is reserved", async () => {
      open([line("r1"), line("r2", { equipmentName: "Lectern", quantityReserved: 3, requestStatus: "partially_fulfilled" })]);

      expect(await lineRow()).toHaveTextContent("Requested4Reserved—");
      expect(await lineRow("Lectern")).toHaveTextContent("Requested4Reserved3");
    });

    it("the session a line belongs to", async () => {
      open([line("r1", { sessionLabel: "Day 1" })]);

      expect(await lineRow()).toHaveTextContent("Projector · Day 1");
    });

    it("how short a partly available line is", async () => {
      open([line("r1", { result: result({ status: "partial", available: 3, shortfall: 1 }) })]);

      const row = await lineRow();

      expect(row).toHaveTextContent("4 requested, 3 available.");
      expect(row).toHaveTextContent("Partial");
    });

    it("who holds an unavailable item, and until when", async () => {
      open([
        line("r1", {
          result: result({
            status: "unavailable",
            available: 0,
            heldBy: [
              { eventTitle: "Town Hall", quantity: 7, availableAgainFrom: "2027-03-04T16:00:00.000Z" },
              { eventTitle: "Summit", quantity: 1, availableAgainFrom: "2027-03-06T16:00:00.000Z" },
            ],
          }),
        }),
      ]);

      const row = await lineRow();

      expect(row).toHaveTextContent("Held by Town Hall (7 units) until 5 Mar.");
      expect(row).toHaveTextContent("Held by Summit (1 unit) until 7 Mar.");
    });

    it.each([
      [120, "2 hours before the event for transfer and preparation."],
      [60, "1 hour before the event for transfer and preparation."],
      [90, "1.5 hours before the event for transfer and preparation."],
    ])("the transfer time of %i minutes as %j", async (transferMinutes, text) => {
      open([line("r1", { transferMinutes })]);

      expect(await lineRow()).toHaveTextContent(text);
    });

    it("that equipment already at the venue needs no transfer", async () => {
      open([line("r1", { transferMinutes: 0 })]);

      expect(await lineRow()).toHaveTextContent(/Already at the venue: needed from /);
    });

    it("that transfer time is not counted until a venue is chosen", async () => {
      open([line("r1", { venueChosen: false, transferMinutes: 0 })]);

      expect(await lineRow()).toHaveTextContent("Venue not yet chosen — transfer time not included.");
    });

    it("that a line cannot be checked while the event has no dates", async () => {
      open([line("r1", { result: null })]);

      const row = await lineRow();

      expect(row).toHaveTextContent("Cannot be checked yet — the event has no dates.");
      expect(within(row).queryByRole("button", { name: "Reserve" })).not.toBeInTheDocument();
    });
  });

  describe("the summary above the lines", () => {
    it("warns when not everything is available", async () => {
      open([line("r1", { result: result({ status: "partial", available: 3 }) })]);

      expect(await screen.findByText("Not everything requested is available.")).toBeInTheDocument();
    });

    it("says nothing when everything is available", async () => {
      open();

      await lineRow();

      expect(screen.queryByText("Not everything requested is available.")).not.toBeInTheDocument();
    });

    it("shows one status for the request when every line is at the same stage", async () => {
      open([line("r1", { requestStatus: "reserved" }), line("r2", { equipmentName: "Lectern", requestStatus: "reserved" })]);

      await lineRow();
      const header = screen.getByRole("heading", { name: "Requested items" }).closest("div.flex") as HTMLElement;

      expect(header).toHaveTextContent("Reserved");
    });

    it("shows no single status when the lines are at different stages", async () => {
      open([line("r1"), line("r2", { equipmentName: "Lectern", requestStatus: "reserved" })]);

      await lineRow();
      const header = screen.getByRole("heading", { name: "Requested items" }).closest("div.flex") as HTMLElement;

      expect(header).toHaveTextContent(/^Requested items$/);
    });

    it("says so when the event has requested no equipment", async () => {
      open([]);

      expect(await screen.findByText("No equipment requested")).toBeInTheDocument();
      expect(screen.queryByText("Not everything requested is available.")).not.toBeInTheDocument();
    });
  });

  describe("reserving", () => {
    it("reserves with one click, confirms the amount, and reloads every line", async () => {
      const api = open([line("r1")], { [reserveRoute("r1")]: { id: "r1", quantityReserved: 4, status: "reserved" } });
      const row = await lineRow();

      await userEvent.click(within(row).getByRole("button", { name: "Reserve" }));

      expect(await screen.findByText("Reservation saved: 4 reserved.")).toBeInTheDocument();
      expect(api.sent(reserveRoute("r1"))[0].body).toBeUndefined();
      await waitFor(() => expect(api.sent(AVAILABILITY)).toHaveLength(2));
    });

    it("confirms even when the server does not say how many", async () => {
      open([line("r1")], { [reserveRoute("r1")]: {} });

      await userEvent.click(within(await lineRow()).getByRole("button", { name: "Reserve" }));

      expect(await screen.findByText("Reservation saved.")).toBeInTheDocument();
    });

    it("confirms when the server's answer has no body at all", async () => {
      open([line("r1")], { [reserveRoute("r1")]: reply(200) });

      await userEvent.click(within(await lineRow()).getByRole("button", { name: "Reserve" }));

      expect(await screen.findByText("Reservation saved.")).toBeInTheDocument();
    });

    it("shows 'Reserving…' and cannot be clicked twice while in flight", async () => {
      let finish: (value: unknown) => void = () => {};
      const api = open([line("r1")], { [reserveRoute("r1")]: () => new Promise((resolve) => (finish = resolve)) });

      await userEvent.click(within(await lineRow()).getByRole("button", { name: "Reserve" }));

      expect(within(await lineRow()).getByRole("button", { name: "Reserving…" })).toBeDisabled();
      finish({ quantityReserved: 4 });
      await screen.findByText("Reservation saved: 4 reserved.");
      expect(api.sent(reserveRoute("r1"))).toHaveLength(1);
    });

    it.each([
      ["the server's reason", reply(400, { error: "Nothing is available for these dates any more." }), "Nothing is available for these dates any more."],
      ["a general message when there is none", reply(500), "Could not reserve this item."],
      ["a network failure", () => Promise.reject(new Error("offline")), "Could not reserve this item."],
    ])("shows %s against the line it belongs to", async (_case, answer, message) => {
      open([line("r1"), line("r2", { equipmentName: "Lectern" })], { [reserveRoute("r1")]: answer });

      await userEvent.click(within(await lineRow()).getByRole("button", { name: "Reserve" }));

      expect(await within(await lineRow()).findByText(message)).toBeInTheDocument();
      expect(within(await lineRow("Lectern")).queryByText(message)).not.toBeInTheDocument();
    });

    it("sends the user to log in when their session expires mid-reservation", async () => {
      open([line("r1")], { [reserveRoute("r1")]: reply(401, {}) });

      await userEvent.click(within(await lineRow()).getByRole("button", { name: "Reserve" }));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests%2FEVT-000007"));
    });

    it.each([
      ["nothing is available", { result: result({ status: "unavailable", available: 0 }) }],
      ["it is already fully reserved", { requestStatus: "reserved", quantityReserved: 4 }],
      ["the request was withdrawn", { requestStatus: "cancelled" }],
    ])("is not offered for a line where %s", async (_case, overrides) => {
      open([line("r1", overrides)]);

      expect(within(await lineRow()).queryByRole("button", { name: "Reserve" })).not.toBeInTheDocument();
    });

    it("is still offered for a partly fulfilled line, since more may have freed up", async () => {
      open([line("r1", { requestStatus: "partially_fulfilled", quantityReserved: 2 })]);

      expect(within(await lineRow()).getByRole("button", { name: "Reserve" })).toBeInTheDocument();
    });

    it("is not offered for a confirmed event, whose equipment is final", async () => {
      open([line("r1")], { [EVENT]: event({ status: "confirmed" }) });

      const row = await lineRow();

      expect(
        screen.getByText("This event is confirmed — its equipment is final. A change now goes through a change request.")
      ).toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "Reserve" })).not.toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
    });

    it.each([
      ["postponed", "postponed"],
      ["under_review", "under review"],
    ])("is not offered for an event that is %s, and the page says when it is", async (status, words) => {
      open([line("r1")], { [EVENT]: event({ status }) });

      const row = await lineRow();

      expect(
        screen.getByText(`This event is ${words} — equipment can be reserved and updated while the event is in planning.`)
      ).toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "Reserve" })).not.toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
    });

    it("says nothing of the kind while the event is in planning", async () => {
      open();

      await lineRow();

      expect(screen.queryByText(/This event is/)).not.toBeInTheDocument();
    });
  });

  describe("the coordinator's requirements and Technical Support's own review", () => {
    it("are shown on each line, with who last updated it and when", async () => {
      open([
        line("r1", {
          technicalRequirements: "HDMI on stage left",
          staffNotes: "Spare unit checked",
          reviewedByName: "Tessa Lim",
          reviewedAt: "2027-02-01T02:30:00.000Z",
        }),
      ]);

      const row = await lineRow();

      expect(row).toHaveTextContent("Technical requirements: HDMI on stage left");
      expect(row).toHaveTextContent("Technical Support notes: Spare unit checked");
      expect(row).toHaveTextContent("Last updated by Tessa Lim, 1 Feb 2027, 10:30");
    });

    it("are dashed out, with no 'last updated', on a line nobody has touched", async () => {
      open();

      const row = await lineRow();

      expect(row).toHaveTextContent("Technical requirements: —");
      expect(row).toHaveTextContent("Technical Support notes: —");
      expect(row).not.toHaveTextContent("Last updated by");
    });

    it.each([
      ["no name", { reviewedByName: null, reviewedAt: "2027-02-01T02:30:00.000Z" }],
      ["no time", { reviewedByName: "Tessa Lim", reviewedAt: null }],
    ])("says nothing about the last update when it has %s", async (_case, review) => {
      open([line("r1", review)]);

      expect(await lineRow()).not.toHaveTextContent("Last updated by");
    });

    it("keeps what Technical Support decided apart from what the stock allows", async () => {
      open([
        line("r1", { requestStatus: "unavailable", result: result({ status: "available" }) }),
        line("r2", { equipmentName: "Lectern", requestStatus: "under_review", result: result({ status: "unavailable", available: 0 }) }),
        line("r3", { equipmentName: "Microphone", result: null }),
      ]);

      expect(await lineRow()).toHaveTextContent("StatusCannot be providedAvailabilityAvailable");
      expect(await lineRow("Lectern")).toHaveTextContent("StatusUnder reviewAvailabilityNone available");
      expect(await lineRow("Microphone")).toHaveTextContent("StatusRequestedAvailability—");
    });
  });

  describe("updating a line", () => {
    const fulfilment = (id: string) => `PATCH /api/events/${REF}/equipment/${id}/fulfilment`;
    const startUpdate = async (name = "Projector") => {
      const row = await lineRow(name);
      await userEvent.click(within(row).getByRole("button", { name: "Update" }));
      return row;
    };
    const status = () => screen.getByLabelText("Fulfilment status");
    const notes = () => screen.getByLabelText("Technical notes");
    const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));
    const statusOptions = () => within(status()).getAllByRole("option").map((o) => o.textContent);

    it.each(["requested", "under_review", "unavailable", "reserved", "partially_fulfilled"])(
      "is offered on a line that is %s",
      async (requestStatus) => {
        open([line("r1", { requestStatus })]);

        expect(within(await lineRow()).getByRole("button", { name: "Update" })).toBeInTheDocument();
      }
    );

    it("is not offered on a line the coordinator has withdrawn", async () => {
      open([line("r1", { requestStatus: "cancelled" })]);

      expect(within(await lineRow()).queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
    });

    it("opens with the line's current status and notes, in place of the Update button", async () => {
      open([line("r1", { requestStatus: "under_review", staffNotes: "Checking the spare." })]);

      const row = await startUpdate();

      expect(status()).toHaveValue("under_review");
      expect(notes()).toHaveValue("Checking the spare.");
      expect(within(row).queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
    });

    it("offers the statuses that can be picked by hand, never the ones only Reserve sets", async () => {
      open();

      await startUpdate();

      expect(statusOptions()).toEqual(["Requested", "Under review", "Cannot be provided"]);
      expect(notes()).toHaveValue("");
    });

    it.each([
      ["reserved", ["Reserved", "Cannot be provided"]],
      ["partially_fulfilled", ["Partially fulfilled", "Cannot be provided"]],
    ])("lets a %s line only stay as it is or be marked as not providable", async (requestStatus, options) => {
      open([line("r1", { requestStatus, quantityReserved: 2 })]);

      await startUpdate();

      expect(statusOptions()).toEqual(options);
    });

    it("asks for a reason once 'Cannot be provided' is chosen", async () => {
      open();
      await startUpdate();
      expect(screen.getByText(/Anything the Coordinator or the team should know/)).toBeInTheDocument();

      set(status(), "unavailable");

      expect(screen.getByText("Required: why it cannot be provided, and any alternative you can suggest.")).toBeInTheDocument();
    });

    it("is open on one line at a time", async () => {
      open([line("r1"), line("r2", { equipmentName: "Lectern", staffNotes: "Lectern note" })]);
      await startUpdate();
      set(notes(), "Half-written");

      const lectern = await startUpdate("Lectern");

      expect(screen.getAllByLabelText("Technical notes")).toHaveLength(1);
      expect(within(lectern).getByLabelText("Technical notes")).toHaveValue("Lectern note");
      expect(within(await lineRow()).getByRole("button", { name: "Update" })).toBeInTheDocument();
    });

    it("saves the status and notes, confirms it, and reloads every line", async () => {
      const api = open([line("r1")], { [fulfilment("r1")]: { id: "r1" } });
      await startUpdate();
      set(status(), "under_review");
      set(notes(), "Checking the spare unit.");

      await save();

      expect(await screen.findByText("Update saved.")).toBeInTheDocument();
      expect(api.sent(fulfilment("r1")).map((c) => c.body)).toEqual([
        { status: "under_review", staffNotes: "Checking the spare unit." },
      ]);
      await waitFor(() => expect(api.sent(AVAILABILITY)).toHaveLength(2));
      expect(screen.queryByLabelText("Technical notes")).not.toBeInTheDocument();
    });

    it("clears the confirmation when the line is updated again", async () => {
      open([line("r1")], { [fulfilment("r1")]: { id: "r1" } });
      await startUpdate();
      await save();
      await screen.findByText("Update saved.");

      await startUpdate();

      expect(screen.queryByText("Update saved.")).not.toBeInTheDocument();
    });

    it.each([
      ["'Cannot be provided' with no reason", "unavailable", "   ", "Give a reason when equipment cannot be provided."],
      ["notes over 500 characters", "under_review", "x".repeat(501), "Technical notes must be 500 characters or fewer."],
    ])("refuses %s under the notes field, without asking the server", async (_case, next, text, message) => {
      const api = open([line("r1")], { [fulfilment("r1")]: { id: "r1" } });
      await startUpdate();
      set(status(), next);
      set(notes(), text);

      await save();

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(notes()).toBeInvalid();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(api.sent(fulfilment("r1"))).toHaveLength(0);
    });

    it("clears that complaint as soon as the panel is edited", async () => {
      open();
      await startUpdate();
      set(status(), "unavailable");
      await save();
      expect(screen.getByText("Give a reason when equipment cannot be provided.")).toBeInTheDocument();

      set(notes(), "Both units are out for repair.");

      expect(screen.queryByText("Give a reason when equipment cannot be provided.")).not.toBeInTheDocument();
      expect(notes()).toBeValid();
    });

    it("Cancel closes the panel and forgets what was typed", async () => {
      const api = open([line("r1")], { [fulfilment("r1")]: { id: "r1" } });
      await startUpdate();
      set(status(), "under_review");
      set(notes(), "Half-written");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByLabelText("Technical notes")).not.toBeInTheDocument();
      await startUpdate();
      expect(status()).toHaveValue("requested");
      expect(notes()).toHaveValue("");
      expect(api.sent(fulfilment("r1"))).toHaveLength(0);
    });

    describe("when the server refuses", () => {
      it("shows a complaint about the notes under the notes field", async () => {
        open([line("r1")], {
          [fulfilment("r1")]: reply(400, { error: "Technical notes must be 500 characters or fewer.", field: "staffNotes" }),
        });
        await startUpdate();

        await save();

        expect(await screen.findByText("Technical notes must be 500 characters or fewer.")).toBeInTheDocument();
        expect(notes()).toBeInvalid();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it.each([
        ["the server's reason", reply(409, { error: "This request was changed by someone else. Reload and try again." }), "This request was changed by someone else. Reload and try again."],
        ["a general message when it gives none", reply(500, {}), "Could not save this update."],
        ["a general message when its answer is unreadable", reply(500), "Could not save this update."],
        ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server."],
      ])("shows %s above the panel, which stays open", async (_case, answer, message) => {
        const api = open([line("r1")], { [fulfilment("r1")]: answer });
        const row = await startUpdate();
        set(notes(), "Kept");

        await save();

        expect(await within(row).findByRole("alert")).toHaveTextContent(message);
        expect(notes()).toHaveValue("Kept");
        expect(notes()).toBeValid();
        expect(screen.queryByText("Update saved.")).not.toBeInTheDocument();
        expect(api.sent(AVAILABILITY)).toHaveLength(1);
      });

      it("sends the user to log in when their session expired", async () => {
        open([line("r1")], { [fulfilment("r1")]: reply(401, {}) });
        await startUpdate();

        await save();

        await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests%2FEVT-000007"));
        expect(screen.queryByText("Update saved.")).not.toBeInTheDocument();
      });
    });
  });

  describe("when it cannot be loaded", () => {
    it.each([
      ["the event", () => ({ [EVENT]: reply(404, {}) })],
      ["its equipment, which Technical Support only sees from planning on", () => ({ [AVAILABILITY]: reply(404, {}) })],
    ])("says so when %s is not found", async (_case, routes) => {
      open([], routes());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This event was not found, or its equipment is not ready for Technical Support yet."
      );
    });

    it("offers a Retry that loads again", async () => {
      const api = open([], { [AVAILABILITY]: reply(500, {}) });
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this equipment request.");

      api.on(AVAILABILITY, { lines: [line("r1")], allAvailable: true });
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await lineRow()).toBeInTheDocument();
    });

    it("shows a general error when the request fails without a reason", async () => {
      open([], { [AVAILABILITY]: () => Promise.reject("offline") });

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("sends the user to log in when their session has expired", async () => {
      open([], { [EVENT]: reply(401, {}) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests%2FEVT-000007"));
    });
  });
});

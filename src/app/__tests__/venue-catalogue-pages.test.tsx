// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import VenuesPage from "@/app/venues/page";
import NewVenuePage from "@/app/venues/new/page";
import EditVenuePage from "@/app/venues/[id]/edit/page";
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
  type MockApi,
} from "@/test/ui";

const set = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });
const field = (label: RegExp | string, scope: HTMLElement = document.body) => within(scope).getByLabelText(label);
const button = (name: string | RegExp, scope: HTMLElement = document.body) => within(scope).getByRole("button", { name });
const group = (name: string) => screen.getByRole("group", { name });

const facilities = [
  { id: "f-stage", name: "Stage", category: "facility" },
  { id: "f-loop", name: "Hearing loop", category: "accessibility" },
];

describe("Venues catalogue", () => {
  const hallA = { id: "v1", code: "HALL-A", name: "Hall A", building: "Tower 1", floor: "3", maxCapacity: 300, opensAt: "08:00", closesAt: "22:00", isActive: true, layouts: [{ layoutName: "theatre", capacity: 300 }, { layoutName: "banquet", capacity: 180 }] };
  const roomB = { id: "v2", code: "ROOM-B", name: "Room B", building: "Annex", floor: null, maxCapacity: 40, opensAt: "09:00", closesAt: "18:00", isActive: true, layouts: [] };
  const oldHall = { id: "v3", code: "OLD", name: "Old Hall", building: "Tower 1", floor: null, maxCapacity: 100, opensAt: "08:00", closesAt: "22:00", isActive: false, layouts: [{ layoutName: "theatre", capacity: 100 }] };

  function open(role: string, venues: unknown = [hallA, roomB, oldHall]) {
    setRoute("/venues");
    const api = mockApi({ ...signedInAs(role), "GET /api/venues": venues });
    render(<VenuesPage />);
    return api;
  }

  const table = () => screen.findByRole("table", { name: "Venue catalogue" });
  const rowFor = async (name: string) => within(await table()).getByText(name).closest("tr") as HTMLElement;
  const names = async () =>
    within(await table())
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.querySelector("span.font-medium")!.textContent);
  const options = (label: string) => within(screen.getByLabelText(label)).getAllByRole("option").map((o) => o.textContent);

  it.each(ROLES.filter((r) => !["coordinator", "ops_manager", "venue_staff"].includes(r)))(
    "refuses %s without requesting the catalogue",
    async (role) => {
      const api = open(role);

      expect(await screen.findByRole("alert")).toHaveTextContent("The venue catalogue is for ConnectSphere staff.");
      expect(api.sent("GET /api/venues")).toHaveLength(0);
    }
  );

  it("shows each venue's location, capacity, layouts and hours", async () => {
    open("coordinator", [hallA, roomB]);

    const hall = await rowFor("Hall A");
    const room = await rowFor("Room B");

    expect(hall).toHaveTextContent("HALL-A");
    expect(hall).toHaveTextContent("Tower 1 — 3");
    expect(hall).toHaveTextContent("2 (max 300 seated)");
    expect(hall).toHaveTextContent("08:00–22:00");
    expect(room).toHaveTextContent("Annex");
    expect(room).not.toHaveTextContent("Annex —");
    // A room with no layouts is never offered by venue search - say so.
    expect(room).toHaveTextContent("None set");
  });

  it("links every row to that room's availability calendar", async () => {
    open("coordinator", [hallA]);

    expect(within(await rowFor("Hall A")).getByRole("link", { name: "View availability" })).toHaveAttribute(
      "href",
      "/venues/v1/availability"
    );
  });

  describe("read-only, for a coordinator or the Ops Manager", () => {
    it.each(["coordinator", "ops_manager"])("asks for active venues only, as %s", async (role) => {
      const api = open(role, [hallA]);

      await table();

      expect(api.sent("GET /api/venues")[0].url).toBe("/api/venues");
    });

    it("offers no way to add or edit a venue, and no Status column", async () => {
      open("coordinator", [hallA]);
      const hall = await rowFor("Hall A");

      await userEvent.click(within(hall).getByText("Hall A"));

      expect(router.push).not.toHaveBeenCalled();
      expect(screen.queryByRole("link", { name: "Add venue" })).not.toBeInTheDocument();
      expect(within(await table()).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Find a venue" })).toHaveAttribute("href", "/venues/search");
    });

    it("does not offer a Retired filter, since retired venues are never sent", async () => {
      open("coordinator", [hallA]);
      await table();

      expect(options("Show")).toEqual(["All venues", "Active only"]);
    });

    it("says Venue Staff have not added any rooms when the catalogue is empty", async () => {
      open("coordinator", []);

      expect(await screen.findByText("No venues yet")).toBeInTheDocument();
      expect(screen.getByText("Venue Staff have not added any rooms yet.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Add the first venue" })).not.toBeInTheDocument();
    });
  });

  describe("for Venue Staff", () => {
    it("asks for retired venues too, and shows which are retired", async () => {
      const api = open("venue_staff");

      const old = await rowFor("Old Hall");

      expect(api.sent("GET /api/venues")[0].url).toBe("/api/venues?includeRetired=true");
      expect(old).toHaveTextContent("Retired");
      expect(await rowFor("Hall A")).toHaveTextContent("Active");
      expect(screen.getByRole("link", { name: "Add venue" })).toHaveAttribute("href", "/venues/new");
    });

    it("opens a venue's editor when its row is clicked", async () => {
      open("venue_staff");

      await userEvent.click(within(await rowFor("Hall A")).getByText("Hall A"));

      expect(router.push).toHaveBeenCalledWith("/venues/v1/edit");
    });

    it("following the availability link does not also open the editor", async () => {
      open("venue_staff");

      await userEvent.click(within(await rowFor("Hall A")).getByRole("link", { name: "View availability" }));

      expect(router.push).not.toHaveBeenCalled();
    });

    it("pressing Enter on the availability link in a mobile card does not also open the editor", async () => {
      open("venue_staff", [hallA]);
      await table();
      const cardLink = within(screen.getByRole("button")).getByRole("link", { name: "View availability" });

      cardLink.focus();
      await userEvent.keyboard("{Enter}");

      expect(router.push).not.toHaveBeenCalled();
    });

    it("can filter to active or retired venues", async () => {
      open("venue_staff");
      await table();
      expect(options("Show")).toEqual(["Active and retired", "Active only", "Retired only"]);

      await userEvent.selectOptions(screen.getByLabelText("Show"), "Retired only");
      expect(await names()).toEqual(["Old Hall"]);
      await userEvent.selectOptions(screen.getByLabelText("Show"), "Active only");

      expect(await names()).toEqual(["Hall A", "Room B"]);
    });

    it("invites them to add the first venue when the catalogue is empty", async () => {
      open("venue_staff", []);

      expect(await screen.findByText("Add the rooms ConnectSphere can offer so coordinators can book them.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add the first venue" })).toHaveAttribute("href", "/venues/new");
    });
  });

  it("filters by building, offering each building once in alphabetical order", async () => {
    open("venue_staff");
    await table();
    expect(options("Filter by building")).toEqual(["All buildings", "Annex", "Tower 1"]);

    await userEvent.selectOptions(screen.getByLabelText("Filter by building"), "Annex");

    expect(await names()).toEqual(["Room B"]);
  });

  it("says when no venue matches the filters, rather than that there are none", async () => {
    open("venue_staff", [hallA]);
    await table();

    await userEvent.selectOptions(screen.getByLabelText("Show"), "Retired only");

    expect(screen.getByText("No venues match these filters")).toBeInTheDocument();
  });

  it("sends the user to log in when their session has expired", async () => {
    open("coordinator", reply(401, {}));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues"));
  });

  it("explains a refusal from the server", async () => {
    open("coordinator", reply(403, {}));

    expect(await screen.findByRole("alert")).toHaveTextContent("The venue catalogue is for ConnectSphere staff.");
  });

  it("shows a load failure with a Retry that loads again", async () => {
    const api = open("coordinator", reply(500, {}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the venue catalogue.");

    api.on("GET /api/venues", [hallA]);
    await userEvent.click(button("Retry"));

    expect(await names()).toEqual(["Hall A"]);
  });
});

// ---- The venue form, as used by Add venue ------------------------------------

function fillRequiredVenue() {
  set(field(/^Code/), "HALL-A");
  set(field(/^Name/), "Hall A");
  set(field(/^Building/), "Tower 1");
  set(field(/^Maximum capacity/), "300");
}

describe("Add venue", () => {
  const ROUTE = "POST /api/venues";

  async function open(answer: unknown = reply(201, { id: "v1" }), routes: Record<string, unknown> = {}) {
    setRoute("/venues/new");
    const api = mockApi({ ...signedInAs("venue_staff"), "GET /api/facilities": facilities, [ROUTE]: answer, ...routes });
    render(<NewVenuePage />);
    await screen.findByRole("checkbox", { name: "Stage" });
    return api;
  }
  const submit = () => userEvent.click(button("Add venue"));
  const body = (api: MockApi) => api.sent(ROUTE)[0].body as Record<string, unknown>;

  it("sends an anonymous visitor to log in", async () => {
    setRoute("/venues/new");
    mockApi(signedOut());

    render(<NewVenuePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fnew"));
  });

  it.each(ROLES.filter((r) => r !== "venue_staff"))("refuses %s, and offers the way back to the catalogue", async (role) => {
    setRoute("/venues/new");
    mockApi({ ...signedInAs(role), "GET /api/facilities": facilities });

    render(<NewVenuePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Only Venue Staff can add a venue");
    expect(screen.queryByLabelText(/^Code/)).not.toBeInTheDocument();
    await userEvent.click(button("Back to Venues"));
    expect(router.push).toHaveBeenCalledWith("/venues");
  });

  it("starts from the normal working day rather than blank times", async () => {
    await open();

    expect(field(/^Opens at/)).toHaveValue("08:00");
    expect(field(/^Closes at/)).toHaveValue("22:00");
    expect(field("Setup time (minutes)")).toHaveValue(0);
  });

  it("adds a venue from the required fields alone, then returns to the catalogue", async () => {
    const api = await open();
    fillRequiredVenue();

    await submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/venues"));
    expect(body(api)).toEqual({
      code: "HALL-A",
      name: "Hall A",
      building: "Tower 1",
      maxCapacity: 300,
      opensAt: "08:00",
      closesAt: "22:00",
      setupMinutes: 0,
      teardownMinutes: 0,
      facilityIds: [],
      layouts: [],
    });
  });

  it("sends everything that was filled in, trimmed", async () => {
    const api = await open();
    set(field(/^Code/), "  HALL-A ");
    set(field(/^Name/), " Hall A ");
    set(field("Description"), " Main hall ");
    set(field(/^Building/), " Tower 1 ");
    set(field("Floor"), " 3 ");
    set(field("Address"), " 1 Marina Way ");
    set(field(/^Maximum capacity/), "300");
    set(field(/^Opens at/), "07:00");
    set(field(/^Closes at/), "23:00");
    set(field("Setup time (minutes)"), "60");
    set(field("Turnaround time (minutes)"), "30");
    await userEvent.click(screen.getByRole("checkbox", { name: "Stage" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Hearing loop" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Stage" }));
    await userEvent.click(button("Add a layout"));
    set(field("Layout"), "theatre");
    set(field("Seats"), "280");

    await submit();

    await waitFor(() => expect(api.sent(ROUTE)).toHaveLength(1));
    expect(body(api)).toEqual({
      code: "HALL-A",
      name: "Hall A",
      description: "Main hall",
      building: "Tower 1",
      floor: "3",
      address: "1 Marina Way",
      maxCapacity: 300,
      opensAt: "07:00",
      closesAt: "23:00",
      setupMinutes: 60,
      teardownMinutes: 30,
      facilityIds: ["f-loop"],
      layouts: [{ layoutName: "theatre", capacity: 280 }],
    });
  });

  it("leaves setup and teardown out when they are blanked", async () => {
    const api = await open();
    fillRequiredVenue();
    set(field("Setup time (minutes)"), "");
    set(field("Turnaround time (minutes)"), "");

    await submit();

    await waitFor(() => expect(api.sent(ROUTE)).toHaveLength(1));
    expect(body(api)).not.toHaveProperty("setupMinutes");
    expect(body(api)).not.toHaveProperty("teardownMinutes");
  });

  describe("what it refuses before sending", () => {
    it("an empty form: names each required field and focuses the first", async () => {
      const api = await open();

      await submit();

      expect(screen.getByText("Give the venue a short code, e.g. MAR-GH.")).toBeInTheDocument();
      expect(screen.getByText("Enter the venue's name.")).toBeInTheDocument();
      expect(screen.getByText("Enter which building this room is in.")).toBeInTheDocument();
      expect(screen.getByText("Enter the room's maximum capacity.")).toBeInTheDocument();
      expect(field(/^Code/)).toHaveFocus();
      expect(api.sent(ROUTE)).toHaveLength(0);
    });

    it.each([
      ["a code longer than 20 characters", () => set(field(/^Code/), "X".repeat(21)), "Keep the code to 20 characters or fewer."],
      ["a capacity of zero", () => set(field(/^Maximum capacity/), "0"), "Enter a whole number, at least 1."],
      ["a fractional capacity", () => set(field(/^Maximum capacity/), "10.5"), "Enter a whole number, at least 1."],
      ["no opening time", () => set(field(/^Opens at/), ""), "Enter when the venue opens."],
      ["no closing time", () => set(field(/^Closes at/), ""), "Enter when the venue closes."],
      ["closing before opening", () => set(field(/^Closes at/), "07:00"), "Closing time must be after opening time."],
      ["negative setup minutes", () => set(field("Setup time (minutes)"), "-5"), "Enter a whole number of minutes, 0 or more."],
      ["fractional turnaround minutes", () => set(field("Turnaround time (minutes)"), "1.5"), "Enter a whole number of minutes, 0 or more."],
      // SPM-93-TC07 (AC5): setup and turnaround go in 15-minute steps.
      ["setup minutes off the 15-minute grid", () => set(field("Setup time (minutes)"), "20"), "Enter minutes in 15-minute steps: 0, 15, 30, 45 and so on."],
      ["turnaround minutes off the 15-minute grid", () => set(field("Turnaround time (minutes)"), "50"), "Enter minutes in 15-minute steps: 0, 15, 30, 45 and so on."],
    ])("%s", async (_case, breakIt, message) => {
      const api = await open();
      fillRequiredVenue();

      breakIt();
      await submit();

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(api.sent(ROUTE)).toHaveLength(0);
    });

    it("clears a field's error as soon as the field is changed", async () => {
      await open();
      await submit();

      set(field(/^Code/), "HALL-A");

      expect(screen.queryByText("Give the venue a short code, e.g. MAR-GH.")).not.toBeInTheDocument();
      expect(screen.getByText("Enter the venue's name.")).toBeInTheDocument();
    });
  });

  describe("layouts", () => {
    const capacity = () => group("Capacity");
    const addLayout = () => userEvent.click(button("Add a layout"));
    const layoutPickers = () => within(capacity()).getAllByLabelText("Layout");

    it("does not offer a layout that another row already uses", async () => {
      await open();
      await addLayout();
      set(field("Layout"), "theatre");

      await addLayout();
      const second = within(layoutPickers()[1]).getAllByRole("option").map((o) => o.textContent);

      expect(second).not.toContain("Theatre");
      expect(second).toContain("U-shape");
    });

    it("names the Remove button after the row's layout, and removes that row", async () => {
      const api = await open();
      fillRequiredVenue();
      await addLayout();
      set(layoutPickers()[0], "theatre");
      set(within(capacity()).getAllByLabelText("Seats")[0], "280");
      await addLayout();

      expect(button("Remove this layout")).toBeInTheDocument();
      await userEvent.click(button("Remove this layout"));
      await submit();

      await waitFor(() => expect(api.sent(ROUTE)).toHaveLength(1));
      expect(body(api).layouts).toEqual([{ layoutName: "theatre", capacity: 280 }]);
      expect(button("Remove theatre layout")).toBeInTheDocument();
    });

    it("refuses a row with no layout chosen", async () => {
      const api = await open();
      fillRequiredVenue();
      await addLayout();

      await submit();

      expect(within(capacity()).getByRole("alert")).toHaveTextContent("Choose a layout for every row, or remove the empty ones.");
      expect(api.sent(ROUTE)).toHaveLength(0);
    });

    it.each(["", "0", "2.5"])("refuses a layout with %j seats", async (seats) => {
      await open();
      fillRequiredVenue();
      await addLayout();
      set(field("Layout"), "theatre");
      set(field("Seats"), seats);

      await submit();

      expect(within(capacity()).getByRole("alert")).toHaveTextContent("Every layout needs a capacity of at least 1.");
    });

    it("clears the layout error when a row is changed, added or removed", async () => {
      await open();
      fillRequiredVenue();
      await addLayout();
      await submit();
      expect(within(capacity()).getByRole("alert")).toBeInTheDocument();

      set(field("Layout"), "theatre");
      expect(within(capacity()).queryByRole("alert")).not.toBeInTheDocument();

      await submit();
      expect(within(capacity()).getByRole("alert")).toBeInTheDocument();
      await addLayout();
      expect(within(capacity()).queryByRole("alert")).not.toBeInTheDocument();

      await submit();
      await userEvent.click(button("Remove this layout"));
      expect(within(capacity()).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("stops offering Add a layout once every layout is listed", async () => {
      await open();

      for (let i = 0; i < 7; i++) await addLayout();

      expect(button("Add a layout")).toBeDisabled();
      expect(screen.getByText("Every layout is already listed.")).toBeInTheDocument();
    });
  });

  describe("facilities", () => {
    it("splits what the room has from its accessibility features", async () => {
      await open();

      expect(within(group("This venue has")).getByRole("checkbox", { name: "Stage" })).toBeInTheDocument();
      expect(within(group("Accessibility")).getByRole("checkbox", { name: "Hearing loop" })).toBeInTheDocument();
    });

    it.each([
      ["are still loading", () => new Promise(() => {})],
      ["fail to load", reply(500, {})],
      ["cannot be reached", () => Promise.reject(new Error("offline"))],
    ])("shows placeholders, and still lets the venue be added, when they %s", async (_case, answer) => {
      setRoute("/venues/new");
      const api = mockApi({ ...signedInAs("venue_staff"), "GET /api/facilities": answer, [ROUTE]: reply(201, {}) });
      render(<NewVenuePage />);
      await screen.findByLabelText(/^Code/);

      expect(screen.queryByText("None available.")).not.toBeInTheDocument();
      fillRequiredVenue();
      await submit();

      await waitFor(() => expect(api.sent(ROUTE)).toHaveLength(1));
    });
  });

  describe("when the server refuses", () => {
    it("shows a duplicate code as a form error", async () => {
      await open(reply(400, { error: "A venue with this code already exists" }));
      fillRequiredVenue();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent("A venue with this code already exists");
      expect(router.push).not.toHaveBeenCalled();
    });

    it("puts field errors under their fields", async () => {
      await open(reply(400, { error: "Validation failed", details: { fieldErrors: { opensAt: ["Invalid"] } } }));
      fillRequiredVenue();

      await submit();

      await waitFor(() => expect(field(/^Opens at/)).toBeInvalid());
      expect(field(/^Opens at/)).toHaveFocus();
    });

    it("falls back to a general message", async () => {
      await open(reply(500, {}));
      fillRequiredVenue();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not add this venue");
    });

    it("explains a network failure", async () => {
      await open(() => Promise.reject(new Error("offline")));
      fillRequiredVenue();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
      expect(button("Add venue")).toBeEnabled();
    });
  });

  it("shows 'Adding…' and cannot be pressed twice while in flight", async () => {
    let finish: (value: unknown) => void = () => {};
    const api = await open(() => new Promise((resolve) => (finish = resolve)));
    fillRequiredVenue();

    await submit();

    expect(button("Adding…")).toBeDisabled();
    finish({ id: "v1" });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/venues"));
    expect(api.sent(ROUTE)).toHaveLength(1);
  });

  it("Cancel returns to the catalogue without saving", async () => {
    const api = await open();
    fillRequiredVenue();

    await userEvent.click(button("Cancel"));

    expect(router.push).toHaveBeenCalledWith("/venues");
    expect(api.sent(ROUTE)).toHaveLength(0);
  });
});

describe("Edit venue", () => {
  const VENUE = "GET /api/venues/v1";
  const PATCH = "PATCH /api/venues/v1";

  function venue(overrides: Record<string, unknown> = {}) {
    return {
      id: "v1",
      code: "HALL-A",
      name: "Hall A",
      description: "Main hall",
      building: "Tower 1",
      floor: "3",
      address: null,
      maxCapacity: 300,
      opensAt: "08:00",
      closesAt: "22:00",
      setupMinutes: 60,
      teardownMinutes: 30,
      isActive: true,
      layouts: [{ layoutName: "theatre", capacity: 280 }],
      facilities: [{ facilityId: "f-loop" }],
      ...overrides,
    };
  }

  const saved = (overrides: Record<string, unknown> = {}, flaggedBookings: object[] = []) => ({
    venue: venue(overrides),
    flaggedBookings,
  });

  function open(venueRow: unknown = venue(), patch: unknown = saved(), role = "venue_staff") {
    setRoute("/venues/v1/edit", { id: "v1" });
    const api = mockApi({ ...signedInAs(role), "GET /api/facilities": facilities, [VENUE]: venueRow, [PATCH]: patch });
    render(<EditVenuePage />);
    return api;
  }
  const ready = () => screen.findByRole("checkbox", { name: "Stage" });
  const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
  const save = () => userEvent.click(button("Save changes"));

  describe("opening it", () => {
    it("sends an anonymous visitor to log in", async () => {
      setRoute("/venues/v1/edit", { id: "v1" });
      mockApi(signedOut());

      render(<EditVenuePage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fv1%2Fedit"));
    });

    it("shows a placeholder while the venue loads", async () => {
      open(() => new Promise(() => {}));

      expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
    });

    it.each([
      ["is not found", reply(404, {}), "This venue could not be found. It may have been removed."],
      ["is refused", reply(403, {}), "The venue catalogue is for ConnectSphere staff."],
      ["cannot be loaded", reply(500, {}), "Could not load this venue."],
      ["cannot be reached", () => Promise.reject(new Error("offline")), "Could not reach the server."],
    ])("says so when the venue %s, and offers the way back", async (_case, answer, message) => {
      open(answer);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      await userEvent.click(button("Back to Venues"));
      expect(router.push).toHaveBeenCalledWith("/venues");
    });

    it("sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fv1%2Fedit"));
    });

    it.each(["coordinator", "ops_manager"])("refuses %s, who may view venues but not change them", async (role) => {
      open(venue(), saved(), role);

      expect(await screen.findByRole("alert")).toHaveTextContent("Only Venue Staff can change a venue");
      expect(screen.queryByLabelText(/^Code/)).not.toBeInTheDocument();
    });

    it("offers the way back to the catalogue from the refusal", async () => {
      open(venue(), saved(), "coordinator");

      await userEvent.click(await screen.findByRole("button", { name: "Back to Venues" }));

      expect(router.push).toHaveBeenCalledWith("/venues");
    });

    it("still opens the venue when the facility list fails to load", async () => {
      setRoute("/venues/v1/edit", { id: "v1" });
      mockApi({ ...signedInAs("venue_staff"), "GET /api/facilities": reply(500, {}), [VENUE]: venue() });

      render(<EditVenuePage />);

      expect(await screen.findByLabelText(/^Code/)).toHaveValue("HALL-A");
      expect(screen.queryByRole("checkbox", { name: "Stage" })).not.toBeInTheDocument();
    });

    it("fills the form from the saved venue", async () => {
      open();
      await ready();

      expect(screen.getByRole("heading", { level: 1, name: "Hall A" })).toBeInTheDocument();
      expect(field(/^Code/)).toHaveValue("HALL-A");
      expect(field("Description")).toHaveValue("Main hall");
      expect(field("Floor")).toHaveValue("3");
      expect(field("Address")).toHaveValue("");
      expect(field(/^Maximum capacity/)).toHaveValue(300);
      expect(field("Setup time (minutes)")).toHaveValue(60);
      expect(field("Layout")).toHaveValue("theatre");
      expect(field("Seats")).toHaveValue(280);
      expect(screen.getByRole("checkbox", { name: "Hearing loop" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Stage" })).not.toBeChecked();
      expect(screen.getByRole("link", { name: "View availability" })).toHaveAttribute("href", "/venues/v1/availability");
    });
  });

  describe("saving changes", () => {
    it("sends the whole venue and stays on the page to say what happened", async () => {
      const api = open(venue(), saved({ maxCapacity: 250 }));
      await ready();
      set(field(/^Maximum capacity/), "250");

      await save();

      expect(await screen.findByText("Changes saved")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "No approved bookings were affected, so nobody needed to be notified."
      );
      expect(api.sent(PATCH)[0].body).toEqual({
        code: "HALL-A",
        name: "Hall A",
        description: "Main hall",
        building: "Tower 1",
        floor: "3",
        maxCapacity: 250,
        opensAt: "08:00",
        closesAt: "22:00",
        setupMinutes: 60,
        teardownMinutes: 30,
        facilityIds: ["f-loop"],
        layouts: [{ layoutName: "theatre", capacity: 280 }],
      });
      expect(router.push).not.toHaveBeenCalled();
      expect(window.scrollTo).toHaveBeenCalled();
    });

    it("lists each booking the change flagged, and why", async () => {
      open(
        venue(),
        saved({}, [
          { bookingId: "b1", eventId: "e1", eventTitle: "Gala Dinner", sessionLabel: "Day 1", reasons: ["max_capacity_below_attendance", "layout_removed"] },
          { bookingId: "b2", eventId: "e2", eventTitle: null, sessionLabel: null, reasons: ["mandatory_facility_removed"] },
        ])
      );
      await ready();

      await save();
      const alert = await screen.findByRole("alert");
      const items = within(alert).getAllByRole("listitem").map((li) => li.textContent);

      expect(alert).toHaveTextContent("Changes saved — 2 bookings flagged for review, coordinators notified");
      expect(alert).toHaveTextContent("These bookings have not been changed.");
      expect(items[0]).toBe(
        "Gala Dinner (Day 1): the venue's maximum capacity is now below the expected attendance; " +
          "the booked layout is no longer offered at this venue"
      );
      expect(items[1]).toBe("Untitled event: a facility this event requires is no longer available at this venue");
    });

    it("counts a single flagged booking in the singular", async () => {
      open(venue(), saved({}, [{ bookingId: "b1", eventId: "e1", eventTitle: "Gala", sessionLabel: null, reasons: ["venue_retired"] }]));
      await ready();

      await save();

      expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved — 1 booking flagged for review");
    });

    it("re-fills the form from what the server saved", async () => {
      open(venue(), saved({ name: "Grand Hall", code: "GRAND" }));
      await ready();
      set(field(/^Name/), "grand hall");

      await save();

      expect(await screen.findByRole("heading", { level: 1, name: "Grand Hall" })).toBeInTheDocument();
      expect(field(/^Name/)).toHaveValue("Grand Hall");
      expect(field(/^Code/)).toHaveValue("GRAND");
    });

    it("sends an emptied layout list, so removed layouts are actually removed", async () => {
      const api = open();
      await ready();

      await userEvent.click(button("Remove theatre layout"));
      await save();

      await waitFor(() => expect(api.sent(PATCH)).toHaveLength(1));
      expect((api.sent(PATCH)[0].body as Record<string, unknown>).layouts).toEqual([]);
    });

    it("checks the form before sending anything", async () => {
      const api = open();
      await ready();
      set(field(/^Name/), "");

      await save();

      expect(screen.getByText("Enter the venue's name.")).toBeInTheDocument();
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("clears a field's error as soon as the field is changed", async () => {
      open();
      await ready();
      set(field(/^Name/), "");
      await save();

      set(field(/^Name/), "Hall A");

      expect(screen.queryByText("Enter the venue's name.")).not.toBeInTheDocument();
    });

    it("clears the previous result when another save starts", async () => {
      const api = open();
      await ready();
      await save();
      await screen.findByText("Changes saved");

      api.on(PATCH, reply(400, { error: "A venue with this code already exists" }));
      await save();

      expect(await screen.findByRole("alert")).toHaveTextContent("A venue with this code already exists");
      expect(screen.queryByText("Changes saved")).not.toBeInTheDocument();
    });

    it.each([
      ["field errors under their fields", reply(400, { error: "Validation failed", details: { fieldErrors: { code: ["Too long"] } } }), "Too long"],
      ["a general message when there is none", reply(500, {}), "Could not save this venue"],
      ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server."],
    ])("shows %s when the save is refused", async (_case, answer, message) => {
      open(venue(), answer);
      await ready();

      await save();

      expect(await screen.findByText(message, { exact: false })).toBeInTheDocument();
      expect(button("Save changes")).toBeEnabled();
    });
  });

  describe("retiring", () => {
    const retired = () => saved({ isActive: false }, [{ bookingId: "b1", eventId: "e1", eventTitle: "Gala Dinner", sessionLabel: null, reasons: ["venue_retired"] }]);

    async function openDialog(patch: unknown = retired()) {
      const api = open(venue(), patch);
      await ready();
      await userEvent.click(button("Retire venue"));
      return api;
    }

    it("asks first, naming the venue and exactly what will and will not happen", async () => {
      const api = await openDialog();

      expect(dialog().open).toBe(true);
      expect(within(dialog()).getByRole("heading", { name: "Retire Hall A?", hidden: true })).toBeInTheDocument();
      expect(dialog()).toHaveTextContent("Any approved booking that has not yet happened will be flagged for review");
      expect(dialog()).toHaveTextContent("No booking is cancelled or moved.");
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("retires with the reason given, and reports who was flagged", async () => {
      const api = await openDialog();
      set(within(dialog()).getByLabelText("Reason"), "  Closed for renovation until March ");

      await userEvent.click(within(dialog()).getByRole("button", { name: "Retire venue", hidden: true }));

      expect(await screen.findByText(/Venue retired — 1 booking flagged for review/)).toBeInTheDocument();
      expect(api.sent(PATCH)[0].body).toEqual({ isActive: false, reason: "Closed for renovation until March" });
      expect(screen.getByText("This venue is retired")).toBeInTheDocument();
      expect(screen.getByText("Retired")).toBeInTheDocument();
      expect(button("Restore venue")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retire venue" })).not.toBeInTheDocument();
    });

    it("sends no reason when none is given", async () => {
      const api = await openDialog();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Retire venue", hidden: true }));

      await waitFor(() => expect(api.sent(PATCH)).toHaveLength(1));
      expect(api.sent(PATCH)[0].body).toEqual({ isActive: false });
    });

    it("does nothing when the confirmation is cancelled", async () => {
      const api = await openDialog();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("shows the error and keeps the venue active when retiring is refused", async () => {
      await openDialog(reply(403, { error: "Only Venue Staff can change a venue" }));

      await userEvent.click(within(dialog()).getByRole("button", { name: "Retire venue", hidden: true }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Only Venue Staff can change a venue");
      expect(button("Retire venue")).toBeInTheDocument();
    });
  });

  describe("a retired venue", () => {
    it("says it is retired and offers Restore instead of Retire", async () => {
      open(venue({ isActive: false }));
      await ready();

      expect(screen.getByText("This venue is retired")).toBeInTheDocument();
      expect(button("Restore venue")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retire venue" })).not.toBeInTheDocument();
    });

    it("restores without a confirmation, since nothing is lost", async () => {
      const api = open(venue({ isActive: false }), saved({ isActive: true }));
      await ready();

      await userEvent.click(button("Restore venue"));

      expect(await screen.findByText("Venue restored")).toBeInTheDocument();
      expect(api.sent(PATCH)[0].body).toEqual({ isActive: true });
      expect(screen.queryByText("This venue is retired")).not.toBeInTheDocument();
      expect(button("Retire venue")).toBeInTheDocument();
    });
  });

  it("Back to Venues returns to the catalogue", async () => {
    open();
    await ready();

    await userEvent.click(button("Back to Venues"));

    expect(router.push).toHaveBeenCalledWith("/venues");
  });
});

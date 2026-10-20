// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import VenuesPage from "@/app/venues/page";
import NewVenuePage from "@/app/venues/new/page";
import EditVenuePage from "@/app/venues/[id]/edit/page";
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
    "[SPM-22][AC4] refuses %s without requesting the catalogue",
    async (role) => {
      const api = open(role);

      expect(await screen.findByRole("alert")).toHaveTextContent("The venue catalogue is for ConnectSphere staff.");
      expect(api.sent("GET /api/venues")).toHaveLength(0);
    }
  );

  it("[SPM-22][AC4] sends an anonymous visitor to log in, without asking for the catalogue", async () => {
    setRoute("/venues");
    const api = mockApi(signedOut());

    render(<VenuesPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues"));
    expect(api.sent("GET /api/venues")).toHaveLength(0);
  });

  it("[SPM-39] shows a general error when the request fails without a reason", async () => {
    open("coordinator", () => Promise.reject("offline"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("[SPM-39][AC2][AC3][AC4] shows each venue's location, capacity, layouts and hours", async () => {
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

  it("[SPM-46][AC1] links every row to that room's availability calendar", async () => {
    open("coordinator", [hallA]);

    expect(within(await rowFor("Hall A")).getByRole("link", { name: "View availability" })).toHaveAttribute(
      "href",
      "/venues/v1/availability"
    );
  });

  describe("read-only, for a coordinator or the Ops Manager", () => {
    it.each(["coordinator", "ops_manager"])("[SPM-39][AC6] asks for active venues only, as %s", async (role) => {
      const api = open(role, [hallA]);

      await table();

      expect(api.sent("GET /api/venues")[0].url).toBe("/api/venues");
    });

    it("[SPM-22][AC3] offers no way to add or edit a venue, and no Status column", async () => {
      open("coordinator", [hallA]);
      const hall = await rowFor("Hall A");

      await userEvent.click(within(hall).getByText("Hall A"));

      expect(router.push).not.toHaveBeenCalled();
      expect(screen.queryByRole("link", { name: "Add venue" })).not.toBeInTheDocument();
      expect(within(await table()).queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Find a venue" })).toHaveAttribute("href", "/venues/search");
    });

    it("[SPM-39][AC6] does not offer a Retired filter, since retired venues are never sent", async () => {
      open("coordinator", [hallA]);
      await table();

      expect(options("Show")).toEqual(["All venues", "Active only"]);
    });

    it("[SPM-39] says Venue Staff have not added any rooms when the catalogue is empty", async () => {
      open("coordinator", []);

      expect(await screen.findByText("No venues yet")).toBeInTheDocument();
      expect(screen.getByText("Venue Staff have not added any rooms yet.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Add the first venue" })).not.toBeInTheDocument();
    });
  });

  describe("for Venue Staff", () => {
    it("[SPM-39][AC6] asks for retired venues too, and shows which are retired", async () => {
      const api = open("venue_staff");

      const old = await rowFor("Old Hall");

      expect(api.sent("GET /api/venues")[0].url).toBe("/api/venues?includeRetired=true");
      expect(old).toHaveTextContent("Retired");
      expect(await rowFor("Hall A")).toHaveTextContent("Active");
      expect(screen.getByRole("link", { name: "Add venue" })).toHaveAttribute("href", "/venues/new");
    });

    it("[SPM-39][AC5] opens a venue's editor when its row is clicked", async () => {
      open("venue_staff");

      await userEvent.click(within(await rowFor("Hall A")).getByText("Hall A"));

      expect(router.push).toHaveBeenCalledWith("/venues/v1/edit");
    });

    it("[SPM-39] following the availability link does not also open the editor", async () => {
      open("venue_staff");

      await userEvent.click(within(await rowFor("Hall A")).getByRole("link", { name: "View availability" }));

      expect(router.push).not.toHaveBeenCalled();
    });

    it("[SPM-39] pressing Enter on the availability link in a mobile card does not also open the editor", async () => {
      open("venue_staff", [hallA]);
      await table();
      const cardLink = within(screen.getByRole("button")).getByRole("link", { name: "View availability" });

      cardLink.focus();
      await userEvent.keyboard("{Enter}");

      expect(router.push).not.toHaveBeenCalled();
    });

    it("[SPM-39][AC6] can filter to active or retired venues", async () => {
      open("venue_staff");
      await table();
      expect(options("Show")).toEqual(["Active and retired", "Active only", "Retired only"]);

      await userEvent.selectOptions(screen.getByLabelText("Show"), "Retired only");
      expect(await names()).toEqual(["Old Hall"]);
      await userEvent.selectOptions(screen.getByLabelText("Show"), "Active only");

      expect(await names()).toEqual(["Hall A", "Room B"]);
    });

    it("[SPM-39][AC1] invites them to add the first venue when the catalogue is empty", async () => {
      open("venue_staff", []);

      expect(await screen.findByText("Add the rooms ConnectSphere can offer so coordinators can book them.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add the first venue" })).toHaveAttribute("href", "/venues/new");
    });
  });

  it("[SPM-39] filters by building, offering each building once in alphabetical order", async () => {
    open("venue_staff");
    await table();
    expect(options("Filter by building")).toEqual(["All buildings", "Annex", "Tower 1"]);

    await userEvent.selectOptions(screen.getByLabelText("Filter by building"), "Annex");

    expect(await names()).toEqual(["Room B"]);
  });

  it("[SPM-39] says when no venue matches the filters, rather than that there are none", async () => {
    open("venue_staff", [hallA]);
    await table();

    await userEvent.selectOptions(screen.getByLabelText("Show"), "Retired only");

    expect(screen.getByText("No venues match these filters")).toBeInTheDocument();
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    open("coordinator", reply(401, {}));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues"));
  });

  it("[SPM-39] explains a refusal from the server", async () => {
    open("coordinator", reply(403, {}));

    expect(await screen.findByRole("alert")).toHaveTextContent("The venue catalogue is for ConnectSphere staff.");
  });

  it("[SPM-39] shows a load failure with a Retry that loads again", async () => {
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

  // SPM-80: a new venue has no bookings, so there is nothing to re-check.
  it("[SPM-80][AC1] does not mention re-checking bookings under the turnaround time", async () => {
    await open();

    expect(field(/^Turnaround time/)).not.toHaveAccessibleDescription();
  });

  it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
    setRoute("/venues/new");
    mockApi(signedOut());

    render(<NewVenuePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fnew"));
  });

  it.each(ROLES.filter((r) => r !== "venue_staff"))("[SPM-22][AC4] refuses %s, and offers the way back to the catalogue", async (role) => {
    setRoute("/venues/new");
    mockApi({ ...signedInAs(role), "GET /api/facilities": facilities });

    render(<NewVenuePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Only Venue Staff can add a venue");
    expect(screen.queryByLabelText(/^Code/)).not.toBeInTheDocument();
    expect(breadcrumb()).toEqual([
      ["Venues", "/venues"],
      ["Add venue", null],
    ]);
    await userEvent.click(button("Back to Venues"));
    expect(router.push).toHaveBeenCalledWith("/venues");
  });

  it("[SPM-39][BUG-98] shows Venues / Add venue in the breadcrumb (SPM-98)", async () => {
    await open();

    expect(breadcrumb()).toEqual([
      ["Venues", "/venues"],
      ["Add venue", null],
    ]);
  });

  it("[SPM-39][AC4] starts from the normal working day rather than blank times", async () => {
    await open();

    expect(field(/^Opens at/)).toHaveValue("08:00");
    expect(field(/^Closes at/)).toHaveValue("22:00");
    expect(field("Setup time (minutes)")).toHaveValue(0);
  });

  it("[SPM-39][AC1] adds a venue from the required fields alone, then returns to the catalogue", async () => {
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

  it("[SPM-39][AC1] sends everything that was filled in, trimmed", async () => {
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

  it("[SPM-93][AC5] leaves setup and teardown out when they are blanked", async () => {
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
    it("[SPM-39][AC1] an empty form: names each required field and focuses the first", async () => {
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
    ])("[SPM-39][AC1] %s", async (_case, breakIt, message) => {
      const api = await open();
      fillRequiredVenue();

      breakIt();
      await submit();

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(api.sent(ROUTE)).toHaveLength(0);
    });

    it("[SPM-39][AC1] clears a field's error as soon as the field is changed", async () => {
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

    it("[SPM-39][AC3] does not offer a layout that another row already uses", async () => {
      await open();
      await addLayout();
      set(field("Layout"), "theatre");

      await addLayout();
      const second = within(layoutPickers()[1]).getAllByRole("option").map((o) => o.textContent);

      expect(second).not.toContain("Theatre");
      expect(second).toContain("U-shape");
    });

    it("[SPM-39][AC3] names the Remove button after the row's layout, and removes that row", async () => {
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

    it("[SPM-39][AC3] sends every row, each with what was entered on it", async () => {
      const api = await open();
      fillRequiredVenue();
      await addLayout();
      await addLayout();
      set(layoutPickers()[0], "theatre");
      set(layoutPickers()[1], "classroom");
      set(within(capacity()).getAllByLabelText("Seats")[0], "280");
      set(within(capacity()).getAllByLabelText("Seats")[1], "120");

      await submit();

      await waitFor(() => expect(api.sent(ROUTE)).toHaveLength(1));
      expect(body(api).layouts).toEqual([
        { layoutName: "theatre", capacity: 280 },
        { layoutName: "classroom", capacity: 120 },
      ]);
    });

    it("[SPM-39][AC3] refuses a row with no layout chosen", async () => {
      const api = await open();
      fillRequiredVenue();
      await addLayout();

      await submit();

      expect(within(capacity()).getByRole("alert")).toHaveTextContent("Choose a layout for every row, or remove the empty ones.");
      expect(api.sent(ROUTE)).toHaveLength(0);
    });

    it.each(["", "0", "2.5"])("[SPM-39][AC3] refuses a layout with %j seats", async (seats) => {
      await open();
      fillRequiredVenue();
      await addLayout();
      set(field("Layout"), "theatre");
      set(field("Seats"), seats);

      await submit();

      expect(within(capacity()).getByRole("alert")).toHaveTextContent("Every layout needs a capacity of at least 1.");
    });

    it("[SPM-39][AC3] clears the layout error when a row is changed, added or removed", async () => {
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

    it("[SPM-39][AC3] stops offering Add a layout once every layout is listed", async () => {
      await open();

      for (let i = 0; i < 7; i++) await addLayout();

      expect(button("Add a layout")).toBeDisabled();
      expect(screen.getByText("Every layout is already listed.")).toBeInTheDocument();
    });
  });

  describe("facilities", () => {
    it("[SPM-39][AC2] splits what the room has from its accessibility features", async () => {
      await open();

      expect(within(group("This venue has")).getByRole("checkbox", { name: "Stage" })).toBeInTheDocument();
      expect(within(group("Accessibility")).getByRole("checkbox", { name: "Hearing loop" })).toBeInTheDocument();
    });

    it.each([
      ["are still loading", () => new Promise(() => {})],
      ["fail to load", reply(500, {})],
      ["cannot be reached", () => Promise.reject(new Error("offline"))],
    ])("[SPM-39][AC1] shows placeholders, and still lets the venue be added, when they %s", async (_case, answer) => {
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
    it("[SPM-39][AC1] shows a duplicate code as a form error", async () => {
      await open(reply(400, { error: "A venue with this code already exists" }));
      fillRequiredVenue();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent("A venue with this code already exists");
      expect(router.push).not.toHaveBeenCalled();
    });

    it("[SPM-39][AC1] puts field errors under their fields", async () => {
      await open(reply(400, { error: "Validation failed", details: { fieldErrors: { opensAt: ["Invalid"] } } }));
      fillRequiredVenue();

      await submit();

      await waitFor(() => expect(field(/^Opens at/)).toBeInvalid());
      expect(field(/^Opens at/)).toHaveFocus();
    });

    it("[SPM-39][AC1] falls back to a general message", async () => {
      await open(reply(500, {}));
      fillRequiredVenue();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not add this venue");
    });

    it("[SPM-39][AC1] explains a network failure", async () => {
      await open(() => Promise.reject(new Error("offline")));
      fillRequiredVenue();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
      expect(button("Add venue")).toBeEnabled();
    });
  });

  it("[SPM-39][AC1] shows 'Adding…' and cannot be pressed twice while in flight", async () => {
    let finish: (value: unknown) => void = () => {};
    const api = await open(() => new Promise((resolve) => (finish = resolve)));
    fillRequiredVenue();

    await submit();

    expect(button("Adding…")).toBeDisabled();
    finish({ id: "v1" });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/venues"));
    expect(api.sent(ROUTE)).toHaveLength(1);
  });

  it("[SPM-39][AC1] Cancel returns to the catalogue without saving", async () => {
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

  // SPM-45: the editor also loads the venue's unavailable periods.
  const PERIODS = "GET /api/venues/v1/unavailability";

  function open(
    venueRow: unknown = venue(),
    patch: unknown = saved(),
    role = "venue_staff",
    routes: Record<string, unknown> = {}
  ) {
    setRoute("/venues/v1/edit", { id: "v1" });
    const api = mockApi({
      ...signedInAs(role),
      "GET /api/facilities": facilities,
      [VENUE]: venueRow,
      [PATCH]: patch,
      [PERIODS]: [],
      ...routes,
    });
    render(<EditVenuePage />);
    return api;
  }
  const ready = () => screen.findByRole("checkbox", { name: "Stage" });
  /// A dialog by its heading - the page has more than one since SPM-45.
  const dialogTitled = (title: string | RegExp) =>
    screen.getByRole("heading", { name: title, hidden: true }).closest("dialog") as HTMLDialogElement;
  const dialog = () => dialogTitled(/^Retire /);
  const save = () => userEvent.click(button("Save changes"));

  describe("opening it", () => {
    // CONTRACT (SPM-80, written before the code): the venue edit form says,
    // under 'Turnaround time (minutes)', what changing either time does.
    it("[SPM-80][AC1][AC4] says under the turnaround time that changing either time re-checks the venue's bookings", async () => {
      open();
      await ready();

      expect(field(/^Turnaround time/)).toHaveAccessibleDescription(
        "Changing the setup or turnaround time re-checks this venue's upcoming bookings. " +
          "Any that now clash are flagged for their coordinator, never changed."
      );
    });

    // SPM-80: pending requests are re-checked too, not only approved bookings.
    it("[SPM-80][AC1][AC4] says changes can affect the venue's bookings without changing them", async () => {
      open();
      await ready();

      expect(
        screen.getByText("Changes here can affect this venue's bookings. Nothing is changed for them automatically.")
      ).toBeInTheDocument();
    });

    it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
      setRoute("/venues/v1/edit", { id: "v1" });
      mockApi(signedOut());

      render(<EditVenuePage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fv1%2Fedit"));
    });

    it("[SPM-39] titles the page 'Edit venue' for a venue saved with no name", async () => {
      open(venue({ name: "" }));
      await ready();

      expect(screen.getByRole("heading", { level: 1, name: "Edit venue" })).toBeInTheDocument();
    });

    it("[SPM-39] shows a placeholder while the venue loads", async () => {
      open(() => new Promise(() => {}));

      expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
    });

    it.each([
      ["is not found", reply(404, {}), "This venue could not be found. It may have been removed."],
      ["is refused", reply(403, {}), "The venue catalogue is for ConnectSphere staff."],
      ["cannot be loaded", reply(500, {}), "Could not load this venue."],
      ["cannot be reached", () => Promise.reject(new Error("offline")), "Could not reach the server."],
    ])("[SPM-39] says so when the venue %s, and offers the way back", async (_case, answer, message) => {
      open(answer);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      await userEvent.click(button("Back to Venues"));
      expect(router.push).toHaveBeenCalledWith("/venues");
    });

    it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fv1%2Fedit"));
    });

    it.each(["coordinator", "ops_manager"])("[SPM-39][AC5] refuses %s, who may view venues but not change them", async (role) => {
      open(venue(), saved(), role);

      expect(await screen.findByRole("alert")).toHaveTextContent("Only Venue Staff can change a venue");
      expect(screen.queryByLabelText(/^Code/)).not.toBeInTheDocument();
    });

    it("[SPM-39][AC5] offers the way back to the catalogue from the refusal", async () => {
      open(venue(), saved(), "coordinator");

      await userEvent.click(await screen.findByRole("button", { name: "Back to Venues" }));

      expect(router.push).toHaveBeenCalledWith("/venues");
    });

    it("[SPM-39][AC5] still opens the venue when the facility list fails to load", async () => {
      setRoute("/venues/v1/edit", { id: "v1" });
      mockApi({ ...signedInAs("venue_staff"), "GET /api/facilities": reply(500, {}), [VENUE]: venue() });

      render(<EditVenuePage />);

      expect(await screen.findByLabelText(/^Code/)).toHaveValue("HALL-A");
      expect(screen.queryByRole("checkbox", { name: "Stage" })).not.toBeInTheDocument();
    });

    it("[SPM-39][AC5] fills the form from the saved venue", async () => {
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

  // SPM-98: Venues / <venue name> / Edit venue, in every state.
  describe("its breadcrumb", () => {
    const trail = (name: string) => [
      ["Venues", "/venues"],
      [name, "/venues/v1/availability"],
      ["Edit venue", null],
    ];

    it("[SPM-39][BUG-98] names the venue and ends on the page", async () => {
      open();
      await ready();

      expect(breadcrumb()).toEqual(trail("Hall A"));
    });

    it.each([
      ["loading", () => new Promise(() => {})],
      ["in error", reply(500, {})],
    ])("[SPM-39][BUG-98] reads 'Venue' for the venue while %s", async (_case, venueRow) => {
      open(venueRow);
      await screen.findByRole("navigation", { name: "Breadcrumb" });

      expect(breadcrumb()).toEqual(trail("Venue"));
    });

    it("[SPM-39][BUG-98] is the same trail when a coordinator is refused", async () => {
      open(venue(), saved(), "coordinator");
      await screen.findByRole("alert");

      await waitFor(() => expect(breadcrumb()).toEqual(trail("Hall A")));
    });
  });

  describe("saving changes", () => {
    it("[SPM-39][AC5] sends the whole venue and stays on the page to say what happened", async () => {
      const api = open(venue(), saved({ maxCapacity: 250 }));
      await ready();
      set(field(/^Maximum capacity/), "250");

      await save();

      expect(await screen.findByText("Changes saved")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "No bookings were affected, so nobody needed to be notified."
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
      expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    });

    it("[SPM-39][AC7] lists each booking the change flagged, and why", async () => {
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

    // CONTRACT (SPM-80, written before the code): a flagged booking's
    // `clashesWith` is listed after its reasons, as "clashes with <reference> <title>".
    it("[SPM-80][AC2] names the booking each flagged booking now clashes with", async () => {
      open(
        venue(),
        saved({ teardownMinutes: 75 }, [
          {
            bookingId: "b1",
            eventId: "e1",
            eventTitle: "Gala Dinner",
            sessionLabel: null,
            reasons: ["booking_clash"],
            clashesWith: [{ bookingId: "b2", eventId: "e2", eventReference: "EVT-000012", eventTitle: "Product Launch" }],
          },
          {
            bookingId: "b2",
            eventId: "e2",
            eventTitle: "Product Launch",
            sessionLabel: null,
            reasons: ["booking_clash"],
            clashesWith: [{ bookingId: "b1", eventId: "e1", eventReference: "EVT-000007", eventTitle: "Gala Dinner" }],
          },
        ])
      );
      await ready();
      set(field(/^Turnaround time/), "75");

      await save();
      const alert = await screen.findByRole("alert");
      const items = within(alert).getAllByRole("listitem").map((li) => li.textContent);

      expect(alert).toHaveTextContent("Changes saved — 2 bookings flagged for review, coordinators notified");
      expect(items).toEqual([
        "Gala Dinner: with the venue's new setup or turnaround time, this booking overlaps another booking " +
          "(clashes with EVT-000012 Product Launch)",
        "Product Launch: with the venue's new setup or turnaround time, this booking overlaps another booking " +
          "(clashes with EVT-000007 Gala Dinner)",
      ]);
    });

    it("[SPM-39][AC7] counts a single flagged booking in the singular", async () => {
      open(venue(), saved({}, [{ bookingId: "b1", eventId: "e1", eventTitle: "Gala", sessionLabel: null, reasons: ["venue_retired"] }]));
      await ready();

      await save();

      expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved — 1 booking flagged for review");
    });

    it("[SPM-39][AC5] re-fills the form from what the server saved", async () => {
      open(venue(), saved({ name: "Grand Hall", code: "GRAND" }));
      await ready();
      set(field(/^Name/), "grand hall");

      await save();

      expect(await screen.findByRole("heading", { level: 1, name: "Grand Hall" })).toBeInTheDocument();
      expect(field(/^Name/)).toHaveValue("Grand Hall");
      expect(field(/^Code/)).toHaveValue("GRAND");
    });

    it("[SPM-39][AC5] sends an emptied layout list, so removed layouts are actually removed", async () => {
      const api = open();
      await ready();

      await userEvent.click(button("Remove theatre layout"));
      await save();

      await waitFor(() => expect(api.sent(PATCH)).toHaveLength(1));
      expect((api.sent(PATCH)[0].body as Record<string, unknown>).layouts).toEqual([]);
    });

    it("[SPM-39][AC5] checks the form before sending anything", async () => {
      const api = open();
      await ready();
      set(field(/^Name/), "");

      await save();

      expect(screen.getByText("Enter the venue's name.")).toBeInTheDocument();
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-39][AC5] clears a field's error as soon as the field is changed", async () => {
      open();
      await ready();
      set(field(/^Name/), "");
      await save();

      set(field(/^Name/), "Hall A");

      expect(screen.queryByText("Enter the venue's name.")).not.toBeInTheDocument();
    });

    it("[SPM-39][AC5] clears the previous result when another save starts", async () => {
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
    ])("[SPM-39][AC5] shows %s when the save is refused", async (_case, answer, message) => {
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

    it("[SPM-39][AC7] asks first, naming the venue and exactly what will and will not happen", async () => {
      const api = await openDialog();

      expect(dialog().open).toBe(true);
      expect(within(dialog()).getByRole("heading", { name: "Retire Hall A?", hidden: true })).toBeInTheDocument();
      expect(dialog()).toHaveTextContent("Any approved booking that has not yet happened will be flagged for review");
      expect(dialog()).toHaveTextContent("No booking is cancelled or moved.");
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-39][AC7] retires with the reason given, and reports who was flagged", async () => {
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

    it("[SPM-39][AC7] sends no reason when none is given", async () => {
      const api = await openDialog();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Retire venue", hidden: true }));

      await waitFor(() => expect(api.sent(PATCH)).toHaveLength(1));
      expect(api.sent(PATCH)[0].body).toEqual({ isActive: false });
    });

    it("[SPM-39][AC7] does nothing when the confirmation is cancelled", async () => {
      const api = await openDialog();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-39][AC7] shows the error and keeps the venue active when retiring is refused", async () => {
      await openDialog(reply(403, { error: "Only Venue Staff can change a venue" }));

      await userEvent.click(within(dialog()).getByRole("button", { name: "Retire venue", hidden: true }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Only Venue Staff can change a venue");
      expect(button("Retire venue")).toBeInTheDocument();
    });
  });

  describe("a retired venue", () => {
    it("[SPM-39][AC6] says it is retired and offers Restore instead of Retire", async () => {
      open(venue({ isActive: false }));
      await ready();

      expect(screen.getByText("This venue is retired")).toBeInTheDocument();
      expect(button("Restore venue")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retire venue" })).not.toBeInTheDocument();
    });

    it("[SPM-39][AC6] restores without a confirmation, since nothing is lost", async () => {
      const api = open(venue({ isActive: false }), saved({ isActive: true }));
      await ready();

      await userEvent.click(button("Restore venue"));

      expect(await screen.findByText("Venue restored")).toBeInTheDocument();
      expect(api.sent(PATCH)[0].body).toEqual({ isActive: true });
      expect(screen.queryByText("This venue is retired")).not.toBeInTheDocument();
      expect(button("Retire venue")).toBeInTheDocument();
    });
  });

  // SPM-45, as the editor's contract. Rewritten on 2026-10-09 for times on the
  // 15-minute grid (SPM-93), before the code was reworked:
  //   It loads GET /api/venues/[id]/unavailability and lists each period under an
  //   "Unavailable periods" heading: reason, the description of an Other reason, and
  //   "Unavailable from <date>, <time>.
  //   Available again from <date>, <time>.", with "Change period" and "End period".
  //   "Mark unavailable" opens a dialog titled "Mark <venue> unavailable" with the fields
  //   Unavailable from, From time, Available again on, Available again at (all empty, all
  //   required) and Reason (required). Choosing "Other" shows a required "Other reason" text field.
  //   It POSTs { fromDay, fromTime, untilDay, untilTime, reason, otherReason? }. "Change period" opens "Change unavailable period", filled in, and
  //   PATCHes .../unavailability/[periodId]; "End period" DELETEs it. After each, the page
  //   says what happened (as it does for a save) and loads the periods again.
  // Decided here, not in the story (change the test if the team wants otherwise):
  //   every label, heading and message quoted below.
  describe("unavailable periods (SPM-45)", () => {
    const CREATE = "POST /api/venues/v1/unavailability";
    const CHANGE = "PATCH /api/venues/v1/unavailability/p1";
    const END = "DELETE /api/venues/v1/unavailability/p1";
    const AFTER_ERROR = "The venue must become available again after it becomes unavailable.";

    const period = (overrides: Record<string, unknown> = {}) => ({
      id: "p1",
      fromDay: "2027-06-10",
      fromTime: "13:00",
      untilDay: "2027-06-15",
      untilTime: "13:00",
      reason: "equipment_failure",
      otherReason: null,
      ...overrides,
    });
    const flagged = (eventTitle: string) => ({
      bookingId: eventTitle,
      eventId: "e1",
      eventTitle,
      sessionLabel: null,
      reasons: ["venue_unavailable"],
    });
    const outcome = (flaggedBookings: object[] = []) => ({ period: period(), flaggedBookings });

    async function openWith(routes: Record<string, unknown> = {}) {
      const api = open(venue(), saved(), "venue_staff", routes);
      await ready();
      return api;
    }

    const markDialog = () => dialogTitled("Mark Hall A unavailable");
    const changeDialog = () => dialogTitled("Change unavailable period");
    const inDialog = (d: HTMLElement, name: string) => within(d).getByRole("button", { name, hidden: true });

    function fill(d: HTMLElement, values: Partial<Record<"from" | "fromTime" | "until" | "untilTime" | "reason" | "otherReason", string>>) {
      if (values.from !== undefined) set(field(/^Unavailable from/, d), values.from);
      if (values.fromTime !== undefined) set(field(/^From time/, d), values.fromTime);
      if (values.until !== undefined) set(field(/^Available again on/, d), values.until);
      if (values.untilTime !== undefined) set(field(/^Available again at/, d), values.untilTime);
      if (values.reason !== undefined) set(field(/^Reason/, d), values.reason);
      if (values.otherReason !== undefined) set(field(/^Other reason/, d), values.otherReason);
    }
    const complete = { from: "2027-06-10", fromTime: "13:00", until: "2027-06-15", untilTime: "13:00", reason: "equipment_failure" };
    const GRID_ERROR = "Choose a time on a 15-minute step (:00, :15, :30 or :45).";

    async function openMarkDialog(routes: Record<string, unknown> = {}) {
      const api = await openWith({ [CREATE]: reply(201, outcome()), ...routes });
      await userEvent.click(button("Mark unavailable"));
      return api;
    }

    describe("the list", () => {
      it("[SPM-45][AC6] shows each period with its reason, dates and times, and what an Other reason is", async () => {
        await openWith({ [PERIODS]: [period(), period({ id: "p2", fromDay: "2027-07-01", fromTime: "09:00", untilDay: "2027-07-01", untilTime: "17:30", reason: "other", otherReason: "Film crew on site" })] });

        expect(screen.getByRole("heading", { name: "Unavailable periods" })).toBeInTheDocument();
        expect(await screen.findByText("Equipment failure")).toBeInTheDocument();
        expect(screen.getByText("Unavailable from 10 Jun 2027, 13:00. Available again from 15 Jun 2027, 13:00.")).toBeInTheDocument();
        expect(screen.getByText("Other")).toBeInTheDocument();
        expect(screen.getByText("Film crew on site")).toBeInTheDocument();
        expect(screen.getByText("Unavailable from 1 Jul 2027, 09:00. Available again from 1 Jul 2027, 17:30.")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Change period" })).toHaveLength(2);
        expect(screen.getAllByRole("button", { name: "End period" })).toHaveLength(2);
      });

      it("[SPM-45] says so when the venue has none, and still offers to mark it unavailable", async () => {
        await openWith();

        expect(await screen.findByText("No unavailable periods under way or coming up.")).toBeInTheDocument();
        expect(button("Mark unavailable")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "End period" })).not.toBeInTheDocument();
      });

      it("[SPM-45] says so when the list cannot be loaded", async () => {
        await openWith({ [PERIODS]: reply(500, {}) });

        expect(await screen.findByText("Could not load this venue's unavailable periods.")).toBeInTheDocument();
      });

      it("[SPM-45] does not mark the venue as retired", async () => {
        await openWith({ [PERIODS]: [period()] });

        await screen.findByText("Equipment failure");
        expect(screen.queryByText("Retired")).not.toBeInTheDocument();
        expect(button("Retire venue")).toBeInTheDocument();
      });

      it.each(["coordinator", "ops_manager"])("[SPM-22][AC4] is never requested for %s, who cannot open the editor", async (role) => {
        const api = open(venue(), saved(), role);

        expect(await screen.findByText("Only Venue Staff can change a venue")).toBeInTheDocument();
        expect(api.sent(PERIODS)).toHaveLength(0);
      });
    });

    describe("marking the venue unavailable", () => {
      it("[SPM-45][AC1][AC6] asks for both dates, both times and a reason, and offers no slots", async () => {
        const api = await openMarkDialog();
        const d = markDialog();

        expect(field(/^Unavailable from/, d)).toHaveValue("");
        expect(field(/^Available again on/, d)).toHaveValue("");
        for (const label of [/^From time/, /^Available again at/]) {
          expect(field(label, d)).toHaveValue("");
          expect(field(label, d)).toHaveAttribute("type", "time");
        }
        expect(within(d).queryByLabelText(/slot/i)).not.toBeInTheDocument();
        expect(within(d).queryByRole("option", { name: "AM", hidden: true })).not.toBeInTheDocument();
        const reasons = within(field(/^Reason/, d)).getAllByRole("option", { hidden: true });
        expect(reasons.map((o) => o.textContent)).toEqual([
          "Choose a reason",
          "Maintenance",
          "Equipment failure",
          "Renovation",
          "Safety",
          "Internal activity",
          "Other",
        ]);
        expect(within(d).queryByLabelText(/^Other reason/)).not.toBeInTheDocument();
        expect(d).toHaveTextContent("No booking is cancelled or moved.");
        expect(api.sent(CREATE)).toHaveLength(0);
      });

      it("[SPM-45][AC1] refuses an empty form, naming each missing answer", async () => {
        const api = await openMarkDialog();

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(markDialog()).toHaveTextContent("Enter the date the venue becomes unavailable.");
        expect(markDialog()).toHaveTextContent("Enter the time the venue becomes unavailable.");
        expect(markDialog()).toHaveTextContent("Enter the date the venue becomes available again.");
        expect(markDialog()).toHaveTextContent("Enter the time the venue becomes available again.");
        expect(markDialog()).toHaveTextContent("Choose a reason.");
        expect(api.sent(CREATE)).toHaveLength(0);
      });

      it("[SPM-45][AC1] clears a field's error once it is answered, leaving the others", async () => {
        await openMarkDialog();
        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        fill(markDialog(), { from: "2027-06-10" });
        fill(markDialog(), { from: "2027-06-11" });

        expect(markDialog()).not.toHaveTextContent("Enter the date the venue becomes unavailable.");
        expect(markDialog()).toHaveTextContent("Enter the time the venue becomes unavailable.");
      });

      it.each([
        ["the start time", { fromTime: "13:10" }],
        ["the return time", { untilTime: "13:40" }],
      ])("[SPM-45][AC1] refuses a time off the 15-minute grid, naming it: %s", async (_case, offGrid) => {
        const api = await openMarkDialog();
        fill(markDialog(), { ...complete, ...offGrid });

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(markDialog()).toHaveTextContent(GRID_ERROR);
        expect(markDialog()).not.toHaveTextContent(AFTER_ERROR);
        expect(api.sent(CREATE)).toHaveLength(0);
      });

      it.each([
        ["earlier the same day", "2027-06-10", "09:00"],
        ["at the same time", "2027-06-10", "13:00"],
        ["on an earlier day, later in the day", "2027-06-09", "23:45"],
      ])("[SPM-45][AC2] refuses a return %s", async (_case, until, untilTime) => {
        const api = await openMarkDialog();
        fill(markDialog(), { ...complete, until, untilTime });

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(markDialog()).toHaveTextContent(AFTER_ERROR);
        expect(api.sent(CREATE)).toHaveLength(0);
      });

      it("[SPM-45][AC1] refuses a period that is already over", async () => {
        const api = await openMarkDialog();
        fill(markDialog(), { ...complete, from: "2020-09-01", until: "2020-09-05" });

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(markDialog()).toHaveTextContent("This period is already over.");
        expect(api.sent(CREATE)).toHaveLength(0);
      });

      it("[SPM-45][AC1] shows the server's refusal of a period that is already over under the return time", async () => {
        const api = await openMarkDialog({
          [CREATE]: reply(400, {
            error: "Validation failed",
            details: { formErrors: [], fieldErrors: { untilTime: ["This period is already over."] } },
          }),
        });
        fill(markDialog(), complete);

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        await waitFor(() => expect(api.sent(CREATE)).toHaveLength(1));
        await waitFor(() => expect(markDialog()).toHaveTextContent("This period is already over."));
        expect(markDialog().open).toBe(true);
      });

      it("[SPM-45][AC2] accepts a return 15 minutes after the start", async () => {
        const api = await openMarkDialog();
        fill(markDialog(), { ...complete, until: "2027-06-10", untilTime: "13:15" });

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        await waitFor(() => expect(api.sent(CREATE)).toHaveLength(1));
        expect(api.sent(CREATE)[0].body).toMatchObject({ untilDay: "2027-06-10", untilTime: "13:15" });
      });

      it("[SPM-45][AC1][AC3] sends the period, then lists it and says who was flagged", async () => {
        const api = await openMarkDialog({
          [CREATE]: reply(201, outcome([flagged("Afternoon Workshop"), flagged("Closing Seminar")])),
        });
        fill(markDialog(), complete);
        api.on(PERIODS, [period()]);

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(
          await screen.findByText("Unavailable period saved — 2 bookings flagged for review, coordinators notified")
        ).toBeInTheDocument();
        expect(api.sent(CREATE)[0].body).toEqual({
          fromDay: "2027-06-10",
          fromTime: "13:00",
          untilDay: "2027-06-15",
          untilTime: "13:00",
          reason: "equipment_failure",
        });
        expect(screen.getByText(/Afternoon Workshop/).closest("li")).toHaveTextContent(
          "Afternoon Workshop: the venue is unavailable during this booking"
        );
        expect(screen.getByText(/Closing Seminar/)).toBeInTheDocument();
        expect(await screen.findByText("Unavailable from 10 Jun 2027, 13:00. Available again from 15 Jun 2027, 13:00.")).toBeInTheDocument();
        expect(api.sent(PERIODS)).toHaveLength(2);
      });

      it("[SPM-45][AC3] treats an answer that lists no flagged bookings as none", async () => {
        await openMarkDialog({ [CREATE]: reply(201, { period: period() }) });
        fill(markDialog(), complete);

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(await screen.findByText("No bookings were affected, so nobody needed to be notified.")).toBeInTheDocument();
      });

      it("[SPM-45][AC3] says so when no booking was affected", async () => {
        await openMarkDialog();
        fill(markDialog(), complete);

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(await screen.findByText("Unavailable period saved")).toBeInTheDocument();
        expect(screen.getByText("No bookings were affected, so nobody needed to be notified.")).toBeInTheDocument();
      });

      describe("when the reason is Other", () => {
        it("[SPM-45][AC6] asks what the reason is, only once Other is chosen", async () => {
          await openMarkDialog();

          fill(markDialog(), { reason: "other" });
          expect(field(/^Other reason/, markDialog())).toHaveValue("");

          fill(markDialog(), { reason: "safety" });
          expect(within(markDialog()).queryByLabelText(/^Other reason/)).not.toBeInTheDocument();
        });

        it.each(["", "   "])("[SPM-45][AC6] refuses a description of %j", async (text) => {
          const api = await openMarkDialog();
          fill(markDialog(), { ...complete, reason: "other" });
          fill(markDialog(), { otherReason: text });

          await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

          expect(markDialog()).toHaveTextContent("Describe the reason.");
          expect(api.sent(CREATE)).toHaveLength(0);
        });

        it("[SPM-45][AC6] sends the description, trimmed", async () => {
          const api = await openMarkDialog();
          fill(markDialog(), { ...complete, reason: "other" });
          fill(markDialog(), { otherReason: "  Film crew on site " });

          await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

          await waitFor(() => expect(api.sent(CREATE)).toHaveLength(1));
          expect(api.sent(CREATE)[0].body).toEqual({
            fromDay: "2027-06-10",
            fromTime: "13:00",
            untilDay: "2027-06-15",
            untilTime: "13:00",
            reason: "other",
            otherReason: "Film crew on site",
          });
        });

        it("[SPM-45][AC6] does not send a description typed before the reason was changed to one on the list", async () => {
          const api = await openMarkDialog();
          fill(markDialog(), { ...complete, reason: "other" });
          fill(markDialog(), { otherReason: "Film crew on site" });
          fill(markDialog(), { reason: "renovation" });

          await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

          await waitFor(() => expect(api.sent(CREATE)).toHaveLength(1));
          expect(api.sent(CREATE)[0].body).not.toHaveProperty("otherReason");
        });
      });

      it("[SPM-45] does nothing when the dialog is cancelled", async () => {
        const api = await openMarkDialog();
        fill(markDialog(), complete);

        await userEvent.click(inDialog(markDialog(), "Cancel"));

        expect(markDialog().open).toBe(false);
        expect(api.sent(CREATE)).toHaveLength(0);
      });

      it("[SPM-45] shows the server's refusal and records nothing", async () => {
        const api = await openMarkDialog({ [CREATE]: reply(403, { error: "Only Venue Staff can mark a venue unavailable" }) });
        fill(markDialog(), complete);

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(await screen.findByText("Only Venue Staff can mark a venue unavailable")).toBeInTheDocument();
        expect(screen.queryByText(/Unavailable period saved/)).not.toBeInTheDocument();
        expect(api.sent(PERIODS)).toHaveLength(1);
      });

      it("[SPM-45] explains a network failure", async () => {
        await openMarkDialog({ [CREATE]: () => Promise.reject(new Error("offline")) });
        fill(markDialog(), complete);

        await userEvent.click(inDialog(markDialog(), "Mark unavailable"));

        expect(await screen.findByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument();
      });
    });

    describe("changing a period", () => {
      async function openChangeDialog(answer: unknown = outcome()) {
        const api = await openWith({ [PERIODS]: [period()], [CHANGE]: answer });
        await userEvent.click(await screen.findByRole("button", { name: "Change period" }));
        return api;
      }

      it("[SPM-45][AC5] opens filled in with the period as it stands", async () => {
        const api = await openChangeDialog();
        const d = changeDialog();

        expect(field(/^Unavailable from/, d)).toHaveValue("2027-06-10");
        expect(field(/^From time/, d)).toHaveValue("13:00");
        expect(field(/^Available again on/, d)).toHaveValue("2027-06-15");
        expect(field(/^Available again at/, d)).toHaveValue("13:00");
        expect(field(/^Reason/, d)).toHaveValue("equipment_failure");
        expect(within(d).queryByLabelText(/^Other reason/)).not.toBeInTheDocument();
        expect(api.sent(CHANGE)).toHaveLength(0);
      });

      it("[SPM-45][AC5] shows the description of an Other reason, ready to edit", async () => {
        await openWith({ [PERIODS]: [period({ reason: "other", otherReason: "Film crew on site" })], [CHANGE]: outcome() });
        await userEvent.click(await screen.findByRole("button", { name: "Change period" }));

        expect(field(/^Reason/, changeDialog())).toHaveValue("other");
        expect(field(/^Other reason/, changeDialog())).toHaveValue("Film crew on site");
      });

      it("[SPM-45][AC5][AC3] sends the new dates and times, then says which bookings are newly flagged", async () => {
        const api = await openChangeDialog(outcome([flagged("Morning Briefing")]));
        fill(changeDialog(), { fromTime: "12:45", until: "2027-06-16", untilTime: "13:15" });
        api.on(PERIODS, [period({ fromTime: "12:45", untilDay: "2027-06-16", untilTime: "13:15" })]);

        await userEvent.click(inDialog(changeDialog(), "Save period"));

        expect(
          await screen.findByText("Unavailable period changed — 1 booking flagged for review, coordinators notified")
        ).toBeInTheDocument();
        expect(api.sent(CHANGE)[0].body).toEqual({
          fromDay: "2027-06-10",
          fromTime: "12:45",
          untilDay: "2027-06-16",
          untilTime: "13:15",
          reason: "equipment_failure",
        });
        expect(await screen.findByText("Unavailable from 10 Jun 2027, 12:45. Available again from 16 Jun 2027, 13:15.")).toBeInTheDocument();
      });

      it("[SPM-45][AC2] refuses a return that is not later than the start", async () => {
        const api = await openChangeDialog();
        fill(changeDialog(), { until: "2027-06-10", untilTime: "13:00" });

        await userEvent.click(inDialog(changeDialog(), "Save period"));

        expect(changeDialog()).toHaveTextContent(AFTER_ERROR);
        expect(api.sent(CHANGE)).toHaveLength(0);
      });
    });

    describe("ending a period early", () => {
      it("[SPM-45][AC5] ends it without a confirmation, says so, and drops it from the list", async () => {
        const api = await openWith({ [PERIODS]: [period()], [END]: { ended: true } });
        await screen.findByText("Equipment failure");
        api.on(PERIODS, []);

        await userEvent.click(button("End period"));

        expect(await screen.findByText("Unavailable period ended")).toBeInTheDocument();
        expect(screen.getByText("The venue can be requested again for the time that was left in the period.")).toBeInTheDocument();
        expect(api.sent(END)).toHaveLength(1);
        expect(await screen.findByText("No unavailable periods under way or coming up.")).toBeInTheDocument();
      });

      it("[SPM-45] says so when the server cannot be reached", async () => {
        await openWith({ [PERIODS]: [period()], [END]: () => Promise.reject(new TypeError("Failed to fetch")) });

        await userEvent.click(await screen.findByRole("button", { name: "End period" }));

        expect(await screen.findByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument();
        expect(screen.getByText("Equipment failure")).toBeInTheDocument();
      });

      it("[SPM-45] shows the error and keeps the period when ending is refused", async () => {
        await openWith({ [PERIODS]: [period()], [END]: reply(400, { error: "This unavailable period is already over." }) });

        await userEvent.click(await screen.findByRole("button", { name: "End period" }));

        expect(await screen.findByText("This unavailable period is already over.")).toBeInTheDocument();
        expect(screen.getByText("Equipment failure")).toBeInTheDocument();
      });
    });
  });

  it("[SPM-39] Back to Venues returns to the catalogue", async () => {
    open();
    await ready();

    await userEvent.click(button("Back to Venues"));

    expect(router.push).toHaveBeenCalledWith("/venues");
  });
});

// @vitest-environment jsdom
//
// S-14 "Find a venue" (SPM-40). Times: the form holds Singapore wall-clock
// values; 05:30Z is 13:30 in Singapore.

import { describe, it, expect } from "vitest";
import VenueSearchPage from "@/app/venues/search/page";
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
  viewer,
  waitFor,
  within,
  type MockApi,
} from "@/test/ui";

const SEARCH = "GET /api/venues/search";
const FACILITIES = "GET /api/facilities";
const REF = "EVT-000007";
const EVENT = `GET /api/events/${REF}`;
const set = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

const facilities = [
  { id: "f-stage", name: "Stage", category: "facility" },
  { id: "f-wifi", name: "Wi-Fi", category: "facility" },
  { id: "f-loop", name: "Hearing loop", category: "accessibility" },
];

const hallA = {
  id: "v1",
  code: "HALL-A",
  name: "Hall A",
  building: "Tower 1",
  floor: "3",
  maxCapacity: 300,
  opensAt: "08:00",
  closesAt: "22:00",
  layouts: [{ layoutName: "theatre", capacity: 300 }, { layoutName: "banquet", capacity: 180 }],
  facilities: [facilities[0], facilities[2]],
};
const roomB = { ...hallA, id: "v2", code: "ROOM-B", name: "Room B", building: "Annex", floor: null, maxCapacity: 40, layouts: [{ layoutName: "boardroom", capacity: 20 }], facilities: [] };

const results = (venues: object[] = [hallA, roomB], checked = 5) => ({
  checked,
  buildings: ["Annex", "Tower 1"],
  results: venues,
});

function open(routes: Record<string, unknown> = {}, { role = "coordinator", query = "", who = {} } = {}) {
  setRoute(`/venues/search${query}`);
  const api = mockApi({ ...signedInAs(role, who), [FACILITIES]: facilities, [SEARCH]: results(), ...routes });
  render(<VenueSearchPage />);
  return api;
}

/// The filters of the most recent search request.
function lastQuery(api: MockApi): Record<string, string> {
  const calls = api.sent(SEARCH);
  return Object.fromEntries(new URLSearchParams(calls[calls.length - 1].url.split("?")[1] ?? ""));
}

const ready = () => screen.findByText(/venues match$/);
const card = (name: string) => screen.getByText(name, { exact: false }).closest("div.rounded-lg") as HTMLElement;
const search = () => userEvent.click(screen.getByRole("button", { name: "Search" }));
const field = (label: RegExp | string) => screen.getByLabelText(label);

describe("Find a venue", () => {
  describe("who can open it", () => {
    it("sends an anonymous visitor to log in", async () => {
      setRoute("/venues/search");
      mockApi(signedOut());

      render(<VenueSearchPage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fsearch"));
    });

    it("remembers the event being searched for across the login", async () => {
      setRoute(`/venues/search?event=${REF}`);
      mockApi(signedOut());

      render(<VenueSearchPage />);

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fsearch%3Fevent%3DEVT-000007")
      );
    });

    it("renders nothing until it knows who is looking", () => {
      setRoute("/venues/search");
      mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

      const { container } = render(<VenueSearchPage />);

      expect(container).toBeEmptyDOMElement();
    });

    it.each(["organiser", "attendee", "tech_support"])("turns %s away", async (role) => {
      open({ [SEARCH]: reply(403, {}) }, { role });

      expect(await screen.findByRole("alert")).toHaveTextContent("Venue search is for ConnectSphere staff.");
      expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    });
  });

  describe("opened on its own", () => {
    it("opens on the whole catalogue, not an empty form", async () => {
      const api = open();

      expect(await screen.findByText("2 of 5 venues match")).toBeInTheDocument();
      expect(lastQuery(api)).toEqual({});
      expect(screen.getByText("Only venues matching every filter you set are shown.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Venues" })).toHaveAttribute("href", "/venues");
    });

    it("describes each venue: where it is, when it is open, its layouts and facilities", async () => {
      open();
      await ready();

      const hall = card("Hall A");

      expect(hall).toHaveTextContent("Tower 1 — 3 · open 08:00–22:00 · max 300 overall");
      expect(hall).toHaveTextContent("Theatre 300, Banquet 180");
      expect(within(within(hall).getByRole("list", { name: "Facilities" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "Stage",
        "Hearing loop",
      ]);
      expect(card("Room B")).toHaveTextContent("Annex · open");
      expect(within(card("Room B")).queryByRole("list", { name: "Facilities" })).not.toBeInTheDocument();
    });

    it("offers no suitability check when no event is being searched for", async () => {
      open();
      await ready();

      expect(screen.queryByRole("link", { name: "Check suitability" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Fill in from")).not.toBeInTheDocument();
    });

    it("splits the facility filters into accessibility and everything else", async () => {
      open();
      await ready();

      const accessibility = screen.getByRole("group", { name: "Accessibility requirements" });
      const other = screen.getByRole("group", { name: "Required facilities" });

      expect(within(accessibility).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label") ?? c.parentElement!.textContent)).toEqual(["Hearing loop"]);
      expect(within(other).getByRole("checkbox", { name: "Stage" })).toBeInTheDocument();
      expect(within(other).getByRole("checkbox", { name: "Wi-Fi" })).toBeInTheDocument();
    });
  });

  describe("searching", () => {
    it("sends only the filters that were set", async () => {
      const api = open();
      await ready();
      set(field("From"), "2027-03-04T13:00");
      set(field("To"), "2027-03-04T18:00");
      set(field("Expected attendance"), "100");
      set(field("Room layout"), "theatre");
      await userEvent.click(screen.getByRole("checkbox", { name: "Hearing loop" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Stage" }));

      await search();

      await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
      expect(lastQuery(api)).toEqual({
        from: "2027-03-04T13:00",
        to: "2027-03-04T18:00",
        attendance: "100",
        layout: "theatre",
        facilityIds: "f-loop,f-stage",
      });
    });

    it("offers the buildings the catalogue has, and filters by the one chosen", async () => {
      const api = open();
      await ready();
      const options = within(field("Location")).getAllByRole("option").map((o) => o.textContent);

      set(field("Location"), "Annex");
      await search();

      expect(options).toEqual(["Any building", "Annex", "Tower 1"]);
      await waitFor(() => expect(lastQuery(api)).toEqual({ building: "Annex" }));
    });

    it("drops a facility that is unticked again", async () => {
      const api = open();
      await ready();
      await userEvent.click(screen.getByRole("checkbox", { name: "Stage" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Stage" }));

      await search();

      await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
      expect(lastQuery(api)).toEqual({});
    });

    it.each([
      ["a start with no end", "2027-03-04T13:00", "", "Give both a start and an end, or clear both."],
      ["an end with no start", "", "2027-03-04T18:00", "Give both a start and an end, or clear both."],
      ["an end before the start", "2027-03-04T18:00", "2027-03-04T13:00", "The end must be after the start."],
    ])("refuses %s without searching", async (_case, from, to, message) => {
      const api = open();
      await ready();
      set(field("From"), from);
      set(field("To"), to);

      await search();

      expect(screen.getByText(message)).toBeInTheDocument();
      expect(field("To")).toBeInvalid();
      expect(api.sent(SEARCH)).toHaveLength(1);
    });

    // The attendance box is a native number input with min=1, and this form
    // does not switch off the browser's own validation - so the browser stops
    // the search before the page's own check ever runs.
    it.each(["0", "-3", "12.5"])("does not search with an attendance of %s", async (attendance) => {
      const api = open();
      await ready();
      set(field("Expected attendance"), attendance);

      await search();

      expect(field("Expected attendance")).toBeInvalid();
      expect(api.sent(SEARCH)).toHaveLength(1);
    });

    it("clears the error once the form is valid again", async () => {
      const api = open();
      await ready();
      set(field("From"), "2027-03-04T13:00");
      await search();
      expect(screen.getByText("Give both a start and an end, or clear both.")).toBeInTheDocument();

      set(field("To"), "2027-03-04T18:00");
      await search();

      await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
      expect(screen.queryByText("Give both a start and an end, or clear both.")).not.toBeInTheDocument();
    });

    it("Clear filters empties the form and searches the whole catalogue again", async () => {
      const api = open();
      await ready();
      set(field("Expected attendance"), "100");
      set(field("Room layout"), "theatre");
      await search();
      await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));

      await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

      await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(3));
      expect(lastQuery(api)).toEqual({});
      expect(field("Expected attendance")).toHaveValue(null);
      expect(field("Room layout")).toHaveValue("");
    });

    it("shows 'Searching…' while a search is in flight", async () => {
      const api = open();
      await ready();
      let finish: (value: unknown) => void = () => {};
      api.on(SEARCH, () => new Promise((resolve) => (finish = resolve)));

      await search();

      expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
      finish(results([hallA], 5));
      expect(await screen.findByText("1 of 5 venues match")).toBeInTheDocument();
    });

    it("lists the facilities that were asked for first on each card", async () => {
      open();
      await ready();

      await userEvent.click(screen.getByRole("checkbox", { name: "Hearing loop" }));
      const listed = within(within(card("Hall A")).getByRole("list", { name: "Facilities" })).getAllByRole("listitem");

      expect(listed.map((li) => li.textContent)).toEqual(["Hearing loop", "Stage"]);
      expect(listed[0].className).toContain("success");
      expect(listed[1].className).not.toContain("success");
    });

    it("emphasises the layout that was asked for on each card", async () => {
      open();
      await ready();

      set(field("Room layout"), "banquet");

      expect(within(card("Hall A")).getByText("Banquet 180").className).toContain("font-medium");
      expect(within(card("Hall A")).getByText("Theatre 300").className).not.toContain("font-medium");
    });
  });

  describe("when nothing matches", () => {
    it("says no venue matches the filters, and suggests widening them", async () => {
      open({ [SEARCH]: results([], 5) });

      expect(await screen.findByText("No venues match these filters")).toBeInTheDocument();
      expect(screen.getByText("0 of 5 venues match")).toBeInTheDocument();
    });

    it("says there are no venues at all when the catalogue is empty", async () => {
      open({ [SEARCH]: results([], 0) });

      expect(await screen.findByText("No venues yet")).toBeInTheDocument();
    });
  });

  describe("when it fails", () => {
    it.each([
      ["the search is refused", { [SEARCH]: reply(403, {}) }, "Venue search is for ConnectSphere staff."],
      ["the search gives a reason", { [SEARCH]: reply(400, { error: "That is not a real date and time" }) }, "That is not a real date and time"],
      ["the search gives no reason", { [SEARCH]: reply(500, {}) }, "Could not search venues."],
      ["the facility list fails to load", { [FACILITIES]: reply(500, {}) }, "Could not load the facility list."],
      ["the server cannot be reached", { [FACILITIES]: () => Promise.reject(new Error("Failed to fetch")) }, "Failed to fetch"],
    ])("says so when %s", async (_case, routes, message) => {
      open(routes);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });

    it.each([FACILITIES, SEARCH])("sends the user to log in when %s says the session has expired", async (route) => {
      open({ [route]: reply(401, {}) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fsearch"));
    });

    it("Retry starts over when the page never loaded", async () => {
      const api = open({ [FACILITIES]: reply(500, {}) });
      await screen.findByRole("alert");

      api.on(FACILITIES, facilities);
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await screen.findByText("2 of 5 venues match")).toBeInTheDocument();
      expect(api.sent(FACILITIES)).toHaveLength(2);
    });

    it("Retry repeats the same search after a refusal, keeping the filters", async () => {
      const api = open();
      await ready();
      api.on(SEARCH, reply(403, {}));
      set(field("Expected attendance"), "100");
      await search();
      await screen.findByRole("alert");

      api.on(SEARCH, results([hallA], 5));
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await screen.findByText("1 of 5 venues match")).toBeInTheDocument();
      expect(lastQuery(api)).toEqual({ attendance: "100" });
      expect(api.sent(FACILITIES)).toHaveLength(1);
    });

    it("Retry recovers after a search that failed outright", async () => {
      const api = open();
      await ready();
      api.on(SEARCH, reply(500, {}));
      await search();
      await screen.findByRole("alert");

      api.on(SEARCH, results([hallA], 5));
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await screen.findByText("1 of 5 venues match")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("opened for an event", () => {
    const me = viewer("coordinator", { id: "c1" });

    function event(overrides: Record<string, unknown> = {}) {
      return {
        id: "event-id",
        sequenceNumber: 7,
        title: "Town Hall",
        status: "planning",
        coordinatorId: "c1",
        startsAt: "2027-03-04T05:30:00.000Z",
        endsAt: "2027-03-04T09:00:00.000Z",
        expectedAttendance: 100,
        preferredLayout: "theatre",
        facilityRequirements: [
          { facilityId: "f-loop", isMandatory: true },
          { facilityId: "f-wifi", isMandatory: false },
        ],
        sessions: [],
        ...overrides,
      };
    }

    function openFor(eventRow: unknown = event(), routes: Record<string, unknown> = {}, role = "coordinator") {
      return open({ [EVENT]: eventRow, ...routes }, { role, query: `?event=${REF}`, who: { id: me.id } });
    }

    it("fills the form from the event's requirements and searches with them", async () => {
      const api = openFor();
      await ready();

      expect(field("From")).toHaveValue("2027-03-04T13:30");
      expect(field("To")).toHaveValue("2027-03-04T17:00");
      expect(field("Expected attendance")).toHaveValue(100);
      expect(field("Room layout")).toHaveValue("theatre");
      expect(lastQuery(api)).toEqual({
        from: "2027-03-04T13:30",
        to: "2027-03-04T17:00",
        attendance: "100",
        layout: "theatre",
        facilityIds: "f-loop",
        event: REF,
      });
    });

    it("copies only the mandatory facilities - a nice-to-have must not rule a venue out", async () => {
      openFor();
      await ready();

      expect(screen.getByRole("checkbox", { name: "Hearing loop" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Wi-Fi" })).not.toBeChecked();
    });

    it("says where the filters came from, and links back to the event", async () => {
      openFor();
      await ready();

      expect(screen.getByText("Filled in from Town Hall's requirements. Change any filter and search again.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: REF })).toHaveAttribute("href", `/events/${REF}`);
      expect(within(card("Hall A")).getByRole("link", { name: "Check suitability" })).toHaveAttribute(
        "href",
        `/events/${REF}/venue`
      );
    });

    it("copes with an event that has no title or requirements yet", async () => {
      const api = openFor(event({ title: null, startsAt: null, endsAt: null, expectedAttendance: null, preferredLayout: null, facilityRequirements: [] }));
      await ready();

      expect(screen.getByText(/Filled in from this event's requirements/)).toBeInTheDocument();
      expect(lastQuery(api)).toEqual({ event: REF });
    });

    it("says so when the event cannot be found, and does not search", async () => {
      const api = openFor(reply(404, {}));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This event doesn't exist, or you don't have access to it."
      );
      expect(api.sent(SEARCH)).toHaveLength(0);
    });

    it("says so when the search itself cannot find the event", async () => {
      openFor(event(), { [SEARCH]: reply(404, {}) });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This event doesn't exist, or you don't have access to it."
      );
    });

    // SPM-68 (written before the code): opened as
    // /venues/search?event=<ref>&booking=<id> the page also reads
    // GET /api/events/<ref>/venue-bookings, fills the form from that booking
    // (searchFromBooking, AC11) and gives each result a "Request booking" link
    // to the existing request form (AC12). Decided here, not in the story:
    // the subtitle's wording, and that the link carries the booking's session.
    describe("replacing a flagged booking (SPM-68)", () => {
      const BOOKINGS = `GET /api/events/${REF}/venue-bookings`;

      function flagged(overrides: Record<string, unknown> = {}) {
        return {
          id: "b-flagged",
          status: "approved",
          // 08:30-19:00 in Singapore, the day after the event's own start.
          startsAt: "2027-03-05T00:30:00.000Z",
          endsAt: "2027-03-05T11:00:00.000Z",
          layoutName: "banquet",
          session: null,
          venue: { id: "v-old", code: "OLD", name: "Old Hall" },
          ...overrides,
        };
      }

      function openToReplace(bookings: unknown[] = [flagged()], eventRow: unknown = event()) {
        return open(
          { [EVENT]: eventRow, [BOOKINGS]: { sessions: [], bookings } },
          { query: `?event=${REF}&booking=b-flagged`, who: { id: me.id } }
        );
      }

      it("fills the form from the booking's date, times and layout and the event's attendance and requirements", async () => {
        const api = openToReplace();
        await ready();

        expect(field("From")).toHaveValue("2027-03-05T08:30");
        expect(field("To")).toHaveValue("2027-03-05T19:00");
        expect(field("Expected attendance")).toHaveValue(100);
        expect(field("Room layout")).toHaveValue("banquet");
        expect(screen.getByRole("checkbox", { name: "Hearing loop" })).toBeChecked();
        expect(screen.getByRole("checkbox", { name: "Wi-Fi" })).not.toBeChecked();
        expect(lastQuery(api)).toEqual({
          from: "2027-03-05T08:30",
          to: "2027-03-05T19:00",
          attendance: "100",
          layout: "banquet",
          facilityIds: "f-loop",
          event: REF,
        });
      });

      it("picks the booking named in the address out of the event's bookings", async () => {
        const other = flagged({ id: "b-other", startsAt: "2027-03-09T01:00:00.000Z", endsAt: "2027-03-09T03:00:00.000Z" });
        openToReplace([other, flagged()]);
        await ready();

        expect(field("From")).toHaveValue("2027-03-05T08:30");
      });

      it("says the filters came from the flagged booking, and at which venue", async () => {
        openToReplace();
        await ready();

        expect(
          screen.getByText("Filled in from the flagged booking at Old Hall. Change any filter and search again.")
        ).toBeInTheDocument();
      });

      it("offers to request each matching venue for the event", async () => {
        openToReplace();
        await ready();

        expect(within(card("Hall A")).getByRole("link", { name: "Request booking" })).toHaveAttribute(
          "href",
          `/events/${REF}/booking/new?venue=v1`
        );
      });

      it("requests the replacement for the same session as a session's booking", async () => {
        openToReplace([flagged({ session: { id: "s1", label: "Day 1" } })]);
        await ready();

        expect(within(card("Hall A")).getByRole("link", { name: "Request booking" })).toHaveAttribute(
          "href",
          `/events/${REF}/booking/new?venue=v1&session=s1`
        );
      });

      it("falls back to the event's own requirements when the booking is not among its bookings", async () => {
        openToReplace([flagged({ id: "b-someone-elses" })]);
        await ready();

        expect(field("From")).toHaveValue("2027-03-04T13:30");
        expect(screen.getByText("Filled in from Town Hall's requirements. Change any filter and search again.")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Request booking" })).not.toBeInTheDocument();
      });

      it("falls back to the event's own requirements when its bookings cannot be read", async () => {
        open(
          { [EVENT]: event(), [BOOKINGS]: reply(403, {}) },
          { query: `?event=${REF}&booking=b-flagged`, who: { id: me.id } }
        );
        await ready();

        expect(field("From")).toHaveValue("2027-03-04T13:30");
      });

      it("copes with a bookings answer that lists none", async () => {
        open({ [EVENT]: event(), [BOOKINGS]: {} }, { query: `?event=${REF}&booking=b-flagged`, who: { id: me.id } });
        await ready();

        expect(field("From")).toHaveValue("2027-03-04T13:30");
      });

      it("sends the user to log in when the session expired before the bookings were read", async () => {
        open(
          { [EVENT]: event(), [BOOKINGS]: reply(401, {}) },
          { query: `?event=${REF}&booking=b-flagged`, who: { id: me.id } }
        );

        await waitFor(() =>
          expect(router.push).toHaveBeenCalledWith(
            "/login?next=%2Fvenues%2Fsearch%3Fevent%3DEVT-000007%26booking%3Db-flagged"
          )
        );
      });

      it("ignores a booking named without an event", async () => {
        const api = open({}, { query: "?booking=b-flagged" });
        await ready();

        expect(api.sent(BOOKINGS)).toHaveLength(0);
        expect(screen.queryByRole("link", { name: "Request booking" })).not.toBeInTheDocument();
      });

      it("remembers the booking being replaced across the login", async () => {
        setRoute(`/venues/search?event=${REF}&booking=b-flagged`);
        mockApi(signedOut());

        render(<VenueSearchPage />);

        await waitFor(() =>
          expect(router.push).toHaveBeenCalledWith(
            "/login?next=%2Fvenues%2Fsearch%3Fevent%3DEVT-000007%26booking%3Db-flagged"
          )
        );
      });

      it("offers no Request booking when the search is not replacing a booking", async () => {
        openFor();
        await ready();

        expect(screen.queryByRole("link", { name: "Request booking" })).not.toBeInTheDocument();
      });
    });

    describe("starting planning", () => {
      const BEGIN =`POST /api/events/${REF}/begin-planning`;
      const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
      const approved = () => event({ status: "approved" });

      it("does not begin planning just because the page was opened", async () => {
        const api = openFor(approved(), { [BEGIN]: { planningStarted: true } });

        await ready();

        expect(api.sent(BEGIN)).toHaveLength(0);
        expect(dialog().open).toBe(false);
        expect(screen.queryByText("Planning has started")).not.toBeInTheDocument();
      });

      it("asks the assigned coordinator before a Search that would begin planning", async () => {
        const api = openFor(approved(), { [BEGIN]: { planningStarted: true } });
        await ready();

        await search();

        expect(dialog().open).toBe(true);
        expect(dialog()).toHaveTextContent("Begin planning?");
        expect(dialog()).toHaveTextContent("it will move from Approved to Planning");
        expect(dialog()).toHaveTextContent("This cannot be undone.");
        expect(api.sent(BEGIN)).toHaveLength(0);
        expect(api.sent(SEARCH)).toHaveLength(1);
      });

      it("on Continue, begins planning, says so, and runs the search", async () => {
        const api = openFor(approved(), { [BEGIN]: { planningStarted: true } });
        await ready();
        await search();

        await userEvent.click(within(dialog()).getByRole("button", { name: "Continue", hidden: true }));

        expect(await screen.findByText("Planning has started")).toBeInTheDocument();
        expect(api.sent(BEGIN)).toHaveLength(1);
        await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
        expect(dialog().open).toBe(false);
      });

      it("on Cancel, leaves the event approved and does not search", async () => {
        const api = openFor(approved(), { [BEGIN]: { planningStarted: true } });
        await ready();
        await search();

        await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

        expect(dialog().open).toBe(false);
        expect(api.sent(BEGIN)).toHaveLength(0);
        expect(api.sent(SEARCH)).toHaveLength(1);
      });

      it("does not ask again once planning has begun", async () => {
        const api = openFor(approved(), { [BEGIN]: { planningStarted: true } });
        await ready();
        await search();
        await userEvent.click(within(dialog()).getByRole("button", { name: "Continue", hidden: true }));
        await screen.findByText("Planning has started");

        await search();

        await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(3));
        expect(dialog().open).toBe(false);
        expect(api.sent(BEGIN)).toHaveLength(1);
      });

      it("says nothing when planning had already begun somewhere else", async () => {
        const api = openFor(approved(), { [BEGIN]: { planningStarted: false } });
        await ready();
        await search();

        await userEvent.click(within(dialog()).getByRole("button", { name: "Continue", hidden: true }));

        await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
        expect(screen.queryByText("Planning has started")).not.toBeInTheDocument();
        expect(screen.queryByText("The event is still Approved")).not.toBeInTheDocument();
      });

      it.each([
        ["the server refuses", reply(403, {})],
        ["the server cannot be reached", () => Promise.reject(new Error("offline"))],
      ])("reports that the event is still approved when %s, and still searches", async (_case, answer) => {
        const api = openFor(approved(), { [BEGIN]: answer });
        await ready();
        await search();

        await userEvent.click(within(dialog()).getByRole("button", { name: "Continue", hidden: true }));

        expect(await screen.findByText("The event is still Approved")).toBeInTheDocument();
        expect(screen.getByText(/The search below still works; try searching\s+again\./)).toBeInTheDocument();
        await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
      });

      it("does not ask about a search the form refuses", async () => {
        openFor(approved(), { [BEGIN]: { planningStarted: true } });
        await ready();
        set(field("To"), "");

        await search();

        expect(dialog().open).toBe(false);
        expect(screen.getByText("Give both a start and an end, or clear both.")).toBeInTheDocument();
      });

      it("Clear filters neither asks nor begins planning", async () => {
        const api = openFor(approved(), { [BEGIN]: { planningStarted: true } });
        await ready();

        await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

        await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
        expect(dialog().open).toBe(false);
        expect(api.sent(BEGIN)).toHaveLength(0);
      });

      it.each([
        ["the event is already in planning", event({ status: "planning" }), "coordinator"],
        ["the event is confirmed", event({ status: "confirmed" }), "coordinator"],
        ["the coordinator is not the one assigned", event({ status: "approved", coordinatorId: "someone-else" }), "coordinator"],
        ["the searcher is the Ops Manager", event({ status: "approved" }), "ops_manager"],
      ])("searches straight away, without asking, when %s", async (_case, eventRow, role) => {
        const api = openFor(eventRow, {}, role);
        await ready();

        await search();

        await waitFor(() => expect(api.sent(SEARCH)).toHaveLength(2));
        expect(dialog().open).toBe(false);
        expect(api.sent(BEGIN)).toHaveLength(0);
      });
    });

    describe("a multi-session event", () => {
      const sessions = [
        { id: "s1", label: "Day 1", startsAt: "2027-03-04T01:00:00.000Z", endsAt: "2027-03-04T04:00:00.000Z", expectedAttendance: 40, preferredLayout: "boardroom" },
        { id: "s2", label: null, startsAt: "2027-03-05T05:00:00.000Z", endsAt: "2027-03-05T10:00:00.000Z", expectedAttendance: null, preferredLayout: null },
      ];

      it("offers to fill in from the whole event or any one session", async () => {
        openFor(event({ sessions }));
        await ready();

        const options = within(field("Fill in from")).getAllByRole("option").map((o) => o.textContent);

        expect(options).toEqual(["Whole event", "Day 1", "Session 2"]);
      });

      it("refills the form from the chosen session's own time, attendance and layout", async () => {
        openFor(event({ sessions }));
        await ready();

        set(field("Fill in from"), "s1");

        expect(field("From")).toHaveValue("2027-03-04T09:00");
        expect(field("To")).toHaveValue("2027-03-04T12:00");
        expect(field("Expected attendance")).toHaveValue(40);
        expect(field("Room layout")).toHaveValue("boardroom");
      });

      it("falls back to the event's attendance and layout for a session that gives none", async () => {
        openFor(event({ sessions }));
        await ready();

        set(field("Fill in from"), "s2");

        expect(field("From")).toHaveValue("2027-03-05T13:00");
        expect(field("Expected attendance")).toHaveValue(100);
        expect(field("Room layout")).toHaveValue("theatre");
      });

      it("goes back to the whole event's values", async () => {
        openFor(event({ sessions }));
        await ready();
        set(field("Fill in from"), "s1");

        set(field("Fill in from"), "");

        expect(field("From")).toHaveValue("2027-03-04T13:30");
        expect(field("Expected attendance")).toHaveValue(100);
      });

      it("Clear filters also resets which session the form was filled from", async () => {
        openFor(event({ sessions }));
        await ready();
        set(field("Fill in from"), "s1");

        await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

        expect(field("Fill in from")).toHaveValue("");
        expect(field("From")).toHaveValue("");
      });
    });
  });
});

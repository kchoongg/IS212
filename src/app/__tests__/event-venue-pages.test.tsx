// @vitest-environment jsdom
//
// SPM-41 / SPM-42: the event's Venue tab and the booking request form, in
// times on a 15-minute grid since SPM-93. Times are written in UTC; Singapore
// is UTC+8, so 05:30Z-09:00Z on 4 March is 13:30-17:00 local.

import { describe, it, expect } from "vitest";
import EventVenuePage from "@/app/events/[id]/venue/page";
import BookingRequestPage from "@/app/events/[id]/booking/new/page";
import { ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";
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
const INFO = `GET /api/events/${REF}/venue-bookings`;
const SUITABILITY = `GET /api/events/${REF}/venue-suitability`;
const set = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

const sessions = [
  { id: "s1", label: "Day 1", startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-04T09:00:00.000Z", preferredLayout: "boardroom", expectedAttendance: 40 },
  { id: "s2", label: null, startsAt: "2027-03-05T01:00:00.000Z", endsAt: "2027-03-05T03:00:00.000Z", preferredLayout: null, expectedAttendance: 12 },
];

function info(overrides: Record<string, unknown> = {}) {
  return {
    event: { title: "Town Hall", preferredLayout: "theatre", expectedAttendance: 100 },
    schedule: { startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-04T09:00:00.000Z" },
    sessions: [],
    cannotRequest: null,
    bookings: [],
    ...overrides,
  };
}

describe("Event Venue tab", () => {
  const hallA = {
    venue: { id: "v1", code: "HALL-A", name: "Hall A", building: "Tower 1", floor: "3", maxCapacity: 300, layouts: [{ layoutName: "theatre", capacity: 300 }, { layoutName: "banquet", capacity: 180 }] },
    suitable: true,
    unmet: [],
    optionalMissing: [],
  };
  const roomB = {
    venue: { id: "v2", code: "ROOM-B", name: "Room B", building: "Annex", floor: null, maxCapacity: 40, layouts: [] },
    suitable: false,
    unmet: [
      { kind: "layout", layoutName: "theatre" },
      { kind: "facility", facilityId: "f1", name: "Hearing loop", category: "accessibility" },
    ],
    optionalMissing: [],
  };

  function suitability(results: object[] = [hallA, roomB], eventOverrides: Record<string, unknown> = {}) {
    return {
      event: { expectedAttendance: 100, preferredLayout: "theatre", requirements: [], missing: [], ...eventOverrides },
      results,
    };
  }

  function open(routes: Record<string, unknown> = {}, role = "coordinator") {
    setRoute(`/events/${REF}/venue`, { id: REF });
    const api = mockApi({ ...signedInAs(role), [INFO]: info(), [SUITABILITY]: suitability(), ...routes });
    render(<EventVenuePage />);
    return api;
  }

  const card = async (name: string) => (await screen.findByText(name, { exact: false })).closest("div.rounded-lg") as HTMLElement;

  it("sends an anonymous visitor to log in", async () => {
    setRoute(`/events/${REF}/venue`, { id: REF });
    mockApi(signedOut());

    render(<EventVenuePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
  });

  it("renders nothing until it knows who is looking", () => {
    setRoute(`/events/${REF}/venue`, { id: REF });
    mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

    const { container } = render(<EventVenuePage />);

    expect(container).toBeEmptyDOMElement();
  });

  it("counts the venues checked and how many suit the event", async () => {
    open();

    expect(await screen.findByText("2 venues checked · 1 suitable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Venue" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Search with filters" })).toHaveAttribute(
      "href",
      "/venues/search?event=EVT-000007"
    );
  });

  // SPM-65: the Attendees tab only where the server says the list is theirs.
  it.each([
    ["the assigned coordinator", true],
    ["a coordinator not assigned to the event", false],
  ])("offers %s the Attendees tab only when the registrations are theirs", async (_who, canView) => {
    open({ [INFO]: info({ canViewRegistrationList: canView }) });

    await screen.findByText("2 venues checked · 1 suitable");
    const tabs = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(
      canView ? ["Overview", "Venue", "Equipment", "Attendees", "Readiness"] : ["Overview", "Venue", "Equipment", "Readiness"]
    );
  });

  it("leaves the space fields empty for an event with no attendance or layout yet", async () => {
    open({ [SUITABILITY]: suitability([hallA], { expectedAttendance: null, preferredLayout: null }) });

    await card("Hall A");

    expect(screen.getByLabelText(/^Expected attendance for this space/)).toHaveValue(null);
    expect(screen.getByLabelText(/^Room layout/)).toHaveValue("");
  });

  it("describes each venue: where it is, its capacity and its layouts", async () => {
    open();

    expect(await card("Hall A")).toHaveTextContent("Tower 1 — 3 · max 300 overall · Theatre 300, Banquet 180");
    expect(await card("Room B")).toHaveTextContent("Annex · max 40 overall");
  });

  it("offers Request booking for a suitable venue only", async () => {
    open();

    const suitable = await card("Hall A");
    const unsuitable = await card("Room B");

    expect(suitable).toHaveTextContent("Suitable");
    expect(within(suitable).getByRole("link", { name: "Request booking" })).toHaveAttribute(
      "href",
      "/events/EVT-000007/booking/new?venue=v1"
    );
    expect(unsuitable).toHaveTextContent("Not suitable");
    expect(within(unsuitable).queryByRole("link", { name: "Request booking" })).not.toBeInTheDocument();
  });

  it("lists every requirement an unsuitable venue fails, one line each", async () => {
    open();

    const reasons = within(await card("Room B")).getAllByRole("listitem").map((li) => li.textContent);

    expect(reasons).toEqual(["Theatre layout is not offered.", "Missing accessibility feature: Hearing loop."]);
  });

  it("notes a missing nice-to-have without calling the venue unsuitable", async () => {
    open({
      [SUITABILITY]: suitability([
        { ...hallA, optionalMissing: [{ kind: "facility", facilityId: "f2", name: "Stage", category: "facility" }] },
      ]),
    });

    const hall = await card("Hall A");

    expect(hall).toHaveTextContent("Nice-to-have not available. Missing facility: Stage.");
    expect(within(hall).getByRole("link", { name: "Request booking" })).toBeInTheDocument();
  });

  it("says which part of the check was skipped when the event has not said what it needs", async () => {
    open({ [SUITABILITY]: suitability([hallA], { missing: ["expectedAttendance", "preferredLayout"] }) });

    expect(await screen.findByText("This check is incomplete")).toBeInTheDocument();
    expect(screen.getByText(/The event has no expected attendance or preferred layout yet/)).toBeInTheDocument();
  });

  it("explains why booking cannot be requested, and offers no Request booking", async () => {
    open({ [INFO]: info({ cannotRequest: "Only the assigned Coordinator can request a venue booking." }) });

    expect(await screen.findByText("Only the assigned Coordinator can request a venue booking.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Request booking" })).not.toBeInTheDocument();
  });

  it("SPM-93-TC01: lists the event's existing booking requests with their times, layout and status", async () => {
    open({
      [INFO]: info({
        bookings: [
          { id: "b1", status: "pending", startsAt: "2027-03-04T05:00:00.000Z", endsAt: "2027-03-04T10:00:00.000Z", layoutName: "theatre", session: null, venue: { code: "HALL-A", name: "Hall A" } },
          { id: "b2", status: "approved", startsAt: "2027-03-05T05:00:00.000Z", endsAt: "2027-03-05T10:00:00.000Z", layoutName: null, session: { id: "s2", label: null }, venue: { code: "ROOM-B", name: "Room B" } },
        ],
      }),
    });

    const requests = (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;

    expect(requests).toHaveTextContent("4 Mar 2027, 13:00–18:00 · Theatre");
    expect(requests).toHaveTextContent("Pending");
    expect(requests).toHaveTextContent("Session · 5 Mar 2027, 13:00–18:00");
    expect(requests).toHaveTextContent("Approved");
  });

  // SPM-82: a pending request is a tentative hold, and says when it expires
  // (AC1); an expired one stays on the record, marked as such (AC8); an
  // approved booking never expires, so it has no expiry line (AC11).
  it("SPM-82-TC06: shows each hold's expiry, marks an expired one, and gives an approved booking none", async () => {
    const at = { startsAt: "2027-03-04T05:00:00.000Z", endsAt: "2027-03-04T10:00:00.000Z", layoutName: "theatre", session: null };
    open({
      [INFO]: info({
        bookings: [
          { id: "b1", status: "pending", holdExpiresAt: "2027-01-15T01:00:00.000Z", ...at, venue: { code: "HALL-A", name: "Hall A" } },
          { id: "b2", status: "expired", holdExpiresAt: "2026-10-01T01:00:00.000Z", ...at, venue: { code: "ROOM-B", name: "Room B" } },
          { id: "b3", status: "approved", holdExpiresAt: "2026-10-01T01:00:00.000Z", ...at, venue: { code: "ROOM-C", name: "Room C" } },
          { id: "b4", status: "pending", holdExpiresAt: null, ...at, venue: { code: "ROOM-D", name: "Room D" } },
          { id: "b5", status: "expired", holdExpiresAt: null, ...at, venue: { code: "ROOM-E", name: "Room E" } },
        ],
      }),
    });

    const requests = (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;
    // Each request is its own block: its venue line, details and badge.
    const row = (code: string) => within(requests).getByText(new RegExp(code)).closest("div.text-sm") as HTMLElement;

    expect(row("HALL-A")).toHaveTextContent("Hold expires 15 Jan 2027, 09:00");
    expect(row("ROOM-B")).toHaveTextContent("Expired");
    expect(row("ROOM-B")).toHaveTextContent("Hold expired on 1 Oct 2026, 09:00");
    expect(row("ROOM-C")).toHaveTextContent("Approved");
    expect(row("ROOM-C")).not.toHaveTextContent(/Hold expire/);
    // A hold made before SPM-82 has no expiry and never expires.
    expect(row("ROOM-D")).not.toHaveTextContent(/Hold expire/);
    // An expired hold whose expiry was not recorded still says it expired.
    expect(row("ROOM-E")).toHaveTextContent("Hold expired");
    expect(row("ROOM-E")).not.toHaveTextContent("Hold expired on");
  });

  it("SPM-81-TC07: lists an event's requests at different venues together, each with its own times and status", async () => {
    open({
      [INFO]: info({
        bookings: [
          { id: "b1", status: "approved", startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-04T09:00:00.000Z", layoutName: "theatre", session: null, venue: { code: "HALL-A", name: "Hall A" } },
          { id: "b2", status: "pending", startsAt: "2027-03-04T05:00:00.000Z", endsAt: "2027-03-04T09:30:00.000Z", layoutName: "theatre", session: null, venue: { code: "ROOM-B", name: "Room B" } },
        ],
      }),
    });

    const requests = (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;
    const row = (venue: string) => within(requests).getByText(venue).closest("div.text-sm") as HTMLElement;

    expect(row("Hall A (HALL-A)")).toHaveTextContent("4 Mar 2027, 13:30–17:00 · Theatre");
    expect(row("Hall A (HALL-A)")).toHaveTextContent("Approved");
    expect(row("Hall A (HALL-A)")).not.toHaveTextContent("Pending");
    expect(row("Room B (ROOM-B)")).toHaveTextContent("4 Mar 2027, 13:00–17:30 · Theatre");
    expect(row("Room B (ROOM-B)")).toHaveTextContent("Pending");
    expect(row("Room B (ROOM-B)")).not.toHaveTextContent("Approved");
  });

  describe("a rejected booking request", () => {
    const rejected = (overrides: Record<string, unknown> = {}) => ({
      id: "b1",
      status: "rejected",
      startsAt: "2027-03-04T05:00:00.000Z",
      endsAt: "2027-03-04T10:00:00.000Z",
      layoutName: "theatre",
      session: null,
      venue: { code: "HALL-A", name: "Hall A" },
      decisionReason: "The hall is being refitted that week.",
      suggestedAlternative: "Free on the Friday instead.",
      suggestedVenue: { id: "v9", code: "ROOM-C", name: "Room C", isActive: true },
      ...overrides,
    });
    const requests = async () =>
      (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;

    it("shows Venue Staff's reason and the alternative they suggested", async () => {
      open({ [INFO]: info({ bookings: [rejected()] }) });

      const card = await requests();

      expect(card).toHaveTextContent("Reason from Venue Staff: The hall is being refitted that week.");
      expect(card).toHaveTextContent("Suggested alternative: Room C (ROOM-C) — Free on the Friday instead.");
    });

    it("offers to request the suggested venue, which only opens the request form", async () => {
      open({ [INFO]: info({ bookings: [rejected()] }) });

      expect(within(await requests()).getByRole("link", { name: "Request this venue" })).toHaveAttribute(
        "href",
        "/events/EVT-000007/booking/new?venue=v9"
      );
    });

    it("carries the session into the request for the suggested venue", async () => {
      open({ [INFO]: info({ sessions, bookings: [rejected({ session: { id: "s2", label: null } })] }) });

      expect(within(await requests()).getByRole("link", { name: "Request this venue" })).toHaveAttribute(
        "href",
        "/events/EVT-000007/booking/new?venue=v9&session=s2"
      );
    });

    it.each([
      ["the suggested venue has since been retired", { suggestedVenue: { id: "v9", code: "ROOM-C", name: "Room C", isActive: false } }, {}],
      ["only a note was suggested, not a venue", { suggestedVenue: null }, {}],
      ["this user cannot request bookings", {}, { cannotRequest: "Only the assigned Coordinator can request a venue booking." }],
    ])("does not offer it when %s", async (_case, bookingOverrides, infoOverrides) => {
      open({ [INFO]: info({ bookings: [rejected(bookingOverrides)], ...infoOverrides }) });

      const card = await requests();

      expect(card).toHaveTextContent("Reason from Venue Staff:");
      expect(within(card).queryByRole("link", { name: "Request this venue" })).not.toBeInTheDocument();
    });

    it("shows a suggestion with no reason, and a reason with no suggestion", async () => {
      open({
        [INFO]: info({
          bookings: [
            rejected({ decisionReason: null, suggestedAlternative: null }),
            rejected({ id: "b2", suggestedVenue: null, suggestedAlternative: null }),
          ],
        }),
      });

      const card = await requests();

      expect(card).toHaveTextContent("Suggested alternative: Room C (ROOM-C)");
      expect(card.textContent!.match(/Reason from Venue Staff:/g)).toHaveLength(1);
      expect(card.textContent!.match(/Suggested alternative:/g)).toHaveLength(1);
    });

    it("adds nothing under a rejection that carries no reason or suggestion", async () => {
      open({ [INFO]: info({ bookings: [rejected({ decisionReason: null, suggestedAlternative: null, suggestedVenue: null })] }) });

      const card = await requests();

      expect(card).toHaveTextContent("Rejected");
      expect(card).not.toHaveTextContent("Reason from Venue Staff");
      expect(card).not.toHaveTextContent("Suggested alternative");
    });

    it("shows no decision details under a request that is not rejected", async () => {
      open({ [INFO]: info({ bookings: [rejected({ status: "approved" })] }) });

      expect(await requests()).not.toHaveTextContent("Reason from Venue Staff");
    });
  });

  describe("SPM-67: withdrawing or releasing a booking", () => {
    const PATCH_B1 = `PATCH /api/events/${REF}/venue-bookings/b1`;
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: "b1",
      status: "pending",
      startsAt: "2027-03-04T05:30:00.000Z",
      endsAt: "2027-03-04T09:00:00.000Z",
      layoutName: "theatre",
      session: null,
      venue: { code: "HALL-A", name: "Hall A" },
      decisionReason: null,
      suggestedAlternative: null,
      suggestedVenue: null,
      cancellationReason: null,
      ...overrides,
    });
    const requests = async () =>
      (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;
    const dialog = () => screen.getByRole("dialog", { hidden: true });

    it("SPM-67-TC07: offers Withdraw request on a pending row and Release booking on an approved one, and nothing on the rest", async () => {
      open({
        [INFO]: info({
          canChangeBookings: true,
          bookings: [
            row({ id: "p", status: "pending" }),
            row({ id: "a", status: "approved", venue: { code: "ROOM-B", name: "Room B" } }),
            row({ id: "r", status: "rejected", venue: { code: "ROOM-C", name: "Room C" } }),
            row({ id: "w", status: "withdrawn", venue: { code: "ROOM-D", name: "Room D" }, cancellationReason: "Wrong room." }),
            row({ id: "x", status: "released", venue: { code: "ROOM-E", name: "Room E" }, cancellationReason: "Merged sessions." }),
          ],
        }),
      });

      const card = await requests();
      const line = (venue: string) => within(card).getByText(venue).closest("div.text-sm") as HTMLElement;

      expect(within(line("Hall A (HALL-A)")).getByRole("button", { name: "Withdraw request" })).toBeInTheDocument();
      expect(within(line("Hall A (HALL-A)")).queryByRole("button", { name: "Release booking" })).not.toBeInTheDocument();
      expect(within(line("Room B (ROOM-B)")).getByRole("button", { name: "Release booking" })).toBeInTheDocument();
      expect(within(line("Room B (ROOM-B)")).queryByRole("button", { name: "Withdraw request" })).not.toBeInTheDocument();
      for (const done of ["Room C (ROOM-C)", "Room D (ROOM-D)", "Room E (ROOM-E)"]) {
        expect(within(line(done)).queryByRole("button")).not.toBeInTheDocument();
      }
      expect(line("Room D (ROOM-D)")).toHaveTextContent("Withdrawn");
      expect(line("Room D (ROOM-D)")).toHaveTextContent("Reason for withdrawal: Wrong room.");
      expect(line("Room E (ROOM-E)")).toHaveTextContent("Released");
      expect(line("Room E (ROOM-E)")).toHaveTextContent("Reason for release: Merged sessions.");
    });

    it("SPM-67-TC08: offers neither to a user who may not change the bookings", async () => {
      open({
        [INFO]: info({
          canChangeBookings: false,
          cannotRequest: "Only the assigned Coordinator can request a venue booking.",
          bookings: [row(), row({ id: "a", status: "approved" })],
        }),
      });

      const card = await requests();

      expect(within(card).queryByRole("button", { name: "Withdraw request" })).not.toBeInTheDocument();
      expect(within(card).queryByRole("button", { name: "Release booking" })).not.toBeInTheDocument();
    });

    it("SPM-67-TC06: shows no reason line when none was given", async () => {
      open({ [INFO]: info({ bookings: [row({ status: "withdrawn" })] }) });

      const card = await requests();

      expect(card).toHaveTextContent("Withdrawn");
      expect(card).not.toHaveTextContent("Reason for withdrawal");
    });

    it("SPM-67-TC01: asks before withdrawing, sends the reason, and says what happened", async () => {
      const api = open({
        [INFO]: info({ canChangeBookings: true, bookings: [row()] }),
        [PATCH_B1]: { id: "b1", status: "withdrawn" },
      });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));

      expect(dialog()).toHaveTextContent("Withdraw this request?");
      expect(dialog()).toHaveTextContent(
        "Hall A (HALL-A) on 4 Mar 2027, 13:30–17:00 will no longer be requested, and Venue Staff will no longer see it on their Booking Requests list."
      );
      expect(within(dialog()).getByRole("button", { name: "Keep request", hidden: true })).toBeInTheDocument();

      api.on(INFO, info({ canChangeBookings: true, bookings: [row({ status: "withdrawn", cancellationReason: "Not needed." })] }));
      fireEvent.change(within(dialog()).getByLabelText("Reason (optional)"), { target: { value: "Not needed." } });
      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      await waitFor(() => expect(api.sent(PATCH_B1)[0].body).toEqual({ action: "withdraw", reason: "Not needed." }));
      expect(await screen.findByText("Request withdrawn")).toBeInTheDocument();
      expect(
        screen.getByText("Hall A (HALL-A) on 4 Mar 2027, 13:30–17:00 is now Withdrawn. You can request another venue below.")
      ).toBeInTheDocument();
      expect(await screen.findByText("Not needed.", { exact: false })).toHaveTextContent("Reason for withdrawal: Not needed.");
    });

    it("still says what happened when the answer has no body", async () => {
      const api = open({ [INFO]: info({ canChangeBookings: true, bookings: [row()] }), [PATCH_B1]: reply(200) });
      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));

      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      await waitFor(() => expect(api.sent(PATCH_B1)).toHaveLength(1));
      expect(await screen.findByText("Request withdrawn")).toBeInTheDocument();
    });

    it("SPM-88: adds that the withdrawal closed the event's safety check", async () => {
      const api = open({
        [INFO]: info({ canChangeBookings: true, bookings: [row()] }),
        [PATCH_B1]: { id: "b1", status: "withdrawn", safetyCheckClosed: true },
      });
      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));

      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      await waitFor(() => expect(api.sent(PATCH_B1)).toHaveLength(1));
      expect(
        await screen.findByText(
          "Hall A (HALL-A) on 4 Mar 2027, 13:30–17:00 is now Withdrawn. You can request another venue below. The event's safety check was closed and it is back in Planning. Submit it for a safety check again once the arrangements are settled."
        )
      ).toBeInTheDocument();
    });

    it("SPM-67-TC03: asks before releasing, and says Venue Staff have been notified", async () => {
      const api = open({
        [INFO]: info({ canChangeBookings: true, bookings: [row({ status: "approved" })] }),
        [PATCH_B1]: { id: "b1", status: "released" },
      });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Release booking" }));

      expect(dialog()).toHaveTextContent("Release this booking?");
      expect(dialog()).toHaveTextContent(
        "Hall A (HALL-A) on 4 Mar 2027, 13:30–17:00 will be freed for other events, and Venue Staff will be notified."
      );
      expect(within(dialog()).getByRole("button", { name: "Keep booking", hidden: true })).toBeInTheDocument();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Release booking", hidden: true }));

      await waitFor(() => expect(api.sent(PATCH_B1)[0].body).toEqual({ action: "release" }));
      expect(await screen.findByText("Booking released")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Hall A (HALL-A) on 4 Mar 2027, 13:30–17:00 is now Released. Venue Staff have been notified. You can request another venue below."
        )
      ).toBeInTheDocument();
    });

    it("sends nothing when the Coordinator keeps the request", async () => {
      const api = open({ [INFO]: info({ canChangeBookings: true, bookings: [row()] }), [PATCH_B1]: {} });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Keep request", hidden: true }));

      expect(api.sent(PATCH_B1)).toHaveLength(0);
    });

    it("shows the server's refusal and reloads the bookings, which may have changed meanwhile", async () => {
      const refusal = "This request has already been approved, so it can no longer be withdrawn. Release the booking instead.";
      const api = open({
        [INFO]: info({ canChangeBookings: true, bookings: [row()] }),
        [PATCH_B1]: reply(400, { error: refusal }),
      });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));
      api.on(INFO, info({ canChangeBookings: true, bookings: [row({ status: "approved" })] }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      expect(await screen.findByText(refusal)).toBeInTheDocument();
      expect(await within(await requests()).findByRole("button", { name: "Release booking" })).toBeInTheDocument();
    });

    it.each([
      ["names the session", { id: "s1", label: "Day 1" }, "Hall A (HALL-A) for Day 1 on"],
      ["calls an unnamed session 'Session'", { id: "s1", label: null }, "Hall A (HALL-A) for Session on"],
    ])("%s a withdrawn request was for", async (_case, session, expected) => {
      open({
        [INFO]: info({ canChangeBookings: true, bookings: [row({ session })] }),
        [PATCH_B1]: { id: "b1", status: "withdrawn" },
      });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      expect(await screen.findByText(expected, { exact: false })).toHaveTextContent(" is now Withdrawn.");
    });

    it("says the change was not saved when the refusal has no body", async () => {
      open({ [INFO]: info({ canChangeBookings: true, bookings: [row()] }), [PATCH_B1]: reply(409) });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      expect(await screen.findByText("Could not save the change. Please try again.")).toBeInTheDocument();
    });

    it("says the change was not saved when the server cannot be reached", async () => {
      open({
        [INFO]: info({ canChangeBookings: true, bookings: [row()] }),
        [PATCH_B1]: () => Promise.reject(new TypeError("Failed to fetch")),
      });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      expect(await screen.findByText("Could not save the change. Please try again.")).toBeInTheDocument();
    });

    it("sends the user to log in when the session has expired", async () => {
      open({ [INFO]: info({ canChangeBookings: true, bookings: [row()] }), [PATCH_B1]: reply(401, {}) });

      await userEvent.click(within(await requests()).getByRole("button", { name: "Withdraw request" }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Withdraw request", hidden: true }));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
    });
  });

  it("shows no booking requests card when there are none", async () => {
    open();

    await card("Hall A");

    expect(screen.queryByRole("heading", { name: "Booking requests" })).not.toBeInTheDocument();
  });

  describe("a multi-session event", () => {
    it("has no session picker on an ordinary event", async () => {
      const api = open();

      await card("Hall A");

      expect(screen.queryByLabelText("Session")).not.toBeInTheDocument();
      expect(api.sent(SUITABILITY)[0].url).toBe(`/api/events/${REF}/venue-suitability`);
    });

    it("judges venues for the first session by default, and carries it into Request booking", async () => {
      const api = open({ [INFO]: info({ sessions }) });

      const hall = await card("Hall A");

      expect(api.sent(SUITABILITY)[0].url).toBe(`/api/events/${REF}/venue-suitability?session=s1`);
      expect(screen.getByLabelText("Session")).toHaveValue("s1");
      expect(within(hall).getByRole("link", { name: "Request booking" })).toHaveAttribute(
        "href",
        "/events/EVT-000007/booking/new?venue=v1&session=s1"
      );
    });

    it("names an unlabelled session 'Session', with its times", async () => {
      open({ [INFO]: info({ sessions }) });
      await card("Hall A");

      const options = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => o.textContent);

      expect(options[0]).toMatch(/^Day 1 — 4 Mar 2027/);
      expect(options[1]).toMatch(/^Session — 5 Mar 2027/);
    });

    it("re-checks every venue when another session is chosen", async () => {
      const api = open({ [INFO]: info({ sessions }) });
      await card("Hall A");

      await userEvent.selectOptions(screen.getByLabelText("Session"), "s2");

      await waitFor(() =>
        expect(api.sent(SUITABILITY).map((c) => c.url)).toContain(`/api/events/${REF}/venue-suitability?session=s2`)
      );
    });
  });

  // SPM-85 (AC7): a role without venue:view - the Safety Officer among them -
  // who types this address is refused before anything is asked for, so no
  // venue, booking or suitability result ever reaches the page.
  describe("for a role that may not search for venues", () => {
    it.each(ROLES.filter((role) => !can(role, "venue:view")))(
      "refuses %s without loading anything",
      async (role) => {
        const api = open({}, role);

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("You do not have access to this");
        expect(alert).toHaveTextContent(
          "Finding and booking a venue is for the Event Coordinator. The rooms booked for this event are on its Overview."
        );
        expect(api.sent(INFO)).toHaveLength(0);
        expect(api.sent(SUITABILITY)).toHaveLength(0);
        expect(screen.queryByRole("link", { name: "Search with filters" })).not.toBeInTheDocument();
      }
    );
  });

  describe("when it cannot be loaded", () => {
    it.each([
      ["the event is not found", { [INFO]: reply(404, {}) }, "This event doesn't exist, or you don't have access to it."],
      ["the booking requests fail to load", { [INFO]: reply(500, {}) }, "Could not load this event's booking requests."],
      ["the suitability check is refused", { [SUITABILITY]: reply(403, {}) }, "Venue suitability is for ConnectSphere staff."],
      ["the suitability check cannot find the event", { [SUITABILITY]: reply(404, {}) }, "This event doesn't exist, or you don't have access to it."],
      ["the suitability check fails", { [SUITABILITY]: reply(500, {}) }, "Could not check venues for this event."],
    ])("says so when %s", async (_case, routes, message) => {
      open(routes);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });

    it("shows a general error when the check fails without a reason", async () => {
      open({ [SUITABILITY]: () => Promise.reject("offline") });

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("offers a Retry that loads again", async () => {
      const api = open({ [SUITABILITY]: reply(500, {}) });
      await screen.findByRole("alert");

      api.on(SUITABILITY, suitability());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await card("Hall A")).toBeInTheDocument();
    });

    it.each([INFO, SUITABILITY])("sends the user to log in when %s answers that the session has expired", async (route) => {
      open({ [route]: reply(401, {}) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
    });
  });
});

describe("Venue booking request form", () => {
  const VENUE = "GET /api/venues/v1";
  const POST = `POST /api/events/${REF}/venue-bookings`;

  const venue = (overrides: Record<string, unknown> = {}) => ({
    id: "v1",
    code: "HALL-A",
    name: "Hall A",
    setupMinutes: 0,
    teardownMinutes: 0,
    ...overrides,
  });

  function open(routes: Record<string, unknown> = {}, query = "?venue=v1") {
    setRoute(`/events/${REF}/booking/new${query}`, { id: REF });
    const api = mockApi({
      ...signedInAs("coordinator"),
      [INFO]: info(),
      [VENUE]: venue(),
      [POST]: reply(201, { id: "b1" }),
      ...routes,
    });
    render(<BookingRequestPage />);
    return api;
  }

  const date = () => screen.findByLabelText(/^Date/);
  const start = () => screen.getByLabelText(/^Start time/);
  const end = () => screen.getByLabelText(/^End time/);
  const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit request" }));
  const valueOf = (label: string) =>
    screen.getAllByRole("term").find((t) => t.textContent === label)!.nextElementSibling as HTMLElement;

  it("sends an anonymous visitor to log in", async () => {
    setRoute(`/events/${REF}/booking/new?venue=v1`, { id: REF });
    mockApi(signedOut());

    render(<BookingRequestPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
  });

  it("shows a placeholder while it loads", async () => {
    open({ [VENUE]: () => new Promise(() => {}) });

    expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("opened without a venue in the address, shows an error instead of a form", async () => {
    open({ "GET /api/venues/null": reply(404, {}) }, "");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this");
    expect(screen.queryByLabelText(/^Date/)).not.toBeInTheDocument();
  });

  it.each([
    ["the venue", { [VENUE]: reply(404, {}) }],
    ["the event", { [INFO]: reply(404, {}) }],
  ])("says so when %s cannot be found", async (_case, routes) => {
    open(routes);

    expect(await screen.findByRole("alert")).toHaveTextContent("This event or venue could not be found.");
  });

  it("shows a general error when loading fails without a reason", async () => {
    open({ [VENUE]: () => Promise.reject("offline") });

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("sends the user to log in when their session has expired", async () => {
    open({ [VENUE]: reply(401, {}) });

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
  });

  describe("what it starts with", () => {
    it("the event, venue and layout being requested", async () => {
      open();
      await date();

      expect(valueOf("Event")).toHaveTextContent("Town Hall");
      expect(valueOf("Venue")).toHaveTextContent("Hall A");
      expect(screen.getByLabelText(/^Room layout/)).toHaveValue("theatre");
      expect(screen.queryByText("Session")).not.toBeInTheDocument();
    });

    it("SPM-93-TC01: the event's own date and times, and no AM / PM / Night choice", async () => {
      open();

      expect(await date()).toHaveValue("2027-03-04");
      expect(start()).toHaveValue("13:30");
      expect(end()).toHaveValue("17:00");
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("SPM-93-TC01: an event off the 15-minute grid is widened to it", async () => {
      open({ [INFO]: info({ schedule: { startsAt: "2027-03-04T06:10:00.000Z", endsAt: "2027-03-04T07:50:00.000Z" } }) });

      expect(await date()).toHaveValue("2027-03-04");
      expect(start()).toHaveValue("14:00");
      expect(end()).toHaveValue("16:00");
    });

    it("SPM-93-TC02: a session's own date, times and layout when one is named", async () => {
      open({ [INFO]: info({ sessions }) }, "?venue=v1&session=s2");

      // 09:00-11:00 Singapore time on 5 March.
      expect(await date()).toHaveValue("2027-03-05");
      expect(start()).toHaveValue("09:00");
      expect(end()).toHaveValue("11:00");
      expect(valueOf("Session")).toHaveTextContent(/^Session — 5 Mar 2027/);
      expect(screen.getByLabelText(/^Room layout/)).toHaveValue("");
    });

    it("names a labelled session by its label", async () => {
      open({ [INFO]: info({ sessions }) }, "?venue=v1&session=s1");
      await date();

      expect(valueOf("Session")).toHaveTextContent(/^Day 1 — 4 Mar 2027/);
      expect(screen.getByLabelText(/^Room layout/)).toHaveValue("boardroom");
    });

    it.each([
      ["has no dates yet", { startsAt: null, endsAt: null }],
      ["runs over more than one day", { startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-05T09:00:00.000Z" }],
    ])("nothing filled in when the event %s", async (_case, schedule) => {
      open({ [INFO]: info({ schedule, event: { title: null, preferredLayout: null } }) });

      expect(await date()).toHaveValue("");
      expect(start()).toHaveValue("");
      expect(end()).toHaveValue("");
      expect(valueOf("Event")).toHaveTextContent("Untitled event");
      expect(screen.getByLabelText(/^Room layout/)).toHaveValue("");
    });
  });

  describe("setup, turnaround and the room in use", () => {
    it("SPM-93-TC08: says none is needed at a venue that needs none, and the room is in use for the booked times", async () => {
      open();
      await date();

      expect(screen.getByText("No setup or turnaround needed at this venue.")).toBeInTheDocument();
      expect(screen.getByText("Room in use: 13:30–17:00")).toBeInTheDocument();
      expect(screen.queryByText(/^Setup:/)).not.toBeInTheDocument();
    });

    it("SPM-93-TC01: shows the times setup and turnaround take either side, which the coordinator does not choose", async () => {
      open({ [VENUE]: venue({ setupMinutes: 30, teardownMinutes: 45 }) });
      await date();

      expect(screen.getByText("Setup: 13:00–13:30 (30 min)")).toBeInTheDocument();
      expect(screen.getByText("Turnaround: 17:00–17:45 (45 min)")).toBeInTheDocument();
      expect(screen.getByText("Room in use: 13:00–17:45")).toBeInTheDocument();
    });

    it("SPM-93-TC09: follows the times as they are changed", async () => {
      open({ [VENUE]: venue({ setupMinutes: 30, teardownMinutes: 45 }) });
      await date();

      set(end(), "17:15");

      expect(screen.getByText("Turnaround: 17:15–18:00 (45 min)")).toBeInTheDocument();
      expect(screen.getByText("Room in use: 13:00–18:00")).toBeInTheDocument();
    });

    it("shows only setup at a venue with no turnaround", async () => {
      open({ [VENUE]: venue({ setupMinutes: 15 }) });
      await date();

      expect(screen.getByText("Setup: 13:15–13:30 (15 min)")).toBeInTheDocument();
      expect(screen.queryByText(/^Turnaround:/)).not.toBeInTheDocument();
      expect(screen.queryByText("No setup or turnaround needed at this venue.")).not.toBeInTheDocument();
    });

    it("shows no room-in-use period while no date is chosen", async () => {
      open({ [VENUE]: venue({ setupMinutes: 30, teardownMinutes: 45 }) });
      set(await date(), "");

      expect(screen.queryByText(/^Room in use:/)).not.toBeInTheDocument();
    });

    it("shows nothing while the times cannot be booked", async () => {
      open({ [VENUE]: venue({ setupMinutes: 30, teardownMinutes: 45 }) });
      await date();

      set(start(), "13:40");

      expect(screen.queryByText(/^Setup:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Room in use:/)).not.toBeInTheDocument();
    });
  });

  describe("SPM-93-TC03: times that are refused, and named", () => {
    it.each([
      ["a start time off the grid", () => set(start(), "13:40"), /^Start time/, "Choose a start time on a 15-minute step (:00, :15, :30 or :45)."],
      ["an end time off the grid", () => set(end(), "17:20"), /^End time/, "Choose an end time on a 15-minute step (:00, :15, :30 or :45)."],
      ["an end equal to the start", () => set(end(), "13:30"), /^End time/, "The end time must be after the start time."],
      ["an end before the start", () => set(end(), "13:15"), /^End time/, "The end time must be after the start time."],
      ["an empty start time", () => set(start(), ""), /^Start time/, "Choose a start time on a 15-minute step (:00, :15, :30 or :45)."],
    ])("%s: the message is under that field and nothing is sent", async (_case, breakIt, field, message) => {
      const api = open();
      await date();

      breakIt();
      await submit();

      expect(screen.getByLabelText(field)).toHaveAccessibleDescription(expect.stringContaining(message));
      expect(api.sent(POST)).toHaveLength(0);
    });

    it("names both times when both are off the grid", async () => {
      open();
      await date();

      set(start(), "13:40");
      set(end(), "17:20");
      await submit();

      expect(screen.getByText("Choose a start time on a 15-minute step (:00, :15, :30 or :45).")).toBeInTheDocument();
      expect(screen.getByText("Choose an end time on a 15-minute step (:00, :15, :30 or :45).")).toBeInTheDocument();
    });

    it("clears the message as soon as a time is changed", async () => {
      open();
      await date();
      set(start(), "13:40");
      await submit();

      set(start(), "13:30");

      expect(screen.queryByText(/on a 15-minute step/)).not.toBeInTheDocument();
    });

    it("puts a refusal the server names a field for under that field", async () => {
      open({ [POST]: reply(400, { error: "The end time must be after the start time.", field: "endTime" }) });
      await date();

      await submit();

      expect(await screen.findByText("The end time must be after the start time.")).toBeInTheDocument();
      expect(screen.getByLabelText(/^End time/)).toHaveAccessibleDescription(
        expect.stringContaining("The end time must be after the start time.")
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("submitting", () => {
    it("SPM-93-TC01: sends the venue, date, times and requirements, then confirms it is pending", async () => {
      const api = open();
      set(await date(), "2027-03-06");
      set(start(), "13:15");
      set(end(), "18:00");
      set(screen.getByLabelText("Venue requirements"), "Stage at the north end");

      await submit();

      expect(await screen.findByText("Booking request sent to Venue Staff.")).toBeInTheDocument();
      expect(api.sent(POST)[0].body).toEqual({
        venueId: "v1",
        day: "2027-03-06",
        startTime: "13:15",
        endTime: "18:00",
        requirementsNote: "Stage at the north end",
        // SPM-90: the space, left as the form opened - the event's own (AC2).
        purpose: "Main programme",
        expectedAttendance: 100,
        layoutName: "theatre",
      });
      expect(screen.getByText("It is Pending until Venue Staff review it.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to Venue" })).toHaveAttribute("href", "/events/EVT-000007/venue");
      expect(screen.queryByRole("button", { name: "Submit request" })).not.toBeInTheDocument();
    });

    it("confirms a request the server accepts without a body", async () => {
      open({ [POST]: reply(201) });
      await date();

      await submit();

      expect(await screen.findByText("Booking request sent to Venue Staff.")).toBeInTheDocument();
    });

    it("sends the session when the request is for one", async () => {
      const api = open({ [INFO]: info({ sessions }) }, "?venue=v1&session=s1");
      await date();

      await submit();

      await waitFor(() => expect(api.sent(POST)).toHaveLength(1));
      expect(api.sent(POST)[0].body).toMatchObject({
        venueId: "v1",
        sessionId: "s1",
        day: "2027-03-04",
        startTime: "13:30",
        endTime: "17:00",
        // SPM-90: the session's own attendance and layout.
        expectedAttendance: 40,
        layoutName: "boardroom",
      });
    });

    it.each([
      ["the server's reason", reply(400, { error: "Hall A is already booked for this time." }), "Hall A is already booked for this time."],
      ["plain words for a validation failure", reply(400, { error: "Validation failed", details: {} }), "Check the date and times, then try again."],
      ["a network failure", () => Promise.reject(new Error("offline")), "Could not send the request. Try again."],
    ])("shows %s and keeps the form", async (_case, answer, message) => {
      open({ [POST]: answer });
      await date();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled();
      expect(screen.queryByText("Booking request sent to Venue Staff.")).not.toBeInTheDocument();
    });

    it("shows 'Submitting…' and cannot be pressed twice while in flight", async () => {
      let finish: (value: unknown) => void = () => {};
      const api = open({ [POST]: () => new Promise((resolve) => (finish = resolve)) });
      await date();

      await submit();

      expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
      finish({ id: "b1" });
      await screen.findByText("Booking request sent to Venue Staff.");
      expect(api.sent(POST)).toHaveLength(1);
    });
  });

  describe("when the request would begin planning", () => {
    const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
    const firstRequest = (answer: unknown = reply(201, { id: "b1", planningStarted: true })) =>
      open({ [INFO]: info({ willBeginPlanning: true }), [POST]: answer });

    it("asks first, and sends nothing until the coordinator continues", async () => {
      const api = firstRequest();
      await date();

      await submit();

      expect(dialog().open).toBe(true);
      expect(dialog()).toHaveTextContent("it will move from Approved to Planning");
      expect(api.sent(POST)).toHaveLength(0);
    });

    it("on Continue, sends the request and says planning has started", async () => {
      const api = firstRequest();
      await date();
      await submit();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Continue", hidden: true }));

      expect(await screen.findByText("Booking request sent to Venue Staff.")).toBeInTheDocument();
      expect(screen.getByText("Planning has started")).toBeInTheDocument();
      expect(api.sent(POST)).toHaveLength(1);
      expect(dialog().open).toBe(false);
    });

    it("on Cancel, sends nothing and keeps the form", async () => {
      const api = firstRequest();
      await date();
      await submit();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(POST)).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Submit request" })).toBeInTheDocument();
    });

    it("closes the question and shows the error when the request is refused", async () => {
      firstRequest(reply(400, { error: "Hall A is already booked for this time." }));
      await date();
      await submit();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Continue", hidden: true }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Hall A is already booked for this time.");
      expect(dialog().open).toBe(false);
    });
  });

  it("does not ask, or mention planning, for an event already in planning", async () => {
    const api = open({ [POST]: reply(201, { id: "b1", planningStarted: false }) });
    await date();

    await submit();

    expect(await screen.findByText("Booking request sent to Venue Staff.")).toBeInTheDocument();
    expect(api.sent(POST)).toHaveLength(1);
    expect(screen.queryByText("Planning has started")).not.toBeInTheDocument();
  });

  // SPM-88 (AC5, AC6): a booking request closes the safety check the event rests on.
  it("SPM-88: says when the request closed the event's safety check", async () => {
    open({ [POST]: reply(201, { id: "b1", planningStarted: false, safetyCheckClosed: true }) });
    await date();

    await submit();

    expect(await screen.findByText("The safety check was closed")).toBeInTheDocument();
    expect(screen.getByText("The event's safety check was closed and it is back in Planning. Submit it for a safety check again once the arrangements are settled.")).toBeInTheDocument();
  });

  it("says nothing about a safety check the request did not close", async () => {
    open({ [POST]: reply(201, { id: "b1", planningStarted: false, safetyCheckClosed: false }) });
    await date();

    await submit();

    await screen.findByText("Booking request sent to Venue Staff.");
    expect(screen.queryByText("The safety check was closed")).not.toBeInTheDocument();
  });

  it("shows the reason instead of the form when a booking cannot be requested", async () => {
    open({ [INFO]: info({ cannotRequest: "A venue cannot be requested for a completed, cancelled or rejected event." }) });

    expect(
      await screen.findByText("A venue cannot be requested for a completed, cancelled or rejected event.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Date/)).not.toBeInTheDocument();
  });

  it("Cancel goes back to the event's Venue tab", async () => {
    open();
    await date();

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/events/EVT-000007/venue");
  });
});

// CONTRACT (SPM-90, written before the code) - what these tests expect:
//   Venue tab: a card headed "The space you need" with "Expected attendance for
//     this space" and "Room layout", started on what the suitability check
//     answered (the event's or session's own), and a "Check venues" button that
//     asks again with ?attendance=<n>&layout=<name> and adds the same two to
//     every "Request booking" link. An attendance below 1 asks nothing and says
//     "Enter a whole number of at least 1."
//   Booking requests card: "<purpose> · <session> · <times> · <layout> · <n> attendees".
//   Request form: "What is this space for?" ("Main programme" for the event's or
//     session's first pending or approved booking, otherwise empty), "Expected
//     attendance for this space" and "Room layout", from the address when it
//     carries them, else the session's or event's own. Sent as purpose,
//     expectedAttendance and layoutName. "Say what this space is for." and
//     "Enter a whole number of at least 1." are shown under their fields.
// Decided here, not in the story: every label and message above.
describe("SPM-90: the space a venue is needed for", () => {
  const purpose = () => screen.getByLabelText(/^What is this space for\?/);
  const attendance = () => screen.getByLabelText(/^Expected attendance for this space/);
  const layout = () => screen.getByLabelText(/^Room layout/);

  describe("on the Venue tab", () => {
    const hall = {
      venue: { id: "v1", code: "HALL-A", name: "Hall A", building: "Tower 1", floor: "3", maxCapacity: 300, layouts: [{ layoutName: "theatre", capacity: 300 }, { layoutName: "classroom", capacity: 120 }] },
      suitable: true,
      unmet: [],
      optionalMissing: [],
    };
    /// Answers with the space it was asked about, as the route does.
    const judged = (call: { url: string }) => {
      const query = new URLSearchParams(call.url.split("?")[1] ?? "");
      return {
        event: {
          expectedAttendance: Number(query.get("attendance") ?? 100),
          preferredLayout: query.get("layout") ?? "theatre",
          requirements: [],
          missing: [],
        },
        results: [hall],
      };
    };

    function open(routes: Record<string, unknown> = {}) {
      setRoute(`/events/${REF}/venue`, { id: REF });
      const api = mockApi({ ...signedInAs("coordinator"), [INFO]: info(), [SUITABILITY]: judged, ...routes });
      render(<EventVenuePage />);
      return api;
    }

    const ready = () => screen.findByRole("heading", { name: "The space you need" });
    const check = () => userEvent.click(screen.getByRole("button", { name: "Check venues" }));

    it("SPM-90-TC01: starts on the event's own attendance and layout", async () => {
      const api = open();
      await ready();

      expect(attendance()).toHaveValue(100);
      expect(layout()).toHaveValue("theatre");
      expect(api.sent(SUITABILITY)[0].url).toBe(`/api/events/${REF}/venue-suitability`);
    });

    it("SPM-90-TC02: checks every venue again for the space, and carries it into Request booking", async () => {
      const api = open();
      await ready();

      set(attendance(), "20");
      await userEvent.selectOptions(layout(), "classroom");
      await check();

      await waitFor(() =>
        expect(api.sent(SUITABILITY).map((c) => c.url)).toContain(
          `/api/events/${REF}/venue-suitability?attendance=20&layout=classroom`
        )
      );
      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Request booking" })).toHaveAttribute(
          "href",
          "/events/EVT-000007/booking/new?venue=v1&attendance=20&layout=classroom"
        )
      );
      expect(attendance()).toHaveValue(20);
      expect(layout()).toHaveValue("classroom");
    });

    it("checks for a space with no layout set, and carries that into Request booking too", async () => {
      const api = open();
      await ready();

      await userEvent.selectOptions(layout(), "");
      await check();

      await waitFor(() =>
        expect(api.sent(SUITABILITY).map((c) => c.url)).toContain(
          `/api/events/${REF}/venue-suitability?attendance=100&layout=`
        )
      );
      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Request booking" })).toHaveAttribute(
          "href",
          "/events/EVT-000007/booking/new?venue=v1&attendance=100&layout="
        )
      );
    });

    it("SPM-90-TC11: goes back to a session's own attendance and layout when another session is chosen", async () => {
      const api = open({ [INFO]: info({ sessions }) });
      await ready();
      set(attendance(), "20");
      await check();
      await waitFor(() => expect(api.sent(SUITABILITY).at(-1)?.url).toContain("session=s1&attendance=20"));
      await waitFor(() => expect(attendance()).toHaveValue(20));

      await userEvent.selectOptions(screen.getByLabelText("Session"), "s2");

      await waitFor(() =>
        expect(api.sent(SUITABILITY).map((c) => c.url)).toContain(`/api/events/${REF}/venue-suitability?session=s2`)
      );
      await waitFor(() => expect(attendance()).toHaveValue(100));
    });

    it("clears the message as soon as the attendance is changed", async () => {
      open();
      await ready();
      set(attendance(), "0");
      await check();
      expect(await screen.findByText("Enter a whole number of at least 1.")).toBeInTheDocument();

      set(attendance(), "5");

      expect(screen.queryByText("Enter a whole number of at least 1.")).not.toBeInTheDocument();
    });

    it("keeps the session with the space", async () => {
      const api = open({ [INFO]: info({ sessions }) });
      await ready();

      set(attendance(), "20");
      await userEvent.selectOptions(layout(), "classroom");
      await check();

      // A longer wait than the default 1s: CI's runner was slow enough to time out here.
      await waitFor(
        () =>
          expect(api.sent(SUITABILITY).map((c) => c.url)).toContain(
            `/api/events/${REF}/venue-suitability?session=s1&attendance=20&layout=classroom`
          ),
        { timeout: 3000 }
      );
    });

    it.each(["0", "", "2.5"])("does not check for an attendance of '%s', and says why", async (value) => {
      const api = open();
      await ready();

      set(attendance(), value);
      await check();

      expect(await screen.findByText("Enter a whole number of at least 1.")).toBeInTheDocument();
      expect(api.sent(SUITABILITY)).toHaveLength(1);
    });

    it("SPM-90-TC07: lists each request with what its space is for, its layout and its attendance", async () => {
      const times = { startsAt: "2027-03-04T05:00:00.000Z", endsAt: "2027-03-04T10:00:00.000Z" };
      open({
        [INFO]: info({
          bookings: [
            { id: "b1", status: "approved", ...times, layoutName: "theatre", purpose: "Main programme", expectedAttendance: 150, session: null, venue: { code: "HALL-A", name: "Hall A" } },
            { id: "b2", status: "pending", ...times, layoutName: "classroom", purpose: "Breakout room", expectedAttendance: 20, session: { id: "s1", label: "Day 1" }, venue: { code: "ROOM-B", name: "Room B" } },
          ],
        }),
      });

      const requests = (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;

      expect(requests).toHaveTextContent("Main programme · 4 Mar 2027, 13:00–18:00 · Theatre · 150 attendees");
      expect(requests).toHaveTextContent("Breakout room · Day 1 · 4 Mar 2027, 13:00–18:00 · Classroom · 20 attendees");
    });

    it("SPM-90-TC10: lists a booking made before, without a purpose", async () => {
      open({
        [INFO]: info({
          bookings: [
            { id: "b1", status: "approved", startsAt: "2027-03-04T05:00:00.000Z", endsAt: "2027-03-04T10:00:00.000Z", layoutName: "theatre", purpose: null, expectedAttendance: 100, session: null, venue: { code: "HALL-A", name: "Hall A" } },
          ],
        }),
      });

      const requests = (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;

      expect(requests).toHaveTextContent("Hall A (HALL-A)4 Mar 2027, 13:00–18:00 · Theatre · 100 attendees");
    });
  });

  describe("on the request form", () => {
    const POST = `POST /api/events/${REF}/venue-bookings`;
    const venue = { id: "v1", code: "HALL-A", name: "Hall A", setupMinutes: 0, teardownMinutes: 0 };
    const held = (status: string, session: { id: string; label: string | null } | null = null) => ({
      id: "b1",
      status,
      startsAt: "2027-03-04T05:30:00.000Z",
      endsAt: "2027-03-04T09:00:00.000Z",
      layoutName: "theatre",
      purpose: "Main programme",
      expectedAttendance: 100,
      session,
      venue: { code: "ROOM-B", name: "Room B" },
    });

    function open(routes: Record<string, unknown> = {}, query = "?venue=v1") {
      setRoute(`/events/${REF}/booking/new${query}`, { id: REF });
      const api = mockApi({
        ...signedInAs("coordinator"),
        [INFO]: info(),
        "GET /api/venues/v1": venue,
        [POST]: reply(201, { id: "b1" }),
        ...routes,
      });
      render(<BookingRequestPage />);
      return api;
    }

    const ready = () => screen.findByLabelText(/^Date/);
    const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    it("SPM-90-TC01: the event's first request starts as its main programme, on the event's own attendance and layout", async () => {
      open();
      await ready();

      expect(purpose()).toHaveValue("Main programme");
      expect(attendance()).toHaveValue(100);
      expect(layout()).toHaveValue("theatre");
    });

    it.each(["pending", "approved"])("SPM-90-TC05: leaves the purpose empty when the event already has a %s booking", async (status) => {
      open({ [INFO]: info({ bookings: [held(status)] }) });
      await ready();

      expect(purpose()).toHaveValue("");
      expect(attendance()).toHaveValue(100);
    });

    it.each(["rejected", "withdrawn", "released"])("starts as the main programme again when the only earlier request is %s", async (status) => {
      open({ [INFO]: info({ bookings: [held(status)] }) });
      await ready();

      expect(purpose()).toHaveValue("Main programme");
    });

    // SPM-68: requesting a replacement for a flagged booking, for the same space.
    it("takes what the space is for from the address, even when the event already has a booking", async () => {
      open({ [INFO]: info({ bookings: [held("approved")] }) }, "?venue=v1&purpose=Breakout%20room&attendance=40&layout=classroom");
      await ready();

      expect(purpose()).toHaveValue("Breakout room");
      expect(attendance()).toHaveValue(40);
      expect(layout()).toHaveValue("classroom");
    });

    it("SPM-90-TC02: takes the space's attendance and layout from the address", async () => {
      open({}, "?venue=v1&attendance=20&layout=classroom");
      await ready();

      expect(attendance()).toHaveValue(20);
      expect(layout()).toHaveValue("classroom");
    });

    it("SPM-90-TC11: a session's first request starts on the session's own attendance and layout", async () => {
      open(
        { [INFO]: info({ sessions, bookings: [held("approved", { id: "s2", label: null })] }) },
        "?venue=v1&session=s1"
      );
      await ready();

      // The other session's booking does not make this one a second room.
      expect(purpose()).toHaveValue("Main programme");
      expect(attendance()).toHaveValue(40);
      expect(layout()).toHaveValue("boardroom");
    });

    it("SPM-90-TC02: sends what the space is for, with its attendance and layout", async () => {
      const api = open({ [INFO]: info({ bookings: [held("pending")] }) }, "?venue=v1&attendance=20&layout=classroom");
      await ready();

      set(purpose(), "Breakout room");
      await submit();

      expect(await screen.findByText("Booking request sent to Venue Staff.")).toBeInTheDocument();
      expect(api.sent(POST)[0].body).toMatchObject({
        venueId: "v1",
        purpose: "Breakout room",
        expectedAttendance: 20,
        layoutName: "classroom",
      });
    });

    it("sends no layout when the space is given none", async () => {
      const api = open();
      await ready();

      await userEvent.selectOptions(layout(), "");
      await submit();

      await waitFor(() => expect(api.sent(POST)).toHaveLength(1));
      expect(api.sent(POST)[0].body).toMatchObject({ layoutName: null });
    });

    it("SPM-90-TC05: sends nothing without a purpose, and says so under the field", async () => {
      const api = open();
      await ready();

      set(purpose(), "   ");
      await submit();

      expect(await screen.findByText("Say what this space is for.")).toBeInTheDocument();
      expect(api.sent(POST)).toHaveLength(0);
    });

    it.each(["0", "", "2.5"])("SPM-90-TC05: sends nothing for an attendance of '%s', and says so under the field", async (value) => {
      const api = open();
      await ready();

      set(attendance(), value);
      await submit();

      expect(await screen.findByText("Enter a whole number of at least 1.")).toBeInTheDocument();
      expect(api.sent(POST)).toHaveLength(0);
    });

    it("SPM-90-TC02: an address with no layout for the space starts on 'Not set'", async () => {
      open({}, "?venue=v1&attendance=20&layout=");
      await ready();

      expect(attendance()).toHaveValue(20);
      expect(layout()).toHaveValue("");
    });

    it("clears each message as soon as its field is changed", async () => {
      open();
      await ready();
      set(purpose(), "");
      set(attendance(), "0");
      await submit();
      expect(await screen.findByText("Say what this space is for.")).toBeInTheDocument();

      set(purpose(), "Green room");
      expect(screen.queryByText("Say what this space is for.")).not.toBeInTheDocument();
      expect(screen.getByText("Enter a whole number of at least 1.")).toBeInTheDocument();

      set(attendance(), "8");
      expect(screen.queryByText("Enter a whole number of at least 1.")).not.toBeInTheDocument();
    });

    it("SPM-90-TC03: shows the server's refusal for the space", async () => {
      const refusal = "Hall A is not suitable for this space: Classroom capacity is 20 - this space expects 25.";
      open({ [POST]: reply(400, { error: refusal }) });
      await ready();

      await submit();

      expect(await screen.findByText(refusal)).toBeInTheDocument();
    });
  });
});

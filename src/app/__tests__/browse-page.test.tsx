// @vitest-environment jsdom
// SPM-51 Register for Event - Browse Events (S-26), written test-first.
//
// CONTRACT:
//   src/app/browse/page.tsx: an Attendee's list of Confirmed events with registration enabled
//   (GET /api/events, which gives an attendee each event's registrationState). One row per event:
//   Event (title), When, Company, Registration (badge: Open / Not open yet with "Opens <date, time>" /
//   Closed / Full / Dates not set), soonest first. A row opens /events/<reference>.
//   Events whose registration is off (an attendee still holding a place can see those, SPM-64 #10)
//   are not listed. Empty: "No events are open for registration right now."
// Manual cases: docs/test-cases/SPM-51_test_cases.json (TC01, TC12).
import { describe, it, expect } from "vitest";
import BrowsePage from "@/app/browse/page";
import { ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { mockApi, render, reply, router, screen, setRoute, signedInAs, signedOut, userEvent, waitFor, within } from "@/test/ui";

const LIST = "GET /api/events";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    sequenceNumber: 41,
    title: "SPM51 Harbour Open House",
    status: "confirmed",
    startsAt: "2028-01-15T01:00:00.000Z",
    endsAt: "2028-01-15T09:00:00.000Z",
    registrationEnabled: true,
    registrationCapacity: 50,
    registrationOpensAt: "2026-09-01T01:00:00.000Z",
    registrationClosesAt: "2027-12-31T09:00:00.000Z",
    organisation: { name: "Straits Medical Institute" },
    registrationState: { kind: "open" },
    ...overrides,
  };
}

function open(rows: unknown) {
  setRoute("/browse");
  const api = mockApi({ ...signedInAs("attendee"), [LIST]: rows });
  render(<BrowsePage />);
  return api;
}

const table = () => screen.getByRole("table");
const rowOf = (title: string) => within(table()).getByText(title).closest("tr") as HTMLElement;

describe("AC1 Browse Events lists the events an attendee can register for", () => {
  it("[SPM-51][AC1] shows each event's date, company and registration state (TC01)", async () => {
    open([
      row(),
      row({ id: "e2", sequenceNumber: 42, title: "SPM51 Early Bird Seminar", startsAt: "2028-01-20T01:00:00.000Z",
        endsAt: "2028-01-20T09:00:00.000Z", registrationState: { kind: "not_open", opensAt: "2027-11-01T01:00:00.000Z" } }),
      row({ id: "e3", sequenceNumber: 43, title: "SPM51 Closed Doors Workshop", startsAt: "2027-12-10T01:00:00.000Z",
        endsAt: "2027-12-10T09:00:00.000Z", registrationState: { kind: "closed", closesAt: "2026-09-30T09:00:00.000Z" } }),
      row({ id: "e4", sequenceNumber: 44, title: "SPM51 Sold Out Summit", startsAt: "2028-01-29T01:00:00.000Z",
        endsAt: "2028-01-29T09:00:00.000Z", registrationState: { kind: "full" } }),
      row({ id: "e5", sequenceNumber: 45, title: "SPM51 Undated Talk", startsAt: "2028-02-05T01:00:00.000Z",
        endsAt: "2028-02-05T09:00:00.000Z", registrationState: { kind: "no_period" } }),
    ]);

    expect(await screen.findByRole("heading", { level: 1, name: "Browse Events" })).toBeInTheDocument();
    await screen.findByRole("table");
    expect(rowOf("SPM51 Harbour Open House")).toHaveTextContent("15 Jan 2028, 09:00–17:00");
    expect(rowOf("SPM51 Harbour Open House")).toHaveTextContent("Straits Medical Institute");
    expect(within(rowOf("SPM51 Harbour Open House")).getByText("Open")).toBeInTheDocument();
    expect(within(rowOf("SPM51 Early Bird Seminar")).getByText("Not open yet")).toBeInTheDocument();
    expect(rowOf("SPM51 Early Bird Seminar")).toHaveTextContent("Opens 1 Nov 2027, 09:00");
    expect(within(rowOf("SPM51 Closed Doors Workshop")).getByText("Closed")).toBeInTheDocument();
    expect(within(rowOf("SPM51 Sold Out Summit")).getByText("Full")).toBeInTheDocument();
    expect(within(rowOf("SPM51 Undated Talk")).getByText("Dates not set")).toBeInTheDocument();
  });

  it("[SPM-51][AC1] lists the soonest event first", async () => {
    open([
      row({ id: "late", title: "Later", startsAt: "2028-02-01T01:00:00.000Z", endsAt: "2028-02-01T02:00:00.000Z" }),
      row({ id: "soon", title: "Sooner", startsAt: "2027-12-01T01:00:00.000Z", endsAt: "2027-12-01T02:00:00.000Z" }),
    ]);

    await screen.findByRole("table");

    const titles = within(table()).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(titles[0]).toContain("Sooner");
    expect(titles[1]).toContain("Later");
  });

  it("[SPM-51][AC1] lists an event with no start date after the dated ones", async () => {
    open([
      row({ id: "undated", title: "Undated", startsAt: null, endsAt: null }),
      row({ id: "dated", title: "Dated" }),
    ]);

    await screen.findByRole("table");

    const titles = within(table()).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(titles[0]).toContain("Dated");
    expect(titles[1]).toContain("Undated");
  });

  it("[SPM-51] shows an event with no title as 'Untitled event'", async () => {
    open([row({ title: null })]);

    expect(await within(await screen.findByRole("table")).findByText("Untitled event")).toBeInTheDocument();
  });

  it("[SPM-51][AC1][AC8] leaves out an event whose registration is off, even one the attendee holds a place in", async () => {
    open([row(), row({ id: "off", title: "SPM51 Private Board Dinner", registrationEnabled: false, registrationState: { kind: "disabled" } })]);

    await screen.findByRole("table");

    expect(within(table()).queryByText("SPM51 Private Board Dinner")).not.toBeInTheDocument();
  });

  // SPM-37 (decided 2026-10-21): the server now sends an attendee the cancelled
  // events they hold a place in, so they can open them from My Registrations.
  it("[SPM-37][AC7] leaves out a cancelled event the attendee holds a place in", async () => {
    open([
      row(),
      row({ id: "gone", title: "SPM37 Open Workshop", status: "cancelled", registrationState: { kind: "not_confirmed" } }),
    ]);

    await screen.findByRole("table");

    expect(within(table()).queryByText("SPM37 Open Workshop")).not.toBeInTheDocument();
  });

  it("[SPM-51][AC1] opens the event when its row is clicked", async () => {
    open([row()]);

    await userEvent.click(await within(await screen.findByRole("table")).findByText("SPM51 Harbour Open House"));

    expect(router.push).toHaveBeenCalledWith("/events/EVT-000041");
  });

  it("[SPM-51] says so when there is nothing to register for", async () => {
    open([]);

    expect(await screen.findByText("No events are open for registration right now.")).toBeInTheDocument();
  });

  it("[SPM-51] shows an error with Retry, and retries", async () => {
    const api = open(reply(500, { error: "Internal server error" }));

    expect(await screen.findByText("Could not load events.")).toBeInTheDocument();
    api.on(LIST, [row()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("[SPM-51] shows a general error when the request fails without a reason", async () => {
    open(() => Promise.reject("offline"));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("[SPM-22][AC4] sends a visitor whose session ended back to log in", async () => {
    open(reply(401, { error: "Not authenticated" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fbrowse"));
  });
});

describe("only attendees browse (TC12)", () => {
  it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
    setRoute("/browse");
    mockApi(signedOut());

    render(<BrowsePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fbrowse"));
  });

  it.each(ROLES.filter((role) => !can(role, "registration:create")))("[SPM-22][AC4] refuses %s without asking for events", async (role) => {
    setRoute("/browse");
    const api = mockApi(signedInAs(role));

    render(<BrowsePage />);

    expect(await screen.findByText("You do not have access to this")).toBeInTheDocument();
    expect(screen.getByText("Browsing and registering for events is what an Attendee account is for.")).toBeInTheDocument();
    expect(api.sent(LIST)).toEqual([]);
  });
});

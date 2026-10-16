// @vitest-environment jsdom
// SPM-51 Register for Event - My Registrations (S-27), written test-first.
//
// CONTRACT:
//   src/app/registrations/page.tsx: an Attendee's registrations from GET /api/registrations, newest first
//   (the API's order): Event (title), When, Status (badge: Registered / Waiting list / Withdrawn / Attended).
//   A row opens /events/<reference>. Empty: "You haven't registered for any events yet."
// Manual cases: docs/test-cases/SPM-51_test_cases.json (TC11, TC12).
import { describe, it, expect } from "vitest";
import RegistrationsPage from "@/app/registrations/page";
import { ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { mockApi, render, reply, router, screen, setRoute, signedInAs, signedOut, userEvent, waitFor, within } from "@/test/ui";

const LIST = "GET /api/registrations";

const registration = (id: string, status: string, title: string | null, sequenceNumber: number, day: string) => ({
  id,
  status,
  registeredAt: "2026-10-05T02:00:00.000Z",
  event: { sequenceNumber, title, startsAt: `${day}T01:00:00.000Z`, endsAt: `${day}T09:00:00.000Z` },
});

function open(rows: unknown) {
  setRoute("/registrations");
  const api = mockApi({ ...signedInAs("attendee"), [LIST]: rows });
  render(<RegistrationsPage />);
  return api;
}

const table = () => screen.getByRole("table");
const rowOf = (title: string) => within(table()).getByText(title).closest("tr") as HTMLElement;

describe("AC6 an attendee sees their registrations and each one's status", () => {
  it("lists each event with its time and status, in the order given (TC11)", async () => {
    open([
      registration("r2", "waitlisted", "SPM51 Sold Out Summit", 44, "2028-01-29"),
      registration("r1", "registered", "SPM51 Last Seat Masterclass", 42, "2028-01-22"),
      registration("r0", "withdrawn", "Earlier Event", 3, "2027-11-02"),
    ]);

    expect(await screen.findByRole("heading", { level: 1, name: "My Registrations" })).toBeInTheDocument();
    await screen.findByRole("table");
    expect(rowOf("SPM51 Last Seat Masterclass")).toHaveTextContent("22 Jan 2028, 09:00–17:00");
    expect(within(rowOf("SPM51 Last Seat Masterclass")).getByText("Registered")).toBeInTheDocument();
    expect(within(rowOf("SPM51 Sold Out Summit")).getByText("Waiting list")).toBeInTheDocument();
    expect(within(rowOf("Earlier Event")).getByText("Withdrawn")).toBeInTheDocument();
    const order = within(table()).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(order[0]).toContain("SPM51 Sold Out Summit");
  });

  it("opens the event when its row is clicked (TC11)", async () => {
    open([registration("r2", "waitlisted", "SPM51 Sold Out Summit", 44, "2028-01-29")]);

    await userEvent.click(await within(await screen.findByRole("table")).findByText("SPM51 Sold Out Summit"));

    expect(router.push).toHaveBeenCalledWith("/events/EVT-000044");
  });

  it("says so when there are none", async () => {
    open([]);

    expect(await screen.findByText("You haven't registered for any events yet.")).toBeInTheDocument();
  });

  it("shows an error with Retry, and retries", async () => {
    const api = open(reply(500, { error: "Internal server error" }));

    expect(await screen.findByText("Could not load your registrations.")).toBeInTheDocument();
    api.on(LIST, [registration("r1", "registered", "SPM51 Last Seat Masterclass", 42, "2028-01-22")]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows a general error when the request fails without a reason", async () => {
    open(() => Promise.reject("offline"));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows an event with no title as 'Untitled event'", async () => {
    open([registration("r1", "registered", null, 42, "2028-01-22")]);

    expect(await within(await screen.findByRole("table")).findByText("Untitled event")).toBeInTheDocument();
  });

  it("sends a visitor whose session ended back to log in", async () => {
    open(reply(401, { error: "Not authenticated" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fregistrations"));
  });
});

describe("only attendees have registrations (TC12)", () => {
  it("sends an anonymous visitor to log in", async () => {
    setRoute("/registrations");
    mockApi(signedOut());

    render(<RegistrationsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fregistrations"));
  });

  it.each(ROLES.filter((role) => !can(role, "registration:create")))(
    "refuses %s without asking for registrations",
    async (role) => {
      setRoute("/registrations");
      const api = mockApi(signedInAs(role));

      render(<RegistrationsPage />);

      expect(await screen.findByText("You do not have access to this")).toBeInTheDocument();
      expect(screen.getByText("Registrations belong to an Attendee account.")).toBeInTheDocument();
      expect(api.sent(LIST)).toEqual([]);
    }
  );
});

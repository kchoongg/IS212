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

// SPM-52 Withdraw from Event.
describe("SPM-52 an attendee withdraws from My Registrations", () => {
  const WITHDRAW = "PATCH /api/registrations/r1";
  const rows = () => [
    registration("r1", "registered", "SPM52 Riverside Forum", 52, "2028-02-10"),
    registration("r2", "waitlisted", "SPM51 Sold Out Summit", 44, "2028-01-29"),
    registration("r3", "attended", "Earlier Event", 3, "2027-11-02"),
    registration("r4", "withdrawn", "Dropped Event", 4, "2027-11-09"),
  ];
  const withdrawButton = (title: string) => within(rowOf(title)).queryByRole("button", { name: "Withdraw" });
  const dialog = () => screen.getByRole("dialog", { hidden: true });

  it("offers Withdraw only on a registration that holds a seat (AC1)", async () => {
    open(rows());
    await screen.findByRole("table");

    expect(withdrawButton("SPM52 Riverside Forum")).toBeInTheDocument();
    expect(withdrawButton("SPM51 Sold Out Summit")).not.toBeInTheDocument();
    expect(withdrawButton("Earlier Event")).not.toBeInTheDocument();
    expect(withdrawButton("Dropped Event")).not.toBeInTheDocument();
  });

  it("asks first, naming the event and what happens to the place, without opening the event", async () => {
    const api = open(rows());
    await screen.findByRole("table");

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);

    expect(within(dialog()).getByRole("heading", { hidden: true, name: "Withdraw from SPM52 Riverside Forum?" })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Your place is released and can be taken by someone else.");
    expect(router.push).not.toHaveBeenCalled();
    expect(api.sent(WITHDRAW)).toEqual([]);
  });

  it("sends nothing when the attendee keeps their place", async () => {
    const api = open(rows());
    await screen.findByRole("table");

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Keep my place" }));

    expect(api.sent(WITHDRAW)).toEqual([]);
  });

  it("withdraws once confirmed, says so, and shows it as Withdrawn (AC1, AC2)", async () => {
    const api = open(rows());
    await screen.findByRole("table");
    api.on(WITHDRAW, { id: "r1", status: "withdrawn" });
    api.on(LIST, [registration("r1", "withdrawn", "SPM52 Riverside Forum", 52, "2028-02-10")]);

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(await screen.findByText("You have withdrawn from SPM52 Riverside Forum.")).toBeInTheDocument();
    expect(api.sent(WITHDRAW)[0].body).toEqual({ status: "withdrawn" });
    await waitFor(() => expect(within(rowOf("SPM52 Riverside Forum")).getByText("Withdrawn")).toBeInTheDocument());
    expect(withdrawButton("SPM52 Riverside Forum")).not.toBeInTheDocument();
  });

  it("shows the server's refusal in the dialog", async () => {
    const api = open(rows());
    await screen.findByRole("table");
    api.on(WITHDRAW, reply(400, { error: "Only an active registration can be withdrawn" }));

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(await within(dialog()).findByText("Only an active registration can be withdrawn")).toBeInTheDocument();
    expect(screen.queryByText(/You have withdrawn from/)).not.toBeInTheDocument();
  });
});

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

const registration = (
  id: string,
  status: string,
  title: string | null,
  sequenceNumber: number,
  day: string,
  eventStatus = "confirmed",
  registration: { registrationEnabled: boolean; registrationClosesAt: string | null } = {
    registrationEnabled: true,
    registrationClosesAt: "2027-12-31T09:00:00.000Z",
  }
) => ({
  id,
  status,
  registeredAt: "2026-10-05T02:00:00.000Z",
  event: {
    sequenceNumber,
    title,
    status: eventStatus,
    startsAt: `${day}T01:00:00.000Z`,
    endsAt: `${day}T09:00:00.000Z`,
    ...registration,
  },
});

function open(rows: unknown, path = "/registrations") {
  setRoute(path);
  const api = mockApi({ ...signedInAs("attendee"), [LIST]: rows });
  render(<RegistrationsPage />);
  return api;
}

const table = () => screen.getByRole("table");
const rowOf = (title: string) => within(table()).getByText(title).closest("tr") as HTMLElement;

describe("AC6 an attendee sees their registrations and each one's status", () => {
  it("[SPM-51][AC6] lists each event with its time and status, in the order given (TC11)", async () => {
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

  it("[SPM-51][AC6] opens the event when its row is clicked (TC11)", async () => {
    open([registration("r2", "waitlisted", "SPM51 Sold Out Summit", 44, "2028-01-29")]);

    await userEvent.click(await within(await screen.findByRole("table")).findByText("SPM51 Sold Out Summit"));

    expect(router.push).toHaveBeenCalledWith("/events/EVT-000044");
  });

  it("[SPM-51][AC6] says so when there are none", async () => {
    open([]);

    expect(await screen.findByText("You haven't registered for any events yet.")).toBeInTheDocument();
  });

  it("[SPM-51] shows an error with Retry, and retries", async () => {
    const api = open(reply(500, { error: "Internal server error" }));

    expect(await screen.findByText("Could not load your registrations.")).toBeInTheDocument();
    api.on(LIST, [registration("r1", "registered", "SPM51 Last Seat Masterclass", 42, "2028-01-22")]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("[SPM-51] shows a general error when the request fails without a reason", async () => {
    open(() => Promise.reject("offline"));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("[SPM-51] shows an event with no title as 'Untitled event'", async () => {
    open([registration("r1", "registered", null, 42, "2028-01-22")]);

    expect(await within(await screen.findByRole("table")).findByText("Untitled event")).toBeInTheDocument();
  });

  it("[SPM-22][AC4] sends a visitor whose session ended back to log in", async () => {
    open(reply(401, { error: "Not authenticated" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fregistrations"));
  });
});

describe("only attendees have registrations (TC12)", () => {
  it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
    setRoute("/registrations");
    mockApi(signedOut());

    render(<RegistrationsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fregistrations"));
  });

  it.each(ROLES.filter((role) => !can(role, "registration:create")))(
    "[SPM-22][AC4] refuses %s without asking for registrations",
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

  it("[SPM-52][AC1] offers Withdraw only on a registration that holds a seat (AC1)", async () => {
    open(rows());
    await screen.findByRole("table");

    expect(withdrawButton("SPM52 Riverside Forum")).toBeInTheDocument();
    expect(withdrawButton("SPM51 Sold Out Summit")).not.toBeInTheDocument();
    expect(withdrawButton("Earlier Event")).not.toBeInTheDocument();
    expect(withdrawButton("Dropped Event")).not.toBeInTheDocument();
  });

  it("[SPM-52][AC1] offers no Withdraw for an event that is over or cancelled", async () => {
    open([
      registration("r5", "registered", "Cancelled Gala", 5, "2028-02-17", "cancelled"),
      registration("r6", "registered", "Past Clinic", 6, "2026-09-15", "completed"),
      registration("r7", "registered", "Ended Talk", 7, "2026-09-16"),
    ]);
    await screen.findByRole("table");

    expect(withdrawButton("Cancelled Gala")).not.toBeInTheDocument();
    expect(withdrawButton("Past Clinic")).not.toBeInTheDocument();
    expect(withdrawButton("Ended Talk")).not.toBeInTheDocument();
  });

  it("[SPM-52][AC1] asks first, naming the event and what happens to the place, without opening the event", async () => {
    const api = open(rows());
    await screen.findByRole("table");

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);

    expect(within(dialog()).getByRole("heading", { hidden: true, name: "Withdraw from SPM52 Riverside Forum?" })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Your place is released and can be taken by someone else.");
    expect(router.push).not.toHaveBeenCalled();
    expect(api.sent(WITHDRAW)).toEqual([]);
  });

  it("[SPM-52][AC1] sends nothing when the attendee keeps their place", async () => {
    const api = open(rows());
    await screen.findByRole("table");

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Keep my place" }));

    expect(api.sent(WITHDRAW)).toEqual([]);
  });

  it("[SPM-52][AC1][AC2] withdraws once confirmed, says so, and shows it as Withdrawn (AC1, AC2)", async () => {
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

  it("[SPM-52] shows the server's refusal in the dialog", async () => {
    const api = open(rows());
    await screen.findByRole("table");
    api.on(WITHDRAW, reply(400, { error: "Only an active registration can be withdrawn" }));

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(await within(dialog()).findByText("Only an active registration can be withdrawn")).toBeInTheDocument();
    expect(screen.queryByText(/You have withdrawn from/)).not.toBeInTheDocument();
  });

  it("[SPM-52] says so in general words when the server gives no reason", async () => {
    const api = open(rows());
    await screen.findByRole("table");
    api.on(WITHDRAW, reply(400, {}));

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(await within(dialog()).findByText("Could not withdraw your registration.")).toBeInTheDocument();
  });

  it("[SPM-52][AC1] opens the question, not the event, when Withdraw is pressed with the keyboard on a phone", async () => {
    open(rows());
    await screen.findByRole("table");
    // The phone layout's card opens the event on Enter; its Withdraw button must not.
    const card = screen.getAllByText("SPM52 Riverside Forum").map((el) => el.closest("li")).find(Boolean)!;

    within(card).getByRole("button", { name: "Withdraw" }).focus();
    await userEvent.keyboard("{Enter}");

    expect(within(dialog()).getByRole("heading", { hidden: true, name: "Withdraw from SPM52 Riverside Forum?" })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("[SPM-52][AC1] warns before withdrawing from an event whose registration is turned off", async () => {
    open([
      registration("r1", "registered", "SPM52 Members Gala", 52, "2028-04-01", "confirmed", {
        registrationEnabled: false,
        registrationClosesAt: null,
      }),
    ]);
    await screen.findByRole("table");

    await userEvent.click(withdrawButton("SPM52 Members Gala")!);

    expect(dialog()).toHaveTextContent(
      "Registration for this event has been turned off, so you can't register again. Once you withdraw, you won't be able to open this event any more."
    );
  });

  it("[SPM-52][AC1] asks with no warning while the attendee could register again", async () => {
    open(rows());
    await screen.findByRole("table");

    await userEvent.click(withdrawButton("SPM52 Riverside Forum")!);

    expect(dialog()).not.toHaveTextContent("you can't register again");
  });

  it("[SPM-52][AC1] says so when sent here after withdrawing from an event page it can no longer show", async () => {
    open([registration("r1", "withdrawn", "SPM52 Members Gala", 52, "2028-04-01")], "/registrations?withdrawn=r1");

    expect(await screen.findByText("You have withdrawn from SPM52 Members Gala.")).toBeInTheDocument();
    expect(within(rowOf("SPM52 Members Gala")).getByText("Withdrawn")).toBeInTheDocument();
  });

  it("[SPM-52][AC1] names an untitled event in general words when sent here after withdrawing", async () => {
    const untitled = registration("r1", "withdrawn", "", 52, "2028-04-01");
    open([{ ...untitled, event: { ...untitled.event, title: null } }], "/registrations?withdrawn=r1");

    expect(await screen.findByText("You have withdrawn from the event.")).toBeInTheDocument();
  });

  it("[SPM-52][AC1] says nothing when the registration in the address was not withdrawn", async () => {
    open(rows(), "/registrations?withdrawn=r1");
    await screen.findByRole("table");

    expect(screen.queryByText(/You have withdrawn from/)).not.toBeInTheDocument();
  });

  it("[SPM-52][AC1] names an untitled event in general words", async () => {
    const untitled = registration("r1", "registered", "", 52, "2028-02-10");
    const api = open([{ ...untitled, event: { ...untitled.event, title: null } }]);
    await screen.findByRole("table");
    api.on(WITHDRAW, { id: "r1", status: "withdrawn" });

    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Withdraw" }));
    expect(within(dialog()).getByRole("heading", { hidden: true, name: "Withdraw from this event?" })).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(await screen.findByText("You have withdrawn from the event.")).toBeInTheDocument();
  });
});

// SPM-66 (AC3, AC5): a waiting registration says where it is in the queue, or
// that a place is offered and until when.
describe("SPM-66 a registration on the waiting list", () => {
  it("[SPM-66][AC3] SPM-66-TC03: shows its position in the queue", async () => {
    open([{ ...registration("w", "waitlisted", "SPM66 Harbour Summit", 66, "2099-12-01"), waitingListPosition: 2, offerExpiresAt: null }]);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(rowOf("SPM66 Harbour Summit")).toHaveTextContent("Number 2 in the queue");
    expect(within(rowOf("SPM66 Harbour Summit")).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("[SPM-66][AC3] says it is queued when no position was sent", async () => {
    open([{ ...registration("w", "waitlisted", "SPM66 Harbour Summit", 66, "2099-12-01"), waitingListPosition: null }]);

    await screen.findByRole("table");
    expect(rowOf("SPM66 Harbour Summit")).toHaveTextContent("In the queue");
  });

  it("[SPM-66][AC5] SPM-66-TC04: shows a place offered, and until when", async () => {
    open([
      {
        ...registration("w", "waitlisted", "SPM66 Harbour Summit", 66, "2099-12-01"),
        waitingListPosition: 1,
        offerExpiresAt: "2099-10-26T02:00:00.000Z",
      },
    ]);

    await screen.findByRole("table");
    expect(rowOf("SPM66 Harbour Summit")).toHaveTextContent("Place offered - accept by 26 Oct 2099, 10:00");
  });
});

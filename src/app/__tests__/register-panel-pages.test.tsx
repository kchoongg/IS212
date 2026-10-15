// @vitest-environment jsdom
// SPM-51 Register for Event - the "Your registration" card on the event page (written test-first).
//
// CONTRACT:
//   src/app/events/[id]/RegisterPanel.tsx, rendered by the Overview for an Attendee only, below the
//   Registration card. It reads the event's registrationState and myRegistration (GET /api/events/<ref>).
//   - registered / attended: the status badge and "You registered on <date>."
//   - waitlisted: the 'Waiting list' badge and "You're on the waiting list."
//   - open: optional 'Dietary requirements' and 'Accessibility requirements', and 'Register', which sends
//     POST /api/registrations { eventId, dietaryRequirements?, accessibilityRequirements? }; then
//     "You're registered for this event." and the event is reloaded.
//   - not_open: "Registration opens <date, time>."  closed: "Registration closed on <date, time>."
//   - no_period: "Registration dates haven't been set for this event."
//   - a refusal shows the server's message in a red alert; no network: "Could not reach the server. …"
// Manual cases: docs/test-cases/SPM-51_test_cases.json (TC02, TC03, TC06-TC08, TC11, TC12).
import { describe, it, expect } from "vitest";
import EventOverviewPage from "@/app/events/[id]/page";
import { fireEvent, mockApi, render, reply, screen, setRoute, signedInAs, userEvent, waitFor, within } from "@/test/ui";

const REF = "EVT-000041";
const EVENT = `GET /api/events/${REF}`;
const REGISTER = "POST /api/registrations";

/// The event as an attendee receives it: the public fields, its state and their registration.
function publicEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-uuid",
    sequenceNumber: 41,
    title: "SPM51 Harbour Open House",
    description: null,
    category: "seminar",
    status: "confirmed",
    startsAt: "2028-01-15T01:00:00.000Z",
    endsAt: "2028-01-15T09:00:00.000Z",
    registrationEnabled: true,
    registrationCapacity: 50,
    registrationOpensAt: "2026-09-01T01:00:00.000Z",
    registrationClosesAt: "2027-12-31T09:00:00.000Z",
    organisation: { name: "Straits Medical Institute" },
    registrationState: { kind: "open" },
    myRegistration: null,
    ...overrides,
  };
}

function open(eventRow: unknown = publicEvent(), extra: Record<string, unknown> = {}, role = "attendee") {
  setRoute(`/events/${REF}`, { id: REF });
  const api = mockApi({ ...signedInAs(role), [EVENT]: eventRow, ...extra });
  render(<EventOverviewPage />);
  return api;
}

/// The card around the "Your registration" heading (Card renders a div.rounded-lg).
const panel = async () =>
  (await screen.findByRole("heading", { name: "Your registration" })).closest("div.rounded-lg") as HTMLElement;
const registerButton = () => screen.queryByRole("button", { name: "Register" });

describe("AC2 + AC5 an attendee registers for an eligible event", () => {
  it("offers the two optional fields and Register (TC02)", async () => {
    open();

    await screen.findByRole("heading", { name: "Your registration" });

    expect(screen.getByLabelText("Dietary requirements")).toHaveValue("");
    expect(screen.getByLabelText("Accessibility requirements")).toHaveValue("");
    expect(registerButton()).toBeInTheDocument();
  });

  it("sends the event and what was typed, then says they are registered (TC02)", async () => {
    const api = open();
    await screen.findByRole("heading", { name: "Your registration" });

    fireEvent.change(screen.getByLabelText("Dietary requirements"), { target: { value: "Vegetarian" } });
    api.on(REGISTER, reply(201, { id: "r1", status: "registered" }));
    api.on(EVENT, publicEvent({ myRegistration: { status: "registered", registeredAt: "2026-10-10T04:00:00.000Z" } }));
    await userEvent.click(registerButton()!);

    expect(await screen.findByText("You're registered for this event.")).toBeInTheDocument();
    expect(api.sent(REGISTER)[0].body).toEqual({ eventId: "event-uuid", dietaryRequirements: "Vegetarian" });
    expect(await screen.findByText("You registered on 10 Oct 2026.")).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
  });

  it("leaves out fields left empty", async () => {
    const api = open();
    await screen.findByRole("heading", { name: "Your registration" });

    api.on(REGISTER, reply(201, { id: "r1" }));
    await userEvent.click(registerButton()!);

    await screen.findByText("You're registered for this event.");
    expect(api.sent(REGISTER)[0].body).toEqual({ eventId: "event-uuid" });
  });
});

describe("AC6 + AC7 an attendee who already holds a place sees it instead of Register", () => {
  it("shows a registration with the date it was made (TC02)", async () => {
    open(publicEvent({ myRegistration: { status: "registered", registeredAt: "2026-10-05T02:00:00.000Z" } }));

    const card = await panel();

    expect(within(card).getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("You registered on 5 Oct 2026.")).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
  });

  it("shows a place on the waiting list (TC11)", async () => {
    open(publicEvent({ registrationState: { kind: "full" }, myRegistration: { status: "waitlisted", registeredAt: "2026-10-05T02:00:00.000Z" } }));

    const card = await panel();

    expect(within(card).getByText("Waiting list")).toBeInTheDocument();
    expect(screen.getByText("You're on the waiting list.")).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
  });

  it("offers Register again to an attendee who withdrew", async () => {
    open(publicEvent({ myRegistration: { status: "withdrawn", registeredAt: "2026-10-05T02:00:00.000Z" } }));

    await screen.findByRole("heading", { name: "Your registration" });

    expect(registerButton()).toBeInTheDocument();
  });

  it("shows the server's refusal when a second registration is made from another tab (TC03)", async () => {
    open(publicEvent(), { [REGISTER]: reply(400, { error: "Already registered for this event" }) });
    await screen.findByRole("heading", { name: "Your registration" });

    await userEvent.click(registerButton()!);

    expect(await screen.findByText("Already registered for this event")).toBeInTheDocument();
    expect(screen.queryByText("You're registered for this event.")).not.toBeInTheDocument();
  });

  it("says so when the server can't be reached", async () => {
    open(publicEvent(), {
      [REGISTER]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await screen.findByRole("heading", { name: "Your registration" });

    await userEvent.click(registerButton()!);

    await waitFor(() =>
      expect(screen.getByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument()
    );
  });
});

describe("AC3 + AC4 an event outside its period can't be registered for, and says why", () => {
  it.each([
    ["not open yet", { kind: "not_open", opensAt: "2027-11-01T01:00:00.000Z" }, "Registration opens 1 Nov 2027, 09:00."],
    ["closed", { kind: "closed", closesAt: "2026-09-30T09:00:00.000Z" }, "Registration closed on 30 Sept 2026, 17:00."],
    ["without dates", { kind: "no_period" }, "Registration dates haven't been set for this event."],
  ])("says when an event is %s, with no Register button (TC06-TC08)", async (_state, state, message) => {
    open(publicEvent({ registrationState: state }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dietary requirements")).not.toBeInTheDocument();
  });
});

describe("AC9 + AC10 a full event offers the waiting list instead of Register", () => {
  it("says the event is full and offers the waiting list, with no Register button (TC05)", async () => {
    open(publicEvent({ registrationState: { kind: "full" } }));

    expect(await screen.findByText("This event is full. You can join the waiting list instead.")).toBeInTheDocument();
    expect(screen.getByText("Joining the waiting list isn't available yet.")).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dietary requirements")).not.toBeInTheDocument();
  });

  it("shows the refusal when the last seat went while the page was open (TC05)", async () => {
    open(publicEvent(), { [REGISTER]: reply(400, { error: "This event is full" }) });
    await screen.findByRole("heading", { name: "Your registration" });

    await userEvent.click(registerButton()!);

    expect(await screen.findByText("This event is full")).toBeInTheDocument();
  });
});

describe("only an attendee gets the card (TC12)", () => {
  it.each(["coordinator", "organiser", "ops_manager", "venue_staff", "tech_support"])(
    "doesn't show it to %s",
    async (role) => {
      open(
        { ...publicEvent(), organiserId: "o1", organisationId: "org", coordinatorId: "c1", coordinator: null, facilityRequirements: [] },
        {},
        role
      );

      await screen.findByRole("heading", { level: 1, name: "SPM51 Harbour Open House" });

      expect(screen.queryByRole("heading", { name: "Your registration" })).not.toBeInTheDocument();
      expect(registerButton()).not.toBeInTheDocument();
    }
  );
});

// SPM-52 Withdraw from Event.
describe("SPM-52 an attendee withdraws from the event page", () => {
  const WITHDRAW = "PATCH /api/registrations/reg-1";
  const mine = (status: string) => ({ id: "reg-1", status, registeredAt: "2026-10-05T02:00:00.000Z" });
  const withdrawButton = () => screen.queryByRole("button", { name: "Withdraw" });
  /// The event page has other dialogs; this is the one asking about withdrawing.
  const dialog = () =>
    screen
      .getByRole("heading", { hidden: true, name: "Withdraw from SPM51 Harbour Open House?" })
      .closest("dialog") as HTMLElement;

  it("offers Withdraw next to a registration (AC1)", async () => {
    open(publicEvent({ myRegistration: mine("registered") }));

    await panel();

    expect(withdrawButton()).toBeInTheDocument();
  });

  it.each(["waitlisted", "attended"])("offers no Withdraw on a %s registration", async (status) => {
    open(publicEvent({ myRegistration: mine(status) }));

    await panel();

    expect(withdrawButton()).not.toBeInTheDocument();
  });

  it("withdraws once confirmed, says so, and offers Register again (AC1-AC3)", async () => {
    const api = open(publicEvent({ myRegistration: mine("registered") }));
    await panel();
    api.on(WITHDRAW, { id: "reg-1", status: "withdrawn" });
    api.on(EVENT, publicEvent({ myRegistration: mine("withdrawn") }));

    await userEvent.click(withdrawButton()!);
    expect(within(dialog()).getByRole("heading", { hidden: true, name: "Withdraw from SPM51 Harbour Open House?" })).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(await screen.findByText("You have withdrawn from this event.")).toBeInTheDocument();
    expect(api.sent(WITHDRAW)[0].body).toEqual({ status: "withdrawn" });
    expect(await screen.findByRole("button", { name: "Register" })).toBeInTheDocument();
    expect(screen.queryByText("You registered on 5 Oct 2026.")).not.toBeInTheDocument();
  });

  it("sends nothing when the attendee keeps their place", async () => {
    const api = open(publicEvent({ myRegistration: mine("registered") }));
    await panel();

    await userEvent.click(withdrawButton()!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Keep my place" }));

    expect(api.sent(WITHDRAW)).toEqual([]);
    expect(screen.getByText("You registered on 5 Oct 2026.")).toBeInTheDocument();
  });

  it("says so when the server can't be reached", async () => {
    open(publicEvent({ myRegistration: mine("registered") }), {
      [WITHDRAW]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await panel();

    await userEvent.click(withdrawButton()!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(
      await within(dialog()).findByText("Could not reach the server. Check your connection and try again.")
    ).toBeInTheDocument();
  });
});

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
import { fireEvent, mockApi, render, reply, router, screen, setRoute, signedInAs, userEvent, waitFor, within } from "@/test/ui";

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
  it("[SPM-51][AC2] offers the two optional fields and Register (TC02)", async () => {
    open();

    await screen.findByRole("heading", { name: "Your registration" });

    expect(screen.getByLabelText("Dietary requirements")).toHaveValue("");
    expect(screen.getByLabelText("Accessibility requirements")).toHaveValue("");
    expect(registerButton()).toBeInTheDocument();
  });

  it("[SPM-51][AC2][AC5] sends the event and what was typed, then says they are registered (TC02)", async () => {
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

  it("[SPM-51][AC5] leaves out fields left empty", async () => {
    const api = open();
    await screen.findByRole("heading", { name: "Your registration" });

    api.on(REGISTER, reply(201, { id: "r1" }));
    await userEvent.click(registerButton()!);

    await screen.findByText("You're registered for this event.");
    expect(api.sent(REGISTER)[0].body).toEqual({ eventId: "event-uuid" });
  });

  it("[SPM-51][AC5] sends accessibility requirements on their own, trimmed", async () => {
    const api = open();
    await screen.findByRole("heading", { name: "Your registration" });

    fireEvent.change(screen.getByLabelText("Dietary requirements"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Accessibility requirements"), { target: { value: "  Wheelchair access " } });
    api.on(REGISTER, reply(201, { id: "r1" }));
    await userEvent.click(registerButton()!);

    await screen.findByText("You're registered for this event.");
    expect(api.sent(REGISTER)[0].body).toEqual({ eventId: "event-uuid", accessibilityRequirements: "Wheelchair access" });
  });
});

describe("AC6 + AC7 an attendee who already holds a place sees it instead of Register", () => {
  it("[SPM-51][AC6] shows a registration with the date it was made (TC02)", async () => {
    open(publicEvent({ myRegistration: { status: "registered", registeredAt: "2026-10-05T02:00:00.000Z" } }));

    const card = await panel();

    expect(within(card).getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("You registered on 5 Oct 2026.")).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
  });

  it("[SPM-51][AC6] shows a place on the waiting list (TC11)", async () => {
    open(publicEvent({ registrationState: { kind: "full" }, myRegistration: { status: "waitlisted", registeredAt: "2026-10-05T02:00:00.000Z" } }));

    const card = await panel();

    expect(within(card).getByText("Waiting list")).toBeInTheDocument();
    expect(screen.getByText("You're on the waiting list.")).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
  });

  it("[SPM-51][AC2] [SPM-52][AC3] offers Register again to an attendee who withdrew", async () => {
    open(publicEvent({ myRegistration: { status: "withdrawn", registeredAt: "2026-10-05T02:00:00.000Z" } }));

    await screen.findByRole("heading", { name: "Your registration" });

    expect(registerButton()).toBeInTheDocument();
  });

  it("[SPM-51][AC7] shows the server's refusal when a second registration is made from another tab (TC03)", async () => {
    open(publicEvent(), { [REGISTER]: reply(400, { error: "Already registered for this event" }) });
    await screen.findByRole("heading", { name: "Your registration" });

    await userEvent.click(registerButton()!);

    expect(await screen.findByText("Already registered for this event")).toBeInTheDocument();
    expect(screen.queryByText("You're registered for this event.")).not.toBeInTheDocument();
  });

  it("[SPM-51] drops the old title and status badge when the event can no longer be loaded", async () => {
    const api = open();
    await screen.findByRole("heading", { level: 1, name: "SPM51 Harbour Open House" });
    api.on(REGISTER, reply(201, { id: "r1" }));
    api.on(EVENT, reply(404, { error: "Event not found" }));

    await userEvent.click(registerButton()!);

    expect(await screen.findByText("This event doesn't exist, or you don't have access to it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Event" })).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText(REF)).not.toBeInTheDocument();
  });

  it("[SPM-51] shows a general refusal when the server gives no reason", async () => {
    open(publicEvent(), { [REGISTER]: reply(400, {}) });
    await screen.findByRole("heading", { name: "Your registration" });

    await userEvent.click(registerButton()!);

    expect(await screen.findByText("Could not register for this event.")).toBeInTheDocument();
  });

  it("[SPM-51] says so when the server can't be reached", async () => {
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
    ["not open yet, with no opening date sent", { kind: "not_open" }, "Registration opens —."],
    ["closed, with no closing date sent", { kind: "closed" }, "Registration closed on —."],
    ["not enabled", { kind: "disabled" }, "Registration is not enabled for this event."],
  ])("[SPM-51][AC3][AC4] says when an event is %s, with no Register button (TC06-TC08)", async (_state, state, message) => {
    open(publicEvent({ registrationState: state }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dietary requirements")).not.toBeInTheDocument();
  });
});

describe("AC9 + AC10 a full event offers the waiting list instead of Register", () => {
  // CHANGED (SPM-66, AC1): the waiting list can now be joined - "Join waiting
  // list" with the same optional needs, in place of Register.
  it("[SPM-51][AC9][AC10] [SPM-66][AC1] says the event is full and offers the waiting list, with no Register button (TC05)", async () => {
    open(publicEvent({ registrationState: { kind: "full" } }));

    expect(await screen.findByText("This event is full. You can join the waiting list instead.")).toBeInTheDocument();
    expect(screen.queryByText("Joining the waiting list isn't available yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join waiting list" })).toBeInTheDocument();
    expect(registerButton()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dietary requirements")).toBeInTheDocument();
  });

  it("[SPM-51][AC9] shows the refusal when the last seat went while the page was open (TC05)", async () => {
    open(publicEvent(), { [REGISTER]: reply(400, { error: "This event is full" }) });
    await screen.findByRole("heading", { name: "Your registration" });

    await userEvent.click(registerButton()!);

    expect(await screen.findByText("This event is full")).toBeInTheDocument();
  });
});

describe("only an attendee gets the card (TC12)", () => {
  it.each(["coordinator", "organiser", "ops_manager", "venue_staff", "tech_support"])(
    "[SPM-22][AC3] doesn't show it to %s",
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

  it("[SPM-52][AC1] offers Withdraw next to a registration (AC1)", async () => {
    open(publicEvent({ myRegistration: mine("registered") }));

    await panel();

    expect(withdrawButton()).toBeInTheDocument();
  });

  it.each(["waitlisted", "attended"])("[SPM-52][AC1] offers no Withdraw on a %s registration", async (status) => {
    open(publicEvent({ myRegistration: mine(status) }));

    await panel();

    expect(withdrawButton()).not.toBeInTheDocument();
  });

  it.each([
    ["cancelled", { status: "cancelled" }],
    ["completed", { status: "completed", startsAt: "2026-09-15T01:00:00.000Z", endsAt: "2026-09-15T09:00:00.000Z" }],
    ["ended", { startsAt: "2026-09-15T01:00:00.000Z", endsAt: "2026-09-15T09:00:00.000Z" }],
  ])("[SPM-52][AC1] offers no Withdraw once the event is %s", async (_case, eventFields) => {
    open(publicEvent({ ...eventFields, myRegistration: mine("registered") }));

    await panel();

    expect(withdrawButton()).not.toBeInTheDocument();
  });

  it("[SPM-52][AC1][AC2][AC3] withdraws once confirmed, says so, and offers Register again (AC1-AC3)", async () => {
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

  it("[SPM-52][AC1] asks with no warning while the attendee could register again", async () => {
    open(publicEvent({ myRegistration: mine("registered") }));
    await panel();

    await userEvent.click(withdrawButton()!);

    expect(dialog()).not.toHaveTextContent("you can't register again");
  });

  it("[SPM-52][AC1] warns that registration has closed before withdrawing", async () => {
    open(
      publicEvent({
        registrationClosesAt: "2026-10-01T09:00:00.000Z",
        registrationState: { kind: "closed", closesAt: "2026-10-01T09:00:00.000Z" },
        myRegistration: mine("registered"),
      })
    );
    await panel();

    await userEvent.click(withdrawButton()!);

    expect(dialog()).toHaveTextContent("Registration for this event has closed, so you can't register again.");
  });

  // Bug: with registration turned off, the attendee could only see the event while holding a place,
  // so the reload after withdrawing is a 404, and they were told the event doesn't exist.
  it("[SPM-52][AC1] warns first, then takes the attendee to My Registrations when registration is turned off", async () => {
    const api = open(
      publicEvent({ registrationEnabled: false, registrationState: { kind: "disabled" }, myRegistration: mine("registered") })
    );
    await panel();
    api.on(WITHDRAW, { id: "reg-1", status: "withdrawn" });
    api.on(EVENT, reply(404, { error: "Event not found" }));

    await userEvent.click(withdrawButton()!);
    expect(dialog()).toHaveTextContent(
      "Registration for this event has been turned off, so you can't register again. Once you withdraw, you won't be able to open this event any more."
    );
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/registrations?withdrawn=reg-1"));
    expect(api.sent(WITHDRAW)[0].body).toEqual({ status: "withdrawn" });
    expect(screen.queryByText("This event doesn't exist, or you don't have access to it.")).not.toBeInTheDocument();
  });

  it("[SPM-52][AC1] stays on the event page when it can still be seen once withdrawn", async () => {
    const api = open(publicEvent({ myRegistration: mine("registered") }));
    await panel();
    api.on(WITHDRAW, { id: "reg-1", status: "withdrawn" });
    api.on(EVENT, publicEvent({ myRegistration: mine("withdrawn") }));

    await userEvent.click(withdrawButton()!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Withdraw" }));

    expect(await screen.findByRole("button", { name: "Register" })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("[SPM-52][AC1] sends nothing when the attendee keeps their place", async () => {
    const api = open(publicEvent({ myRegistration: mine("registered") }));
    await panel();

    await userEvent.click(withdrawButton()!);
    await userEvent.click(within(dialog()).getByRole("button", { hidden: true, name: "Keep my place" }));

    expect(api.sent(WITHDRAW)).toEqual([]);
    expect(screen.getByText("You registered on 5 Oct 2026.")).toBeInTheDocument();
  });

  it("[SPM-52] says so when the server can't be reached", async () => {
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

// SPM-66 - Join and Respond to Waiting List: the attendee's side of the card.
describe("SPM-66 the waiting list", () => {
  const JOIN = `POST /api/events/${REF}/waiting-list`;
  const LEAVE = "PATCH /api/registrations/reg-1";
  const ANSWER = "POST /api/registrations/reg-1/offer";
  const full = (overrides: Record<string, unknown> = {}) => publicEvent({ registrationState: { kind: "full" }, ...overrides });
  const waiting = (overrides: Record<string, unknown> = {}) => ({
    id: "reg-1",
    status: "waitlisted",
    registeredAt: "2026-10-20T02:00:00.000Z",
    offerExpiresAt: null,
    waitingListPosition: 3,
    ...overrides,
  });
  const offered = () => waiting({ offerExpiresAt: "2099-10-26T02:00:00.000Z", waitingListPosition: 1 });
  const dialogTitled = (name: string) => screen.getByRole("heading", { hidden: true, name }).closest("dialog") as HTMLElement;

  it("[SPM-66][AC1] SPM-66-TC01: joins a full event's waiting list with the needs typed, and says so", async () => {
    const api = open(full(), { [JOIN]: { id: "reg-1", status: "waitlisted" } });
    await panel();

    fireEvent.change(screen.getByLabelText("Dietary requirements"), { target: { value: " Halal " } });
    await userEvent.click(screen.getByRole("button", { name: "Join waiting list" }));

    expect(await screen.findByText("You're on the waiting list.")).toBeInTheDocument();
    expect(api.sent(JOIN)[0].body).toEqual({ dietaryRequirements: "Halal" });
    expect(api.sent(REGISTER)).toHaveLength(0);
    expect(screen.queryByText("You're registered for this event.")).not.toBeInTheDocument();
  });

  it("[SPM-66][AC2] SPM-66-TC02: shows the server's refusal when joining", async () => {
    open(full(), { [JOIN]: reply(400, { error: "You're already on the waiting list for this event." }) });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Join waiting list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You're already on the waiting list for this event.");
  });

  it("[SPM-66][AC1] falls back to a general message when joining is refused without one", async () => {
    open(full(), { [JOIN]: reply(400, {}) });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Join waiting list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not join the waiting list.");
  });

  it("[SPM-66][AC3] SPM-66-TC03: shows a waiting attendee their position, and Leave waiting list", async () => {
    open(full({ myRegistration: waiting() }));

    const card = await panel();

    expect(within(card).getByText("Waiting list")).toBeInTheDocument();
    expect(within(card).getByText("You're number 3 on the waiting list.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Leave waiting list" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Join waiting list" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("[SPM-66][AC3] says they are waiting when no position was sent", async () => {
    open(full({ myRegistration: waiting({ waitingListPosition: null }) }));

    expect(within(await panel()).getByText("You're on the waiting list.")).toBeInTheDocument();
  });

  it("[SPM-66][AC4] SPM-66-TC03: asks before leaving, then leaves and says so", async () => {
    const api = open(full({ myRegistration: waiting() }), { [LEAVE]: { id: "reg-1", status: "withdrawn" } });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Leave waiting list" }));
    const ask = dialogTitled("Leave the waiting list for SPM51 Harbour Open House?");
    expect(ask).toHaveTextContent("You lose your place in the queue. To wait again, you would join at the back of the list.");
    expect(api.sent(LEAVE)).toHaveLength(0);
    await userEvent.click(within(ask).getByRole("button", { hidden: true, name: "Leave waiting list" }));

    expect(await screen.findByText("You have left the waiting list.")).toBeInTheDocument();
    expect(api.sent(LEAVE)[0].body).toEqual({ status: "withdrawn" });
  });

  it("[SPM-66][AC4] words the Leave question for an event with no title", async () => {
    open(full({ title: null, myRegistration: waiting() }));
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Leave waiting list" }));

    expect(dialogTitled("Leave the waiting list for this event?")).toBeInTheDocument();
  });

  it("[SPM-66][AC4] keeps the attendee on the list when they choose to stay", async () => {
    const api = open(full({ myRegistration: waiting() }), { [LEAVE]: {} });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Leave waiting list" }));
    await userEvent.click(
      within(dialogTitled("Leave the waiting list for SPM51 Harbour Open House?")).getByRole("button", { hidden: true, name: "Stay on the list" })
    );

    expect(api.sent(LEAVE)).toHaveLength(0);
  });

  it("[SPM-66][AC5][AC6] SPM-66-TC04: shows a place offered, and until when", async () => {
    open(full({ myRegistration: offered() }));

    const card = await panel();

    expect(within(card).getByText("A place is available for you")).toBeInTheDocument();
    expect(card).toHaveTextContent("Accept it by 26 Oct 2099, 10:00. If you don't, it goes to the next person on the waiting list.");
    expect(within(card).getByRole("button", { name: "Accept place" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Leave waiting list" })).not.toBeInTheDocument();
  });

  it("[SPM-66][AC6] SPM-66-TC04: accepts the place, and says they are registered", async () => {
    const api = open(full({ myRegistration: offered() }), { [ANSWER]: { id: "reg-1", status: "registered" } });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Accept place" }));

    expect(await screen.findByText("You're registered for this event.")).toBeInTheDocument();
    expect(api.sent(ANSWER)[0].body).toEqual({ response: "accept" });
  });

  it("[SPM-66][AC7] SPM-66-TC06: asks before declining, then declines and says so", async () => {
    const api = open(full({ myRegistration: offered() }), { [ANSWER]: { id: "reg-1", status: "withdrawn" } });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const ask = dialogTitled("Decline this place?");
    expect(ask).toHaveTextContent("The place goes to the next person on the waiting list, and you leave the waiting list.");
    await userEvent.click(within(ask).getByRole("button", { hidden: true, name: "Decline place" }));

    expect(await screen.findByText("You have declined the place.")).toBeInTheDocument();
    expect(api.sent(ANSWER)[0].body).toEqual({ response: "decline" });
  });

  it("[SPM-66][AC7] keeps the offer when they change their mind", async () => {
    const api = open(full({ myRegistration: offered() }), { [ANSWER]: {} });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await userEvent.click(within(dialogTitled("Decline this place?")).getByRole("button", { hidden: true, name: "Keep the offer" }));

    expect(api.sent(ANSWER)).toHaveLength(0);
  });

  it("[SPM-66][AC6] treats an offer whose time has passed as ended", async () => {
    open(full({ myRegistration: waiting({ offerExpiresAt: "2020-01-01T00:00:00.000Z", waitingListPosition: 1 }) }));

    const card = await panel();

    expect(within(card).queryByRole("button", { name: "Accept place" })).not.toBeInTheDocument();
    expect(within(card).getByText("You're number 1 on the waiting list.")).toBeInTheDocument();
  });

  it.each([
    ["the server's reason", reply(400, { error: "This offer has ended." }), "This offer has ended."],
    ["a general message when it gives none", reply(500), "Could not update your place on the waiting list."],
    ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server. Check your connection and try again."],
  ])("[SPM-66][AC6] shows %s when accepting fails", async (_case, answer, message) => {
    open(full({ myRegistration: offered() }), { [ANSWER]: answer });
    await panel();

    await userEvent.click(screen.getByRole("button", { name: "Accept place" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});

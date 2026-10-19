// @vitest-environment jsdom
// SPM-64 Configure Event Registration - the Registration card on the event's
// Overview (written test-first). Manual cases: docs/test-cases/SPM-64_test_cases.json.
//
// CONTRACT:
//   src/app/events/[id]/RegistrationCard.tsx, rendered by the Overview (src/app/events/[id]/page.tsx).
//   Read-only for everyone: 'Registration' (Enabled / Not enabled for this event); when enabled 'Capacity',
//   'Measured against' (not for an attendee), 'Opens', 'Closes'; an amber 'Registration setup is incomplete'
//   alert while enabled and incomplete (registrationGaps(), src/lib/eventConfirmation.ts).
//   The assigned coordinator, while Approved / Planning / Confirmed, gets 'Change registration settings':
//     GET /api/events/<ref>/registration -> { bookings } (active ones, for 'Capacity measured against');
//     'Save registration settings' sends PATCH /api/events/<ref>/registration with only what changed;
//     a 400's fieldErrors show under their fields; success shows 'Registration settings saved.' and the
//     'Flagged for review' lines, then reloads the event.
import { describe, it, expect } from "vitest";
import EventOverviewPage from "@/app/events/[id]/page";
import { fireEvent, mockApi, render, reply, screen, setRoute, signedInAs, userEvent, waitFor, within } from "@/test/ui";

const REF = "EVT-000007";
const EVENT = `GET /api/events/${REF}`;
const SETTINGS = `GET /api/events/${REF}/registration`;
const SAVE = `PATCH /api/events/${REF}/registration`;
const COORDINATOR = { id: "c1" };

/// Orchard Seminar Room, booked as a classroom (70; 120 as a theatre).
const seminarBooking = {
  id: "b1",
  status: "approved",
  layoutName: "classroom",
  venue: {
    name: "Orchard Seminar Room",
    code: "ORC-SEM",
    layouts: [
      { layoutName: "theatre", capacity: 120 },
      { layoutName: "classroom", capacity: 70 },
    ],
  },
};
const option = (id: string, status: string, name: string, code: string, capacity: number) => ({
  id,
  status,
  layoutName: "classroom",
  layoutCapacity: capacity,
  venue: { name, code },
});
const seminarOption = option("b1", "approved", "Orchard Seminar Room", "ORC-SEM", 70);
const studioOption = option("b2", "pending", "Orchard Studio", "ORC-STU", 40);

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-id",
    sequenceNumber: 7,
    title: "SPM64 Orchard Data Forum",
    purpose: null,
    description: null,
    category: "conference",
    status: "planning",
    startsAt: "2027-03-17T01:00:00.000Z",
    endsAt: "2027-03-17T09:00:00.000Z",
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    registrationVenueBookingId: null,
    registrationVenueBooking: null,
    organiserId: "organiser-id",
    organisationId: "org-id",
    coordinatorId: COORDINATOR.id,
    organiser: { fullName: "Evelyn Chen" },
    organisation: { name: "Straits Medical Institute" },
    coordinator: { fullName: "Daniel Tan" },
    facilityRequirements: [],
    equipmentRequests: [],
    venueBookings: [],
    sessions: [],
    rejectionReason: null,
    ...overrides,
  };
}

/// Fully set up: 50 places from 1 Aug 2026 09:00 to 30 Sep 2026 17:00 (Singapore).
const enabled = {
  registrationEnabled: true,
  registrationCapacity: 50,
  registrationOpensAt: "2026-08-01T01:00:00.000Z",
  registrationClosesAt: "2026-09-30T09:00:00.000Z",
  registrationVenueBookingId: "b1",
  registrationVenueBooking: seminarBooking,
};

function open(role: string, eventRow: unknown = event(), extra: Record<string, unknown> = {}, who: object = {}) {
  setRoute(`/events/${REF}`, { id: REF });
  const api = mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, ...extra });
  render(<EventOverviewPage />);
  return api;
}

const asCoordinator = (eventRow: unknown = event(), extra: Record<string, unknown> = {}) =>
  open("coordinator", eventRow, { [SETTINGS]: { bookings: [seminarOption] }, ...extra }, COORDINATOR);

const valueOf = (label: string) => {
  const term = screen.getAllByRole("term").find((t) => t.textContent === label);
  return term?.nextElementSibling as HTMLElement | undefined;
};
const changeButton = () => screen.queryByRole("button", { name: "Change registration settings" });
const saveButton = () => screen.getByRole("button", { name: "Save registration settings" });
const switchBox = () => screen.getByRole("checkbox", { name: "Attendees need to register for this event" });

async function startEditing() {
  await userEvent.click(await screen.findByRole("button", { name: "Change registration settings" }));
  return switchBox();
}

describe("the Registration card, read-only", () => {
  it("[SPM-64][AC4] shows the settings with the booking the capacity is measured against (TC23)", async () => {
    open("organiser", event(enabled), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Registration")).toHaveTextContent("Enabled");
    expect(valueOf("Capacity")).toHaveTextContent("50");
    expect(valueOf("Measured against")).toHaveTextContent(
      "Orchard Seminar Room (ORC-SEM), Classroom layout – up to 70"
    );
    // The app's own formatter: en-GB writes September as "Sept".
    expect(valueOf("Opens")).toHaveTextContent("1 Aug 2026, 09:00");
    expect(valueOf("Closes")).toHaveTextContent("30 Sept 2026, 17:00");
  });

  it("[SPM-64][AC4] names just the room when the booking's layout is no longer one the room offers", async () => {
    open(
      "organiser",
      event({ ...enabled, registrationVenueBooking: { ...seminarBooking, layoutName: "banquet" } }),
      {},
      { id: "organiser-id" }
    );

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Measured against")).toHaveTextContent(/^Orchard Seminar Room \(ORC-SEM\)$/);
  });

  it("[SPM-64][AC1] says when registration is not enabled, without the other rows", async () => {
    open("organiser", event(), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Registration")).toHaveTextContent("Not enabled for this event");
    expect(valueOf("Capacity")).toBeUndefined();
  });
});

describe("AC10 the organiser sees the settings but can't change them", () => {
  it("[SPM-64][AC10] gives the organiser no way to change them (TC23)", async () => {
    open("organiser", event(enabled), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(changeButton()).not.toBeInTheDocument();
  });
});

describe("AC11 nobody but the assigned coordinator gets the controls", () => {
  it.each([
    ["a coordinator who is not assigned", "coordinator", { id: "c2" }],
    ["the Ops Manager", "ops_manager", {}],
    ["Venue Staff", "venue_staff", {}],
    ["Technical Support", "tech_support", {}],
  ])("[SPM-64][AC11] shows %s the settings with no button (TC24)", async (_who, role, who) => {
    const api = open(role, event(enabled), {}, who);

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Capacity")).toHaveTextContent("50");
    expect(changeButton()).not.toBeInTheDocument();
    expect(api.sent(SETTINGS)).toEqual([]);
  });

  it("[SPM-64][AC11] [SPM-51][AC4] shows an attendee the public settings, without the booking or a button (TC25)", async () => {
    const { registrationVenueBookingId: _id, registrationVenueBooking: _b, ...publicSettings } = enabled;
    open("attendee", { ...event({ status: "confirmed" }), ...publicSettings, registrationVenueBooking: undefined });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Capacity")).toHaveTextContent("50");
    expect(valueOf("Measured against")).toBeUndefined();
    expect(changeButton()).not.toBeInTheDocument();
  });

  it("[SPM-64][AC11] gives the assigned coordinator no button outside Approved, Planning and Confirmed (TC03)", async () => {
    open("coordinator", event({ status: "postponed" }), {}, COORDINATOR);

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(changeButton()).not.toBeInTheDocument();
  });
});

describe("AC1 the assigned coordinator turns registration on and off", () => {
  it("[SPM-64][AC1] opens the form with the switch off and only the switch showing", async () => {
    asCoordinator();

    const box = await startEditing();

    expect(box).not.toBeChecked();
    expect(screen.queryByLabelText("Registration capacity")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("[SPM-64][AC1] turns registration on, sending only the switch, then shows it saved (TC01)", async () => {
    const api = asCoordinator();
    const box = await startEditing();

    await userEvent.click(box);
    expect(screen.getByLabelText("Registration capacity")).toHaveValue(null);
    expect(screen.getByLabelText("Registration opens")).toHaveValue("");
    expect(screen.getByLabelText("Registration closes")).toHaveValue("");

    api.on(SAVE, { event: event({ registrationEnabled: true }), flagged: [] });
    api.on(EVENT, event({ registrationEnabled: true }));
    await userEvent.click(saveButton());

    expect(await screen.findByText("Registration settings saved.")).toBeInTheDocument();
    expect(api.sent(SAVE)[0].body).toEqual({ registrationEnabled: true });
    expect(valueOf("Registration")).toHaveTextContent("Enabled");
    expect(changeButton()).toBeInTheDocument();
  });

  it("[SPM-64][AC1] turns registration off, keeping the saved values in the form (TC02)", async () => {
    const api = asCoordinator(event({ ...enabled, status: "confirmed" }));
    const box = await startEditing();

    expect(box).toBeChecked();
    expect(screen.getByLabelText("Registration capacity")).toHaveValue(50);

    await userEvent.click(box);
    api.on(SAVE, { event: event({ ...enabled, registrationEnabled: false }), flagged: [] });
    await userEvent.click(saveButton());

    await screen.findByText("Registration settings saved.");
    expect(api.sent(SAVE)[0].body).toEqual({ registrationEnabled: false });
  });

  it("[SPM-64][AC1] closes the form on Cancel without sending anything", async () => {
    const api = asCoordinator();
    await userEvent.click(await startEditing());

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(changeButton()).toBeInTheDocument();
    expect(api.sent(SAVE)).toEqual([]);
  });
});

describe("AC2 + AC3 the capacity", () => {
  it("[SPM-64][AC2] sends the capacity as a number, with no booking choice for a single booking (TC04)", async () => {
    const api = asCoordinator();
    await userEvent.click(await startEditing());

    fireEvent.change(screen.getByLabelText("Registration capacity"), { target: { value: "60" } });
    api.on(SAVE, { event: event({ registrationEnabled: true, registrationCapacity: 60 }), flagged: [] });
    await userEvent.click(saveButton());

    await screen.findByText("Registration settings saved.");
    expect(api.sent(SAVE)[0].body).toEqual({ registrationEnabled: true, registrationCapacity: 60 });
    expect(screen.queryByLabelText("Capacity measured against")).not.toBeInTheDocument();
  });

  it("[SPM-64][AC2][AC3] shows the server's refusal under 'Registration capacity' and keeps the form open (TC05, TC06)", async () => {
    const message =
      "Registration capacity can't be more than 70, the capacity of Orchard Seminar Room (ORC-SEM) in its Classroom layout.";
    asCoordinator(event(), { [SAVE]: reply(400, { error: message, details: { fieldErrors: { registrationCapacity: [message] } } }) });
    await userEvent.click(await startEditing());

    fireEvent.change(screen.getByLabelText("Registration capacity"), { target: { value: "71" } });
    await userEvent.click(saveButton());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Registration capacity")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Registration settings saved.")).not.toBeInTheDocument();
  });
});

describe("AC4 choosing the booking the capacity is measured against", () => {
  it("[SPM-64][AC4] offers only the active bookings when there are several, and sends the one chosen (TC09)", async () => {
    const api = asCoordinator(event(), { [SETTINGS]: { bookings: [seminarOption, studioOption] } });
    await userEvent.click(await startEditing());

    const picker = await screen.findByLabelText("Capacity measured against");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a booking",
      "Orchard Seminar Room (ORC-SEM) · Classroom · up to 70 · Approved",
      "Orchard Studio (ORC-STU) · Classroom · up to 40 · Pending",
    ]);

    await userEvent.selectOptions(picker, "b2");
    fireEvent.change(screen.getByLabelText("Registration capacity"), { target: { value: "40" } });
    api.on(SAVE, { event: event(), flagged: [] });
    await userEvent.click(saveButton());

    await screen.findByText("Registration settings saved.");
    expect(api.sent(SAVE)[0].body).toEqual({
      registrationEnabled: true,
      registrationCapacity: 40,
      registrationVenueBookingId: "b2",
    });
  });

  it("[SPM-64][AC4] leaves the layout and capacity out of a booking that has neither", async () => {
    const bare = { ...studioOption, layoutName: null, layoutCapacity: null };
    asCoordinator(event(), { [SETTINGS]: { bookings: [seminarOption, bare] } });
    await userEvent.click(await startEditing());

    const picker = await screen.findByLabelText("Capacity measured against");
    expect(within(picker).getByRole("option", { name: "Orchard Studio (ORC-STU) · Pending" })).toBeInTheDocument();
  });

  it("[SPM-64] still opens the form when the bookings cannot be loaded", async () => {
    const api = asCoordinator(event(), { [SETTINGS]: reply(500, {}) });
    await userEvent.click(await startEditing());

    await waitFor(() => expect(api.sent(SETTINGS)).toHaveLength(1));
    expect(screen.queryByLabelText("Capacity measured against")).not.toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
  });

  it("[SPM-64][AC4] shows a missing choice under 'Capacity measured against' (TC10)", async () => {
    const message = "Choose which venue booking the capacity is measured against.";
    asCoordinator(event(), {
      [SETTINGS]: { bookings: [seminarOption, studioOption] },
      [SAVE]: reply(400, { error: message, details: { fieldErrors: { registrationVenueBookingId: [message] } } }),
    });
    await userEvent.click(await startEditing());

    fireEvent.change(screen.getByLabelText("Registration capacity"), { target: { value: "30" } });
    await userEvent.click(saveButton());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Capacity measured against")).toHaveAttribute("aria-invalid", "true");
  });
  // Found while writing the TC18 fixture: with the measured booking lost and
  // one active booking left, the coordinator only presses Save, so the form
  // must send that booking - otherwise nothing changes and the setup stays
  // incomplete.
  it("[SPM-64][AC4] moves a lost measured booking to the only active one left, so Save sends it (TC18)", async () => {
    const lostEvent = event({
      ...enabled,
      registrationCapacity: 40,
      registrationVenueBooking: { ...seminarBooking, status: "rejected" },
    });
    const api = asCoordinator(lostEvent, { [SETTINGS]: { bookings: [studioOption] } });
    await startEditing();

    expect(screen.queryByLabelText("Capacity measured against")).not.toBeInTheDocument();
    api.on(SAVE, { event: lostEvent, flagged: [] });
    await userEvent.click(saveButton());

    await screen.findByText("Registration settings saved.");
    expect(api.sent(SAVE)[0].body).toEqual({ registrationVenueBookingId: "b2" });
  });
});

describe("AC5 - AC7 the registration period", () => {
  it("[SPM-64][AC5] sends the dates typed, as full date-times (TC11, TC14)", async () => {
    const api = asCoordinator();
    await userEvent.click(await startEditing());

    fireEvent.change(screen.getByLabelText("Registration opens"), { target: { value: "2027-02-01T09:00" } });
    fireEvent.change(screen.getByLabelText("Registration closes"), { target: { value: "2027-03-10T17:00" } });
    api.on(SAVE, { event: event(), flagged: [] });
    await userEvent.click(saveButton());

    await screen.findByText("Registration settings saved.");
    expect(api.sent(SAVE)[0].body).toEqual({
      registrationEnabled: true,
      registrationOpensAt: new Date("2027-02-01T09:00").toISOString(),
      registrationClosesAt: new Date("2027-03-10T17:00").toISOString(),
    });
  });

  it("[SPM-64][AC6] shows a refused period under 'Registration closes' (TC12, TC13, TC15)", async () => {
    const message = "Registration must close no later than the event starts.";
    asCoordinator(event(), {
      [SAVE]: reply(400, { error: message, details: { fieldErrors: { registrationClosesAt: [message] } } }),
    });
    await userEvent.click(await startEditing());

    fireEvent.change(screen.getByLabelText("Registration closes"), { target: { value: "2027-03-17T09:01" } });
    await userEvent.click(saveButton());

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Registration closes")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("AC8 incomplete setup is shown as outstanding", () => {
  it("[SPM-64][AC8] lists what is still needed while registration is on (TC16)", async () => {
    asCoordinator(event({ registrationEnabled: true }));

    const title = await screen.findByText("Registration setup is incomplete");

    expect(title.closest("[role='alert']")).toHaveTextContent(
      "Still needed: registration capacity, opening date, closing date."
    );
  });

  it("[SPM-64][AC8] says when the booking the capacity was measured against is no longer active (TC18)", async () => {
    asCoordinator(event({ ...enabled, registrationVenueBooking: { ...seminarBooking, status: "rejected" } }));

    await screen.findByText("Registration setup is incomplete");

    expect(
      screen.getByText("The venue booking the capacity was measured against is no longer active. Choose another booking.")
    ).toBeInTheDocument();
  });

  it.each([
    ["fully set up", enabled],
    ["turned off", { registrationEnabled: false }],
  ])("[SPM-64][AC8] shows no alert when registration is %s (TC16, TC17)", async (_state, settings) => {
    asCoordinator(event(settings));

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(screen.queryByText("Registration setup is incomplete")).not.toBeInTheDocument();
  });
});

describe("AC9 what a save flagged", () => {
  it("[SPM-64][AC9] lists the registrations the save flagged for review (TC19)", async () => {
    const line =
      "Registrations: 15 attendees – the registration capacity was lowered below the number registered or waitlisted";
    const api = asCoordinator(event({ ...enabled, registrationCapacity: 20 }));
    await startEditing();

    fireEvent.change(screen.getByLabelText("Registration capacity"), { target: { value: "14" } });
    api.on(SAVE, { event: event({ ...enabled, registrationCapacity: 14 }), flagged: [line] });
    await userEvent.click(saveButton());

    expect(await screen.findByText("Flagged for review")).toBeInTheDocument();
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(api.sent(SAVE)[0].body).toEqual({ registrationCapacity: 14 });
  });
});

describe("a save answered without a flagged list", () => {
  it("[SPM-64][AC9] is saved, with nothing flagged", async () => {
    const api = asCoordinator();
    await userEvent.click(await startEditing());

    api.on(SAVE, { event: event({ registrationEnabled: true }) });
    api.on(EVENT, event({ registrationEnabled: true }));
    await userEvent.click(saveButton());

    expect(await screen.findByText("Registration settings saved.")).toBeInTheDocument();
  });
});

describe("when saving goes wrong", () => {
  it("[SPM-64] shows a refusal that names no field above the form", async () => {
    asCoordinator(event(), {
      [SAVE]: reply(400, {
        error: "Registration settings can only be changed while the event is Approved, Planning or Confirmed.",
      }),
    });
    await userEvent.click(await startEditing());

    await userEvent.click(saveButton());

    expect(
      await screen.findByText("Registration settings can only be changed while the event is Approved, Planning or Confirmed.")
    ).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
  });

  it("[SPM-64] says so when the server can't be reached", async () => {
    asCoordinator(event(), {
      [SAVE]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await userEvent.click(await startEditing());

    await userEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument()
    );
  });
});

// SPM-52 Withdraw from Event (AC4, AC5): the organiser and coordinator see a
// withdrawal in the places taken. GET /api/events/<ref> sends registrationCounts to them only.
describe("SPM-52 the places taken and withdrawals", () => {
  const counts = { registrationCounts: { taken: 12, waitlisted: 0, withdrawn: 3 } };

  it("[SPM-52][AC4][AC5] shows the organiser the places taken out of the capacity, and the withdrawals", async () => {
    open("organiser", event({ ...enabled, ...counts }), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Places taken")).toHaveTextContent("12 of 50 · 38 left");
    expect(valueOf("Withdrawn")).toHaveTextContent("3");
  });

  it("[SPM-52][AC4][AC5] shows the coordinator the same", async () => {
    asCoordinator(event({ ...enabled, ...counts }));

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Places taken")).toHaveTextContent("12 of 50 · 38 left");
    expect(valueOf("Withdrawn")).toHaveTextContent("3");
  });

  it("[SPM-52][AC4][AC5] shows only the number taken when there is no capacity", async () => {
    open("organiser", event({ ...enabled, registrationCapacity: null, ...counts }), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Places taken")?.textContent).toBe("12");
  });

  it("[SPM-52][AC4][AC5] never shows fewer than none left", async () => {
    const over = { registrationCounts: { taken: 52, waitlisted: 0, withdrawn: 0 } };
    open("organiser", event({ ...enabled, ...over }), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Places taken")).toHaveTextContent("52 of 50 · 0 left");
  });

  it("[SPM-52][AC4][AC5] shows no counts when the event doesn't send them", async () => {
    open("organiser", event(enabled), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Places taken")).toBeUndefined();
    expect(valueOf("Withdrawn")).toBeUndefined();
  });

  it("[SPM-52][AC4][AC5] keeps showing the counts after registration is turned off, without a capacity", async () => {
    open("organiser", event(counts), {}, { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "SPM64 Orchard Data Forum" });

    expect(valueOf("Registration")).toHaveTextContent("Not enabled for this event");
    expect(valueOf("Places taken")?.textContent).toBe("12");
    expect(valueOf("Withdrawn")).toHaveTextContent("3");
  });
});

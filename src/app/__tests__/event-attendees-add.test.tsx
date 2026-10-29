// @vitest-environment jsdom
//
// Manually Add Attendee (SPM-57): the assigned coordinator's 'Add attendee'
// form on the Attendees tab (src/app/events/[id]/attendees/page.tsx and
// AddAttendeeForm.tsx). The list is GET /api/events/[ref]/registrations; the
// form posts to the same address (src/app/api/__tests__/event-registrations-add.test.ts).
//
// Decided here, not in the story (change the test if the team wants otherwise):
//   - every label and message quoted below (docs/test-cases/SPM-57_test_cases.json)

import { describe, it, expect } from "vitest";
import EventAttendeesPage from "@/app/events/[id]/attendees/page";
import { mockApi, render, reply, screen, setRoute, signedInAs, userEvent, waitFor, within } from "@/test/ui";

const REF = "EVT-000007";
const LIST = `GET /api/events/${REF}/registrations`;
const ADD = `POST /api/events/${REF}/registrations`;

function registration(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: name,
    status: "registered",
    registeredAt: "2026-10-01T02:00:00.000Z",
    withdrawnAt: null,
    attendee: { name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: null },
    addedBy: null,
    dietaryRequirements: null,
    accessibilityRequirements: null,
    ...overrides,
  };
}

const jocelyn = registration("Jocelyn Pang", {
  addedBy: { name: "Daniel Tan" },
  dietaryRequirements: "Halal",
  accessibilityRequirements: "Hearing loop",
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: { sequenceNumber: 7, title: "SPM57 Salon Briefing", status: "confirmed" },
    registrationEnabled: true,
    registrationCapacity: 2,
    counts: { taken: 3, waitlisted: 1, withdrawn: 0 },
    registrations: [registration("Marcus Yeo"), jocelyn],
    venueCapacity: { capacity: 4, venue: "SPM57 Salon (SPM57-SAL)", layout: "Theatre" },
    canAddAttendees: true,
    addAttendeesRefusal: null,
    ...overrides,
  };
}

function open(routes: Record<string, unknown> = {}, role = "coordinator") {
  setRoute(`/events/${REF}/attendees`, { id: REF });
  const api = mockApi({ ...signedInAs(role), [LIST]: payload(), ...routes });
  render(<EventAttendeesPage />);
  return api;
}

/// Opens the form and types the email.
async function fill(email: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Add attendee" }));
  if (email) await userEvent.type(screen.getByLabelText("Attendee email"), email);
}
const form = () => screen.getByRole("form", { name: "Add an attendee" });
const submit = () => userEvent.click(within(form()).getByRole("button", { name: "Add attendee" }));

describe("[SPM-57] the Attendees tab", () => {
  it("[SPM-57][AC3] shows the venue capacity registration is measured against", async () => {
    open();

    expect(await screen.findByText("Venue capacity: 4 · SPM57 Salon (SPM57-SAL), Theatre layout")).toBeInTheDocument();
  });

  it("[SPM-57][AC1][AC5] shows the requirements recorded under an attendee's name", async () => {
    open({}, "organiser");

    const cell = within(await screen.findByRole("table")).getByText("Jocelyn Pang").closest("tr") as HTMLElement;
    expect(within(cell).getByText("Added by Daniel Tan")).toBeInTheDocument();
    expect(within(cell).getByText("Dietary: Halal")).toBeInTheDocument();
    expect(within(cell).getByText("Accessibility: Hearing loop")).toBeInTheDocument();
    const marcus = within(screen.getByRole("table")).getByText("Marcus Yeo").closest("tr") as HTMLElement;
    expect(within(marcus).queryByText(/Dietary|Accessibility/)).not.toBeInTheDocument();
  });

  it("[SPM-57][AC5] offers the organiser no 'Add attendee'", async () => {
    open({ [LIST]: payload({ canAddAttendees: false }) }, "organiser");

    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Add attendee" })).not.toBeInTheDocument();
  });

  it.each([
    ["isn't Confirmed", "Attendees can only be added to a Confirmed event."],
    ["has started", "This event has started, so attendees can no longer be added."],
    [
      "has no known venue capacity",
      "This event's venue capacity isn't known, so attendees can't be added. Choose the venue booking registration is measured against in the Registration settings first.",
    ],
  ])("[SPM-57][AC1][AC3] tells the coordinator why not for an event that %s, instead of the button", async (_what, reason) => {
    open({ [LIST]: payload({ addAttendeesRefusal: reason, venueCapacity: null }) });

    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add attendee" })).not.toBeInTheDocument();
  });

  it("[SPM-57][AC1] says nothing more when registration is off: the tab already says so", async () => {
    open({
      [LIST]: payload({ registrationEnabled: false, addAttendeesRefusal: "Registration is not enabled for this event" }),
    });

    expect(await screen.findByText("Registration is not enabled for this event")).toBeInTheDocument();
    expect(screen.getAllByText(/Registration is not enabled/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Add attendee" })).not.toBeInTheDocument();
  });
});

describe("[SPM-57] adding an attendee", () => {
  it("[SPM-57][AC1] opens a form with the email and the two requirements, and Cancel closes it", async () => {
    open();

    await fill("");

    expect(screen.getByRole("heading", { name: "Add an attendee" })).toBeInTheDocument();
    expect(screen.getByLabelText("Attendee email")).toBeInTheDocument();
    expect(screen.getByLabelText("Dietary requirements")).toBeInTheDocument();
    expect(screen.getByLabelText("Accessibility requirements")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Add an attendee" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add attendee" })).toBeInTheDocument();
  });

  it("[SPM-57][AC1][AC2] adds the attendee with their requirements, says so and reloads the list", async () => {
    const api = open({ [ADD]: reply(201, { id: "r9", status: "registered", message: "Lee Wei Ming has been added to the registration list." }) });

    await fill("lee.wei.ming@example.com");
    await userEvent.type(screen.getByLabelText("Dietary requirements"), "Vegetarian");
    await userEvent.type(screen.getByLabelText("Accessibility requirements"), "Wheelchair access");
    await submit();

    expect(await screen.findByText("Lee Wei Ming has been added to the registration list.")).toBeInTheDocument();
    expect(api.sent(ADD)[0].body).toEqual({
      email: "lee.wei.ming@example.com",
      dietaryRequirements: "Vegetarian",
      accessibilityRequirements: "Wheelchair access",
    });
    expect(screen.queryByRole("heading", { name: "Add an attendee" })).not.toBeInTheDocument();
    await waitFor(() => expect(api.sent(LIST)).toHaveLength(2));
  });

  it.each([
    ["", "Enter the attendee's email address"],
    ["not-an-email", "Enter a valid email address"],
  ])("[SPM-57][AC1] refuses %j before sending it", async (email, message) => {
    const api = open();

    await fill(email);
    await submit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Attendee email")).toHaveFocus();
    expect(api.sent(ADD)).toHaveLength(0);
  });

  it("[SPM-57][AC1] shows the server's refusal of the account on the email field", async () => {
    const message = "No Attendee account uses this email address. Only people with an Attendee account can be added.";
    open({ [ADD]: reply(400, { error: message, details: { fieldErrors: { email: [message] } } }) });

    await fill("vip.guest@example.com");
    await submit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Attendee email")).toHaveAttribute("aria-invalid", "true");
  });

  it("[SPM-57][AC3] shows the venue capacity refusal above the form, which stays open", async () => {
    const full =
      "This event has reached its venue capacity: 4 attendees in SPM57 Salon (SPM57-SAL), Theatre layout. No more attendees can be added.";
    open({ [ADD]: reply(400, { error: full }) });

    await fill("ravi.subramaniam@example.com");
    await submit();

    expect(await screen.findByText(full)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add an attendee" })).toBeInTheDocument();
    expect(screen.queryByText(/has been added/)).not.toBeInTheDocument();
  });

  it("[SPM-57] says so when the answer has no body", async () => {
    open({ [ADD]: reply(500) });

    await fill("lee.wei.ming@example.com");
    await submit();

    expect(await screen.findByText("Could not add this attendee.")).toBeInTheDocument();
  });

  it("[SPM-57] says so when the server cannot be reached", async () => {
    open({
      [ADD]: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await fill("lee.wei.ming@example.com");
    await submit();

    expect(await screen.findByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument();
  });

  it("[SPM-57] clears the last confirmation when the form is opened again", async () => {
    open({ [ADD]: reply(201, { id: "r9", status: "registered", message: "Lee Wei Ming has been added to the registration list." }) });

    await fill("lee.wei.ming@example.com");
    await submit();
    await screen.findByText("Lee Wei Ming has been added to the registration list.");
    await userEvent.click(screen.getByRole("button", { name: "Add attendee" }));

    expect(screen.queryByText("Lee Wei Ming has been added to the registration list.")).not.toBeInTheDocument();
  });
});

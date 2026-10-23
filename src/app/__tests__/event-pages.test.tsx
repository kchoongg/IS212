// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import EventOverviewPage from "@/app/events/[id]/page";
import ReviewRequestPage from "@/app/events/[id]/review/page";
import { EventGlance } from "@/app/events/[id]/EventGlance";
import { ROLES } from "@/lib/roles";
import { REVIEW_FIELD_LABELS } from "@/lib/eventReview";
import {
  CLARIFICATION_ALREADY_OPEN,
  CLARIFICATION_FIELDS_REQUIRED,
  CLARIFICATION_MESSAGE_REQUIRED,
} from "@/lib/clarification";
import { formatDateTime } from "@/lib/format";
import {
  breadcrumb,
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
const EVENT = `GET /api/events/${REF}`;
const daniel = { id: "c1", fullName: "Daniel Tan" };
const priya = { id: "c2", fullName: "Priya Raj" };

/// The event as staff and its organiser receive it: every field present.
function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-id",
    sequenceNumber: 7,
    title: "Gala Dinner",
    purpose: "Annual client event",
    description: "Dinner and awards",
    category: "conference",
    status: "planning",
    startsAt: "2027-03-04T01:00:00.000Z",
    endsAt: "2027-03-04T09:00:00.000Z",
    expectedAttendance: 200,
    preferredLayout: "u_shape",
    accessibilityNotes: "Step-free access",
    specialRequirements: "VIP entrance",
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    organiserId: "organiser-id",
    organisationId: "org-id",
    coordinatorId: "c1",
    organiser: { fullName: "Rachel Ng" },
    organisation: { name: "Meridian" },
    coordinator: { fullName: "Daniel Tan" },
    facilityRequirements: [],
    equipmentRequests: [],
    sessions: [],
    rejectionReason: null,
    ...overrides,
  };
}

/// The same event as an Attendee receives it: the public fields only.
function publicEvent() {
  return {
    id: "event-id",
    sequenceNumber: 7,
    title: "Gala Dinner",
    description: "Dinner and awards",
    category: "conference",
    status: "confirmed",
    startsAt: "2027-03-04T01:00:00.000Z",
    endsAt: "2027-03-04T09:00:00.000Z",
    registrationEnabled: true,
    registrationCapacity: 150,
    registrationOpensAt: "2027-02-01T00:00:00.000Z",
    registrationClosesAt: "2027-03-01T00:00:00.000Z",
    organisation: { name: "Meridian" },
  };
}

const terms = () => screen.getAllByRole("term").map((t) => t.textContent);
const valueOf = (label: string) => {
  const term = screen.getAllByRole("term").find((t) => t.textContent === label);
  return term!.nextElementSibling as HTMLElement;
};

/// The page holds several dialogs; each is found by its own title.
const dialogTitled = (title: string) =>
  screen.getByText(title, { selector: "dialog h2" }).closest("dialog") as HTMLDialogElement;

describe("Event overview", () => {
  function open(role: string, eventRow: unknown = event(), extra: Record<string, unknown> = {}, who = {}) {
    setRoute(`/events/${REF}`, { id: REF });
    const api = mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, ...extra });
    render(<EventOverviewPage />);
    return api;
  }

  it("[SPM-22][AC4] sends an anonymous visitor to log in, remembering the event", async () => {
    setRoute(`/events/${REF}`, { id: REF });
    mockApi(signedOut());

    render(<EventOverviewPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007"));
  });

  it("[SPM-31] renders nothing until it knows who is looking", () => {
    setRoute(`/events/${REF}`, { id: REF });
    mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

    const { container } = render(<EventOverviewPage />);

    expect(container).toBeEmptyDOMElement();
  });

  it("[SPM-31][AC1] [SPM-27][AC1] shows the event's title, reference, status and details", async () => {
    open("coordinator");

    expect(await screen.findByRole("heading", { level: 1, name: "Gala Dinner" })).toBeInTheDocument();
    expect(screen.getByText("EVT-000007")).toBeInTheDocument();
    expect(screen.getByText("Annual client event")).toBeInTheDocument();
    expect(valueOf("Category")).toHaveTextContent("Conference");
    expect(valueOf("Status")).toHaveTextContent("Planning");
    expect(valueOf("Expected attendance")).toHaveTextContent("200");
    expect(valueOf("Preferred layout")).toHaveTextContent("U shape");
    expect(valueOf("Organiser")).toHaveTextContent("Rachel Ng");
    expect(valueOf("Company")).toHaveTextContent("Meridian");
    expect(valueOf("Coordinator")).toHaveTextContent("Daniel Tan");
  });

  it("[SPM-31][AC1] leaves out the Company row when the event comes without one", async () => {
    const { organisation: _omitted, ...withoutCompany } = event();
    open("coordinator", withoutCompany);

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(terms()).not.toContain("Company");
  });

  it("[SPM-31][AC1] [SPM-30][AC5] says when no coordinator is assigned, and dashes out what is empty", async () => {
    open("coordinator", event({ coordinator: null, coordinatorId: null, category: null, preferredLayout: null, organisation: null }));

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(valueOf("Coordinator")).toHaveTextContent("Not yet assigned");
    expect(valueOf("Category")).toHaveTextContent("—");
    expect(valueOf("Preferred layout")).toHaveTextContent("—");
    expect(valueOf("Company")).toHaveTextContent("—");
  });

  // SPM-98: <list> / <event title>, the title being the current page.
  it.each([
    ["organiser", "My Events"],
    ["coordinator", "Events"],
  ])("[SPM-31][BUG-98] calls the breadcrumb's list '%s' for %s, and ends on the event's title", async (role, list) => {
    open(role);
    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(breadcrumb()).toEqual([
      [list, "/events"],
      ["Gala Dinner", null],
    ]);
  });

  it("[SPM-31][BUG-98] calls the event 'Event' in the breadcrumb while it loads", async () => {
    open("coordinator", () => new Promise(() => {}));

    await screen.findByRole("heading", { level: 1, name: "Loading…" });
    expect(breadcrumb()).toEqual([
      ["Events", "/events"],
      ["Event", null],
    ]);
  });

  it.each([
    ["organiser", ["Overview", "Equipment", "Attendees"]],
    // SPM-33: the Readiness tab is built, for coordinators only.
    ["coordinator", ["Overview", "Venue", "Equipment", "Attendees", "Readiness"]],
    ["venue_staff", ["Overview", "Venue"]],
    ["tech_support", ["Overview", "Equipment"]],
    ["ops_manager", ["Overview"]],
    ["attendee", ["Overview"]],
  ])("[SPM-22][AC2] offers %s the tabs %j", async (role, expected) => {
    // As the server says it for the organiser who raised the event and its
    // assigned coordinator; the other roles never have the Attendees tab.
    open(role, role === "attendee" ? publicEvent() : event({ canViewRegistrationList: true }), {
      "GET /api/assignments": { coordinators: [] },
    });

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });
    const tabs = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");

    expect(tabs.map((t) => t.textContent)).toEqual(expected);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
  });

  // SPM-65 (AC8, AC1): another organiser at the same client, or a coordinator
  // not assigned to the event, can open it but not its registration list.
  it.each([
    ["organiser", ["Overview", "Equipment"]],
    ["coordinator", ["Overview", "Venue", "Equipment", "Readiness"]],
  ])("[SPM-22][AC2] offers %s no Attendees tab on an event whose registrations are not theirs", async (role, expected) => {
    open(role, event({ canViewRegistrationList: false }), { "GET /api/assignments": { coordinators: [] } });

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });
    const tabs = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");

    expect(tabs.map((t) => t.textContent)).toEqual(expected);
  });

  it("[SPM-24][AC4] sends the owner of a draft to the editor instead", async () => {
    open("organiser", event({ status: "draft" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/events/EVT-000007/edit"));
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
  });

  describe("what an attendee sees", () => {
    it("[SPM-22][AC5] only the public details - no internal planning rows or cards", async () => {
      open("attendee", publicEvent());

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      // CHANGED (SPM-64): 'Window' became 'Opens' and 'Closes' on the Registration card.
      expect(terms()).toEqual(["Category", "Status", "When", "Description", "Company", "Registration", "Capacity", "Opens", "Closes"]);
      expect(screen.queryByRole("heading", { name: "Venue requirements" })).not.toBeInTheDocument();
    });

    // CHANGED (SPM-64): the period is shown as 'Opens' and 'Closes'.
    it("[SPM-51][AC4] the registration capacity and period", async () => {
      open("attendee", publicEvent());

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Capacity")).toHaveTextContent("150");
      expect(valueOf("Opens")).not.toHaveTextContent("—");
      expect(valueOf("Closes")).not.toHaveTextContent("—");
    });
  });

  it("[SPM-51][AC8] says registration is not enabled when it is not", async () => {
    open("coordinator");

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(valueOf("Registration")).toHaveTextContent("Not enabled for this event");
  });

  it("[SPM-31][AC1] lists the facility requirements, marking the optional ones", async () => {
    open(
      "coordinator",
      event({
        facilityRequirements: [
          { facilityId: "f1", isMandatory: true, facility: { id: "f1", name: "Hearing loop", category: "accessibility" } },
          { facilityId: "f2", isMandatory: false, facility: { id: "f2", name: "Stage", category: "facility" } },
        ],
      })
    );

    await screen.findByRole("heading", { name: "Venue requirements" });
    const items = within(valueOf("Required facilities")).getAllByRole("listitem").map((li) => li.textContent);

    expect(items).toEqual(["Hearing loop", "Stage (nice-to-have)"]);
    expect(valueOf("Accessibility notes")).toHaveTextContent("Step-free access");
    expect(valueOf("Special requirements")).toHaveTextContent("VIP entrance");
  });

  it("[SPM-31][AC1] dashes out the facility requirements when there are none", async () => {
    open("coordinator");

    await screen.findByRole("heading", { name: "Venue requirements" });

    expect(valueOf("Required facilities")).toHaveTextContent("—");
  });

  it("[SPM-28][AC5] shows why a rejected request was rejected", async () => {
    open("organiser", event({ status: "rejected", rejectionReason: "No venue is licensed overnight." }));

    expect(await screen.findByText("This request was rejected")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No venue is licensed overnight.");
  });

  describe("the way in to a review", () => {
    it("[SPM-28][AC1] is offered to the assigned coordinator while the request is under review", async () => {
      open("coordinator", event({ status: "under_review" }), {}, { id: "c1" });

      expect(await screen.findByRole("link", { name: "Review request" })).toHaveAttribute(
        "href",
        "/events/EVT-000007/review"
      );
    });

    it("[SPM-28][AC1] is offered for an event with no company on record", async () => {
      open("coordinator", event({ status: "under_review", organisationId: null }), {}, { id: "c1" });

      expect(await screen.findByRole("link", { name: "Review request" })).toBeInTheDocument();
    });

    it("[SPM-28][AC1] leaves the planning controls in place for an event with no company on record", async () => {
      open("coordinator", event({ organisationId: null }), {}, { id: "c1" });

      expect(await screen.findByRole("link", { name: "Edit event information" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change registration settings" })).toBeInTheDocument();
    });

    it("[SPM-28][AC1] is not offered to a coordinator it is not assigned to", async () => {
      open("coordinator", event({ status: "under_review" }), {}, { id: "someone-else" });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("link", { name: "Review request" })).not.toBeInTheDocument();
    });

    it("[SPM-28][AC1] is not offered once the request has been decided", async () => {
      open("coordinator", event({ status: "approved" }), {}, { id: "c1" });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("link", { name: "Review request" })).not.toBeInTheDocument();
    });
  });

  describe("assigning a coordinator from the event", () => {
    const assignments = { "GET /api/assignments": { awaiting: [], assigned: [], coordinators: [daniel, priya] } };
    const unassigned = () => event({ status: "submitted", coordinatorId: null, coordinator: null });

    it("[SPM-30][AC1] lets the Ops Manager assign one to a submitted event, then reloads it", async () => {
      const api = open("ops_manager", unassigned(), {
        ...assignments,
        "PUT /api/events/EVT-000007/coordinator": { status: "under_review", coordinator: daniel, previousCoordinator: null },
      });
      expect(await screen.findByRole("heading", { name: "Assign a coordinator" })).toBeInTheDocument();
      expect(screen.getByText("Assigning one moves this event to Under review.")).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Assign to — Gala Dinner" }), "Daniel Tan");
      await userEvent.click(screen.getByRole("button", { name: "Assign" }));

      expect(await screen.findByText("Daniel Tan is now the coordinator. The event has moved to Under review.")).toBeInTheDocument();
      await waitFor(() => expect(api.sent(EVENT)).toHaveLength(2));
    });

    it("[SPM-30][AC1] is offered for an event with no company on record", async () => {
      open("ops_manager", event({ status: "submitted", coordinatorId: null, coordinator: null, organisationId: null }), assignments);

      expect(await screen.findByRole("heading", { name: "Assign a coordinator" })).toBeInTheDocument();
    });

    it("[SPM-30][AC1] names an untitled event as such in the picker", async () => {
      open("ops_manager", event({ status: "submitted", coordinatorId: null, coordinator: null, title: null }), assignments);

      expect(await screen.findByRole("combobox", { name: "Assign to — Untitled event" })).toBeInTheDocument();
    });

    it("[SPM-30][AC6] lets the Ops Manager change the coordinator of a live event", async () => {
      open("ops_manager", event(), {
        ...assignments,
        "PUT /api/events/EVT-000007/coordinator": { status: "planning", coordinator: priya, previousCoordinator: daniel },
      });
      expect(await screen.findByRole("heading", { name: "Change coordinator" })).toBeInTheDocument();
      expect(screen.getByText("Currently Daniel Tan.")).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Reassign to — Gala Dinner" }), "Priya Raj");
      await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
      await userEvent.click(within(dialogTitled("Reassign this event?")).getByRole("button", { name: "Reassign", hidden: true }));

      expect(await screen.findByText("Reassigned from Daniel Tan to Priya Raj.")).toBeInTheDocument();
    });

    it("[SPM-30][AC6] says only 'assigned' when it cannot name the current coordinator", async () => {
      open("ops_manager", event({ coordinator: null }), assignments);

      expect(await screen.findByText("Currently assigned.")).toBeInTheDocument();
    });

    it("[SPM-30][AC6] is not offered once the event is completed", async () => {
      open("ops_manager", event({ status: "completed" }), assignments);

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("heading", { name: "Change coordinator" })).not.toBeInTheDocument();
    });

    it("[SPM-30][AC1] is left out, with the rest of the page intact, when the coordinator list fails to load", async () => {
      open("ops_manager", unassigned(), { "GET /api/assignments": reply(500, {}) });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("heading", { name: "Assign a coordinator" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
    });

    it("[SPM-30][AC1] survives the coordinator list request failing outright", async () => {
      open("ops_manager", unassigned(), { "GET /api/assignments": () => Promise.reject(new Error("offline")) });

      expect(await screen.findByRole("heading", { name: "Details" })).toBeInTheDocument();
    });

    it.each(ROLES.filter((r) => r !== "ops_manager" && r !== "attendee"))(
      "[SPM-30][AC1] [SPM-22][AC3] is never offered to %s, who is not even sent the list of coordinators",
      async (role) => {
        const api = open(role, unassigned());

        await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

        expect(screen.queryByRole("heading", { name: "Assign a coordinator" })).not.toBeInTheDocument();
        expect(api.sent("GET /api/assignments")).toHaveLength(0);
      }
    );
  });

  describe("the venue the event is in", () => {
    it("[SPM-36][AC4] SPM-36-TC02: is still named for the organiser once the event is completed", async () => {
      open("organiser", event({ status: "completed", venueBookings: [{ session: null, venue: { name: "Orchard Gallery", code: "ORC-GAL" } }] }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Status")).toHaveTextContent("Completed");
      expect(valueOf("Venue")).toHaveTextContent(/^Orchard Gallery \(ORC-GAL\)$/);
    });

    it("[SPM-31][AC1] is named once a booking is approved", async () => {
      open("organiser", event({ venueBookings: [{ session: null, venue: { name: "Hall A", code: "HALL-A" } }] }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Venue")).toHaveTextContent(/^Hall A \(HALL-A\)$/);
    });

    it("[SPM-31][AC1] is named per session for a multi-session event", async () => {
      open(
        "organiser",
        event({
          venueBookings: [
            { session: { label: "Day 1" }, venue: { name: "Hall A", code: "HALL-A" } },
            { session: { label: null }, venue: { name: "Room B", code: "ROOM-B" } },
          ],
        })
      );

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Venue")).toHaveTextContent("Day 1: Hall A (HALL-A) · Room B (ROOM-B)");
    });

    it("[SPM-81][AC6] SPM-81-TC07: names every approved room when the event is booked into more than one", async () => {
      open(
        "organiser",
        event({
          venueBookings: [
            { session: null, venue: { name: "Room B", code: "ROOM-B" } },
            { session: null, venue: { name: "Hall A", code: "HALL-A" } },
          ],
        })
      );

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Venue")).toHaveTextContent(/^Room B \(ROOM-B\) · Hall A \(HALL-A\)$/);
    });

    it("[SPM-31][AC1] reads 'Not booked yet' until one is", async () => {
      open("organiser", event({ venueBookings: [] }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Venue")).toHaveTextContent("Not booked yet");
    });

    it("[SPM-22][AC5] has no row at all for a viewer who is not sent the bookings", async () => {
      open("attendee", publicEvent());

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(terms()).not.toContain("Venue");
    });
  });

  describe.each([
    {
      action: "recording a withdrawal",
      button: "Record withdrawal",
      title: "Record this withdrawal?",
      keep: "Keep request",
      from: "under_review",
      sends: { status: "withdrawn" },
      warning: "Gala Dinner will be marked Withdrawn and can't be reopened.",
      untitled: "This request will be marked Withdrawn",
      done: "The withdrawal has been recorded.",
      fallback: "Could not withdraw this request.",
      refusal: "This event is planning and can't be moved to withdrawn.",
      notFrom: ["submitted", "approved", "planning", "withdrawn"],
    },
    {
      action: "confirming the event",
      button: "Confirm event",
      title: "Confirm this event?",
      keep: "Not yet",
      from: "planning",
      sends: { status: "confirmed" },
      warning: "Gala Dinner will be marked Confirmed",
      untitled: "This event will be marked Confirmed",
      done: "The event is confirmed. The organiser can now see the arrangements.",
      fallback: "Could not confirm this event.",
      refusal: "This event can't be confirmed yet: no venue booking has been approved.",
      notFrom: ["under_review", "approved", "confirmed", "postponed"],
    },
  ])("$action", ({ button, title, keep, from, sends, warning, untitled, done, fallback, refusal, notFrom }) => {
    const PATCH = `PATCH /api/events/${REF}`;
    const assigned = { id: "c1" };
    const openAs = (routes: Record<string, unknown> = {}, eventRow = event({ status: from })) =>
      open("coordinator", eventRow, routes, assigned);
    const ask = async () => userEvent.click(await screen.findByRole("button", { name: button }));
    const go = () => userEvent.click(within(dialogTitled(title)).getByRole("button", { name: button, hidden: true }));

    it("[SPM-34][AC4] [SPM-59][AC1] is offered to the assigned coordinator", async () => {
      openAs();

      expect(await screen.findByRole("button", { name: button })).toBeInTheDocument();
    });

    it.each(notFrom)("[SPM-34][AC1] [SPM-59][AC1] is not offered while the event is %s", async (status) => {
      openAs({}, event({ status }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("button", { name: button })).not.toBeInTheDocument();
    });

    it.each([
      ["a coordinator it is not assigned to", "coordinator", { id: "c2" }],
      ["the Ops Manager", "ops_manager", {}],
      ["the organiser who owns it", "organiser", { id: "organiser-id" }],
    ])("[SPM-34][AC4] [SPM-59][AC1] is not offered to %s", async (_who, role, who) => {
      open(role, event({ status: from }), { "GET /api/users": [] }, who);

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("button", { name: button })).not.toBeInTheDocument();
    });

    it("[SPM-34] [SPM-59] asks first, saying what it does, and sends nothing yet", async () => {
      const api = openAs({ [PATCH]: {} });

      await ask();

      expect(dialogTitled(title).open).toBe(true);
      expect(dialogTitled(title)).toHaveTextContent(warning);
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-34] [SPM-59] words the question for an event with no title", async () => {
      openAs({}, event({ status: from, title: null }));

      await ask();

      expect(dialogTitled(title)).toHaveTextContent(untitled);
    });

    it("[SPM-34][AC5] [SPM-59][AC2] does it once confirmed, says so, and reloads the event", async () => {
      const api = openAs({ [PATCH]: {} });
      await ask();

      await go();

      expect(await screen.findByText(done)).toBeInTheDocument();
      expect(api.sent(PATCH).map((c) => c.body)).toEqual([sends]);
      await waitFor(() => expect(api.sent(EVENT)).toHaveLength(2));
      expect(dialogTitled(title).open).toBe(false);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("[SPM-34] [SPM-59] does nothing when the question is declined", async () => {
      const api = openAs({ [PATCH]: {} });
      await ask();

      await userEvent.click(within(dialogTitled(title)).getByRole("button", { name: keep, hidden: true }));

      expect(dialogTitled(title).open).toBe(false);
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it.each([
      ["the server's reason", reply(400, { error: refusal }), refusal],
      ["a general message when it gives none", reply(500, {}), fallback],
      ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server. Check your connection and try again."],
    ])("[SPM-34][AC3] [SPM-59] shows %s when it is refused, and closes the question", async (_case, answer, message) => {
      const api = openAs({ [PATCH]: answer });
      await ask();

      await go();

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(dialogTitled(title).open).toBe(false);
      expect(screen.queryByText(done)).not.toBeInTheDocument();
      expect(api.sent(EVENT)).toHaveLength(1);
    });

    it("[SPM-34] [SPM-59] clears an earlier refusal when it then succeeds", async () => {
      const api = openAs({ [PATCH]: reply(400, { error: refusal }) });
      await ask();
      await go();
      await screen.findByRole("alert");
      api.on(PATCH, {});

      await ask();
      await go();

      expect(await screen.findByText(done)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // SPM-36: the assigned coordinator marks a Confirmed event completed once it
  // has ended (#71). The page offers the button only when the PATCH route
  // would accept it.
  describe("marking the event completed", () => {
    const PATCH = `PATCH /api/events/${REF}`;
    const TITLE = "Mark this event as completed?";
    const BUTTON = "Mark as completed";
    const ended = (overrides: Record<string, unknown> = {}) =>
      event({ status: "confirmed", startsAt: "2026-09-30T01:00:00.000Z", endsAt: "2026-09-30T09:00:00.000Z", ...overrides });
    const openAs = (routes: Record<string, unknown> = {}, eventRow = ended()) =>
      open("coordinator", eventRow, routes, { id: "c1" });
    const ask = async () => userEvent.click(await screen.findByRole("button", { name: BUTTON }));
    const go = () => userEvent.click(within(dialogTitled(TITLE)).getByRole("button", { name: BUTTON, hidden: true }));

    it("[SPM-36][AC1] SPM-36-TC01: is offered to the assigned coordinator once a Confirmed event has ended", async () => {
      openAs();

      expect(await screen.findByRole("button", { name: BUTTON })).toBeInTheDocument();
    });

    it("[SPM-36][AC1] SPM-36-TC04: is not offered before the event has ended", async () => {
      openAs({}, ended({ endsAt: "2099-01-01T09:00:00.000Z" }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
    });

    it.each(["planning", "safety_cleared", "postponed", "completed", "cancelled"])(
      "[SPM-36][AC2][AC5] is not offered while the event is %s",
      async (status) => {
        openAs({}, ended({ status }));

        await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

        expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
      }
    );

    it.each([
      ["a coordinator it is not assigned to", "coordinator", { id: "c2" }],
      ["the Event Coordinator Lead", "ops_manager", {}],
      ["the organiser who owns it", "organiser", { id: "organiser-id" }],
    ])("[SPM-36][AC1] SPM-36-TC05: is not offered to %s", async (_who, role, who) => {
      open(role, ended(), { "GET /api/users": [] }, who);

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
    });

    it("[SPM-36][AC3][AC5] SPM-36-TC01: asks first, saying the arrangements stay and the status is final, and sends nothing yet", async () => {
      const api = openAs({ [PATCH]: {} });

      await ask();

      expect(dialogTitled(TITLE).open).toBe(true);
      expect(dialogTitled(TITLE)).toHaveTextContent(
        "Gala Dinner will be marked Completed. Its venue and equipment stay on record, and its status can't be changed after this."
      );
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-36] words the question for an event with no title", async () => {
      openAs({}, ended({ title: null }));

      await ask();

      expect(dialogTitled(TITLE)).toHaveTextContent("This event will be marked Completed.");
    });

    it("[SPM-36][AC1] SPM-36-TC01: marks it completed, says so, and reloads the event", async () => {
      const api = openAs({ [PATCH]: {} });
      await ask();

      await go();

      expect(await screen.findByText("Gala Dinner has been marked as completed.")).toBeInTheDocument();
      expect(api.sent(PATCH).map((c) => c.body)).toEqual([{ status: "completed" }]);
      await waitFor(() => expect(api.sent(EVENT)).toHaveLength(2));
      expect(dialogTitled(TITLE).open).toBe(false);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("[SPM-36] does nothing when the question is declined", async () => {
      const api = openAs({ [PATCH]: {} });
      await ask();

      await userEvent.click(within(dialogTitled(TITLE)).getByRole("button", { name: "Not yet", hidden: true }));

      expect(dialogTitled(TITLE).open).toBe(false);
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it.each([
      ["the server's reason", reply(400, { error: "This event hasn't ended yet, so it can't be marked completed." }), "This event hasn't ended yet, so it can't be marked completed."],
      ["a general message when it gives none", reply(500, {}), "Could not mark this event as completed."],
      ["a general message when its answer has no body", reply(502), "Could not mark this event as completed."],
      ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server. Check your connection and try again."],
    ])("[SPM-36][AC1] shows %s when it is refused, and closes the question", async (_case, answer, message) => {
      const api = openAs({ [PATCH]: answer });
      await ask();

      await go();

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(dialogTitled(TITLE).open).toBe(false);
      expect(api.sent(EVENT)).toHaveLength(1);
    });
  });

  describe("when it cannot be loaded", () => {
    it("[SPM-31] explains a 404 without confirming the event exists", async () => {
      open("organiser", reply(404, { error: "Event not found" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This event doesn't exist, or you don't have access to it."
      );
      expect(screen.getByRole("heading", { level: 1, name: "Event" })).toBeInTheDocument();
      expect(breadcrumb()).toEqual([
        ["My Events", "/events"],
        ["Event", null],
      ]);
    });

    it("[SPM-31] shows a general error when the request fails without a reason", async () => {
      open("organiser", () => Promise.reject("offline"));

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("[SPM-31] offers a Retry that loads again", async () => {
      const api = open("organiser", reply(500, {}));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this event.");

      api.on(EVENT, event());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await screen.findByRole("heading", { level: 1, name: "Gala Dinner" })).toBeInTheDocument();
    });

    it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
      open("organiser", reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007"));
    });
  });
});

describe("EventGlance", () => {
  it("[SPM-31][AC1] summarises the event beside a tab's own content", () => {
    render(
      <EventGlance
        event={{
          startsAt: "2027-03-04T01:00:00.000Z",
          endsAt: "2027-03-04T09:00:00.000Z",
          expectedAttendance: 200,
          submittedAt: "2027-01-10T02:00:00.000Z",
          coordinator: { fullName: "Daniel Tan" },
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Event at a glance" })).toBeInTheDocument();
    expect(valueOf("Expected attendance")).toHaveTextContent("200");
    expect(valueOf("Coordinator")).toHaveTextContent("Daniel Tan");
    expect(valueOf("Venue")).toHaveTextContent("Not booked yet");
    expect(valueOf("Submitted")).toHaveTextContent("10 Jan 2027");
  });

  it("[SPM-31][AC1] names the venue that is booked", () => {
    render(
      <EventGlance
        event={{
          startsAt: null,
          endsAt: null,
          expectedAttendance: null,
          submittedAt: null,
          coordinator: null,
          venueBookings: [{ session: null, venue: { name: "Hall A", code: "HALL-A" } }],
        }}
      />
    );

    expect(valueOf("Venue")).toHaveTextContent(/^Hall A$/);
  });

  it("[SPM-31][AC1] names each session's venue for a multi-session event", () => {
    render(
      <EventGlance
        event={{
          startsAt: null,
          endsAt: null,
          expectedAttendance: null,
          submittedAt: null,
          coordinator: null,
          venueBookings: [
            { session: { label: "Day 1" }, venue: { name: "Hall A", code: "HALL-A" } },
            { session: { label: null }, venue: { name: "Room B", code: "ROOM-B" } },
          ],
        }}
      />
    );

    expect(valueOf("Venue")).toHaveTextContent("Day 1: Hall A · Room B");
  });

  it("[SPM-31][AC1] says no venue is booked for an empty list, as for none loaded", () => {
    render(
      <EventGlance
        event={{ startsAt: null, endsAt: null, expectedAttendance: null, submittedAt: null, coordinator: null, venueBookings: [] }}
      />
    );

    expect(valueOf("Venue")).toHaveTextContent("Not booked yet");
  });

  it("[SPM-31][AC1] fills in what is not known yet", () => {
    render(
      <EventGlance event={{ startsAt: null, endsAt: null, expectedAttendance: null, submittedAt: null, coordinator: null }} />
    );

    expect(valueOf("Expected attendance")).toHaveTextContent("—");
    expect(valueOf("Coordinator")).toHaveTextContent("Not yet assigned");
  });
});

describe("Review request", () => {
  const PATCH = `PATCH /api/events/${REF}`;
  const underReview = (overrides: Record<string, unknown> = {}) => event({ status: "under_review", ...overrides });

  function open(eventRow: unknown = underReview(), extra: Record<string, unknown> = {}, who: object = { id: "c1" }) {
    setRoute(`/events/${REF}/review`, { id: REF });
    const api = mockApi({ ...signedInAs("coordinator", who), [EVENT]: eventRow, ...extra });
    render(<ReviewRequestPage />);
    return api;
  }

  const decision = () => screen.findByRole("radiogroup", { name: "Review outcome" });
  const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;

  it.each(ROLES.filter((r) => r !== "coordinator"))("[SPM-28][AC1] refuses %s without loading the request", async (role) => {
    setRoute(`/events/${REF}/review`, { id: REF });
    const api = mockApi(signedInAs(role));

    render(<ReviewRequestPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Reviewing event requests is the Event Coordinator's role.");
    expect(api.sent(EVENT)).toHaveLength(0);
  });

  it("[SPM-28][AC1] refuses a coordinator the request is not assigned to, without showing the request", async () => {
    open(underReview(), {}, { id: "someone-else" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the coordinator assigned to this request can review it."
    );
    expect(screen.queryByRole("heading", { name: "What was requested" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("[SPM-28][AC6] sends the assigned coordinator to the event page when the request is already decided", async () => {
    open(event({ status: "approved" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/events/EVT-000007"));
    expect(screen.queryByRole("heading", { name: "What was requested" })).not.toBeInTheDocument();
  });

  it("[SPM-59][AC4] sends the assigned coordinator to the event page when the request has been withdrawn", async () => {
    open(event({ status: "withdrawn" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/events/EVT-000007"));
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  // SPM-98: Events / <event title> / Review request, in every state.
  describe("its breadcrumb", () => {
    it("[SPM-28][BUG-98] names the event by its title and links it to the Overview", async () => {
      open();
      await decision();

      expect(breadcrumb()).toEqual([
        ["Events", "/events"],
        ["Gala Dinner", `/events/${REF}`],
        ["Review request", null],
      ]);
    });

    it.each([
      ["loading", () => new Promise(() => {})],
      ["in error", reply(500, {})],
    ])("[SPM-28][BUG-98] reads 'Event' for the event while %s", async (_case, eventRow) => {
      open(eventRow);
      await screen.findByRole("navigation", { name: "Breadcrumb" });

      expect(breadcrumb()).toEqual([
        ["Events", "/events"],
        ["Event", `/events/${REF}`],
        ["Review request", null],
      ]);
    });

    it.each([
      ["organiser", "My Events"],
      ["venue_staff", "Events"],
    ])("[SPM-28][BUG-98] is the same trail when %s is refused", async (role, list) => {
      setRoute(`/events/${REF}/review`, { id: REF });
      mockApi(signedInAs(role));
      render(<ReviewRequestPage />);
      await screen.findByRole("alert");

      expect(breadcrumb()).toEqual([
        [list, "/events"],
        ["Event", `/events/${REF}`],
        ["Review request", null],
      ]);
    });
  });

  describe("what was requested", () => {
    it("[SPM-28][AC2] shows everything the organiser asked for", async () => {
      open(
        underReview({
          registrationEnabled: true,
          registrationCapacity: 150,
          registrationOpensAt: "2027-02-01T00:00:00.000Z",
          facilityRequirements: [
            { facilityId: "f1", isMandatory: true, facility: { name: "Hearing loop" } },
            { facilityId: "f2", isMandatory: false, facility: { name: "Stage" } },
          ],
          equipmentRequests: [{ id: "r1", sessionId: null, quantityRequested: 4, equipment: { name: "Projector" } }],
        })
      );

      await decision();

      expect(valueOf("Client")).toHaveTextContent("Meridian");
      expect(valueOf("Organiser")).toHaveTextContent("Rachel Ng");
      expect(valueOf("Category")).toHaveTextContent("Conference");
      expect(valueOf("Expected attendance")).toHaveTextContent("200");
      expect(valueOf("Preferred layout")).toHaveTextContent("U shape");
      expect(valueOf("Registration")).toHaveTextContent("Enabled · capacity 150");
      expect(valueOf("Facilities")).toHaveTextContent("Hearing loop (required)");
      expect(valueOf("Facilities")).toHaveTextContent("Stage (nice-to-have)");
      expect(valueOf("Equipment")).toHaveTextContent("Projector × 4");
      expect(screen.queryByText("Some information was not provided")).not.toBeInTheDocument();
    });

    it("[SPM-28][AC3] marks each empty field 'Not provided' and summarises them, without blocking the decision", async () => {
      open(
        underReview({
          category: null,
          purpose: "  ",
          description: null,
          startsAt: null,
          expectedAttendance: null,
          preferredLayout: null,
          accessibilityNotes: null,
          specialRequirements: null,
          organisation: null,
          registrationEnabled: true,
          registrationCapacity: null,
        })
      );

      await decision();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Category, Purpose, Description, When, Expected attendance, Preferred layout, Accessibility needs, " +
          "Special requirements, Registration capacity, Facilities, Equipment."
      );
      for (const label of ["Client", "Category", "When", "Purpose", "Expected attendance", "Facilities", "Equipment"]) {
        expect(valueOf(label)).toHaveTextContent("Not provided");
      }
      expect(valueOf("Registration")).toHaveTextContent("Enabled · capacity Not provided");
      expect(screen.getByRole("radio", { name: /Approve/ })).toBeEnabled();
    });

    it("[SPM-28][AC2] lists the sessions of a multi-session event, and which session each item is for", async () => {
      open(
        underReview({
          sessions: [
            { id: "s1", label: "Day 1", startsAt: "2027-03-04T01:00:00.000Z", endsAt: "2027-03-04T05:00:00.000Z", expectedAttendance: 80, preferredLayout: "theatre" },
            { id: "s2", label: null, startsAt: "2027-03-05T01:00:00.000Z", endsAt: "2027-03-05T05:00:00.000Z", expectedAttendance: null, preferredLayout: null },
          ],
          equipmentRequests: [
            { id: "r1", sessionId: "s1", quantityRequested: 2, equipment: { name: "Projector" } },
            { id: "r2", sessionId: "s2", quantityRequested: 1, equipment: { name: "Lectern" } },
          ],
        })
      );

      await decision();
      const card = screen.getByRole("heading", { name: "Sessions" }).closest("div.rounded-lg") as HTMLElement;
      const sessions = within(card).getAllByRole("listitem");

      expect(within(card).getByText("2 sessions in this event.")).toBeInTheDocument();
      expect(sessions[0]).toHaveTextContent("Day 1");
      expect(sessions[0]).toHaveTextContent("Attendance 80 · Layout Theatre");
      expect(sessions[1]).toHaveTextContent("Session 2");
      expect(sessions[1]).toHaveTextContent("Attendance Not provided · Layout Not provided");
      expect(valueOf("Equipment")).toHaveTextContent("Projector × 2 (Day 1)");
      // An unlabelled session is named by its times instead.
      expect(valueOf("Equipment")).toHaveTextContent(/Lectern × 1 \(.*2027.*\)/);
    });
  });

  describe("approving", () => {
    async function chooseApprove() {
      await decision();
      await userEvent.click(screen.getByRole("radio", { name: /Approve/ }));
      await userEvent.click(screen.getByRole("button", { name: "Approve request" }));
    }

    it("[SPM-28][AC4] asks for confirmation, saying what will change, before anything is sent", async () => {
      const api = open();

      await chooseApprove();

      expect(dialog().open).toBe(true);
      expect(dialog()).toHaveTextContent("“Gala Dinner” moves from Under review to Approved");
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-28][AC4] approves once confirmed, and stays on the page to say so", async () => {
      const api = open(underReview(), { [PATCH]: { status: "approved", coordinatorId: "c1" } });
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Approve", hidden: true }));

      expect(await screen.findByText("Request approved")).toBeInTheDocument();
      expect(api.sent(PATCH)[0].body).toEqual({ status: "approved" });
      expect(screen.getByRole("link", { name: "Back to Review Queue" })).toHaveAttribute("href", "/queue");
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(screen.getByText("Approved")).toBeInTheDocument();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it("[SPM-28][AC4] sends nothing when the confirmation is cancelled", async () => {
      const api = open();
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-28][AC4] shows the server's refusal and leaves the decision open", async () => {
      open(underReview(), { [PATCH]: reply(400, { error: "Only a request that is under review can be approved or rejected" }) });
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Approve", hidden: true }));

      expect(await screen.findByText("Only a request that is under review can be approved or rejected")).toBeInTheDocument();
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
      expect(screen.queryByText("Request approved")).not.toBeInTheDocument();
    });

    it("[SPM-28][AC4] falls back to a general message when the server gives none", async () => {
      open(underReview(), { [PATCH]: reply(500) });
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Approve", hidden: true }));

      expect(await screen.findByText("Could not save your decision. Please try again.")).toBeInTheDocument();
    });

    it("[SPM-28][AC4] shows a general error when sending fails without a reason", async () => {
      open(underReview(), { [PATCH]: () => Promise.reject("offline") });
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Approve", hidden: true }));

      expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    });
  });

  describe("rejecting", () => {
    async function chooseReject() {
      await decision();
      await userEvent.click(screen.getByRole("radio", { name: /Reject this request/ }));
    }
    const reasonBox = () => screen.getByRole("textbox", { name: /Reason for rejection/ });

    it.each(["", "   "])("[SPM-28][AC5] refuses a reason of %j without sending anything", async (text) => {
      const api = open();
      await chooseReject();
      if (text) await userEvent.type(reasonBox(), text);

      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(reasonBox()).toBeInvalid();
      expect(screen.getByText("A reason is required when rejecting. The organiser sees this message.")).toBeInTheDocument();
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-28][AC5] clears the reason error as soon as the coordinator starts typing", async () => {
      open();
      await chooseReject();
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      await userEvent.type(reasonBox(), "N");

      expect(reasonBox()).not.toHaveAttribute("aria-invalid");
    });

    it("[SPM-28][AC5] rejects with the trimmed reason, and shows the outcome with that reason", async () => {
      const api = open(underReview(), { [PATCH]: { status: "rejected", coordinatorId: "c1" } });
      await chooseReject();

      await userEvent.type(reasonBox(), "  No venue is licensed overnight.  ");
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(await screen.findByText("Request rejected")).toBeInTheDocument();
      expect(api.sent(PATCH)[0].body).toEqual({ status: "rejected", reason: "No venue is licensed overnight." });
      expect(screen.getByText("Reason: No venue is licensed overnight.")).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    });

    it("[SPM-28][AC5] Cancel backs out of rejecting and forgets the reason", async () => {
      open();
      await chooseReject();
      await userEvent.type(reasonBox(), "Changed my mind");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("textbox", { name: /Reason for rejection/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("radio", { name: /Reject this request/ }));

      expect(reasonBox()).toHaveValue("");
    });

    it("[SPM-28][AC5] switching to Approve hides the reason box", async () => {
      open();
      await chooseReject();

      await userEvent.click(screen.getByRole("radio", { name: /Approve/ }));

      expect(screen.queryByRole("textbox", { name: /Reason for rejection/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Approve request" })).toBeInTheDocument();
    });

    it("[SPM-28][AC5] shows the server's refusal", async () => {
      open(underReview(), { [PATCH]: reply(403, { error: 'Your role cannot move an event to "rejected"' }) });
      await chooseReject();

      await userEvent.type(reasonBox(), "Not feasible");
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(await screen.findByText('Your role cannot move an event to "rejected"')).toBeInTheDocument();
    });
  });

  // SPM-29: the third outcome the mockup offers (design/mockups/EventReview.dc.html).
  //
  // CONTRACT (SPM-29, written before the code):
  //   a radio "Ask the organiser for clarification" beside Approve and Reject, while nothing is open;
  //   choosing it shows a checkbox group "What needs clarification" (REVIEW_FIELD_LABELS, AC1),
  //   a textbox "Message to the organiser" (AC2) and a "Send request" button;
  //   the form's rules are clarificationProblem()'s; POST /api/events/<ref>/clarifications
  //   { fields, message: <trimmed> }; afterwards "Clarification requested", the event still
  //   Under review, and the clarification shown on the page as "Open clarification";
  //   the server's error, or "Could not send your request. Please try again.";
  //   Approve and Reject stay available while a clarification is open (decided 2026-10-19).
  describe("asking for clarification (SPM-29)", () => {
    const CLARIFY = `POST /api/events/${REF}/clarifications`;
    const asked = {
      id: "clarification-id",
      fields: ["purpose", "when"],
      message: "Is this a dinner or a conference? Which day?",
      requestedAt: "2026-10-19T02:00:00.000Z",
      requester: { fullName: "Daniel Tan" },
    };
    const clarifyOption = () => screen.queryByRole("radio", { name: /Ask the organiser for clarification/ });
    const whatNeedsClarifying = () => screen.getByRole("group", { name: "What needs clarification" });
    const messageBox = () => screen.getByRole("textbox", { name: /Message to the organiser/ });
    const send = () => userEvent.click(screen.getByRole("button", { name: "Send request" }));

    async function chooseClarify() {
      await decision();
      await userEvent.click(clarifyOption()!);
    }

    it("[SPM-29][AC1][AC2] is offered beside approving and rejecting", async () => {
      open(underReview({ openClarification: null }));

      await decision();

      expect(screen.getAllByRole("radio")).toHaveLength(3);
      expect(clarifyOption()).toBeInTheDocument();
    });

    it("[SPM-29][AC1] lets the coordinator choose which parts of the request need clarifying", async () => {
      open(underReview({ openClarification: null }));

      await chooseClarify();

      const group = within(whatNeedsClarifying());
      expect(group.getAllByRole("checkbox")).toHaveLength(Object.keys(REVIEW_FIELD_LABELS).length);
      for (const label of Object.values(REVIEW_FIELD_LABELS)) {
        expect(group.getByRole("checkbox", { name: label })).not.toBeChecked();
      }
    });

    it("[SPM-29][AC2] asks for a message to the organiser", async () => {
      open(underReview({ openClarification: null }));

      await chooseClarify();

      expect(messageBox()).toHaveValue("");
    });

    it("[SPM-29][AC1] refuses to send with nothing chosen to clarify", async () => {
      const api = open(underReview({ openClarification: null }));
      await chooseClarify();
      await userEvent.type(messageBox(), "Please clarify");

      await send();

      expect(screen.getByText(CLARIFICATION_FIELDS_REQUIRED)).toBeInTheDocument();
      expect(api.sent(CLARIFY)).toHaveLength(0);
    });

    it("[SPM-29][AC1] treats an item ticked and then unticked as not chosen", async () => {
      const api = open(underReview({ openClarification: null }));
      await chooseClarify();
      const purpose = within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" });
      await userEvent.click(purpose);
      await userEvent.click(purpose);
      await userEvent.type(messageBox(), "Please clarify");

      await send();

      expect(purpose).not.toBeChecked();
      expect(screen.getByText(CLARIFICATION_FIELDS_REQUIRED)).toBeInTheDocument();
      expect(api.sent(CLARIFY)).toHaveLength(0);
    });

    it("[SPM-29][AC2] clears the message error as soon as the coordinator starts typing", async () => {
      open(underReview({ openClarification: null }));
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      await send();
      expect(messageBox()).toBeInvalid();

      await userEvent.type(messageBox(), "W");

      expect(messageBox()).not.toHaveAttribute("aria-invalid");
    });

    it.each(["", "   "])("[SPM-29][AC2] refuses to send a message of %j", async (text) => {
      const api = open(underReview({ openClarification: null }));
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      if (text) await userEvent.type(messageBox(), text);

      await send();

      expect(messageBox()).toBeInvalid();
      expect(screen.getByText(CLARIFICATION_MESSAGE_REQUIRED)).toBeInTheDocument();
      expect(api.sent(CLARIFY)).toHaveLength(0);
    });

    it("[SPM-29][AC1][AC2][AC3][AC4] sends what needs clarifying and the trimmed message for this event, which stays Under review", async () => {
      const api = open(underReview({ openClarification: null }), { [CLARIFY]: reply(201, asked) });
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "When" }));
      await userEvent.type(messageBox(), "  Is this a dinner or a conference? Which day?  ");

      await send();

      expect(await screen.findByText("Clarification requested")).toBeInTheDocument();
      expect(api.sent(CLARIFY)[0].body).toEqual({
        fields: ["purpose", "when"],
        message: "Is this a dinner or a conference? Which day?",
      });
      expect(screen.getByText("Under review")).toBeInTheDocument();
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("[SPM-29][AC3] shows the clarification once sent, and leaves Approve and Reject available", async () => {
      open(underReview({ openClarification: null }), { [CLARIFY]: reply(201, asked) });
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      await userEvent.type(messageBox(), "Is this a dinner or a conference? Which day?");
      await send();

      await screen.findByText("Clarification requested");

      expect(screen.getByText("Open clarification")).toBeInTheDocument();
      expect(screen.getByText("Is this a dinner or a conference? Which day?")).toBeInTheDocument();
      expect(clarifyOption()).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Approve/ })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Reject this request/ })).toBeInTheDocument();
    });

    it("[SPM-29][AC3] shows a clarification already open, and offers no second one", async () => {
      open(underReview({ openClarification: asked }));

      await decision();

      expect(screen.getByText("Open clarification")).toBeInTheDocument();
      expect(screen.getByText("Is this a dinner or a conference? Which day?")).toBeInTheDocument();
      expect(screen.getByText(/Purpose, When/)).toBeInTheDocument();
      expect(screen.getByText(/Daniel Tan/)).toBeInTheDocument();
      expect(clarifyOption()).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Approve/ })).toBeInTheDocument();
    });

    it("[SPM-29] shows the server's refusal", async () => {
      open(underReview({ openClarification: null }), {
        [CLARIFY]: reply(400, { error: "This event already has an open clarification." }),
      });
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      await userEvent.type(messageBox(), "Which day?");

      await send();

      expect(await screen.findByText("This event already has an open clarification.")).toBeInTheDocument();
      expect(screen.queryByText("Clarification requested")).not.toBeInTheDocument();
    });

    // PR #70 review: another tab (or a second click) opened one first - load
    // the request again so the page shows it, instead of a form it can't send.
    it("[SPM-29][AC3] shows the clarification someone else just opened, after being told one is already open", async () => {
      const api = open(underReview({ openClarification: null }), {
        [CLARIFY]: reply(400, { error: CLARIFICATION_ALREADY_OPEN }),
      });
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      await userEvent.type(messageBox(), "Which day?");
      api.on(EVENT, underReview({ openClarification: asked }));

      await send();

      expect(await screen.findByText("Open clarification")).toBeInTheDocument();
      expect(screen.getByText("Is this a dinner or a conference? Which day?")).toBeInTheDocument();
      expect(screen.getByText(CLARIFICATION_ALREADY_OPEN)).toBeInTheDocument();
      expect(clarifyOption()).not.toBeInTheDocument();
    });

    it("[SPM-29] falls back to a general message when the server gives none", async () => {
      open(underReview({ openClarification: null }), { [CLARIFY]: reply(500) });
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      await userEvent.type(messageBox(), "Which day?");

      await send();

      expect(await screen.findByText("Could not send your request. Please try again.")).toBeInTheDocument();
    });

    it("[SPM-29] shows a general error when sending fails without a reason", async () => {
      open(underReview({ openClarification: null }), { [CLARIFY]: () => Promise.reject("offline") });
      await chooseClarify();
      await userEvent.click(within(whatNeedsClarifying()).getByRole("checkbox", { name: "Purpose" }));
      await userEvent.type(messageBox(), "Which day?");

      await send();

      expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    });
  });

  describe("when it cannot be loaded", () => {
    it("[SPM-28] explains a 404", async () => {
      open(reply(404, {}));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This event doesn't exist, or you don't have access to it."
      );
    });

    it("[SPM-28] shows a general error when loading fails without a reason", async () => {
      open(() => Promise.reject("offline"));

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("[SPM-28] offers a Retry that loads again", async () => {
      const api = open(reply(500, {}));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this request.");

      api.on(EVENT, underReview());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await decision()).toBeInTheDocument();
    });

    it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Freview"));
    });
  });
});

// SPM-62: the way in to "Edit event information"
// (/events/<ref>/update) from the event page. What a save changed and flagged
// is shown on the edit page itself (event-information-pages.test.tsx);
// showing flags afterwards is SPM-33 / SPM-68's.
describe("Event overview - updating event information (SPM-62)", () => {
  const assigned = { id: "c1" };

  function open(role: string, eventRow: unknown = event(), who: object = {}, path = `/events/${REF}`) {
    setRoute(path, { id: REF });
    mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, "GET /api/assignments": { coordinators: [] } });
    render(<EventOverviewPage />);
  }

  const heading = () => screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

  describe("the way in", () => {
    it.each(["approved", "planning", "confirmed"])("[SPM-62][AC1] is offered to the assigned coordinator of a %s event", async (status) => {
      open("coordinator", event({ status }), assigned);

      const link = await screen.findByRole("link", { name: "Edit event information" });

      expect(link).toHaveAttribute("href", `/events/${REF}/update`);
    });

    it.each(["under_review", "postponed", "completed", "cancelled", "rejected", "withdrawn"])(
      "[SPM-62][AC1] is not offered while the event is %s",
      async (status) => {
        open("coordinator", event({ status }), assigned);
        await heading();

        expect(screen.queryByRole("link", { name: "Edit event information" })).not.toBeInTheDocument();
      }
    );

    it.each([
      ["a coordinator it is not assigned to", "coordinator", { id: "c2" }],
      ["the organiser who owns it", "organiser", { id: "organiser-id" }],
      ["the Ops Manager", "ops_manager", {}],
      ["Venue Staff", "venue_staff", {}],
      ["Technical Support", "tech_support", {}],
    ])("[SPM-62][AC3] is not offered to %s", async (_who, role, who) => {
      open(role, event(), who);
      await heading();

      expect(screen.queryByRole("link", { name: "Edit event information" })).not.toBeInTheDocument();
    });
  });
});

// SPM-86 - Submit Event for Operational Safety Check.
//
// CONTRACT (SPM-86, written before the code and built to it): a "Submit for safety check" button on the
// Overview for the assigned coordinator while the event is in Planning (canSubmitForSafetyCheck);
// a dialog "Submit for safety check?" with "Submit" / "Not yet"; POST /api/events/[id]/safety-check
// with no body; the success message, or the server's refusal in an alert; the event reloaded.
// A "Safety check" row under "Status" in Details when the response carries a safetyCheck
// (staff only - the API leaves it out for the organiser).
describe("Event overview - submitting for a safety check (SPM-86)", () => {
  const POST = `POST /api/events/${REF}/safety-check`;
  const BUTTON = "Submit for safety check";
  const TITLE = "Submit for safety check?";
  const DONE = "The event has been submitted for a safety check. The Safety Officer has been notified.";

  function open(role = "coordinator", eventRow: unknown = event(), extra: Record<string, unknown> = {}, who: object = daniel) {
    setRoute(`/events/${REF}`, { id: REF });
    const api = mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, "GET /api/users": [], ...extra });
    render(<EventOverviewPage />);
    return api;
  }

  const ask = async () => userEvent.click(await screen.findByRole("button", { name: BUTTON }));
  const go = () => userEvent.click(within(dialogTitled(TITLE)).getByRole("button", { name: "Submit", hidden: true }));

  it("[SPM-86][AC1] SPM-86-TC01: is offered to the assigned coordinator while the event is in Planning", async () => {
    open();

    expect(await screen.findByRole("button", { name: BUTTON })).toBeInTheDocument();
  });

  it.each(["approved", "safety_review", "confirmed", "postponed", "under_review"])(
    "[SPM-86][AC1][AC6] SPM-86-TC11: is not offered while the event is %s",
    async (status) => {
      open("coordinator", event({ status }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
    }
  );

  it.each([
    ["a coordinator it is not assigned to", "coordinator", priya],
    ["the Ops Manager", "ops_manager", {}],
    ["Technical Support", "tech_support", {}],
    ["the organiser who owns it", "organiser", { id: "organiser-id" }],
  ])("[SPM-86][AC7] SPM-86-TC10: is not offered to %s", async (_who, role, who) => {
    open(role, event(), {}, who);

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });

  it("[SPM-86] asks first, saying what will happen, and sends nothing yet", async () => {
    const api = open("coordinator", event(), { [POST]: {} });

    await ask();

    expect(dialogTitled(TITLE).open).toBe(true);
    expect(dialogTitled(TITLE)).toHaveTextContent("Gala Dinner will move to Safety review and the Safety Officer will be notified.");
    expect(api.sent(POST)).toHaveLength(0);
  });

  it("[SPM-86] does nothing when the question is declined", async () => {
    const api = open("coordinator", event(), { [POST]: {} });
    await ask();

    await userEvent.click(within(dialogTitled(TITLE)).getByRole("button", { name: "Not yet", hidden: true }));

    expect(dialogTitled(TITLE).open).toBe(false);
    expect(api.sent(POST)).toHaveLength(0);
  });

  it("[SPM-86][AC3][AC5] SPM-86-TC01: submits, says the Safety Officer was notified, and reloads the event", async () => {
    const api = open("coordinator", event(), { [POST]: { status: "safety_review" } });
    await ask();

    await go();

    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(api.sent(POST)).toHaveLength(1);
    await waitFor(() => expect(api.sent(EVENT)).toHaveLength(2));
    expect(dialogTitled(TITLE).open).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [
      "SPM-86-TC06: the outstanding arrangements",
      reply(400, {
        error: "This event cannot be submitted for a safety check yet: the venue for this event is still awaiting a decision from Venue Staff.",
        outstanding: ["the venue for this event is still awaiting a decision from Venue Staff"],
      }),
      "This event cannot be submitted for a safety check yet: the venue for this event is still awaiting a decision from Venue Staff.",
    ],
    ["SPM-86-TC09: that a check is already pending", reply(400, { error: "A safety check is already pending for this event." }), "A safety check is already pending for this event."],
    ["a general message when the server gives none", reply(500, {}), "Could not submit this event for a safety check."],
    ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server. Check your connection and try again."],
  ])("[SPM-86][AC2] shows %s when it is refused, and leaves the event as it was", async (_case, answer, message) => {
    const api = open("coordinator", event(), { [POST]: answer });
    await ask();

    await go();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(dialogTitled(TITLE).open).toBe(false);
    expect(screen.queryByText(DONE)).not.toBeInTheDocument();
    expect(api.sent(EVENT)).toHaveLength(1);
  });

  describe("the Safety check row (AC8)", () => {
    const pending = () =>
      event({
        status: "safety_review",
        safetyCheck: { status: "pending", submittedAt: "2026-10-09T06:30:00.000Z", submittedBy: "Daniel Tan" },
      });

    it("[SPM-86][AC8] SPM-86-TC02: shows staff who submitted it and when, in Singapore time", async () => {
      open("coordinator", pending());

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Status")).toHaveTextContent("Safety review");
      expect(valueOf("Safety check")).toHaveTextContent("Awaiting review · submitted by Daniel Tan, 9 Oct 2026, 14:30");
      expect(terms().indexOf("Safety check")).toBe(terms().indexOf("Status") + 1);
    });

    // CHANGED (SPM-87): a decided check says who decided it and when, with the note.
    it("[SPM-87][AC10] SPM-87-TC06: words a decided check with who decided it, when, and the changes required", async () => {
      open(
        "coordinator",
        event({
          status: "planning",
          safetyCheck: {
            status: "changes_requested",
            submittedAt: "2026-10-09T06:30:00.000Z",
            submittedBy: "Daniel Tan",
            decidedAt: "2026-10-13T06:30:00.000Z",
            decidedBy: "Hana Yusof",
            decisionNote: "Add a second fire marshal at the east exit.",
          },
        })
      );

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Safety check")).toHaveTextContent(
        "Changes requested · decided by Hana Yusof, 13 Oct 2026, 14:30. Changes required: Add a second fire marshal at the east exit."
      );
    });

    it("[SPM-86][AC8] is not shown for an event that was never submitted", async () => {
      open("coordinator", event({ safetyCheck: null }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(terms()).not.toContain("Safety check");
    });

    it("[SPM-86][AC4] [SPM-88][AC10] SPM-86-TC03: is not shown to the organiser, whose event reads Safety review", async () => {
      const { safetyCheck: _hidden, ...asOrganiserReceivesIt } = pending() as Record<string, unknown>;
      open("organiser", asOrganiserReceivesIt, {}, { id: "organiser-id" });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Status")).toHaveTextContent("Safety review");
      expect(terms()).not.toContain("Safety check");
    });
  });
});

// SPM-85: the Safety Officer reads what an Operational Safety Check needs -
// attendance, sessions, accessibility needs, the rooms booked with their
// layout and seats, and the equipment - and is offered nothing that changes it.
describe("Event overview - what a Safety Officer sees (SPM-85)", () => {
  function open(role: string, eventRow: unknown) {
    setRoute(`/events/${REF}`, { id: REF });
    const api = mockApi({ ...signedInAs(role), [EVENT]: eventRow });
    render(<EventOverviewPage />);
    return api;
  }

  /// One card on the page: everything under its heading.
  const card = (title: string) =>
    screen.getByRole("heading", { level: 2, name: title }).closest(".rounded-lg") as HTMLElement;
  const termsIn = (title: string) => within(card(title)).getAllByRole("term").map((t) => t.textContent);
  const valueIn = (title: string, label: string) => {
    const term = within(card(title)).getAllByRole("term").find((t) => t.textContent === label);
    return term!.nextElementSibling as HTMLElement;
  };
  const tabLabels = () =>
    within(screen.getByRole("navigation", { name: "Sections" }))
      .getAllByRole("link")
      .map((link) => link.textContent);

  // 09:00-12:00 and 13:00-17:00 on 14 Jun 2027, Singapore time.
  const sessions = [
    {
      id: "s1",
      label: "Main programme",
      startsAt: "2027-06-14T01:00:00.000Z",
      endsAt: "2027-06-14T04:00:00.000Z",
      expectedAttendance: 200,
      preferredLayout: "theatre",
    },
    {
      id: "s2",
      label: "Breakout workshop",
      startsAt: "2027-06-14T05:00:00.000Z",
      endsAt: "2027-06-14T09:00:00.000Z",
      expectedAttendance: 60,
      preferredLayout: "classroom",
    },
  ];
  const booking = (session: string | null, name: string, code: string, layoutName: string | null, layouts: object[]) => ({
    startsAt: "2027-06-14T01:00:00.000Z",
    endsAt: "2027-06-14T04:00:00.000Z",
    layoutName,
    session: session ? { label: session } : null,
    venue: { name, code, layouts },
  });
  const forum = (overrides: Record<string, unknown> = {}) =>
    event({
      status: "safety_review",
      sessions,
      venueBookings: [
        booking("Main programme", "Marina Auditorium", "MAR-AUD", "theatre", [{ layoutName: "theatre", capacity: 220 }]),
        booking("Breakout workshop", "Orchard Seminar Room", "ORC-SEM", "classroom", [
          { layoutName: "theatre", capacity: 120 },
          { layoutName: "classroom", capacity: 70 },
        ]),
      ],
      ...overrides,
    });

  it("[SPM-85][AC3][AC6] AC3, AC6: offers the Overview and Equipment tabs only - no Attendees, and no venue search", async () => {
    open("safety_officer", forum());

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(tabLabels()).toEqual(["Overview", "Equipment"]);
  });

  it("[SPM-85][AC3] AC3: shows each session's time, attendance and layout", async () => {
    open("safety_officer", forum());

    await screen.findByRole("heading", { level: 2, name: "Sessions" });

    expect(termsIn("Sessions")).toEqual(["Main programme", "Breakout workshop"]);
    expect(valueIn("Sessions", "Main programme")).toHaveTextContent("14 Jun 2027, 09:00–12:00 · 200 people · Theatre");
    expect(valueIn("Sessions", "Breakout workshop")).toHaveTextContent("14 Jun 2027, 13:00–17:00 · 60 people · Classroom");
  });

  it("[SPM-85][AC3] AC3: shows each booked room with its layout and the seats that layout holds", async () => {
    open("safety_officer", forum());

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(valueIn("Venue bookings", "Main programme")).toHaveTextContent(
      "Marina Auditorium (MAR-AUD) · Theatre · seats 220"
    );
    // The capacity of the layout booked, not the room's largest.
    expect(valueIn("Venue bookings", "Breakout workshop")).toHaveTextContent(
      "Orchard Seminar Room (ORC-SEM) · Classroom · seats 70"
    );
  });

  // SPM-90 (AC5): what each booked space is for, straight after the room.
  it("[SPM-90][AC5] SPM-90-TC07: names what each booked space is for, and nothing for a booking made without one", async () => {
    const [hall, seminar] = (forum() as unknown as { venueBookings: object[] }).venueBookings;
    open("coordinator", forum({ venueBookings: [{ ...hall, purpose: "Main programme" }, { ...seminar, purpose: null }] }));

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(valueIn("Venue bookings", "Main programme")).toHaveTextContent(
      "Marina Auditorium (MAR-AUD) · Main programme · Theatre · seats 220"
    );
    expect(valueIn("Venue bookings", "Breakout workshop")).toHaveTextContent(
      "Orchard Seminar Room (ORC-SEM) · Classroom · seats 70"
    );
  });

  it("[SPM-90][AC5] SPM-90: names the space of a booking that has no layout set", async () => {
    const [hall] = (forum() as unknown as { venueBookings: object[] }).venueBookings;
    open("coordinator", forum({ venueBookings: [{ ...hall, purpose: "Green room", layoutName: null }] }));

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(valueIn("Venue bookings", "Main programme")).toHaveTextContent(
      "Marina Auditorium (MAR-AUD) · Green room · Layout not set"
    );
  });

  it("[SPM-85][AC3] AC3: still shows the attendance and the accessibility needs it has always shown staff", async () => {
    open(
      "safety_officer",
      forum({ facilityRequirements: [{ facilityId: "f1", isMandatory: true, facility: { name: "Step-free access" } }] })
    );

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(valueOf("Expected attendance")).toHaveTextContent("200");
    expect(valueIn("Venue requirements", "Required facilities")).toHaveTextContent("Step-free access");
    expect(valueIn("Venue requirements", "Accessibility notes")).toHaveTextContent("Step-free access");
  });

  it("[SPM-85][AC3] names a whole-event booking 'Whole event', and says when no layout was booked", async () => {
    open(
      "safety_officer",
      forum({
        sessions: [],
        venueBookings: [booking(null, "Orchard Gallery", "ORC-GAL", null, [{ layoutName: "theatre", capacity: 110 }])],
      })
    );

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(valueIn("Venue bookings", "Whole event")).toHaveTextContent("Orchard Gallery (ORC-GAL) · Layout not set");
    expect(screen.queryByRole("heading", { level: 2, name: "Sessions" })).not.toBeInTheDocument();
  });

  it("[SPM-85][AC3] says when the layout booked has no recorded capacity", async () => {
    open("safety_officer", forum({ venueBookings: [booking(null, "Orchard Gallery", "ORC-GAL", "banquet", [])] }));

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(valueIn("Venue bookings", "Whole event")).toHaveTextContent(
      "Orchard Gallery (ORC-GAL) · Banquet · capacity not recorded"
    );
  });

  it("[SPM-85][AC3] says so when no room is booked yet", async () => {
    open("safety_officer", forum({ venueBookings: [] }));

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(within(card("Venue bookings")).getByText("No venue is booked yet.")).toBeInTheDocument();
  });

  it("[SPM-85][AC3] shows a session's missing label, attendance or layout as not set", async () => {
    open(
      "safety_officer",
      forum({
        sessions: [
          {
            id: "s1",
            label: null,
            startsAt: "2027-06-14T01:00:00.000Z",
            endsAt: "2027-06-14T04:00:00.000Z",
            expectedAttendance: null,
            preferredLayout: null,
          },
        ],
      })
    );

    await screen.findByRole("heading", { level: 2, name: "Sessions" });

    expect(valueIn("Sessions", "Session 1")).toHaveTextContent(
      "14 Jun 2027, 09:00–12:00 · Attendance not set · Layout not set"
    );
  });

  it("[SPM-85][AC3] gives the same two cards to the event's coordinator", async () => {
    open("coordinator", forum());

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(screen.getByRole("heading", { level: 2, name: "Sessions" })).toBeInTheDocument();
  });

  it("[SPM-22][AC5] keeps both cards from the organiser, who learns the room from the Venue row", async () => {
    open("organiser", forum());

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByRole("heading", { level: 2, name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Venue bookings" })).not.toBeInTheDocument();
  });

  it("[SPM-85][AC4][AC5] AC4, AC5: offers the Safety Officer nothing that changes the event, its venue, its equipment or its registration", async () => {
    // Every one of these is offered to the event's own coordinator (c1) on a
    // Planning event with registration open.
    open("safety_officer", forum({ status: "planning", registrationEnabled: true, registrationCapacity: 150 }));

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    for (const name of [
      "Edit event information",
      "Submit for safety check",
      "Confirm event",
      "Review request",
      "Record withdrawal",
      "Change registration settings",
    ]) {
      expect(screen.queryByRole("button", { name }), name).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name }), name).not.toBeInTheDocument();
    }
  });
});

// SPM-87 - Conduct Operational Safety Check, on the event the Safety Officer opens from Safety Checks.
//
// CONTRACT (SPM-87, written before the code): a "Record safety decision" button for the Safety
// Officer while the event is in Safety review (canRecordSafetyDecision); a dialog "Record safety
// decision" with the radios "Approve", "Request changes", "Reject", a box "Changes required" or
// "Reason for rejecting" (none for Approve), "Record decision" / "Cancel"; POST
// /api/events/[id]/safety-decision with { decision, note? }; the done message, or the refusal under
// the box or in an alert; the event reloaded. SPM-85's "Venue bookings" card adds each venue's
// opening hours and its unavailable periods on the event's dates (AC2).
describe("Event overview - recording a safety decision (SPM-87)", () => {
  const POST = `POST /api/events/${REF}/safety-decision`;
  const BUTTON = "Record safety decision";
  const hana = { id: "so1", fullName: "Hana Yusof" };
  const inReview = (overrides: Record<string, unknown> = {}) =>
    event({
      status: "safety_review",
      safetyCheck: { status: "pending", submittedAt: "2026-10-09T06:30:00.000Z", submittedBy: "Daniel Tan", decidedAt: null, decidedBy: null, decisionNote: null },
      ...overrides,
    });

  function open(role = "safety_officer", eventRow: unknown = inReview(), extra: Record<string, unknown> = {}, who: object = hana) {
    setRoute(`/events/${REF}`, { id: REF });
    const api = mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, "GET /api/users": [], ...extra });
    render(<EventOverviewPage />);
    return api;
  }

  const dialog = () => dialogTitled("Record safety decision");
  const ask = async () => userEvent.click(await screen.findByRole("button", { name: BUTTON }));
  const choose = (name: string) => userEvent.click(within(dialog()).getByRole("radio", { name, hidden: true }));
  const record = () => userEvent.click(within(dialog()).getByRole("button", { name: "Record decision", hidden: true }));

  it("[SPM-87][AC11] SPM-87-TC03: is offered to the Safety Officer while the event is in Safety review", async () => {
    open();

    expect(await screen.findByRole("button", { name: BUTTON })).toBeInTheDocument();
  });

  it.each(["planning", "safety_cleared", "confirmed"])("[SPM-87][AC11] SPM-87-TC10: is not offered while the event is %s", async (status) => {
    open("safety_officer", inReview({ status }));

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });

  it.each([
    ["the assigned coordinator", "coordinator", daniel],
    ["the Ops Manager", "ops_manager", {}],
  ])("[SPM-87][AC12] SPM-87-TC11: is not offered to %s", async (_who, role, who) => {
    open(role, inReview(), {}, who);

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
  });

  it("[SPM-87][AC3][AC4][AC5] SPM-87-TC03: offers three decisions and asks for no reason to approve", async () => {
    open();
    await ask();

    expect(dialog().open).toBe(true);
    for (const name of ["Approve", "Request changes", "Reject"]) {
      expect(within(dialog()).getByRole("radio", { name, hidden: true })).toBeInTheDocument();
    }
    expect(within(dialog()).getAllByRole("radio", { hidden: true })).toHaveLength(3);
    await choose("Approve");
    expect(within(dialog()).queryByRole("textbox", { hidden: true })).not.toBeInTheDocument();
  });

  it("[SPM-87][AC3][AC7] SPM-87-TC03: approves, says so, and reloads the event", async () => {
    const api = open("safety_officer", inReview(), { [POST]: { status: "safety_cleared" } });
    await ask();

    await choose("Approve");
    await record();

    expect(api.sent(POST).map((c) => c.body)).toEqual([{ decision: "approved" }]);
    expect(await screen.findByText("Safety check approved. The coordinator has been notified.")).toBeInTheDocument();
    await waitFor(() => expect(api.sent(EVENT)).toHaveLength(2));
    expect(dialog().open).toBe(false);
  });

  it.each([
    ["Request changes", "Changes required", "changes_requested", "Changes requested. The event is back in Planning and the coordinator has been notified."],
    ["Reject", "Reason for rejecting", "rejected", "Safety arrangement rejected. The event is back in Planning and the coordinator has been notified."],
  ])("[SPM-87][AC4][AC5][AC8] SPM-87-TC06/TC07: %s sends the note and says the event is back in Planning", async (choice, box, decision, done) => {
    const api = open("safety_officer", inReview(), { [POST]: { status: "planning" } });
    await ask();

    await choose(choice);
    fireEvent.change(within(dialog()).getByLabelText(box), { target: { value: "Add a marshal." } });
    await record();

    expect(api.sent(POST).map((c) => c.body)).toEqual([{ decision, note: "Add a marshal." }]);
    expect(await screen.findByText(done)).toBeInTheDocument();
  });

  it.each([
    ["Reject", "Reason for rejecting", "", "Give a reason for rejecting."],
    ["Request changes", "Changes required", "   ", "Describe the changes required."],
  ])("[SPM-87][AC6] SPM-87-TC08: %s without a reason asks for one and sends nothing", async (choice, box, value, message) => {
    const api = open("safety_officer", inReview(), { [POST]: {} });
    await ask();

    await choose(choice);
    fireEvent.change(within(dialog()).getByLabelText(box), { target: { value } });
    await record();

    expect(within(dialog()).getByText(message)).toBeInTheDocument();
    expect(dialog().open).toBe(true);
    expect(api.sent(POST)).toHaveLength(0);
  });

  it("[SPM-87] asks for a choice before recording", async () => {
    const api = open("safety_officer", inReview(), { [POST]: {} });
    await ask();

    await record();

    expect(within(dialog()).getByText("Choose a decision.")).toBeInTheDocument();
    expect(api.sent(POST)).toHaveLength(0);
  });

  it.each([
    ["SPM-87-TC09: that it was already decided", reply(400, { error: "This safety check has already been decided." }), "This safety check has already been decided."],
    ["a general message when the server gives none", reply(500, {}), "Could not record this safety decision."],
    ["a network failure", () => Promise.reject(new Error("offline")), "Could not reach the server. Check your connection and try again."],
  ])("[SPM-87] shows %s when it is refused", async (_case, answer, message) => {
    const api = open("safety_officer", inReview(), { [POST]: answer });
    await ask();

    await choose("Approve");
    await record();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(dialog().open).toBe(false);
    expect(api.sent(EVENT)).toHaveLength(1);
  });

  it("[SPM-87] shows a general message when the server's refusal is not readable", async () => {
    open("safety_officer", inReview(), { [POST]: reply(502) });
    await ask();

    await choose("Approve");
    await record();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not record this safety decision.");
  });

  it("[SPM-87][AC6] clears the reason error as soon as one is typed", async () => {
    open("safety_officer", inReview(), { [POST]: {} });
    await ask();
    await choose("Reject");
    await record();
    expect(within(dialog()).getByText("Give a reason for rejecting.")).toBeInTheDocument();

    fireEvent.change(within(dialog()).getByLabelText("Reason for rejecting"), { target: { value: "T" } });

    expect(within(dialog()).queryByText("Give a reason for rejecting.")).not.toBeInTheDocument();
  });

  it("[SPM-87] closes without sending anything on Cancel", async () => {
    const api = open("safety_officer", inReview(), { [POST]: {} });
    await ask();

    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

    expect(dialog().open).toBe(false);
    expect(api.sent(POST)).toHaveLength(0);
  });

  it("[SPM-87][AC2] SPM-87-TC02: shows each booked venue's opening hours and unavailable periods on the event's dates (AC2)", async () => {
    open(
      "safety_officer",
      inReview({
        venueBookings: [
          {
            startsAt: "2027-10-08T02:00:00.000Z",
            endsAt: "2027-10-08T05:00:00.000Z",
            layoutName: "theatre",
            session: null,
            venue: {
              name: "SPM87 Hillside Studio",
              code: "SPM87-STU",
              opensAt: "08:00",
              closesAt: "22:00",
              layouts: [{ layoutName: "theatre", capacity: 60 }],
              unavailable: [{ startsAt: "2027-10-07T23:00:00.000Z", endsAt: "2027-10-08T01:00:00.000Z", reason: "maintenance" }],
            },
          },
        ],
      })
    );

    await screen.findByRole("heading", { level: 2, name: "Venue bookings" });

    expect(screen.getByText("SPM87 Hillside Studio (SPM87-STU) · Theatre · seats 60")).toBeInTheDocument();
    expect(screen.getByText("Open 08:00–22:00")).toBeInTheDocument();
    expect(screen.getByText("Unavailable 8 Oct 2027, 07:00–09:00 (Maintenance)")).toBeInTheDocument();
  });
});

// SPM-88 - Resolve Safety Check Outcome, on the event's Overview.
//
// CONTRACT (SPM-88, written before the code):
//   A "Safety check history" card for staff (the API's `safetyHistory`, newest first), one line per
//   submission (safetyHistoryLine); none for an external user or an event never submitted (AC1).
//   A "Flag arrangements for review" button for the assigned coordinator while the event is in
//   Planning and its latest check was returned (AC3). Its dialog of the same name loads
//   GET /api/events/[id]/venue-bookings and GET /api/events/[id]/equipment, offers "Venue: <name>"
//   for each pending or approved booking and "Equipment: <item>" for each line not cancelled,
//   "Flag for review" / "Cancel"; "Choose at least one arrangement to flag." for none; POST
//   /api/events/[id]/safety-flags { venueBookingIds, equipmentRequestIds }; then
//   "<n> arrangement(s) flagged for review. Nothing has been changed or cancelled." and a reload.
describe("Event overview - resolving a safety check outcome (SPM-88)", () => {
  const FLAGS = `POST /api/events/${REF}/safety-flags`;
  const BOOKINGS = `GET /api/events/${REF}/venue-bookings`;
  const EQUIPMENT = `GET /api/events/${REF}/equipment`;
  const BUTTON = "Flag arrangements for review";
  const changesRequested = {
    status: "changes_requested",
    submittedAt: "2026-10-08T06:00:00.000Z",
    submittedBy: "Daniel Tan",
    decidedAt: "2026-10-09T02:00:00.000Z",
    decidedBy: "Hana Yusof",
    decisionNote: "Add a second fire marshal at the east exit.",
  };
  const rejected = {
    status: "rejected",
    submittedAt: "2026-10-05T06:00:00.000Z",
    submittedBy: "Daniel Tan",
    decidedAt: "2026-10-06T02:00:00.000Z",
    decidedBy: "Hana Yusof",
    decisionNote: "Fire exits are blocked by the stage set.",
  };
  const returned = (overrides: Record<string, unknown> = {}) =>
    event({
      title: "SPM88 Harbour Returned Forum",
      status: "planning",
      safetyCheck: changesRequested,
      safetyHistory: [changesRequested, rejected],
      ...overrides,
    });
  const arrangements = {
    [BOOKINGS]: {
      bookings: [
        { id: "b1", status: "approved", session: null, venue: { name: "SPM88 Harbour Studio", code: "SPM88-STU" } },
        { id: "b2", status: "pending", session: { id: "s1", label: "Day 2" }, venue: { name: "Bay Room", code: "BAY" } },
        { id: "b3", status: "withdrawn", session: null, venue: { name: "Old Room", code: "OLD" } },
      ],
    },
    [EQUIPMENT]: [
      { id: "r1", status: "reserved", equipment: { name: "Handheld Wireless Mic" } },
      { id: "r2", status: "cancelled", equipment: { name: "Old Projector" } },
    ],
  };

  function open(role = "coordinator", eventRow: unknown = returned(), extra: Record<string, unknown> = {}, who: object = daniel) {
    setRoute(`/events/${REF}`, { id: REF });
    const api = mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, "GET /api/users": [], ...arrangements, ...extra });
    render(<EventOverviewPage />);
    return api;
  }

  const dialog = () => dialogTitled(BUTTON);
  const ask = async () => userEvent.click(await screen.findByRole("button", { name: BUTTON }));
  const tick = async (name: string) =>
    userEvent.click(await within(dialog()).findByRole("checkbox", { name, hidden: true }));
  const flag = () => userEvent.click(within(dialog()).getByRole("button", { name: "Flag for review", hidden: true }));

  describe("the history (AC1)", () => {
    it("[SPM-88][AC1] SPM-88-TC01: lists every submission and decision, newest first, beside the latest in the Safety check row", async () => {
      open();

      expect(await screen.findByRole("heading", { name: "Safety check history" })).toBeInTheDocument();
      const list = screen.getByRole("list", { name: "Safety check history" });
      const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
      expect(items).toEqual([
        "Submitted by Daniel Tan, 8 Oct 2026, 14:00 - Changes requested by Hana Yusof, 9 Oct 2026, 10:00. Changes required: Add a second fire marshal at the east exit.",
        "Submitted by Daniel Tan, 5 Oct 2026, 14:00 - Rejected by Hana Yusof, 6 Oct 2026, 10:00. Reason: Fire exits are blocked by the stage set.",
      ]);
      expect(
        screen.getByText(
          "Changes requested · decided by Hana Yusof, 9 Oct 2026, 10:00. Changes required: Add a second fire marshal at the east exit."
        )
      ).toBeInTheDocument();
    });

    it("[SPM-88][AC10] SPM-88-TC02: shows the organiser no history", async () => {
      open("organiser", event({ status: "planning" }), {}, { id: "organiser-id" });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("heading", { name: "Safety check history" })).not.toBeInTheDocument();
    });

    it("[SPM-88][AC1] has no history card for an event never submitted", async () => {
      open("coordinator", event({ safetyCheck: null, safetyHistory: [] }));

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("heading", { name: "Safety check history" })).not.toBeInTheDocument();
    });

    it("[SPM-88][AC6] SPM-88-TC07: words a closed check in the Safety check row", async () => {
      const closed = {
        ...changesRequested,
        status: "closed",
        decidedAt: "2026-10-15T06:30:00.000Z",
        decidedBy: "Daniel Tan",
        decisionNote: "the expected attendance changed",
      };
      open("coordinator", returned({ safetyCheck: closed, safetyHistory: [closed] }));

      expect(
        await screen.findAllByText("Closed after a change on 15 Oct 2026, 14:30: the expected attendance changed", { exact: false })
      ).not.toHaveLength(0);
    });
  });

  describe("flagging arrangements (AC3)", () => {
    it.each([
      ["changes were requested", changesRequested, "org-id"],
      ["the check was rejected", rejected, null],
    ])("[SPM-88][AC3] SPM-88-TC03: is offered to the assigned coordinator once %s", async (_case, check, organisationId) => {
      open("coordinator", returned({ safetyCheck: check, organisationId }));

      expect(await screen.findByRole("button", { name: BUTTON })).toBeInTheDocument();
    });

    it.each([
      ["the check was approved", returned({ status: "safety_cleared", safetyCheck: { ...changesRequested, status: "approved" } })],
      ["the check is pending", returned({ status: "safety_review", safetyCheck: { ...changesRequested, status: "pending" } })],
      ["the event was never submitted", returned({ safetyCheck: null, safetyHistory: [] })],
    ])("[SPM-88][AC3] SPM-88-TC05: is not offered when %s", async (_case, row) => {
      open("coordinator", row);

      await screen.findByRole("heading", { level: 1 });

      expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
    });

    it.each([
      ["a coordinator who is not assigned", "coordinator", priya],
      ["the Safety Officer", "safety_officer", { id: "so1" }],
      ["the Ops Manager", "ops_manager", {}],
    ])("[SPM-88][AC3] SPM-88-TC05: is not offered to %s", async (_who, role, who) => {
      open(role, returned(), {}, who);

      await screen.findByRole("heading", { level: 1 });

      expect(screen.queryByRole("button", { name: BUTTON })).not.toBeInTheDocument();
    });

    it("[SPM-88][AC3] SPM-88-TC03: offers the event's current bookings and equipment, and nothing else", async () => {
      open();
      await ask();

      await within(dialog()).findByRole("checkbox", { name: "Venue: SPM88 Harbour Studio", hidden: true });
      expect(within(dialog()).getAllByRole("checkbox", { hidden: true }).map((c) => (c as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
        "Venue: SPM88 Harbour Studio",
        "Venue: Day 2: Bay Room",
        "Equipment: Handheld Wireless Mic",
      ]);
    });

    it("[SPM-88][AC3] SPM-88-TC03: flags what was ticked, says nothing else changed, and reloads the event", async () => {
      const api = open("coordinator", returned(), { [FLAGS]: { flagged: 2 } });
      await ask();

      await tick("Venue: SPM88 Harbour Studio");
      await tick("Equipment: Handheld Wireless Mic");
      await flag();

      expect(api.sent(FLAGS).map((c) => c.body)).toEqual([{ venueBookingIds: ["b1"], equipmentRequestIds: ["r1"] }]);
      expect(
        await screen.findByText("2 arrangements flagged for review. Nothing has been changed or cancelled.")
      ).toBeInTheDocument();
      await waitFor(() => expect(api.sent(EVENT)).toHaveLength(2));
      expect(dialog().open).toBe(false);
    });

    it("[SPM-88][AC3] says '1 arrangement' for one", async () => {
      open("coordinator", returned(), { [FLAGS]: { flagged: 1 } });
      await ask();

      await tick("Equipment: Handheld Wireless Mic");
      await flag();

      expect(
        await screen.findByText("1 arrangement flagged for review. Nothing has been changed or cancelled.")
      ).toBeInTheDocument();
    });

    it("[SPM-88][AC3] SPM-88-TC05: asks for at least one, and sends nothing", async () => {
      const api = open();
      await ask();
      await within(dialog()).findByRole("checkbox", { name: "Venue: SPM88 Harbour Studio", hidden: true });

      await flag();

      expect(within(dialog()).getByText("Choose at least one arrangement to flag.")).toBeInTheDocument();
      expect(api.sent(FLAGS)).toHaveLength(0);
    });

    it("[SPM-88][AC3] clears the message once something is ticked", async () => {
      open();
      await ask();
      await within(dialog()).findByRole("checkbox", { name: "Venue: SPM88 Harbour Studio", hidden: true });
      await flag();

      await tick("Venue: SPM88 Harbour Studio");

      expect(within(dialog()).queryByText("Choose at least one arrangement to flag.")).not.toBeInTheDocument();
    });

    it("[SPM-88][AC3] unticks a box ticked by mistake", async () => {
      const api = open("coordinator", returned(), { [FLAGS]: { flagged: 1 } });
      await ask();
      await tick("Venue: SPM88 Harbour Studio");
      await tick("Equipment: Handheld Wireless Mic");
      await tick("Venue: SPM88 Harbour Studio");

      await flag();

      expect(api.sent(FLAGS).map((c) => c.body)).toEqual([{ venueBookingIds: [], equipmentRequestIds: ["r1"] }]);
    });

    it("[SPM-88] says so when the event has nothing to flag", async () => {
      open("coordinator", returned(), { [BOOKINGS]: { bookings: [] }, [EQUIPMENT]: [] });
      await ask();

      expect(await within(dialog()).findByText("This event has no venue bookings or equipment to flag.")).toBeInTheDocument();
    });

    it("[SPM-88] says so when the arrangements cannot be loaded", async () => {
      open("coordinator", returned(), { [EQUIPMENT]: reply(500, {}) });
      await ask();

      expect(await within(dialog()).findByText("Could not load this event's arrangements.")).toBeInTheDocument();
    });

    it("[SPM-88] shows the server's refusal and keeps the event as it was", async () => {
      const api = open("coordinator", returned(), {
        [FLAGS]: reply(400, { error: "Some of these arrangements can no longer be flagged. Reload the page and try again." }),
      });
      await ask();
      await tick("Venue: SPM88 Harbour Studio");

      await flag();

      expect(
        await screen.findByText("Some of these arrangements can no longer be flagged. Reload the page and try again.")
      ).toBeInTheDocument();
      expect(api.sent(EVENT)).toHaveLength(1);
    });

    it("[SPM-88] gives a general message when the refusal has no reason", async () => {
      open("coordinator", returned(), { [FLAGS]: reply(500) });
      await ask();
      await tick("Venue: SPM88 Harbour Studio");

      await flag();

      expect(await screen.findByText("Could not flag these arrangements.")).toBeInTheDocument();
    });

    it("[SPM-88] says so when the server cannot be reached", async () => {
      open("coordinator", returned(), { [FLAGS]: () => Promise.reject("offline") });
      await ask();
      await tick("Venue: SPM88 Harbour Studio");

      await flag();

      expect(await screen.findByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument();
    });

    it("[SPM-88][AC3] closes on Cancel without sending anything", async () => {
      const api = open();
      await ask();
      await tick("Venue: SPM88 Harbour Studio");

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(FLAGS)).toHaveLength(0);
    });
  });
});

// SPM-29 (AC3): "The open clarification is shown on the event to the Event
// Organiser and the assigned Event Coordinator." The API sends
// openClarification only to them (canSeeClarification), so the page shows it
// whenever it is there.
//
// CONTRACT (SPM-29, written before the code): an alert "Clarification requested" on
// /events/<ref> naming what needs clarifying (REVIEW_FIELD_LABELS), the message, and who
// asked and when (formatDateTime). Not shown when openClarification is null or absent.
describe("Event overview - an open clarification (SPM-29)", () => {
  const asked = {
    id: "clarification-id",
    fields: ["purpose", "when"],
    message: "Is this a dinner or a conference? Which day?",
    requestedAt: "2026-10-19T02:00:00.000Z",
    requester: { fullName: "Daniel Tan" },
  };

  function open(role: string, eventRow: unknown, who = {}) {
    setRoute(`/events/${REF}`, { id: REF });
    mockApi({ ...signedInAs(role, who), [EVENT]: eventRow });
    render(<EventOverviewPage />);
  }

  const banner = async () =>
    (await screen.findByText("Clarification requested")).closest("[role=alert], [role=status]") as HTMLElement;

  it("[SPM-29][AC3][AC4] shows the organiser what needs clarifying, the message, and who asked when", async () => {
    open("organiser", event({ status: "under_review", openClarification: asked }), { id: "organiser-id" });

    const shown = await banner();

    expect(shown).toHaveTextContent("Purpose, When");
    expect(shown).toHaveTextContent("Is this a dinner or a conference? Which day?");
    expect(shown).toHaveTextContent("Daniel Tan");
    expect(shown).toHaveTextContent(formatDateTime(asked.requestedAt));
  });

  it("[SPM-29][AC3] shows it to the assigned coordinator too", async () => {
    open("coordinator", event({ status: "under_review", openClarification: asked }), { id: "c1" });

    const shown = await banner();

    expect(shown).toHaveTextContent("Is this a dinner or a conference? Which day?");
  });

  // PR #70 review: clarifications raised before SPM-29 (the seed's) record no
  // items, so the line would read "Needs clarification:" with nothing after it.
  it("[SPM-29][AC1] leaves out the 'Needs clarification' line when no items were recorded", async () => {
    open("organiser", event({ status: "under_review", openClarification: { ...asked, fields: [] } }), {
      id: "organiser-id",
    });

    const shown = await banner();

    expect(shown).toHaveTextContent("Is this a dinner or a conference? Which day?");
    expect(shown).not.toHaveTextContent("Needs clarification");
  });

  it.each([
    ["nothing is open", { openClarification: null }],
    ["the viewer is not shown clarifications", {}],
  ])("[SPM-29][AC3] shows nothing when %s", async (_case, overrides) => {
    open("organiser", event({ status: "under_review", ...overrides }), { id: "organiser-id" });

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByText("Clarification requested")).not.toBeInTheDocument();
  });

  // CONTRACT (SPM-26, written before the code): the banner offers the organiser
  // who raised the request an "Update request" link to /events/<ref>/edit,
  // where they answer it. No one else gets it - a colleague at the same client
  // sees the banner only (decided 2026-10-21).
  it("[SPM-26][AC1][AC2] offers the organiser who raised it 'Update request'", async () => {
    open("organiser", event({ status: "under_review", openClarification: asked }), { id: "organiser-id" });

    const link = within(await banner()).getByRole("link", { name: "Update request" });

    expect(link).toHaveAttribute("href", `/events/${REF}/edit`);
  });

  it.each([
    ["an organiser at the same client", "organiser", { id: "colleague-id" }],
    ["the assigned coordinator", "coordinator", { id: "c1" }],
  ])("[SPM-26][AC2] does not offer it to %s", async (_who, role, who) => {
    open(role, event({ status: "under_review", openClarification: asked }), who);

    const shown = await banner();

    expect(within(shown).queryByRole("link", { name: "Update request" })).not.toBeInTheDocument();
  });
});

// SPM-26 (AC3, AC4): after resubmitting, the Update request page brings the
// organiser back here with ?resubmitted=1, and the page says the request was
// sent and stays Under review.
describe("Event overview - after the organiser resubmits (SPM-26)", () => {
  function openResubmitted(query: string, eventRow: unknown) {
    setRoute(`/events/${REF}${query}`, { id: REF });
    mockApi({ ...signedInAs("organiser", { id: "organiser-id" }), [EVENT]: eventRow });
    render(<EventOverviewPage />);
  }

  it("[SPM-26][AC3][AC4] says the request was sent to the coordinator and stays Under review", async () => {
    openResubmitted("?resubmitted=1", event({ status: "under_review", openClarification: null }));

    expect(
      await screen.findByText("Your updated request has been sent to Daniel Tan. It stays Under review.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Clarification requested")).not.toBeInTheDocument();
  });

  it("[SPM-26][AC3] says 'your coordinator' if the request names none", async () => {
    openResubmitted("?resubmitted=1", event({ status: "under_review", openClarification: null, coordinator: null }));

    expect(
      await screen.findByText("Your updated request has been sent to your coordinator. It stays Under review.")
    ).toBeInTheDocument();
  });

  it("[SPM-26] says nothing on an ordinary visit", async () => {
    openResubmitted("", event({ status: "under_review", openClarification: null }));

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByText(/Your updated request has been sent/)).not.toBeInTheDocument();
  });
});

describe("[SPM-59] a withdrawn request on its event page", () => {
  function openAs(role: string, who: object) {
    setRoute(`/events/${REF}`, { id: REF });
    mockApi({ ...signedInAs(role, who), [EVENT]: event({ status: "withdrawn" }), "GET /api/assignments": { coordinators: [] } });
    render(<EventOverviewPage />);
  }

  it("[SPM-59][AC5] shows the organiser that it has been withdrawn", async () => {
    openAs("organiser", { id: "organiser-id" });

    const header = (await screen.findByRole("heading", { level: 1, name: "Gala Dinner" })).closest("header") as HTMLElement;
    expect(within(header).getByText("Withdrawn")).toBeInTheDocument();
    const details = (screen.getByRole("heading", { name: "Details" }).closest("div.rounded-lg")) as HTMLElement;
    expect(details).toHaveTextContent(/Status\s*Withdrawn/i);
  });

  it("[SPM-59][AC4] offers the assigned coordinator nothing more to do with it", async () => {
    openAs("coordinator", { id: "c1" });
    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByText("This request is waiting for your review")).not.toBeInTheDocument();
    for (const name of ["Record withdrawal", "Confirm event", "Submit for safety check"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    for (const name of ["Review request", "Edit event information"]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });

  it("[SPM-59][AC4] offers the Ops Manager no change of coordinator", async () => {
    openAs("ops_manager", {});
    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(screen.queryByRole("heading", { name: "Change coordinator" })).not.toBeInTheDocument();
  });
});


// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import EventOverviewPage from "@/app/events/[id]/page";
import ReviewRequestPage from "@/app/events/[id]/review/page";
import { EventGlance } from "@/app/events/[id]/EventGlance";
import { ROLES } from "@/lib/roles";
import {
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

describe("Event overview", () => {
  function open(role: string, eventRow: unknown = event(), extra: Record<string, unknown> = {}, who = {}) {
    setRoute(`/events/${REF}`, { id: REF });
    const api = mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, ...extra });
    render(<EventOverviewPage />);
    return api;
  }

  it("sends an anonymous visitor to log in, remembering the event", async () => {
    setRoute(`/events/${REF}`, { id: REF });
    mockApi(signedOut());

    render(<EventOverviewPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007"));
  });

  it("renders nothing until it knows who is looking", () => {
    setRoute(`/events/${REF}`, { id: REF });
    mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

    const { container } = render(<EventOverviewPage />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the event's title, reference, status and details", async () => {
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

  it("says when no coordinator is assigned, and dashes out what is empty", async () => {
    open("coordinator", event({ coordinator: null, coordinatorId: null, category: null, preferredLayout: null, organisation: null }));

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(valueOf("Coordinator")).toHaveTextContent("Not yet assigned");
    expect(valueOf("Category")).toHaveTextContent("—");
    expect(valueOf("Preferred layout")).toHaveTextContent("—");
    expect(valueOf("Company")).toHaveTextContent("—");
  });

  it("calls the breadcrumb 'My Events' for an organiser and 'Events' for staff", async () => {
    open("organiser");
    expect(await screen.findByRole("link", { name: "My Events" })).toHaveAttribute("href", "/events");
  });

  it("calls the breadcrumb 'Events' for staff", async () => {
    open("coordinator");
    expect(await screen.findByRole("link", { name: "Events" })).toHaveAttribute("href", "/events");
  });

  it.each([
    ["organiser", ["Overview", "Equipment"]],
    ["coordinator", ["Overview", "Venue", "Equipment"]],
    ["venue_staff", ["Overview", "Venue"]],
    ["tech_support", ["Overview", "Equipment"]],
    ["ops_manager", ["Overview"]],
    ["attendee", ["Overview"]],
  ])("offers %s the tabs %j", async (role, expected) => {
    open(role, role === "attendee" ? publicEvent() : event(), { "GET /api/assignments": { coordinators: [] } });

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });
    const tabs = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");

    expect(tabs.map((t) => t.textContent)).toEqual(expected);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
  });

  it("sends the owner of a draft to the editor instead", async () => {
    open("organiser", event({ status: "draft" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/events/EVT-000007/edit"));
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
  });

  describe("what an attendee sees", () => {
    it("only the public details - no internal planning rows or cards", async () => {
      open("attendee", publicEvent());

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(terms()).toEqual(["Category", "Status", "When", "Description", "Company", "Capacity", "Window"]);
      expect(screen.queryByRole("heading", { name: "Venue requirements" })).not.toBeInTheDocument();
    });

    it("the registration capacity and window", async () => {
      open("attendee", publicEvent());

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(valueOf("Capacity")).toHaveTextContent("150");
      expect(valueOf("Window")).not.toHaveTextContent("—");
    });
  });

  it("says registration is not enabled when it is not", async () => {
    open("coordinator");

    await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

    expect(valueOf("Registration")).toHaveTextContent("Not enabled for this event");
  });

  it("lists the facility requirements, marking the optional ones", async () => {
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

  it("dashes out the facility requirements when there are none", async () => {
    open("coordinator");

    await screen.findByRole("heading", { name: "Venue requirements" });

    expect(valueOf("Required facilities")).toHaveTextContent("—");
  });

  it("shows why a rejected request was rejected", async () => {
    open("organiser", event({ status: "rejected", rejectionReason: "No venue is licensed overnight." }));

    expect(await screen.findByText("This request was rejected")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No venue is licensed overnight.");
  });

  describe("the way in to a review", () => {
    it("is offered to the assigned coordinator while the request is under review", async () => {
      open("coordinator", event({ status: "under_review" }), {}, { id: "c1" });

      expect(await screen.findByRole("link", { name: "Review request" })).toHaveAttribute(
        "href",
        "/events/EVT-000007/review"
      );
    });

    it("is not offered to a coordinator it is not assigned to", async () => {
      open("coordinator", event({ status: "under_review" }), {}, { id: "someone-else" });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("link", { name: "Review request" })).not.toBeInTheDocument();
    });

    it("is not offered once the request has been decided", async () => {
      open("coordinator", event({ status: "approved" }), {}, { id: "c1" });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("link", { name: "Review request" })).not.toBeInTheDocument();
    });
  });

  describe("assigning a coordinator from the event", () => {
    const assignments = { "GET /api/assignments": { awaiting: [], assigned: [], coordinators: [daniel, priya] } };
    const unassigned = () => event({ status: "submitted", coordinatorId: null, coordinator: null });

    it("lets the Ops Manager assign one to a submitted event, then reloads it", async () => {
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

    it("lets the Ops Manager change the coordinator of a live event", async () => {
      open("ops_manager", event(), {
        ...assignments,
        "PUT /api/events/EVT-000007/coordinator": { status: "planning", coordinator: priya, previousCoordinator: daniel },
      });
      expect(await screen.findByRole("heading", { name: "Change coordinator" })).toBeInTheDocument();
      expect(screen.getByText("Currently Daniel Tan.")).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Reassign to — Gala Dinner" }), "Priya Raj");
      await userEvent.click(screen.getByRole("button", { name: "Reassign" }));
      const dialog = screen.getByRole("dialog", { hidden: true });
      await userEvent.click(within(dialog).getByRole("button", { name: "Reassign", hidden: true }));

      expect(await screen.findByText("Reassigned from Daniel Tan to Priya Raj.")).toBeInTheDocument();
    });

    it("says only 'assigned' when it cannot name the current coordinator", async () => {
      open("ops_manager", event({ coordinator: null }), assignments);

      expect(await screen.findByText("Currently assigned.")).toBeInTheDocument();
    });

    it("is not offered once the event is completed", async () => {
      open("ops_manager", event({ status: "completed" }), assignments);

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("heading", { name: "Change coordinator" })).not.toBeInTheDocument();
    });

    it("is left out, with the rest of the page intact, when the coordinator list fails to load", async () => {
      open("ops_manager", unassigned(), { "GET /api/assignments": reply(500, {}) });

      await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

      expect(screen.queryByRole("heading", { name: "Assign a coordinator" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Details" })).toBeInTheDocument();
    });

    it("survives the coordinator list request failing outright", async () => {
      open("ops_manager", unassigned(), { "GET /api/assignments": () => Promise.reject(new Error("offline")) });

      expect(await screen.findByRole("heading", { name: "Details" })).toBeInTheDocument();
    });

    it.each(ROLES.filter((r) => r !== "ops_manager" && r !== "attendee"))(
      "is never offered to %s, who is not even sent the list of coordinators",
      async (role) => {
        const api = open(role, unassigned());

        await screen.findByRole("heading", { level: 1, name: "Gala Dinner" });

        expect(screen.queryByRole("heading", { name: "Assign a coordinator" })).not.toBeInTheDocument();
        expect(api.sent("GET /api/assignments")).toHaveLength(0);
      }
    );
  });

  describe("when it cannot be loaded", () => {
    it("explains a 404 without confirming the event exists", async () => {
      open("organiser", reply(404, { error: "Event not found" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This event doesn't exist, or you don't have access to it."
      );
      expect(screen.getByRole("heading", { level: 1, name: "Event" })).toBeInTheDocument();
    });

    it("offers a Retry that loads again", async () => {
      const api = open("organiser", reply(500, {}));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this event.");

      api.on(EVENT, event());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await screen.findByRole("heading", { level: 1, name: "Gala Dinner" })).toBeInTheDocument();
    });

    it("sends the user to log in when their session has expired", async () => {
      open("organiser", reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007"));
    });
  });
});

describe("EventGlance", () => {
  it("summarises the event beside a tab's own content", () => {
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

  it("fills in what is not known yet", () => {
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

  it.each(ROLES.filter((r) => r !== "coordinator"))("refuses %s without loading the request", async (role) => {
    setRoute(`/events/${REF}/review`, { id: REF });
    const api = mockApi(signedInAs(role));

    render(<ReviewRequestPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Reviewing event requests is the Event Coordinator's role.");
    expect(api.sent(EVENT)).toHaveLength(0);
  });

  it("refuses a coordinator the request is not assigned to, without showing the request", async () => {
    open(underReview(), {}, { id: "someone-else" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the coordinator assigned to this request can review it."
    );
    expect(screen.queryByRole("heading", { name: "What was requested" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("sends the assigned coordinator to the event page when the request is already decided", async () => {
    open(event({ status: "approved" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/events/EVT-000007"));
    expect(screen.queryByRole("heading", { name: "What was requested" })).not.toBeInTheDocument();
  });

  describe("what was requested", () => {
    it("shows everything the organiser asked for", async () => {
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

    it("marks each empty field 'Not provided' and summarises them, without blocking the decision", async () => {
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

    it("lists the sessions of a multi-session event, and which session each item is for", async () => {
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

    it("asks for confirmation, saying what will change, before anything is sent", async () => {
      const api = open();

      await chooseApprove();

      expect(dialog().open).toBe(true);
      expect(dialog()).toHaveTextContent("“Gala Dinner” moves from Under review to Approved");
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("approves once confirmed, and stays on the page to say so", async () => {
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

    it("sends nothing when the confirmation is cancelled", async () => {
      const api = open();
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("shows the server's refusal and leaves the decision open", async () => {
      open(underReview(), { [PATCH]: reply(400, { error: "Only a request that is under review can be approved or rejected" }) });
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Approve", hidden: true }));

      expect(await screen.findByText("Only a request that is under review can be approved or rejected")).toBeInTheDocument();
      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
      expect(screen.queryByText("Request approved")).not.toBeInTheDocument();
    });

    it("falls back to a general message when the server gives none", async () => {
      open(underReview(), { [PATCH]: reply(500) });
      await chooseApprove();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Approve", hidden: true }));

      expect(await screen.findByText("Could not save your decision. Please try again.")).toBeInTheDocument();
    });
  });

  describe("rejecting", () => {
    async function chooseReject() {
      await decision();
      await userEvent.click(screen.getByRole("radio", { name: /Reject this request/ }));
    }
    const reasonBox = () => screen.getByRole("textbox", { name: /Reason for rejection/ });

    it.each(["", "   "])("refuses a reason of %j without sending anything", async (text) => {
      const api = open();
      await chooseReject();
      if (text) await userEvent.type(reasonBox(), text);

      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(reasonBox()).toBeInvalid();
      expect(screen.getByText("A reason is required when rejecting. The organiser sees this message.")).toBeInTheDocument();
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("clears the reason error as soon as the coordinator starts typing", async () => {
      open();
      await chooseReject();
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      await userEvent.type(reasonBox(), "N");

      expect(reasonBox()).not.toHaveAttribute("aria-invalid");
    });

    it("rejects with the trimmed reason, and shows the outcome with that reason", async () => {
      const api = open(underReview(), { [PATCH]: { status: "rejected", coordinatorId: "c1" } });
      await chooseReject();

      await userEvent.type(reasonBox(), "  No venue is licensed overnight.  ");
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(await screen.findByText("Request rejected")).toBeInTheDocument();
      expect(api.sent(PATCH)[0].body).toEqual({ status: "rejected", reason: "No venue is licensed overnight." });
      expect(screen.getByText("Reason: No venue is licensed overnight.")).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    });

    it("Cancel backs out of rejecting and forgets the reason", async () => {
      open();
      await chooseReject();
      await userEvent.type(reasonBox(), "Changed my mind");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("textbox", { name: /Reason for rejection/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("radio", { name: /Reject this request/ }));

      expect(reasonBox()).toHaveValue("");
    });

    it("switching to Approve hides the reason box", async () => {
      open();
      await chooseReject();

      await userEvent.click(screen.getByRole("radio", { name: /Approve/ }));

      expect(screen.queryByRole("textbox", { name: /Reason for rejection/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Approve request" })).toBeInTheDocument();
    });

    it("shows the server's refusal", async () => {
      open(underReview(), { [PATCH]: reply(403, { error: 'Your role cannot move an event to "rejected"' }) });
      await chooseReject();

      await userEvent.type(reasonBox(), "Not feasible");
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(await screen.findByText('Your role cannot move an event to "rejected"')).toBeInTheDocument();
    });
  });

  describe("when it cannot be loaded", () => {
    it("explains a 404", async () => {
      open(reply(404, {}));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This event doesn't exist, or you don't have access to it."
      );
    });

    it("offers a Retry that loads again", async () => {
      const api = open(reply(500, {}));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this request.");

      api.on(EVENT, underReview());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await decision()).toBeInTheDocument();
    });

    it("sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Freview"));
    });
  });
});

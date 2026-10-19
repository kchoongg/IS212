// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { RequirePermission } from "@/components/RequirePermission";
import { NotBuiltYet } from "@/components/NotBuiltYet";
import { AssignCoordinator } from "@/components/AssignCoordinator";
import { NAV_BY_ROLE, ROLES, roleLabel } from "@/lib/roles";
import { saveToken } from "@/lib/session";
import { NOTIFICATIONS_CHANGED } from "@/lib/notificationView";
import {
  act,
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

const mainNav = () => screen.getByRole("navigation", { name: "Main" });
const navLabels = () => within(mainNav()).getAllByRole("link").map((a) => a.textContent);

describe("AppShell", () => {
  describe("before sign-in", () => {
    it("treats a page with no path as the landing page", async () => {
      setRoute("");
      mockApi(signedOut());

      render(<AppShell>page content</AppShell>);

      expect(screen.getByText("page content")).toBeInTheDocument();
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    });

    it.each(["/", "/login", "/register"])("renders %s with no navigation at all", async (path) => {
      setRoute(path);
      mockApi(signedOut());

      render(<AppShell>page content</AppShell>);

      expect(screen.getByText("page content")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "ConnectSphere" })).toHaveAttribute("href", "/");
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    });

    it("offers Log in, and no navigation links, to an anonymous visitor on an app page", async () => {
      setRoute("/dashboard");
      mockApi(signedOut());

      render(<AppShell>page content</AppShell>);

      expect(await screen.findByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
      expect(within(mainNav()).queryByRole("link")).not.toBeInTheDocument();
    });

    it("treats a failed session check as anonymous", async () => {
      setRoute("/dashboard");
      mockApi({ "GET /api/auth/me": () => Promise.reject(new Error("network down")) });

      render(<AppShell>page content</AppShell>);

      expect(await screen.findByRole("link", { name: "Log in" })).toBeInTheDocument();
    });
  });

  it("shows placeholders, not Log in, while the session is still being checked", () => {
    setRoute("/dashboard");
    mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

    render(<AppShell>page content</AppShell>);

    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  describe("signed in", () => {
    it.each(ROLES)("gives %s exactly the navigation for that role", async (role) => {
      setRoute("/dashboard");
      mockApi(signedInAs(role));

      render(<AppShell>page content</AppShell>);

      await screen.findByRole("button", { name: "Log out" });
      expect(navLabels()).toEqual(NAV_BY_ROLE[role].map((item) => item.label));
    });

    it("gives a role it does not recognise the Dashboard only", async () => {
      setRoute("/dashboard");
      mockApi(signedInAs("intern"));

      render(<AppShell>page content</AppShell>);

      await screen.findByRole("button", { name: "Log out" });
      expect(navLabels()).toEqual(["Dashboard"]);
    });

    it("shows who is signed in, their role and their initials", async () => {
      setRoute("/dashboard");
      mockApi(signedInAs("coordinator", { name: "Daniel Wei Tan" }));

      render(<AppShell>page content</AppShell>);

      expect(await screen.findByText("Daniel Wei Tan")).toBeInTheDocument();
      expect(screen.getByText(roleLabel("coordinator"))).toBeInTheDocument();
      expect(screen.getByText("DT")).toBeInTheDocument();
    });

    it.each([
      ["Cher", "C"],
      ["   ", "?"],
    ])("shows the initials of %j as %s", async (name, initials) => {
      setRoute("/dashboard");
      mockApi(signedInAs("organiser", { name }));

      render(<AppShell>page content</AppShell>);

      expect(await screen.findByText(initials)).toBeInTheDocument();
    });

    it("links the wordmark to the dashboard and the bell to notifications", async () => {
      setRoute("/events");
      mockApi(signedInAs("organiser"));

      render(<AppShell>page content</AppShell>);
      await screen.findByRole("button", { name: "Log out" });

      expect(screen.getByRole("link", { name: "ConnectSphere" })).toHaveAttribute("href", "/dashboard");
      // The bell in the top bar - not the sidebar's own Notifications item.
      const banner = screen.getByRole("banner");
      expect(within(banner).getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/notifications");
    });

    it("highlights the section a nested page belongs to", async () => {
      setRoute("/events/EVT-000007/equipment");
      mockApi(signedInAs("organiser"));

      render(<AppShell>page content</AppShell>);
      await screen.findByRole("button", { name: "Log out" });

      expect(within(mainNav()).getByRole("link", { name: "My Events" })).toHaveAttribute("aria-current", "page");
      expect(within(mainNav()).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    });

    it("highlights only the most specific section when two contain the page", async () => {
      setRoute("/equipment/requests/EVT-000007");
      mockApi(signedInAs("tech_support"));

      render(<AppShell>page content</AppShell>);
      await screen.findByRole("button", { name: "Log out" });
      const current = within(mainNav())
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page")
        .map((a) => a.textContent);

      // The page sits under both /equipment and /equipment/requests; only the
      // closer one is lit, never both.
      expect(current).toEqual(["Equipment Requests"]);
    });

    it("logs out: forgets the session and goes to the login page", async () => {
      setRoute("/dashboard");
      mockApi(signedInAs("organiser"));
      render(<AppShell>page content</AppShell>);

      await userEvent.click(await screen.findByRole("button", { name: "Log out" }));

      expect(localStorage.getItem("connectsphere_token")).toBeNull();
      expect(router.push).toHaveBeenCalledWith("/login");
    });

    it("picks up a sign-in that happens elsewhere on the page without a reload", async () => {
      setRoute("/dashboard");
      const api = mockApi(signedOut());
      render(<AppShell>page content</AppShell>);
      await screen.findByRole("link", { name: "Log in" });

      api.on("GET /api/auth/me", { id: "u1", name: "Rachel Ng", email: "r@example.com", role: "organiser" });
      act(() => saveToken("fresh-token"));

      expect(await screen.findByText("Rachel Ng")).toBeInTheDocument();
      expect(navLabels()).toEqual(["Dashboard", "My Events", "Notifications"]);
    });
  });

  describe("on a small screen", () => {
    async function open() {
      setRoute("/dashboard");
      mockApi(signedInAs("organiser"));
      const view = render(<AppShell>page content</AppShell>);
      await screen.findByRole("button", { name: "Log out" });
      const toggle = screen.getByRole("button", { name: "Toggle navigation" });
      await userEvent.click(toggle);
      return { toggle, ...view };
    }

    it("the menu button opens a second copy of the navigation", async () => {
      const { toggle } = await open();

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(2);
    });

    it("starts closed", async () => {
      setRoute("/dashboard");
      mockApi(signedInAs("organiser"));
      render(<AppShell>page content</AppShell>);
      await screen.findByRole("button", { name: "Log out" });

      expect(screen.getByRole("button", { name: "Toggle navigation" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(1);
    });

    it("the menu button closes it again", async () => {
      const { toggle } = await open();

      await userEvent.click(toggle);

      expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(1);
    });

    it("following a link closes it", async () => {
      await open();
      const slideOver = screen.getAllByRole("navigation", { name: "Main" })[1];

      await userEvent.click(within(slideOver).getByRole("link", { name: "My Events" }));

      expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(1);
    });

    it("clicking outside it closes it", async () => {
      const { container } = await open();

      await userEvent.click(container.querySelector(".fixed > [aria-hidden=true]")!);

      expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(1);
    });
  });
});

// SPM-71 (AC3): the number of unread notifications, on the bell and on the
// sidebar's Notifications link.
describe("AppShell - unread notifications (SPM-71)", () => {
  const COUNT = "GET /api/notifications/unread-count";
  const bell = () => within(screen.getByRole("banner")).getByRole("link", { name: /^Notifications/ });
  const sidebarLink = () => within(mainNav()).getByRole("link", { name: /^Notifications/ });

  function open(unread: unknown, path = "/dashboard") {
    setRoute(path);
    const api = mockApi({ ...signedInAs("coordinator"), [COUNT]: unread });
    const view = render(<AppShell>page content</AppShell>);
    return { api, view };
  }

  it("shows the count on the bell and on the sidebar link", async () => {
    open({ unread: 3 });

    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 3 unread"));
    expect(bell()).toHaveTextContent("3");
    expect(sidebarLink()).toHaveAccessibleName("Notifications, 3 unread");
    expect(sidebarLink()).toHaveTextContent("3");
  });

  it("shows no number at all when nothing is unread", async () => {
    const { api } = open({ unread: 0 });

    await waitFor(() => expect(api.sent(COUNT)).toHaveLength(1));
    expect(bell()).toHaveAccessibleName("Notifications");
    expect(sidebarLink()).toHaveTextContent(/^Notifications$/);
  });

  it("caps a large count at 99+", async () => {
    open({ unread: 140 });

    await waitFor(() => expect(bell()).toHaveTextContent("99+"));
    expect(bell()).toHaveAccessibleName("Notifications, 99+ unread");
  });

  it("asks nobody for a count before anyone has signed in", async () => {
    setRoute("/dashboard");
    const api = mockApi(signedOut());

    render(<AppShell>page content</AppShell>);

    await screen.findByRole("link", { name: "Log in" });
    expect(api.sent(COUNT)).toHaveLength(0);
  });

  it("counts again when the Notifications page marks something read", async () => {
    const { api } = open({ unread: 3 });
    await waitFor(() => expect(bell()).toHaveTextContent("3"));

    api.on(COUNT, { unread: 2 });
    act(() => {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    });

    await waitFor(() => expect(bell()).toHaveAccessibleName("Notifications, 2 unread"));
  });

  it("counts again on moving to another page", async () => {
    const { api, view } = open({ unread: 3 });
    await waitFor(() => expect(api.sent(COUNT)).toHaveLength(1));

    setRoute("/events");
    view.rerender(<AppShell>other page</AppShell>);

    await waitFor(() => expect(api.sent(COUNT)).toHaveLength(2));
  });

  it("shows no number when the count comes back as something other than a number", async () => {
    const { api } = open({ unread: "three" });

    await waitFor(() => expect(api.sent(COUNT)).toHaveLength(1));
    expect(bell()).toHaveAccessibleName("Notifications");
  });

  it("drops a count that arrives after the shell has gone", async () => {
    let answer: (value: unknown) => void = () => {};
    const { api, view } = open(() => new Promise((resolve) => (answer = resolve)));
    await waitFor(() => expect(api.sent(COUNT)).toHaveLength(1));

    view.unmount();
    answer({ unread: 5 });

    // Lets the late answer settle: still the one count request, and no
    // second one once the shell has gone.
    await waitFor(() => expect(api.sent(COUNT)).toHaveLength(1));
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("keeps working, with no number, when the count cannot be loaded", async () => {
    open(reply(500, {}));

    await screen.findByRole("button", { name: "Log out" });
    expect(bell()).toHaveAccessibleName("Notifications");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});

describe("RequirePermission", () => {
  const screenBody = () => screen.queryByText("the restricted screen");

  function renderGate(props: Partial<React.ComponentProps<typeof RequirePermission>> = {}) {
    return render(
      <RequirePermission action="venue:manage" title="Venues" {...props}>
        the restricted screen
      </RequirePermission>
    );
  }

  it("renders nothing while it does not yet know who is asking", () => {
    mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

    const { container } = renderGate();

    expect(container).toBeEmptyDOMElement();
  });

  it("sends an anonymous visitor to log in, remembering where they were", async () => {
    setRoute("/venues/new");
    mockApi(signedOut());

    const { container } = renderGate();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fnew"));
    expect(container).toBeEmptyDOMElement();
  });

  it("refuses the wrong role without ever mounting the screen", async () => {
    setRoute("/venues/new");
    mockApi(signedInAs("coordinator"));

    renderGate({ reason: "Only Venue Staff can add a venue." });

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have access to this");
    expect(screen.getByRole("alert")).toHaveTextContent("Only Venue Staff can add a venue.");
    expect(screen.getByRole("heading", { name: "Venues" })).toBeInTheDocument();
    expect(screenBody()).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("gives a general reason when the screen does not supply one", async () => {
    mockApi(signedInAs("attendee"));

    renderGate({ breadcrumbs: [{ label: "Venues" }] });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This screen is not part of your role in ConnectSphere."
    );
  });

  it("offers a way back to the dashboard from the refusal", async () => {
    mockApi(signedInAs("attendee"));
    renderGate();

    await userEvent.click(await screen.findByRole("button", { name: "Back to Dashboard" }));

    expect(router.push).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the screen for a role that holds the permission", async () => {
    mockApi(signedInAs("venue_staff"));

    renderGate();

    expect(await screen.findByText("the restricted screen")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("with no permission named, lets any signed-in user through", async () => {
    mockApi(signedInAs("attendee"));

    renderGate({ action: undefined });

    expect(await screen.findByText("the restricted screen")).toBeInTheDocument();
  });

  it("with no permission named, still turns away an anonymous visitor", async () => {
    setRoute("/dashboard");
    mockApi(signedOut());

    renderGate({ action: undefined });

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fdashboard"));
    expect(screenBody()).not.toBeInTheDocument();
  });
});

describe("NotBuiltYet", () => {
  it("says the screen is unfinished, and which story it belongs to", () => {
    render(
      <NotBuiltYet
        title="Notifications"
        screen="S-05 (Notifications)"
        description="Everything that needs your attention."
        breadcrumbs={[{ label: "Notifications" }]}
      />
    );

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("Everything that needs your attention.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("This screen is not built yet");
    expect(screen.getByRole("status")).toHaveTextContent("S-05 (Notifications) is specified in UI_DESIGN.md");
  });
});

describe("AssignCoordinator", () => {
  const daniel = { id: "c1", fullName: "Daniel Tan" };
  const priya = { id: "c2", fullName: "Priya Raj" };
  const ROUTE = "PUT /api/events/EVT-000007/coordinator";

  function renderPicker(current: typeof daniel | null, onAssigned = vi.fn()) {
    render(
      <AssignCoordinator
        eventRef="EVT-000007"
        eventTitle="Gala Dinner"
        current={current}
        coordinators={[daniel, priya]}
        onAssigned={onAssigned}
      />
    );
    return {
      onAssigned,
      select: screen.getByRole("combobox", { name: "Assign to — Gala Dinner" }) as HTMLSelectElement,
    };
  }

  describe("first assignment", () => {
    it("is disabled until a coordinator is chosen", () => {
      mockApi();

      renderPicker(null);

      expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    });

    it("assigns on click, with no confirmation, and reports the result", async () => {
      const result = { status: "under_review", coordinator: daniel, previousCoordinator: null };
      const api = mockApi({ [ROUTE]: result });
      const { onAssigned, select } = renderPicker(null);

      await userEvent.selectOptions(select, "Daniel Tan");
      await userEvent.click(screen.getByRole("button", { name: "Assign" }));

      await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(result));
      expect(api.sent(ROUTE)[0].body).toEqual({ coordinatorId: "c1" });
      expect(select).toHaveValue("");
    });

    it("shows the server's refusal and does not report success", async () => {
      mockApi({ [ROUTE]: reply(400, { error: "Choose an active Event Coordinator." }) });
      const { onAssigned, select } = renderPicker(null);

      await userEvent.selectOptions(select, "Daniel Tan");
      await userEvent.click(screen.getByRole("button", { name: "Assign" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Choose an active Event Coordinator.");
      expect(onAssigned).not.toHaveBeenCalled();
    });

    it("falls back to a general message when the server gives no reason", async () => {
      mockApi({ [ROUTE]: reply(500) });
      const { select } = renderPicker(null);

      await userEvent.selectOptions(select, "Daniel Tan");
      await userEvent.click(screen.getByRole("button", { name: "Assign" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the coordinator.");
    });

    it("shows a general error when the request fails without a reason", async () => {
      mockApi({ [ROUTE]: () => Promise.reject("offline") });
      const { select } = renderPicker(null);

      await userEvent.selectOptions(select, "Daniel Tan");
      await userEvent.click(screen.getByRole("button", { name: "Assign" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("clears the error once a different coordinator is picked", async () => {
      mockApi({ [ROUTE]: reply(400, { error: "Choose an active Event Coordinator." }) });
      const { select } = renderPicker(null);
      await userEvent.selectOptions(select, "Daniel Tan");
      await userEvent.click(screen.getByRole("button", { name: "Assign" }));
      await screen.findByRole("alert");

      await userEvent.selectOptions(select, "Priya Raj");

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("reassignment", () => {
    const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;

    it("asks first, naming who loses the event and who gets it", async () => {
      const api = mockApi({ [ROUTE]: {} });
      const { select } = renderPicker(daniel);

      await userEvent.selectOptions(select, "Priya Raj");
      await userEvent.click(screen.getByRole("button", { name: "Reassign" }));

      expect(dialog().open).toBe(true);
      expect(dialog()).toHaveTextContent("“Gala Dinner” moves from Daniel Tan to Priya Raj.");
      expect(api.sent(ROUTE)).toHaveLength(0);
    });

    it("sends the change only once confirmed", async () => {
      const result = { status: "planning", coordinator: priya, previousCoordinator: daniel };
      const api = mockApi({ [ROUTE]: result });
      const { onAssigned, select } = renderPicker(daniel);
      await userEvent.selectOptions(select, "Priya Raj");
      await userEvent.click(screen.getByRole("button", { name: "Reassign" }));

      await userEvent.click(within(dialog()).getByRole("button", { name: "Reassign", hidden: true }));

      await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(result));
      expect(api.sent(ROUTE)[0].body).toEqual({ coordinatorId: "c2" });
    });

    it("sends nothing when the confirmation is cancelled", async () => {
      const api = mockApi({ [ROUTE]: {} });
      const { onAssigned, select } = renderPicker(daniel);
      await userEvent.selectOptions(select, "Priya Raj");
      await userEvent.click(screen.getByRole("button", { name: "Reassign" }));

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(ROUTE)).toHaveLength(0);
      expect(onAssigned).not.toHaveBeenCalled();
    });

    it("refuses to reassign to the coordinator who already has it", async () => {
      mockApi();
      const { select } = renderPicker(daniel);

      await userEvent.selectOptions(select, "Daniel Tan");

      expect(screen.getByRole("button", { name: "Reassign" })).toBeDisabled();
      expect(screen.getByText("Daniel Tan is already the assigned coordinator.")).toBeInTheDocument();
    });

    it("closes the confirmation and shows the error when the server refuses", async () => {
      mockApi({ [ROUTE]: reply(409, { error: "Someone else changed this event's coordinator just now." }) });
      const { select } = renderPicker(daniel);
      await userEvent.selectOptions(select, "Priya Raj");
      await userEvent.click(screen.getByRole("button", { name: "Reassign" }));

      await userEvent.click(within(dialog()).getByRole("button", { name: "Reassign", hidden: true }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this event's coordinator");
      expect(dialog().open).toBe(false);
    });
  });

  it("uses the label it is given for the select's accessible name", () => {
    mockApi();
    render(
      <AssignCoordinator
        eventRef="EVT-000007"
        eventTitle="Gala Dinner"
        current={null}
        coordinators={[daniel]}
        onAssigned={vi.fn()}
        label="Coordinator for"
        className="w-full"
      />
    );

    expect(screen.getByRole("combobox", { name: "Coordinator for — Gala Dinner" })).toBeInTheDocument();
  });
});

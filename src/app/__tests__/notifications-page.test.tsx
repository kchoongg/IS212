// @vitest-environment jsdom
//
// SPM-71 (View Notifications): the Notifications page, S-04.

import { describe, it, expect, vi } from "vitest";
import { StrictMode } from "react";
import NotificationsPage from "@/app/notifications/page";
import { NOTIFICATIONS_CHANGED } from "@/lib/notificationView";
import { mockApi, render, reply, router, screen, setRoute, signedInAs, signedOut, userEvent, waitFor, within } from "@/test/ui";

const LIST = "GET /api/notifications";
const ALL = "POST /api/notifications/read-all";
const one = (id: string) => `PATCH /api/notifications/${id}`;

function note(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "coordinator_assigned",
    title: `Notification ${id}`,
    body: `What happened in ${id}.`,
    isRead: false,
    // 09:00 in Singapore.
    createdAt: "2026-10-12T01:00:00.000Z",
    event: { reference: "EVT-000071", title: "Harbour Lights Gala" },
    href: "/events/EVT-000071",
    ...overrides,
  };
}

// Leon Koh's list from the fixtures, as the API returns it: newest first.
const leon = () => [
  note("n1", { title: "You have been assigned an event", body: 'You are now the coordinator for "Harbour Lights Gala".' }),
  note("n2", {
    type: "booking_needs_review",
    title: "Booking needs review",
    createdAt: "2026-10-11T07:30:00.000Z",
    href: "/events/EVT-000071/venue",
  }),
  note("n3", {
    type: "equipment_unavailable",
    title: "Equipment out of service - reservation needs review",
    isRead: true,
    createdAt: "2026-10-10T03:00:00.000Z",
    event: { reference: "EVT-000072", title: "Riverside Tech Fair" },
    href: "/events/EVT-000072/equipment",
  }),
];

function open(routes: Record<string, unknown> = {}) {
  setRoute("/notifications");
  const api = mockApi({ ...signedInAs("coordinator"), [LIST]: leon(), ...routes });
  render(<NotificationsPage />);
  return api;
}

/// One notification on the page, found by its title.
const item = async (title: string) => (await screen.findByText(title)).closest("li") as HTMLElement;
const titles = () =>
  within(screen.getByRole("list", { name: "Your notifications" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("h2")!.textContent);

describe("Notifications page (SPM-71)", () => {
  describe("who can open it", () => {
    it("sends an anonymous visitor to log in, remembering the page", async () => {
      setRoute("/notifications");
      mockApi(signedOut());

      render(<NotificationsPage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fnotifications"));
    });

    it("AC1: lets any signed-in user in, whatever their role", async () => {
      setRoute("/notifications");
      mockApi({ ...signedInAs("attendee"), [LIST]: [] });

      render(<NotificationsPage />);

      expect(await screen.findByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
    });
  });

  describe("the list", () => {
    it("AC1: shows the notifications in the order given - newest first", async () => {
      open();

      await item("Booking needs review");

      expect(titles()).toEqual([
        "You have been assigned an event",
        "Booking needs review",
        "Equipment out of service - reservation needs review",
      ]);
    });

    it("AC2: says what happened, which event it is about and when", async () => {
      open();

      const assigned = await item("You have been assigned an event");

      expect(assigned).toHaveTextContent('You are now the coordinator for "Harbour Lights Gala".');
      expect(assigned).toHaveTextContent("Harbour Lights Gala · EVT-000071");
      expect(assigned).toHaveTextContent("12 Oct 2026, 09:00");
    });

    it("names an event with no title 'Untitled event'", async () => {
      open({ [LIST]: [note("n1", { event: { reference: "EVT-000071", title: null } })] });

      expect(await item("Notification n1")).toHaveTextContent("Untitled event · EVT-000071");
    });

    it("shows a notification about no event as plain text, not a link", async () => {
      open({ [LIST]: [note("n1", { event: null, href: null })] });

      const plain = await item("Notification n1");

      expect(within(plain).queryByRole("link")).not.toBeInTheDocument();
      expect(plain).not.toHaveTextContent("EVT-");
    });

    it("AC3: marks the unread ones 'Unread' and leaves the read ones plain", async () => {
      open();

      const unread = await item("Booking needs review");
      const read = await item("Equipment out of service - reservation needs review");

      expect(within(unread).getByText("Unread")).toBeInTheDocument();
      expect(within(unread).getByRole("button", { name: "Mark as read" })).toBeInTheDocument();
      expect(within(read).queryByText("Unread")).not.toBeInTheDocument();
      expect(within(read).queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
    });

    it("AC8: says so when there are no notifications, and offers nothing to mark", async () => {
      open({ [LIST]: [] });

      expect(await screen.findByText("No notifications")).toBeInTheDocument();
      expect(screen.getByText("Updates about your events will appear here.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
    });

    it("shows a general error when the request fails without a reason", async () => {
      open({ [LIST]: () => Promise.reject("offline") });

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("shows a load failure with a Retry that loads again", async () => {
      const api = open({ [LIST]: reply(500, {}) });
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your notifications.");

      api.on(LIST, leon());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await item("Booking needs review")).toBeInTheDocument();
    });

    it("sends the user to log in when their session has expired", async () => {
      open({ [LIST]: reply(401, {}) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fnotifications"));
    });
  });

  describe("marking as read", () => {
    it("AC4: marks one as read, and tells the navigation to recount", async () => {
      const changed = vi.fn();
      window.addEventListener(NOTIFICATIONS_CHANGED, changed);
      const api = open({ [one("n2")]: { id: "n2", isRead: true } });

      await userEvent.click(within(await item("Booking needs review")).getByRole("button", { name: "Mark as read" }));

      await waitFor(() => expect(within(screen.getByText("Booking needs review").closest("li")!).queryByText("Unread")).not.toBeInTheDocument());
      expect(api.sent(one("n2")).map((c) => c.body)).toEqual([{ isRead: true }]);
      expect(changed).toHaveBeenCalledTimes(1);
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
    });

    it("AC4: marks all as read, and the button goes once nothing is unread", async () => {
      const changed = vi.fn();
      window.addEventListener(NOTIFICATIONS_CHANGED, changed);
      const api = open({ [ALL]: { updated: 2 } });

      await userEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));

      await waitFor(() => expect(screen.queryByText("Unread")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
      expect(api.sent(ALL)).toHaveLength(1);
      expect(changed).toHaveBeenCalledTimes(1);
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
    });

    it("keeps a notification read when an older load of the list arrives after marking it", async () => {
      // Found in the browser: React's development mode loads the page twice,
      // and a slow second answer - read before the mark was saved - used to
      // overwrite it, showing it Unread again although the server had it read.
      let releaseLate: (rows: unknown) => void = () => {};
      let loads = 0;
      setRoute("/notifications");
      mockApi({
        ...signedInAs("coordinator"),
        // The first load is the slow one: it answers last, with the list as it
        // was before the mark was saved.
        [LIST]: () => (++loads === 1 ? new Promise((resolve) => (releaseLate = resolve)) : leon()),
        [one("n2")]: { id: "n2", isRead: true },
      });
      render(
        <StrictMode>
          <NotificationsPage />
        </StrictMode>
      );

      const booking = await item("Booking needs review");
      await userEvent.click(within(booking).getByRole("button", { name: "Mark as read" }));
      await waitFor(() => expect(within(booking).queryByText("Unread")).not.toBeInTheDocument());
      releaseLate(leon()); // the stale list, n2 still unread

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(within(await item("Booking needs review")).queryByText("Unread")).not.toBeInTheDocument();
      expect(loads).toBe(2);
    });

    it("ignores an older load that fails after a newer one has shown the list", async () => {
      // The same double load as above, but the slow first answer is a failure:
      // it must not replace the list already showing with an error.
      let failLate: (answer: unknown) => void = () => {};
      let loads = 0;
      setRoute("/notifications");
      mockApi({
        ...signedInAs("coordinator"),
        [LIST]: () => (++loads === 1 ? new Promise((resolve) => (failLate = resolve)) : leon()),
      });
      render(
        <StrictMode>
          <NotificationsPage />
        </StrictMode>
      );

      await item("Booking needs review");
      failLate(reply(500, {}));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByText("Could not load your notifications.")).not.toBeInTheDocument();
      expect(await item("Booking needs review")).toBeInTheDocument();
      expect(loads).toBe(2);
    });

    it("offers no Mark all as read when everything is already read", async () => {
      open({ [LIST]: [note("n1", { isRead: true })] });

      await item("Notification n1");

      expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
    });

    it("keeps a notification unread, and says so, when marking it fails", async () => {
      open({ [one("n2")]: reply(500, {}) });

      const booking = await item("Booking needs review");
      await userEvent.click(within(booking).getByRole("button", { name: "Mark as read" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not update your notifications. Try again.");
      expect(within(booking).getByText("Unread")).toBeInTheDocument();
    });

    it("says so when marking all fails, and leaves them unread", async () => {
      open({ [ALL]: reply(500, {}) });

      await userEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not update your notifications. Try again.");
      expect(screen.getAllByText("Unread")).toHaveLength(2);
    });
  });

  describe("selecting one", () => {
    it("AC5: opens what it is about, marking it read first", async () => {
      const api = open({ [one("n2")]: { id: "n2", isRead: true } });

      await userEvent.click(within(await item("Booking needs review")).getByRole("link", { name: "Booking needs review" }));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/events/EVT-000071/venue"));
      expect(api.sent(one("n2")).map((c) => c.body)).toEqual([{ isRead: true }]);
    });

    it("AC5: opens a notification that is already read without marking it again", async () => {
      const title = "Equipment out of service - reservation needs review";
      const api = open();

      await userEvent.click(within(await item(title)).getByRole("link", { name: title }));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/events/EVT-000072/equipment"));
      expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    });

    it("still opens it when marking it read fails - reading it matters more", async () => {
      open({ [one("n2")]: reply(500, {}) });

      await userEvent.click(within(await item("Booking needs review")).getByRole("link", { name: "Booking needs review" }));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/events/EVT-000071/venue"));
    });
  });
});

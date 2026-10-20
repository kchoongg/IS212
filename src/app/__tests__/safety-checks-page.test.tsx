// @vitest-environment jsdom
//
// SPM-85: the Safety Officer's Safety Checks page - the events waiting for an
// Operational Safety Check. Its <Table> renders each row twice (desktop table
// and mobile cards), so row assertions look inside the table.

import { describe, it, expect } from "vitest";
import SafetyChecksPage from "@/app/safety-checks/page";
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

const table = () => screen.findByRole("table");

function awaiting(overrides: Record<string, unknown> = {}) {
  return {
    id: "e41",
    sequenceNumber: 41,
    title: "Harbour Safety Forum",
    status: "safety_review",
    // 09:00-17:00 in Singapore.
    startsAt: "2027-06-14T01:00:00.000Z",
    endsAt: "2027-06-14T09:00:00.000Z",
    expectedAttendance: 200,
    organisation: { name: "Meridian Financial Group" },
    submittedAt: "2026-10-10T02:00:00.000Z",
    submittedBy: "Daniel Tan",
    ...overrides,
  };
}

describe("Safety Checks (SPM-85)", () => {
  it("[SPM-22][AC4] sends an anonymous visitor to log in, remembering where they were going", async () => {
    setRoute("/safety-checks");
    mockApi(signedOut());

    render(<SafetyChecksPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fsafety-checks"));
  });

  // AC8: users in other roles cannot perform Safety Officer actions.
  it.each(ROLES.filter((role) => role !== "safety_officer"))(
    "[SPM-85][AC8] refuses %s, and never asks for the list",
    async (role) => {
      const api = mockApi(signedInAs(role));

      render(<SafetyChecksPage />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("You do not have access to this");
      expect(alert).toHaveTextContent(
        "The Operational Safety Check is the Safety Officer's role. You can still see the events you are involved in from your Dashboard."
      );
      expect(api.sent("GET /api/safety-checks")).toHaveLength(0);
    }
  );

  it("[SPM-87][AC1] lists each event with its client, time, attendance and who submitted it when", async () => {
    mockApi({ ...signedInAs("safety_officer"), "GET /api/safety-checks": [awaiting()] });

    render(<SafetyChecksPage />);

    expect(await screen.findByRole("heading", { name: "Safety Checks" })).toBeInTheDocument();
    const cells = within(await table()).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Harbour Safety ForumEVT-000041",
      "Meridian Financial Group",
      "14 Jun 2027, 09:00–17:00",
      "200",
      "10 Oct 2026 by Daniel Tan",
    ]);
  });

  it("[SPM-87][AC2] links each event to its Overview, where the review information is", async () => {
    mockApi({ ...signedInAs("safety_officer"), "GET /api/safety-checks": [awaiting()] });

    render(<SafetyChecksPage />);

    expect(within(await table()).getByRole("link", { name: "Harbour Safety Forum" })).toHaveAttribute(
      "href",
      "/events/EVT-000041"
    );
  });

  it("[SPM-87][AC1] copes with an event that has no title, client, attendance or recorded submission", async () => {
    mockApi({
      ...signedInAs("safety_officer"),
      "GET /api/safety-checks": [
        awaiting({ title: null, organisation: null, expectedAttendance: null, submittedAt: null, submittedBy: null }),
      ],
    });

    render(<SafetyChecksPage />);
    const cells = within(await table()).getAllByRole("cell");

    expect(cells[0]).toHaveTextContent("Untitled event");
    expect(cells[1]).toHaveTextContent("—");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[4]).toHaveTextContent("—");
  });

  it("[SPM-87][AC1] names the submission date alone when who submitted it is not known", async () => {
    mockApi({ ...signedInAs("safety_officer"), "GET /api/safety-checks": [awaiting({ submittedBy: null })] });

    render(<SafetyChecksPage />);
    const cells = within(await table()).getAllByRole("cell");

    expect(cells[4]).toHaveTextContent(/^10 Oct 2026$/);
  });

  it("[SPM-87][AC1] says so when there is nothing to check", async () => {
    mockApi({ ...signedInAs("safety_officer"), "GET /api/safety-checks": [] });

    render(<SafetyChecksPage />);

    expect(await screen.findByText("Nothing to check")).toBeInTheDocument();
    expect(screen.getByText("Events appear here once a coordinator submits them for a safety check.")).toBeInTheDocument();
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("safety_officer"), "GET /api/safety-checks": reply(401, {}) });

    render(<SafetyChecksPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fsafety-checks"));
  });

  it("[SPM-87] shows a general error when the request fails without a reason", async () => {
    mockApi({ ...signedInAs("safety_officer"), "GET /api/safety-checks": () => Promise.reject("offline") });
    render(<SafetyChecksPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("[SPM-87] shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("safety_officer"), "GET /api/safety-checks": reply(500, {}) });
    render(<SafetyChecksPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the safety checks.");

    api.on("GET /api/safety-checks", [awaiting()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(within(await table()).getByRole("link", { name: "Harbour Safety Forum" })).toBeInTheDocument();
  });
});

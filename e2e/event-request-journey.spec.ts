import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Role } from "../src/lib/roles";
import { ACCOUNTS, logInAs } from "./accounts";

// Smoke: the request journey every event starts with, across the four roles
// that take part (SPM-21, SPM-30, SPM-28, then SPM-42 and SPM-43 for its
// venue). Each role has its own browser session, as each person has their own
// laptop.

async function sessionFor(browser: Browser, role: Role): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await logInAs(page, role);
  return page;
}

/// A day of its own for each run - one of about 25,000 from 2030 on - so a
/// local re-run does not find the room an earlier run booked already taken
/// for its times. (CI's database is new for every run.)
function dayForThisRun(): string {
  const dayNumber = Math.floor(Math.random() * 25_000);
  return new Date(Date.UTC(2030, 0, 1) + dayNumber * 86_400_000).toISOString().slice(0, 10);
}

test("an organiser's request is assigned a coordinator by the Ops Manager, approved, then booked into a venue", async ({
  browser,
}) => {
  // Unique per run, so the test can find its own event on a database that
  // earlier local runs have already added to.
  const title = `E2E Harbour Summit ${Date.now()}`;
  const day = dayForThisRun();

  // The organiser submits a new request.
  const organiser = await sessionFor(browser, "organiser");
  await organiser.getByRole("link", { name: "New event request" }).click();
  await organiser.getByLabel("Event name").fill(title);
  await organiser.getByLabel("Type of event").selectOption("conference");
  await organiser.getByLabel("Starts at").fill(`${day}T09:00`);
  await organiser.getByLabel("Ends at").fill(`${day}T17:00`);
  await organiser.getByLabel("Expected attendance").fill("80");
  await organiser.getByRole("button", { name: "Submit request" }).click();

  await expect(organiser).toHaveURL(/\/events\/EVT-\d{6}$/);
  const eventPath = new URL(organiser.url()).pathname;
  await expect(organiser.getByRole("heading", { level: 1, name: title })).toBeVisible();

  // The Ops Manager assigns it to a coordinator, which puts it under review.
  const opsManager = await sessionFor(browser, "ops_manager");
  await opsManager.goto(eventPath);
  await expect(opsManager.getByRole("heading", { name: "Assign a coordinator" })).toBeVisible();
  await opsManager.getByRole("combobox", { name: `Assign to — ${title}` }).selectOption({ label: ACCOUNTS.coordinator.name });
  await opsManager.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(
    opsManager.getByText(`${ACCOUNTS.coordinator.name} is now the coordinator. The event has moved to Under review.`)
  ).toBeVisible();

  // The assigned coordinator reviews it and approves it.
  const coordinator = await sessionFor(browser, "coordinator");
  await coordinator.goto(eventPath);
  await coordinator.getByRole("link", { name: "Review request" }).click();
  await coordinator.getByRole("radio", { name: /Approve/ }).check();
  await coordinator.getByRole("button", { name: "Approve request" }).click();
  await coordinator.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(coordinator.getByText("Request approved")).toBeVisible();

  // The organiser sees the decision on their event.
  await organiser.reload();
  await expect(organiser.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(organiser.getByText("Approved", { exact: true }).first()).toBeVisible();

  // The coordinator requests a venue from the Venue tab, which opens already
  // listing venues checked against the event's attendance. A named seed venue
  // whose opening hours fit 09:00-17:00 with its setup and turnaround (08:00
  // to 22:00, 60 and 30 minutes) - not simply the first one listed, which may
  // open too late for this event's setup. Each venue is a card; this one is
  // the innermost element holding its name and a Request booking link. The
  // form starts on the event's times and attendance, so it is sent as is; as
  // the event's first booking request it begins planning, which the
  // coordinator confirms.
  await coordinator.goto(`${eventPath}/venue`);
  await coordinator
    .locator("div")
    .filter({ hasText: "Marina Auditorium (MAR-AUD)" })
    .filter({ has: coordinator.getByRole("link", { name: "Request booking" }) })
    .last()
    .getByRole("link", { name: "Request booking" })
    .click();
  await expect(coordinator.getByRole("heading", { level: 1, name: "Request a venue booking" })).toBeVisible();
  await coordinator.getByRole("button", { name: "Submit request" }).click();
  await coordinator.getByRole("dialog").getByRole("button", { name: "Continue" }).click();
  await expect(coordinator.getByText("Booking request sent to Venue Staff.")).toBeVisible();
  await expect(coordinator.getByText("Planning has started")).toBeVisible();

  // Venue Staff find the request on Booking Requests and approve it. Each
  // request is a card; this one is the innermost element holding both this
  // event's reference and an Approve button.
  const reference = eventPath.split("/").pop()!;
  const venueStaff = await sessionFor(browser, "venue_staff");
  await venueStaff.goto("/bookings");
  const request = venueStaff
    .locator("div")
    .filter({ has: venueStaff.getByRole("link", { name: reference, exact: true }) })
    .filter({ has: venueStaff.getByRole("button", { name: "Approve", exact: true }) })
    .last();
  await request.getByRole("button", { name: "Approve", exact: true }).click();
  await venueStaff.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(venueStaff.getByText("Booking approved")).toBeVisible();
  await expect(venueStaff.getByText(/is now Approved — the room is booked\./)).toBeVisible();
  // Decided, so it has left the list of requests waiting for a decision.
  await expect(venueStaff.getByRole("link", { name: reference, exact: true })).toHaveCount(0);
});

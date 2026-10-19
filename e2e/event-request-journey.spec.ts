import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Role } from "../src/lib/roles";
import { ACCOUNTS, logInAs } from "./accounts";

// The core journey, end to end: an organiser's request through review, venue,
// equipment, registration setup, the Operational Safety Check and
// confirmation, until an attendee registers. Every role takes part, each in
// its own browser session, as each person has their own laptop. Stories in
// order: SPM-25, SPM-30, SPM-28, SPM-42/43, SPM-47/49, SPM-64, SPM-86/87,
// SPM-34, SPM-51.

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

/// Today's date in Singapore, the browser's time zone (playwright.config.ts).
function todayInSingapore(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

test("[SPM-25][AC1][AC2] [SPM-30][AC1] [SPM-28][AC4] [SPM-54][AC1] [SPM-42][AC7] [SPM-43][AC3] [SPM-47][AC1] [SPM-49][AC1] [SPM-64][AC1] [SPM-86][AC1] [SPM-87][AC3] [SPM-34][AC5] [SPM-51][AC2] a request goes from submission to Confirmed - venue, equipment, registration and safety check - and an attendee registers", async ({
  browser,
}) => {
  // Seven roles and about forty steps: well past the 30s default, which is
  // for a single screen's test. Each step still waits on its own condition.
  test.setTimeout(150_000);
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
  // A room layout, so a registration capacity can be measured against it
  // later (SPM-64: theatre seats 220 here).
  await coordinator.getByLabel("Room layout").selectOption({ label: "Theatre" });
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

  // The coordinator asks for one presentation clicker on the Equipment tab
  // (SPM-47)...
  await coordinator.goto(`${eventPath}/equipment`);
  await coordinator.getByLabel("Equipment", { exact: true }).selectOption({ label: "Presentation Clicker — IT" });
  await coordinator.getByLabel("Quantity", { exact: true }).fill("1");
  await coordinator.getByRole("button", { name: "Add", exact: true }).click();
  await expect(coordinator.getByText("Presentation Clicker", { exact: true })).toBeVisible();

  // ...and Technical Support reserve it (SPM-49).
  const techSupport = await sessionFor(browser, "tech_support");
  await techSupport.goto(`/equipment/requests/${reference}`);
  await techSupport.getByRole("button", { name: "Reserve", exact: true }).click();
  await expect(techSupport.getByText("Reservation saved: 1 reserved.")).toBeVisible();

  // The coordinator turns registration on: 50 places, open from today until
  // an hour before the event (SPM-64). Set before the safety check, as an
  // incomplete setup would hold up confirmation.
  await coordinator.goto(eventPath);
  await coordinator.getByRole("button", { name: "Change registration settings" }).click();
  await coordinator.getByLabel("Attendees need to register for this event").check();
  await coordinator.getByLabel("Registration capacity").fill("50");
  await coordinator.getByLabel("Registration opens").fill(`${todayInSingapore()}T00:00`);
  await coordinator.getByLabel("Registration closes").fill(`${day}T08:00`);
  await coordinator.getByRole("button", { name: "Save registration settings" }).click();
  await expect(coordinator.getByText("Registration settings saved.")).toBeVisible();

  // Venue and equipment are both held, so it can go for its Operational
  // Safety Check (SPM-86)...
  await coordinator.getByRole("button", { name: "Submit for safety check" }).click();
  await coordinator.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    coordinator.getByText("The event has been submitted for a safety check. The Safety Officer has been notified.")
  ).toBeVisible();

  // ...which the Safety Officer approves (SPM-87).
  const safetyOfficer = await sessionFor(browser, "safety_officer");
  await safetyOfficer.goto(eventPath);
  await safetyOfficer.getByRole("button", { name: "Record safety decision" }).click();
  const decision = safetyOfficer.getByRole("dialog");
  await decision.getByRole("radio", { name: "Approve", exact: true }).check();
  await decision.getByRole("button", { name: "Record decision" }).click();
  await expect(safetyOfficer.getByText("Safety check approved. The coordinator has been notified.")).toBeVisible();

  // The coordinator confirms it (SPM-34).
  await coordinator.reload();
  await coordinator.getByRole("button", { name: "Confirm event", exact: true }).click();
  await coordinator.getByRole("dialog").getByRole("button", { name: "Confirm event", exact: true }).click();
  await expect(coordinator.getByText("The event is confirmed. The organiser can now see the arrangements.")).toBeVisible();

  // Now Confirmed and open for registration, an attendee finds it on Browse
  // Events and registers (SPM-51).
  const attendee = await sessionFor(browser, "attendee");
  await attendee.goto("/browse");
  // Its row in the table (the list shown instead on a phone is hidden here).
  await attendee.getByRole("row").filter({ hasText: title }).click();
  await expect(attendee).toHaveURL(new RegExp(`${eventPath}$`));
  await attendee.getByRole("button", { name: "Register", exact: true }).click();
  await expect(attendee.getByText("You're registered for this event.")).toBeVisible();
});

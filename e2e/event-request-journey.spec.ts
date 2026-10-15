import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Role } from "../src/lib/roles";
import { ACCOUNTS, logInAs } from "./accounts";

// Smoke: the request journey every event starts with, across the three roles
// that take part (SPM-21, SPM-30, SPM-28). Each role has its own browser
// session, as each person has their own laptop.

async function sessionFor(browser: Browser, role: Role): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await logInAs(page, role);
  return page;
}

test("an organiser's request is assigned a coordinator by the Ops Manager, then approved", async ({ browser }) => {
  // Unique per run, so the test can find its own event on a database that
  // earlier local runs have already added to.
  const title = `E2E Harbour Summit ${Date.now()}`;

  // The organiser submits a new request.
  const organiser = await sessionFor(browser, "organiser");
  await organiser.getByRole("link", { name: "New event request" }).click();
  await organiser.getByLabel("Event name").fill(title);
  await organiser.getByLabel("Type of event").selectOption("conference");
  await organiser.getByLabel("Starts at").fill("2030-03-04T09:00");
  await organiser.getByLabel("Ends at").fill("2030-03-04T17:00");
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
});

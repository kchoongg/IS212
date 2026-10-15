import { expect, test } from "@playwright/test";
import { NAV_BY_ROLE, ROLES } from "../src/lib/roles";
import { ACCOUNTS, logInAs } from "./accounts";

// Smoke: every role can log in and gets its own sidebar. The expected links
// come from NAV_BY_ROLE, so a sidebar change updates this test with it.

for (const role of ROLES) {
  test(`${role} logs in and lands on their dashboard with their own sidebar`, async ({ page }) => {
    await logInAs(page, role);

    const sidebar = page.getByRole("navigation", { name: "Main" });
    // Each link starts with its label; Notifications may be followed by an
    // unread count.
    await expect(sidebar.getByRole("link")).toHaveText(NAV_BY_ROLE[role].map((item) => new RegExp(`^${item.label}`)));
  });
}

test("a visitor who is not logged in is sent to log in, and brought back after", async ({ page }) => {
  await page.goto("/events");

  await expect(page).toHaveURL(/\/login\?next=%2Fevents$/);
  await page.getByLabel("Email").fill(ACCOUNTS.coordinator.email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/events$/);
});

test("a wrong password is refused, and the visitor stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNTS.coordinator.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

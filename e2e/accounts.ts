import { expect, type Page } from "@playwright/test";
import type { Role } from "../src/lib/roles";

/// One seeded account per role (prisma/seed.ts). Every seeded account's
/// password is the same.
export const ACCOUNTS: Record<Role, { email: string; name: string }> = {
  organiser: { email: "rachel.ng@meridianfina.com", name: "Rachel Ng" },
  coordinator: { email: "daniel.tan@connectsphere.com", name: "Daniel Tan" },
  venue_staff: { email: "marcus.wong@connectsphere.com", name: "Marcus Wong" },
  tech_support: { email: "kenji.sato@connectsphere.com", name: "Kenji Sato" },
  attendee: { email: "lee.wei.ming@example.com", name: "Lee Wei Ming" },
  ops_manager: { email: "grace.lim@connectsphere.com", name: "Grace Lim" },
  safety_officer: { email: "hana.yusof@connectsphere.com", name: "Hana Yusof" },
};
export const PASSWORD = "password123";

/// Logs in through the real login page, as a person would, and waits until
/// the app has taken them to their dashboard.
export async function logInAs(page: Page, role: Role) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ACCOUNTS[role].email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

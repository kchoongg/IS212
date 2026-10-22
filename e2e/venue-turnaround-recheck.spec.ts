import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Role } from "../src/lib/roles";
import { ACCOUNTS, PASSWORD, logInAs } from "./accounts";

// Re-check bookings when a venue's turnaround time changes (SPM-80 AC1, AC2,
// AC4, AC5; SPM-80-TC02 and TC03).
//
// The venue, the two Approved events and their approved bookings are set up
// through the API - a room of this run's own, so nothing else is flagged and a
// local re-run does not collide with an earlier one. What is under test happens
// in the browser: Venue Staff raise the turnaround time and are told which
// bookings now clash, and the coordinator finds both flagged, each naming the
// other.

const SINGAPORE = "+08:00";

/// A day of its own for each run, as in the other specs.
function dayForThisRun(): string {
  const dayNumber = Math.floor(Math.random() * 25_000);
  return new Date(Date.UTC(2030, 0, 1) + dayNumber * 86_400_000).toISOString().slice(0, 10);
}

async function tokenFor(request: APIRequestContext, role: Role): Promise<string> {
  const res = await request.post("/api/auth/login", { data: { email: ACCOUNTS[role].email, password: PASSWORD } });
  expect(res.status()).toBe(200);
  return (await res.json()).token;
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });

/// An event for `start`-`end` on `day`, submitted, assigned to the coordinator
/// and approved, with an approved booking of `venueId` for exactly its times.
/// Returns its reference.
async function bookedEvent(
  request: APIRequestContext,
  { title, day, start, end, venueId }: { title: string; day: string; start: string; end: string; venueId: string }
): Promise<string> {
  const [organiser, opsManager, coordinator, venueStaff] = await Promise.all(
    (["organiser", "ops_manager", "coordinator", "venue_staff"] as const).map((role) => tokenFor(request, role))
  );

  const created = await request.post("/api/events", {
    headers: as(organiser),
    data: {
      title,
      category: "meeting",
      startsAt: new Date(`${day}T${start}:00${SINGAPORE}`).toISOString(),
      endsAt: new Date(`${day}T${end}:00${SINGAPORE}`).toISOString(),
      expectedAttendance: 30,
    },
  });
  expect(created.status()).toBe(201);
  const reference = `EVT-${String((await created.json()).sequenceNumber).padStart(6, "0")}`;

  expect((await request.patch(`/api/events/${reference}`, { headers: as(organiser), data: { status: "submitted" } })).status()).toBe(200);
  const queue = await (await request.get("/api/assignments", { headers: as(opsManager) })).json();
  const daniel = queue.coordinators.find((c: { fullName: string }) => c.fullName === ACCOUNTS.coordinator.name);
  expect(
    (await request.put(`/api/events/${reference}/coordinator`, { headers: as(opsManager), data: { coordinatorId: daniel.id } })).status()
  ).toBe(200);
  expect((await request.patch(`/api/events/${reference}`, { headers: as(coordinator), data: { status: "approved" } })).status()).toBe(200);

  const requested = await request.post(`/api/events/${reference}/venue-bookings`, {
    headers: as(coordinator),
    data: { venueId, day, startTime: start, endTime: end, purpose: "Main programme" },
  });
  expect(requested.status()).toBe(201);
  const bookingId = (await requested.json()).id;
  const decided = await request.patch(`/api/venue-bookings/${bookingId}`, {
    headers: as(venueStaff),
    data: { decision: "approve" },
  });
  expect(decided.status()).toBe(200);
  return reference;
}

test("[SPM-80][AC1][AC2][AC4][AC5] raising a venue's turnaround time flags both bookings that now overlap, each naming the other", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const day = dayForThisRun();
  const stamp = String(Date.now()).slice(-8);

  // A room of this run's own, with no setup or turnaround time.
  const venueStaff = await tokenFor(request, "venue_staff");
  const venueName = `E2E Turnaround Room ${stamp}`;
  const created = await request.post("/api/venues", {
    headers: as(venueStaff),
    data: {
      code: `E2E80-${stamp}`,
      name: venueName,
      building: "E2E Tower",
      maxCapacity: 40,
      opensAt: "07:00",
      closesAt: "23:00",
      setupMinutes: 0,
      teardownMinutes: 0,
      layouts: [{ layoutName: "classroom", capacity: 40 }],
    },
  });
  expect(created.status()).toBe(201);
  const venueId = (await created.json()).id;

  // Half an hour apart: no clash until the turnaround passes 30 minutes.
  const morningTitle = `E2E Morning Seminar ${stamp}`;
  const lunchTitle = `E2E Lunch Forum ${stamp}`;
  const morning = await bookedEvent(request, { title: morningTitle, day, start: "10:00", end: "12:00", venueId });
  const lunch = await bookedEvent(request, { title: lunchTitle, day, start: "12:30", end: "14:00", venueId });

  // Venue Staff raise the turnaround time to 45 minutes.
  await logInAs(page, "venue_staff");
  await page.goto(`/venues/${venueId}/edit`);
  const turnaround = page.getByLabel("Turnaround time (minutes)");
  await expect(turnaround).toHaveValue("0");
  await expect(turnaround).toHaveAccessibleDescription(/re-checks this venue's upcoming bookings/);
  await turnaround.fill("45");
  await page.getByRole("button", { name: "Save changes" }).click();

  const result = page.getByRole("alert").filter({ hasText: "flagged for review" });
  await expect(result).toContainText("Changes saved — 2 bookings flagged for review, coordinators notified");
  await expect(result.getByRole("listitem")).toHaveCount(2);
  await expect(result).toContainText(`${morningTitle}: with the venue's new setup or turnaround time, this booking overlaps another booking (clashes with ${lunch} ${lunchTitle})`);
  await expect(result).toContainText(`${lunchTitle}: with the venue's new setup or turnaround time, this booking overlaps another booking (clashes with ${morning} ${morningTitle})`);

  // The coordinator finds both flagged, still Approved, each naming the other.
  await page.getByRole("button", { name: "Log out" }).click();
  await logInAs(page, "coordinator");
  await page.goto("/flagged?tab=venue");

  // Each entry names the other's title, so find each by its own event link.
  const entryFor = (title: string) =>
    page.getByRole("listitem").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  const morningItem = entryFor(morningTitle);
  await expect(morningItem).toContainText("Approved");
  await expect(morningItem).toContainText("Flagged because: with the venue's new setup or turnaround time, this booking overlaps another booking");
  await expect(morningItem).toContainText(`${venueName} is already booked for ${lunch} ${lunchTitle} on `);
  await expect(morningItem.getByRole("button", { name: "Keep booking" })).toHaveCount(0);

  const lunchItem = entryFor(lunchTitle);
  await expect(lunchItem).toContainText("Approved");
  await expect(lunchItem).toContainText(`${venueName} is already booked for ${morning} ${morningTitle} on `);

  // And is told, with the reason.
  await page.goto("/notifications");
  await expect(page.getByText(`now overlaps the booking for ${lunch} ${lunchTitle}`)).toBeVisible();
  await expect(page.getByText(`now overlaps the booking for ${morning} ${morningTitle}`)).toBeVisible();
});

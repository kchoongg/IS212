import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Role } from "../src/lib/roles";
import { ACCOUNTS, PASSWORD, logInAs } from "./accounts";

// Conflict: a second event cannot book a room another event already holds for
// the same time (SPM-44 AC4, AC5, AC9; SPM-44-TC04).
//
// The two Approved events are set up through the API - submitting, assigning
// and approving by hand is the journey spec's job, and repeating it here would
// only make this slower and more fragile. What is under test happens in the
// browser: the coordinator asks for the taken room and is refused, with the
// event in its way named.

const SINGAPORE = "+08:00";

/// A day of its own for each run, as in the journey spec, so a local re-run
/// does not collide with the rooms an earlier run took.
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

/// An event submitted by the organiser, assigned to the coordinator by the Ops
/// Manager and approved by the coordinator - returns its reference.
async function approvedEvent(request: APIRequestContext, title: string, day: string): Promise<string> {
  const [organiser, opsManager, coordinator] = await Promise.all(
    (["organiser", "ops_manager", "coordinator"] as const).map((role) => tokenFor(request, role))
  );

  const created = await request.post("/api/events", {
    headers: as(organiser),
    data: {
      title,
      category: "conference",
      startsAt: new Date(`${day}T09:00:00${SINGAPORE}`).toISOString(),
      endsAt: new Date(`${day}T17:00:00${SINGAPORE}`).toISOString(),
      expectedAttendance: 80,
    },
  });
  expect(created.status()).toBe(201);
  const reference = `EVT-${String((await created.json()).sequenceNumber).padStart(6, "0")}`;

  const submitted = await request.patch(`/api/events/${reference}`, { headers: as(organiser), data: { status: "submitted" } });
  expect(submitted.status()).toBe(200);

  const queue = await (await request.get("/api/assignments", { headers: as(opsManager) })).json();
  const daniel = queue.coordinators.find((c: { fullName: string }) => c.fullName === ACCOUNTS.coordinator.name);
  const assigned = await request.put(`/api/events/${reference}/coordinator`, {
    headers: as(opsManager),
    data: { coordinatorId: daniel.id },
  });
  expect(assigned.status()).toBe(200);

  const approved = await request.patch(`/api/events/${reference}`, { headers: as(coordinator), data: { status: "approved" } });
  expect(approved.status()).toBe(200);
  return reference;
}

test("[SPM-44][AC5][AC9] a second event's request for a room already held at that time is refused, naming the event that holds it", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const day = dayForThisRun();
  const stamp = Date.now();
  const firstTitle = `E2E Holding Forum ${stamp}`;
  const first = await approvedEvent(request, firstTitle, day);
  const second = await approvedEvent(request, `E2E Late Forum ${stamp}`, day);

  // The first event takes Marina Auditorium for 09:00-17:00: a pending
  // request, which holds the room until Venue Staff decide (#41).
  const coordinator = await tokenFor(request, "coordinator");
  const venues = await (await request.get("/api/venues", { headers: as(coordinator) })).json();
  const auditorium = venues.find((v: { code: string }) => v.code === "MAR-AUD");
  const held = await request.post(`/api/events/${first}/venue-bookings`, {
    headers: as(coordinator),
    data: { venueId: auditorium.id, day, startTime: "09:00", endTime: "17:00", purpose: "Main programme" },
  });
  expect(held.status()).toBe(201);

  // The coordinator asks for the same room and times for the second event,
  // from the request form (as from a Venue tab opened before the first
  // request was made).
  await logInAs(page, "coordinator");
  await page.goto(`/events/${second}/booking/new?venue=${auditorium.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Request a venue booking" })).toBeVisible();
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "is on hold" })).toHaveText(
    new RegExp(`^Marina Auditorium is on hold for ${first} ${firstTitle} on `)
  );
  await expect(page.getByText("Booking request sent to Venue Staff.")).toHaveCount(0);
});

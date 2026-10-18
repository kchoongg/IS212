// Fresh rows for one integration test, and a way to call a route as a user.
//
// Every test builds its own small world in beforeEach - a client
// organisation, an organiser, a coordinator, a Venue Staff member and a venue,
// all with names no other test or seed row uses - and deletes it in
// afterEach. Nothing is read from or written to the seed's own rows, so a test
// gives the same answer on a freshly seeded database and on one that earlier
// runs or test passes have used.
//
//   let world: World;
//   beforeEach(async () => { world = await createWorld(); });
//   afterEach(async () => { await destroyWorld(world); });

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";
import { eventReference } from "@/lib/format";

interface Person {
  id: string;
  role: string;
}

export interface World {
  organisationId: string;
  organiser: Person;
  coordinator: Person;
  venueStaff: Person;
  venue: { id: string; name: string };
  /// Every event made with createEvent(), so destroyWorld() can remove them.
  eventIds: string[];
}

export interface TestEvent {
  id: string;
  /// "EVT-000123", the id the routes take in their path.
  reference: string;
  title: string;
}

/// Wall-clock time in Singapore, where every venue is (discussion #36).
export function sgt(day: string, time: string): Date {
  return new Date(`${day}T${time}:00+08:00`);
}

export async function createWorld(): Promise<World> {
  const tag = randomUUID().slice(0, 8);
  const organisation = await prisma.organisation.create({ data: { name: `Integration Client ${tag}` } });
  const person = (role: string, name: string, organisationId: string | null = null) =>
    prisma.user.create({
      data: {
        email: `integration-${role}-${tag}@example.test`,
        // Never used: tests sign their own sessions instead of logging in.
        passwordHash: "integration-test-no-login",
        fullName: `${name} ${tag}`,
        role,
        organisationId,
      },
      select: { id: true, role: true },
    });

  const [organiser, coordinator, venueStaff] = await Promise.all([
    person("organiser", "Integration Organiser", organisation.id),
    person("coordinator", "Integration Coordinator"),
    person("venue_staff", "Integration Venue Staff"),
  ]);
  const venue = await prisma.venue.create({
    data: {
      code: `INT-${tag}`,
      name: `Integration Room ${tag}`,
      building: "Integration Tower",
      maxCapacity: 200,
      // No setup or turnaround, so a booking holds the room for exactly its
      // own times and each test can say precisely which times overlap.
      setupMinutes: 0,
      teardownMinutes: 0,
    },
    select: { id: true, name: true },
  });

  return { organisationId: organisation.id, organiser, coordinator, venueStaff, venue, eventIds: [] };
}

/// An Approved event, assigned to the world's coordinator - the state in
/// which a venue booking can first be requested (SPM-42).
export async function createEvent(
  world: World,
  { title, day, start, end }: { title: string; day: string; start: string; end: string }
): Promise<TestEvent> {
  const event = await prisma.event.create({
    data: {
      title,
      category: "conference",
      organiserId: world.organiser.id,
      organisationId: world.organisationId,
      coordinatorId: world.coordinator.id,
      status: "approved",
      startsAt: sgt(day, start),
      endsAt: sgt(day, end),
      expectedAttendance: 50,
    },
    select: { id: true, sequenceNumber: true },
  });
  world.eventIds.push(event.id);
  return { id: event.id, reference: eventReference(event.sequenceNumber), title };
}

/// Removes everything createWorld() and createEvent() made. Deleting an event
/// takes its bookings, status history and notifications with it (onDelete:
/// Cascade); the venue and the people go after, once nothing points at them.
export async function destroyWorld(world: World | undefined) {
  if (!world) return;
  await prisma.event.deleteMany({ where: { id: { in: world.eventIds } } });
  await prisma.venue.deleteMany({ where: { id: world.venue.id } });
  await prisma.user.deleteMany({
    where: { id: { in: [world.organiser.id, world.coordinator.id, world.venueStaff.id] } },
  });
  await prisma.organisation.deleteMany({ where: { id: world.organisationId } });
}

/// A request from `as`, signed in with a real session, as the route handler
/// receives it.
export function req(method: string, path: string, as: Person, body?: unknown): NextRequest {
  const headers: Record<string, string> = { authorization: `Bearer ${signSession({ id: as.id, role: as.role })}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/// The second argument of a dynamic route handler.
export function params<T extends Record<string, string>>(values: T): { params: Promise<T> } {
  return { params: Promise.resolve(values) };
}

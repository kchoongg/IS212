// The route side of the permission model: turn a request into an Actor, and
// turn a refusal into the right HTTP response.
//
// src/lib/permissions.ts holds the rules and stays pure. This file is the one
// place that touches the request and the database, so a route reads as:
//
//   const actor = await getActor(req);
//   if (!actor) return unauthenticated();
//   if (!can(actor.role, "venue:manage")) return forbidden();

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getSession } from "./auth";
import { parseEventReference } from "./format";
import type { Actor } from "./permissions";

/**
 * Verifies the session and loads the parts of the user that access decisions
 * depend on.
 *
 * The JWT carries only `{ id, role }`, and deliberately keeps doing so: a
 * token is issued for eight hours, so a role change or a deactivated account
 * baked into it would keep working until it expired. One indexed lookup per
 * request buys the current answer instead of the answer at login time - and
 * `organisationId`, which is not in the token at all and is what scopes an
 * organiser to their own client (briefing §8b).
 *
 * Returns null when there is no valid session, when the user no longer
 * exists, or when the account has been deactivated.
 */
export async function getActor(req: NextRequest): Promise<Actor | null> {
  const session = getSession(req);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, role: true, organisationId: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return { id: user.id, role: user.role, organisationId: user.organisationId };
}

/// 401: we do not know who you are. The frontend reads this as "send them to
/// the login screen" (see useCurrentUser / authedFetch).
export function unauthenticated() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

/// 403: we know who you are, and you may not do this. UI_DESIGN.md §7.4.
export function forbidden(message = "You do not have access to this") {
  return NextResponse.json({ error: message }, { status: 403 });
}

/// 404 used as a refusal. For records the user may not even know exist - an
/// organiser's unsubmitted draft, an event belonging to another client - a
/// 403 would confirm the record is real. Say "not found" and mean it.
export function hidden() {
  return NextResponse.json({ error: "Event not found" }, { status: 404 });
}

/**
 * Turns the `[id]` route segment under /events - now a reference like
 * "EVT-000123", not the underlying UUID - into the event's real `id`, for
 * routes that only need it to scope a foreign key (e.g. EquipmentRequest.
 * eventId) rather than the full row. Returns null for a malformed reference
 * or one that matches no event; callers should treat either the same way
 * (hidden(), not a 400) since a route segment a user typed or bookmarked
 * wrong looks identical to one that no longer exists.
 */
export async function resolveEventId(reference: string): Promise<string | null> {
  const sequenceNumber = parseEventReference(reference);
  if (sequenceNumber === null) return null;
  const event = await prisma.event.findUnique({ where: { sequenceNumber }, select: { id: true } });
  return event?.id ?? null;
}

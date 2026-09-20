// Writes a multi-session event's sessions and each session's equipment
// requests. Shared by POST /api/events (create) and PATCH /api/events/[id]
// (edit a draft) so the two cannot disagree about what a session's equipment
// reservation looks like. Takes the caller's transaction client, the same way
// notifications.ts does: a session written for an event whose create then
// fails would be an orphan.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionInput } from "@/lib/validation";
import { equipmentWindow } from "@/lib/eventSessions";

/// Two statements however many sessions there are (createMany for the
/// sessions, createMany for all their equipment), not one per session: this
/// runs inside an interactive transaction with a timeout, against a database
/// that can cold-start slowly.
///
/// Session ids are generated here rather than by the database because
/// createMany does not return the rows it inserted, and the equipment rows
/// need their session's id.
export async function writeSessions(
  tx: Prisma.TransactionClient,
  eventId: string,
  requestedBy: string,
  sessions: SessionInput[]
) {
  const rows = sessions.map((session) => ({ id: randomUUID(), session }));

  await tx.eventSession.createMany({
    data: rows.map(({ id, session }) => ({
      id,
      eventId,
      label: session.label || null,
      startsAt: new Date(session.startsAt),
      endsAt: new Date(session.endsAt),
      expectedAttendance: session.expectedAttendance,
      preferredLayout: session.preferredLayout || null,
    })),
  });

  const equipment = rows.flatMap(({ id, session }) => {
    // Each session's reservation window is its OWN times plus load-in/out, not
    // the event's - that is what makes a two-day event's Day 2 kit not block
    // Day 1's, and what Technical Support checks availability against.
    const window = equipmentWindow(new Date(session.startsAt), new Date(session.endsAt));
    return (session.equipment ?? []).map((item) => ({
      eventId,
      sessionId: id,
      equipmentId: item.equipmentId,
      quantityRequested: item.quantityRequested,
      technicalRequirements: item.technicalRequirements,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      requestedBy,
      status: "requested",
    }));
  });
  if (equipment.length > 0) {
    await tx.equipmentRequest.createMany({ data: equipment });
  }
}

/// What the create and edit routes return for an event's sessions: enough for
/// the form to refill itself. Equipment is not nested here - it comes back on
/// the event's own `equipmentRequests`, each carrying its `sessionId`.
export const SESSION_SELECT = {
  id: true,
  label: true,
  startsAt: true,
  endsAt: true,
  expectedAttendance: true,
  preferredLayout: true,
} as const;

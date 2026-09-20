// Multi-session events (SPM-23, class clarification #74: "sessions may have
// different timings and operational requirements, including different venues,
// equipment requirements and attendance limits"). Pure functions over plain
// data, so both API routes and the form share one definition of what a
// session-based event's own start, end and headcount mean.

type DateInput = string | Date;

export interface SessionSchedule {
  startsAt: DateInput;
  endsAt: DateInput;
  expectedAttendance?: number | null;
}

/// Equipment is held wider than the event itself: kit leaves the store before
/// the doors open and comes back after they close. Two hours either side is
/// the default load-in / load-out window; Technical Support adjusts it on
/// review. One definition, because the create and edit routes both use it and
/// a session's window has to match a single-session event's.
export const EQUIPMENT_LOAD_WINDOW_MS = 2 * 60 * 60 * 1000;

export function equipmentWindow(startsAt: Date, endsAt: Date): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(startsAt.getTime() - EQUIPMENT_LOAD_WINDOW_MS),
    endsAt: new Date(endsAt.getTime() + EQUIPMENT_LOAD_WINDOW_MS),
  };
}

/// What the event as a whole looks like once it is split into sessions. The
/// Event row keeps its own startsAt / endsAt / expectedAttendance so every
/// screen that lists events (My events, the dashboard, the coordinator queue)
/// keeps working unchanged - they read these, not the sessions.
///
///   startsAt           earliest session start
///   endsAt             latest session end
///   expectedAttendance the largest single session. A venue has to hold one
///                      session at a time, and the same people usually attend
///                      several, so summing would overstate it. Undefined
///                      when no session gave a figure.
///
/// Returns null for an event with no sessions, so a caller can tell "derive
/// from sessions" from "use the event's own values".
export function deriveEventFromSessions(
  sessions: SessionSchedule[] | null | undefined
): { startsAt: Date; endsAt: Date; expectedAttendance: number | undefined } | null {
  if (!sessions?.length) return null;

  const starts = sessions.map((s) => new Date(s.startsAt).getTime());
  const ends = sessions.map((s) => new Date(s.endsAt).getTime());
  const attendances = sessions
    .map((s) => s.expectedAttendance)
    .filter((n): n is number => typeof n === "number");

  return {
    startsAt: new Date(Math.min(...starts)),
    endsAt: new Date(Math.max(...ends)),
    expectedAttendance: attendances.length ? Math.max(...attendances) : undefined,
  };
}

/// What a request must have before it leaves draft (SPM-23 AC7, SPM-25 AC1).
/// A draft may be incomplete, but anything past draft may not. The SQL design
/// enforced this with a CHECK constraint; Prisma has no equivalent, so the
/// rule lives here.
///
/// Moved out of PATCH /api/events/[id] (SPM-26) so that updating a request
/// that is Under review keeps it as complete as submitting it did.

export interface SubmissionInput {
  title: string | null;
  category: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  expectedAttendance: number | null;
}

/// The fields still missing, by their API names, in form order - empty when
/// the request is complete. `sessions` must be in start order, so "session 2"
/// is the second one the organiser sees.
export function missingSubmissionFields(
  event: SubmissionInput,
  sessions: { expectedAttendance: number | null }[]
): string[] {
  const missing: string[] = [];
  if (!event.title) missing.push("title");
  if (!event.category) missing.push("category");
  if (!event.startsAt) missing.push("startsAt");
  if (!event.endsAt) missing.push("endsAt");
  if (event.expectedAttendance == null) missing.push("expectedAttendance");

  // A multi-session event's own attendance is derived from its sessions (the
  // largest one), so it is non-null as soon as ANY session has a figure -
  // which would let a session with none through. Each session has to be
  // complete in its own right ("each with its own ... expected attendance").
  sessions.forEach((session, i) => {
    if (session.expectedAttendance == null) missing.push(`session ${i + 1} expectedAttendance`);
  });
  return missing;
}

// Display formatting. See UI_DESIGN.md §5.3.
//
// One place, so a date reads "3 Oct 2026" on every screen instead of
// toLocaleDateString() picking a different format per component and per
// machine. Times are Singapore time throughout release 1.

/// Exported because booking times are read in the same zone this file displays in
/// (src/lib/venueTime.ts). Two copies of a timezone is a drift waiting to
/// happen - a booking shown at 14:00 but checked as if it were 06:00.
export const TIME_ZONE = "Asia/Singapore";
const LOCALE = "en-SG";

/// Shown wherever a value is absent. Never leave a cell blank — a blank cell
/// is indistinguishable from a rendering bug.
export const EMPTY = "—";

type DateInput = Date | string | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/// "3 Oct 2026"
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(date);
}

/// "14:00"
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(date);
}

/// "3 Oct 2026, 14:00"
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return `${formatDate(date)}, ${formatTime(date)}`;
}

/// "3 Oct 2026, 09:00–17:00" when both fall on one day, otherwise the two
/// full timestamps. Multi-day events are common enough (briefing §4,
/// Multi-Session Events) that collapsing them would mislead.
export function formatDateTimeRange(start: DateInput, end: DateInput): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from && !to) return EMPTY;
  if (!from || !to) return formatDateTime(from ?? to);

  const sameDay = formatDate(from) === formatDate(to);
  return sameDay
    ? `${formatDate(from)}, ${formatTime(from)}–${formatTime(to)}`
    : `${formatDateTime(from)} – ${formatDateTime(to)}`;
}

/// "3h 30m". Returns EMPTY rather than a negative duration for an end that
/// precedes its start — the validation layer catches that case, and a screen
/// should not render "-2h" while it does.
export function formatDuration(start: DateInput, end: DateInput): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from || !to) return EMPTY;

  const minutes = Math.round((to.getTime() - from.getTime()) / 60000);
  if (minutes <= 0) return EMPTY;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/// "120 / 250"
export function formatCapacity(used: number | null | undefined, total: number | null | undefined): string {
  if (used == null || total == null) return EMPTY;
  return `${used} / ${total}`;
}

/// "Marina Grand Hall (MAR-GH)" — the code is what staff say aloud.
export function formatVenue(name: string | null | undefined, code?: string | null): string {
  if (!name) return EMPTY;
  return code ? `${name} (${code})` : name;
}

/// "EVT-000123" — the user-facing reference for Event.sequenceNumber
/// (schema.prisma), shown to every role including an Attendee. Distinct
/// from `id` (opaque, changes on every reseed) and `seedKey` (internal,
/// seed-data only).
export function eventReference(sequenceNumber: number): string {
  return `EVT-${String(sequenceNumber).padStart(6, "0")}`;
}

/// Postgres int4 max - Event.sequenceNumber's column type. A reference above
/// this can never match a real row.
const MAX_SEQUENCE_NUMBER = 2_147_483_647;

/// The inverse of eventReference() — this is what the [id] route segment
/// under /events actually holds now (see src/lib/apiAuth.ts's
/// resolveEventId()). Returns null for anything that isn't that shape,
/// including a raw UUID (the URL no longer accepts one) and a number too
/// large for the database column (FIXED, found in review of PR #21: an
/// unbounded \d+ let e.g. "EVT-99999999999" through, which Prisma then threw
/// on trying to fit into a 32-bit column - three routes surfaced that as an
/// unhandled 500 instead of the 404 an unmatched reference should give).
export function parseEventReference(value: string): number | null {
  const match = /^EVT-(\d+)$/i.exec(value);
  if (!match) return null;
  const sequenceNumber = Number(match[1]);
  return sequenceNumber <= MAX_SEQUENCE_NUMBER ? sequenceNumber : null;
}

/// Any value that may be missing, for direct rendering in a table cell.
export function orEmpty(value: string | number | null | undefined): string {
  if (value == null || value === "") return EMPTY;
  return String(value);
}

/// Value for a `datetime-local` input, which needs "YYYY-MM-DDTHH:mm" in
/// local time and rejects the ISO string the API returns.
export function toDateTimeLocalValue(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, CardHeader, DataState, PageHeader, StatusBadge } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { formatDate, formatDateTime, formatDateTimeRange, orEmpty } from "@/lib/format";
import { eventAllowsReserving, reservingClosedMessage } from "@/lib/equipmentAvailability";

// S-25 (detail). SPM-48: for each equipment line an event has requested, is
// there enough suitable stock free for its dates? Shown automatically on load -
// the mockup (design/mockups/EquipmentRequests.dc.html) has no "check" button.
//
// SPM-49 (reserve): a line that still has something to give can be reserved
// with one click - no quantity to type in, see the Reserve button below and
// POST .../reserve. Reserving is its own permission (canReserveEquipment),
// checked server-side; this page only decides whether to show the button.

interface EventInfo {
  sequenceNumber: number;
  title: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
}

interface HeldBy {
  eventTitle: string;
  quantity: number;
  availableAgainFrom: string;
}

interface AvailabilityResult {
  status: "available" | "partial" | "unavailable";
  total: number;
  inMaintenance: number;
  reservedElsewhere: number;
  available: number;
  requested: number;
  shortfall: number;
  heldBy: HeldBy[];
  leavesAt: string;
}

interface Line {
  requestId: string;
  requestStatus: string;
  quantityRequested: number;
  quantityReserved: number | null;
  equipmentName: string;
  sessionLabel: string | null;
  venueChosen: boolean;
  transferMinutes: number;
  result: AvailabilityResult | null;
}

interface Availability {
  lines: Line[];
  allAvailable: boolean;
}

/// "13 Oct" - the day the equipment is free again; the year adds noise here.
function formatDay(value: string): string {
  return formatDate(value).replace(/\s\d{4}$/, "");
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"}`;
}

export default function EquipmentRequestDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  // SPM-49: which line is mid-reservation, and the refusal message per line
  // (a race lost to another Technical Support user, or a status that no
  // longer allows it) - keyed by requestId, since several lines are on screen.
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [reserveErrors, setReserveErrors] = useState<Record<string, string>>({});
  // The confirmation after a reservation saves, per line - kept across the
  // reload that follows, so the tester sees both it and the new numbers.
  const [reserveNotices, setReserveNotices] = useState<Record<string, string>>({});

  const path = `/equipment/requests/${eventId}`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [eventRes, availabilityRes] = await Promise.all([
        authedFetch(`/api/events/${eventId}`),
        authedFetch(`/api/events/${eventId}/equipment/availability`),
      ]);
      if (eventRes.status === 401 || availabilityRes.status === 401) {
        router.push(loginUrlFor(path));
        return;
      }
      if (availabilityRes.status === 403) {
        setError("Only Technical Support Staff can check equipment availability.");
        return;
      }
      if (eventRes.status === 404 || availabilityRes.status === 404) {
        setError("This event was not found.");
        return;
      }
      if (!eventRes.ok || !availabilityRes.ok) throw new Error("Could not load this equipment request.");
      setEvent(await eventRes.json());
      setAvailability(await availabilityRes.json());
    } catch (err) {
      setAvailability(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router, path]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(path));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router, path]);

  async function reserve(requestId: string) {
    setReservingId(requestId);
    setReserveErrors((current) => ({ ...current, [requestId]: "" }));
    setReserveNotices((current) => ({ ...current, [requestId]: "" }));
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment/${requestId}/reserve`, {
        method: "POST",
      });
      if (res.status === 401) {
        router.push(loginUrlFor(path));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setReserveErrors((current) => ({
          ...current,
          [requestId]: body?.error ?? "Could not reserve this item.",
        }));
        return;
      }
      const saved = await res.json().catch(() => null);
      setReserveNotices((current) => ({
        ...current,
        [requestId]:
          typeof saved?.quantityReserved === "number"
            ? `Reservation saved: ${saved.quantityReserved} reserved.`
            : "Reservation saved.",
      }));
      // Re-read the whole request: the amount just reserved changes what
      // every OTHER line's availability shows too (AC4), not only this one.
      await load();
    } catch {
      setReserveErrors((current) => ({ ...current, [requestId]: "Could not reserve this item." }));
    } finally {
      setReservingId(null);
    }
  }

  // One chip for the whole request when every line is at the same stage (the
  // mockup shows "Under review" beside "Requested items"); nothing if mixed.
  const stages = new Set(availability?.lines.map((l) => l.requestStatus));
  const requestStage = stages.size === 1 ? [...stages][0] : null;

  // Same rule the Reserve route enforces: a finished, abandoned or released
  // event takes no new reservations, so no button is offered and the page
  // says why rather than letting a click fail.
  const reservingOpen = event ? eventAllowsReserving(event.status) : false;
  const isTechSupport = user?.role === "tech_support";

  return (
    <div>
      <PageHeader
        title="Equipment request"
        subtitle={
          event
            ? `${orEmpty(event.title)} · ${formatDateTimeRange(event.startsAt, event.endsAt)}`
            : undefined
        }
        breadcrumbs={[
          { label: "Equipment requests", href: "/equipment/requests" },
          { label: event?.title ?? "Event" },
        ]}
      />

      {user && user.role !== "tech_support" && (
        <Alert variant="info" className="mb-5">
          Equipment availability is for Technical Support Staff.
        </Alert>
      )}

      {isTechSupport && event && !reservingOpen && (
        <Alert variant="info" className="mb-5">
          {reservingClosedMessage(event.status)}
        </Alert>
      )}

      {availability && !availability.allAvailable && availability.lines.length > 0 && (
        <Alert variant="warning" title="Not everything requested is available." className="mb-5">
          Some items are short, unavailable, or could not be checked for these dates.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Requested items"
          aside={requestStage ? <StatusBadge status={requestStage} /> : undefined}
        />
        <DataState
          data={availability?.lines ?? null}
          error={error}
          onRetry={load}
          empty={{
            title: "No equipment requested",
            description: "This event has not requested any equipment.",
          }}
        >
          {(lines) => (
            <ul className="divide-y divide-line">
              {lines.map((line) => (
                <LineRow
                  key={line.requestId}
                  line={line}
                  canReserve={isTechSupport && reservingOpen}
                  reserving={reservingId === line.requestId}
                  reserveError={reserveErrors[line.requestId]}
                  reserveNotice={reserveNotices[line.requestId]}
                  onReserve={() => reserve(line.requestId)}
                />
              ))}
            </ul>
          )}
        </DataState>
      </Card>
    </div>
  );
}

// SPM-49 AC5: only offered while there is something left to give and the
// request itself is still open. Reserving again after a partial fulfilment is
// allowed - more may have freed up - so "partially_fulfilled" still offers it;
// "reserved" (already given everything requested) and "cancelled" do not.
function canOfferReserve(line: Line): boolean {
  return (
    line.result !== null &&
    line.result.available > 0 &&
    line.requestStatus !== "reserved" &&
    line.requestStatus !== "cancelled"
  );
}

interface LineRowProps {
  line: Line;
  canReserve: boolean;
  reserving: boolean;
  reserveError?: string;
  reserveNotice?: string;
  onReserve: () => void;
}

function LineRow({ line, canReserve, reserving, reserveError, reserveNotice, onReserve }: LineRowProps) {
  const { result } = line;

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-ink">
          {line.equipmentName}
          {line.sessionLabel && <span className="font-normal text-ink-3"> · {line.sessionLabel}</span>}
        </p>

        {result ? (
          <>
            <p className="text-xs text-ink-2">
              {result.total} total − {result.inMaintenance} in maintenance − {result.reservedElsewhere} reserved
              elsewhere = <span className="font-medium text-ink">{result.available} available</span> for these dates
            </p>
            {result.status === "partial" && (
              <p className="text-xs text-tone-warning-fg">
                {result.requested} requested, {result.available} available.
              </p>
            )}
            {result.status === "unavailable" &&
              result.heldBy.map((held) => (
                <p key={`${held.eventTitle}-${held.availableAgainFrom}`} className="text-xs text-tone-warning-fg">
                  Held by {held.eventTitle} ({held.quantity} unit{held.quantity === 1 ? "" : "s"}) until{" "}
                  {formatDay(held.availableAgainFrom)}.
                </p>
              ))}
            <p className="inline-block rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">
              {transferNote(line, result)}
            </p>
            {reserveNotice && <p className="text-xs text-tone-success-fg">{reserveNotice}</p>}
            {reserveError && <p className="text-xs text-tone-danger-fg">{reserveError}</p>}
          </>
        ) : (
          <p className="text-xs text-ink-3">Cannot be checked yet — the event has no dates.</p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        {/* Three fixed-width columns, so Requested, Reserved and the chip line up
            from one row to the next whatever the chip says. */}
        <div className="grid grid-cols-[4rem_4rem_7rem] gap-4 text-center text-sm">
          <Column label="Requested">
            <NumberBox value={line.quantityRequested} />
          </Column>
          <Column label="Reserved">
            <NumberBox value={line.quantityReserved} />
          </Column>
          <Column label="Availability">
            <div className="flex h-9 items-center justify-center">
              {result ? <StatusBadge status={result.status} /> : <span className="text-ink-3">—</span>}
            </div>
          </Column>
        </div>
        {canReserve && canOfferReserve(line) && (
          <Button variant="secondary" size="sm" onClick={onReserve} disabled={reserving}>
            {reserving ? "Reserving…" : "Reserve"}
          </Button>
        )}
      </div>
    </li>
  );
}

/// Where the transfer/preparation time comes from - or why there is none.
function transferNote(line: Line, result: AvailabilityResult): string {
  if (!line.venueChosen) return "Venue not yet chosen — transfer time not included.";
  if (line.transferMinutes > 0) {
    return `Leaves ${formatDateTime(result.leavesAt)} — ${formatHours(line.transferMinutes)} before the event for transfer and preparation.`;
  }
  return `Already at the venue: needed from ${formatDateTime(result.leavesAt)}.`;
}

function Column({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/// A count in a bordered box, like the mockup's quantity boxes. "—" when there
/// is no number yet (nothing reserved so far).
function NumberBox({ value }: { value: number | null }) {
  return (
    <div className="flex h-9 w-16 items-center justify-center rounded-md border border-line-strong bg-surface text-base text-ink">
      {value ?? "—"}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Card, CardHeader, DataState, PageHeader, StatusBadge } from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { formatDate, formatDateTime, formatDateTimeRange, orEmpty } from "@/lib/format";

// S-25 (detail). SPM-48: for each equipment line an event has requested, is
// there enough suitable stock free for its dates? Shown automatically on load -
// the mockup (design/mockups/EquipmentRequests.dc.html) has no "check" button.
// Read-only: reserving what is free is SPM-49.

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

  // One chip for the whole request when every line is at the same stage (the
  // mockup shows "Under review" beside "Requested items"); nothing if mixed.
  const stages = new Set(availability?.lines.map((l) => l.requestStatus));
  const requestStage = stages.size === 1 ? [...stages][0] : null;

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
                <LineRow key={line.requestId} line={line} />
              ))}
            </ul>
          )}
        </DataState>
      </Card>
    </div>
  );
}

function LineRow({ line }: { line: Line }) {
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
                  Held by {held.eventTitle} until {formatDay(held.availableAgainFrom)}.
                </p>
              ))}
            <p className="text-xs text-ink-3">{transferNote(line, result)}</p>
          </>
        ) : (
          <p className="text-xs text-ink-3">Cannot be checked yet — the event has no dates.</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-6 text-sm">
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Requested</p>
          <p className="mt-1 text-base text-ink">{line.quantityRequested}</p>
        </div>
        {result && <StatusBadge status={result.status} />}
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

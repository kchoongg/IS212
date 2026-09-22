"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  type Column,
} from "@/components/ui";
import { SkeletonRows } from "@/components/ui/DataState";
import { cn } from "@/lib/cn";
import { can } from "@/lib/permissions";
import { authedFetch } from "@/lib/session";
import { TIME_ZONE, formatDate, formatDateTimeRange, formatTime } from "@/lib/format";
import { addDays } from "@/lib/venueSlots";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import type {
  AvailabilityBlock,
  AvailabilityBooking,
  AvailabilityCell,
  AvailabilityDay,
  AvailabilityResponse,
  CellStatus,
} from "@/lib/venueAvailability";

// S-21, the venue availability calendar - SPM-46 "View Venue Availability".
//
// Built to the story's acceptance criteria and to the test cases in
// docs/test-cases/SPM-46_test_cases.json, whose on-screen wording ("View
// availability", "Show availability", the slot and cell labels, "Room in use",
// "Overlaps with") this screen matches. Layout follows the S-21 mockup
// (breadcrumb, venue name and code, the range and opening hours under it, week
// navigation at the top right, a key under the grid) - but NOT its continuous
// hour-by-hour grid: AC2 asks for AM / PM / Night slots, and that was decided
// over the mockup.
//
// Everything the calendar says comes from GET /api/venues/[id]/availability.
// This screen decides nothing about availability itself - it only lays out
// what the endpoint (src/lib/venueAvailability.ts) worked out.
//
// The range lives in the URL (?from=&to=), not in component state, so the page
// survives a reload, an address can be shared, and "Previous week" / "Next
// week" are just navigation.

/// Dates arrive over the wire as ISO strings, not Date objects. They are only
/// ever passed to the format helpers, which accept either.
type Wire = AvailabilityResponse;

interface VenueOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const STATUS_LABEL: Record<CellStatus, string> = {
  free: "Free",
  booked: "Booked",
  turnaround: "Turnaround",
  unavailable: "Unavailable",
  closed: "Closed",
};

/// Colour is never the only signal - every cell also says its status in words
/// (UI_DESIGN.md §5.2).
const STATUS_TONE: Record<CellStatus, string> = {
  free: "bg-tone-success-bg text-tone-success-fg ring-tone-success-ring",
  booked: "bg-tone-info-bg text-tone-info-fg ring-tone-info-ring",
  turnaround: "bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-ring",
  unavailable: "bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-ring",
  closed: "bg-tone-neutral-bg text-tone-neutral-fg ring-tone-neutral-ring",
};

const WEEKDAY = new Intl.DateTimeFormat("en-SG", { weekday: "short", timeZone: TIME_ZONE });

/// "2026-12-01" -> "Tue 1 Dec 2026". A day key parsed as UTC midnight is 08:00
/// the same day in Singapore, so both halves land on the right date.
function dayLabel(dayKey: string): string {
  const instant = new Date(`${dayKey}T00:00:00Z`);
  return `${WEEKDAY.format(instant)} ${formatDate(instant)}`;
}

/// "renovation" -> "Renovation", "internal_activity" -> "Internal activity".
function reasonLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/// "u_shape" -> "U-shape", matching how the venue form labels layouts.
function layoutLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, "-");
}

/// "06:00–20:00" when the room is in use within one day, otherwise both full
/// timestamps - a long booking's turnaround can cross midnight.
function roomInUse(from: Date | string, to: Date | string): string {
  return formatDate(from) === formatDate(to)
    ? `${formatTime(from)}–${formatTime(to)}`
    : formatDateTimeRange(from, to);
}

export default function VenueAvailabilityPage() {
  // useSearchParams needs a Suspense boundary in Next 16, or a production
  // build can fail with "blocking-prerender-client-hook".
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <VenueAvailability />
    </Suspense>
  );
}

function VenueAvailability() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const venueId = params.id;
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from") ?? "";
  const toParam = searchParams.get("to") ?? "";

  const { user, state: authState } = useCurrentUser();
  const canManage = can(user?.role ?? "", "venue:manage");

  const [data, setData] = useState<Wire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbiddenMessage, setForbiddenMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venueInput, setVenueInput] = useState(venueId);
  const [fromInput, setFromInput] = useState(fromParam);
  const [toInput, setToInput] = useState(toParam);

  const here = useMemo(() => {
    const query = new URLSearchParams();
    if (fromParam) query.set("from", fromParam);
    if (toParam) query.set("to", toParam);
    const qs = query.toString();
    return `/venues/${venueId}/availability${qs ? `?${qs}` : ""}`;
  }, [venueId, fromParam, toParam]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (fromParam) query.set("from", fromParam);
      if (toParam) query.set("to", toParam);
      const res = await authedFetch(`/api/venues/${venueId}/availability?${query.toString()}`);
      if (res.status === 401) {
        router.push(loginUrlFor(here));
        return;
      }
      const body = await res.json();
      if (res.status === 403) {
        // AC6. Said once, plainly, with nothing else on the page - not an
        // error to retry, and not a hint of what the calendar holds.
        setForbiddenMessage(body.error ?? "Venue availability is for ConnectSphere staff");
        setData(null);
        return;
      }
      if (!res.ok) {
        // An invalid range (end before start, or more than 62 days) comes back
        // as a 400 with the exact sentence to show. The server is the one
        // place that rule lives, so the screen repeats it rather than
        // re-checking and risking a different answer.
        setError(body.error ?? "Could not load this venue's availability.");
        setData(null);
        return;
      }
      setData(body);
      // With no range in the address, the endpoint picks a week from today -
      // show the user which week that was.
      setFromInput(body.range.from);
      setToInput(body.range.to);
      setVenueInput(body.venue.id);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [venueId, fromParam, toParam, here, router]);

  const loadVenues = useCallback(async () => {
    try {
      // Venue Staff can see retired rooms, and must be able to pick one here
      // to check what it still has booked.
      const res = await authedFetch(canManage ? "/api/venues?includeRetired=true" : "/api/venues");
      if (!res.ok) return;
      setVenues(await res.json());
    } catch {
      // The picker is a convenience; the calendar works without it.
    }
  }, [canManage]);

  useEffect(() => {
    if (authState === "anonymous") {
      router.push(loginUrlFor(here));
      return;
    }
    if (authState === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [authState, load, here, router]);

  useEffect(() => {
    if (authState === "authenticated" && !forbiddenMessage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadVenues();
    }
  }, [authState, forbiddenMessage, loadVenues]);

  /// Every change of venue or range is a navigation, so the address always
  /// says what is on screen.
  function go(targetVenueId: string, from: string, to: string) {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    router.push(`/venues/${targetVenueId}/availability?${query.toString()}`);
  }

  function shiftWeek(days: number) {
    if (!data) return;
    go(venueId, addDays(data.range.from, days), addDays(data.range.to, days));
  }

  // The picker always includes the venue on screen - a coordinator's list is
  // active venues only, but they can still arrive at a retired one by link.
  const venueOptions = useMemo(() => {
    const list = [...venues];
    if (data && !list.some((v) => v.id === data.venue.id)) {
      list.push({ id: data.venue.id, code: data.venue.code, name: data.venue.name, isActive: data.venue.isActive });
    }
    return list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((v) => ({ value: v.id, label: `${v.name} (${v.code})${v.isActive ? "" : " - retired"}` }));
  }, [venues, data]);

  const bookingsById = useMemo(
    () => new Map((data?.bookings ?? []).map((b) => [b.id, b])),
    [data]
  );
  const blocksById = useMemo(
    () => new Map((data?.unavailability ?? []).map((u) => [u.id, u])),
    [data]
  );

  const venueName = data?.venue.name ?? "Venue";
  const crumbs = [
    { label: "Venues", href: "/venues" },
    // Only Venue Staff can open the editor, so only they get it as a link.
    { label: venueName, href: canManage && data ? `/venues/${venueId}/edit` : undefined },
    { label: "Availability" },
  ];

  if (forbiddenMessage) {
    return (
      <div>
        <PageHeader title="Venue availability" breadcrumbs={[{ label: "Venues" }, { label: "Availability" }]} />
        <Alert variant="error" title="You do not have access to this">
          {forbiddenMessage}
        </Alert>
      </div>
    );
  }

  const columns: Column<AvailabilityDay>[] = [
    {
      key: "day",
      header: "Day",
      hideLabelOnMobile: true,
      className: "w-40",
      render: (day) => <span className="font-medium">{dayLabel(day.date)}</span>,
    },
    ...(data?.slots ?? []).map(({ slot, label }) => ({
      key: slot,
      header: `${slot} ${label}`,
      render: (day: AvailabilityDay) => (
        <SlotCellView cell={day.slots[slot]} bookingsById={bookingsById} blocksById={blocksById} />
      ),
    })),
  ];

  return (
    <div>
      <PageHeader
        title={data ? `${data.venue.name} availability` : "Venue availability"}
        subtitle={
          data
            ? `${formatDate(`${data.range.from}T00:00:00Z`)} – ${formatDate(`${data.range.to}T00:00:00Z`)} · ` +
              `open ${data.venue.opensAt}–${data.venue.closesAt} · ` +
              `setup ${data.venue.setupMinutes} min, teardown ${data.venue.teardownMinutes} min`
            : undefined
        }
        breadcrumbs={crumbs}
        actions={
          <>
            <Button variant="secondary" onClick={() => shiftWeek(-7)} disabled={!data}>
              Previous week
            </Button>
            <Button variant="secondary" onClick={() => shiftWeek(7)} disabled={!data}>
              Next week
            </Button>
          </>
        }
      />

      {/* AC1 - choose the venue and the period. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(venueInput, fromInput, toInput);
        }}
        className="mb-6 flex flex-wrap items-end gap-3"
      >
        <Field label="Venue" className="min-w-64 flex-1">
          <Select
            name="venue"
            options={venueOptions}
            value={venueInput}
            onChange={(e) => setVenueInput(e.target.value)}
          />
        </Field>
        <Field label="From">
          <Input name="from" type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
        </Field>
        <Field label="To">
          <Input name="to" type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} />
        </Field>
        <Button type="submit">Show availability</Button>
      </form>

      {error && (
        <Alert variant="error" className="mb-6">
          {error}
        </Alert>
      )}

      {loading && !data && !error && <SkeletonRows rows={6} />}

      {data && !error && (
        <div className="flex flex-col gap-6">
          {!data.venue.isActive && (
            <Alert variant="warning" title="This venue is retired">
              It is no longer offered for new bookings, so no slot is shown as free. Anything already booked
              here is still listed below.
            </Alert>
          )}

          {/* AC5 - one flag for the whole range, so an overlap is never missed
              just because it is below the fold. */}
          {data.hasOverlaps && (
            <Alert variant="warning" title="Some bookings or unavailable periods overlap">
              Each one is marked &lsquo;Overlaps with&rsquo; below. Overlaps are worked out from the exact times,
              not the slots - two short bookings can share a slot without clashing.
            </Alert>
          )}

          <div>
            <Table
              columns={columns}
              rows={data.days}
              rowKey={(day) => day.date}
              caption={`Availability of ${venueName}, by day and slot`}
            />
            <Key />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <BookingsCard bookings={data.bookings} bookingsById={bookingsById} blocksById={blocksById} />
            <UnavailabilityCard blocks={data.unavailability} bookingsById={bookingsById} blocksById={blocksById} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type Lookups = {
  bookingsById: Map<string, AvailabilityBooking>;
  blocksById: Map<string, AvailabilityBlock>;
};

/// One slot. Says its status in words, then everything occupying it - so a
/// slot showing "Unavailable" still names the booking sharing it, and nothing
/// is hidden behind the status that won.
function SlotCellView({ cell, bookingsById, blocksById }: { cell: AvailabilityCell } & Lookups) {
  const booked = cell.bookingIds.map((id) => bookingsById.get(id)?.eventTitle ?? "Untitled event");
  const turnaround = cell.turnaroundBookingIds.map((id) => bookingsById.get(id)?.eventTitle ?? "Untitled event");
  const blocks = cell.unavailabilityIds.map((id) => {
    const block = blocksById.get(id);
    return block ? reasonLabel(block.reason) : "Unavailable";
  });

  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
          STATUS_TONE[cell.status]
        )}
      >
        {STATUS_LABEL[cell.status]}
      </span>
      {cell.status === "free" && cell.openingHours === "partial" && (
        <span className="text-xs text-ink-3">Limited hours</span>
      )}
      {blocks.map((label, i) => (
        <span key={`u${i}`} className="text-xs text-ink-2">
          {label}
        </span>
      ))}
      {booked.map((title, i) => (
        <span key={`b${i}`} className="text-xs font-medium text-ink">
          {title}
        </span>
      ))}
      {turnaround.map((title, i) => (
        <span key={`t${i}`} className="text-xs text-ink-3">
          Setup or teardown: {title}
        </span>
      ))}
    </div>
  );
}

function Key() {
  const entries: { status: CellStatus; meaning: string }[] = [
    { status: "free", meaning: "the room can be requested" },
    { status: "booked", meaning: "an approved booking's own times" },
    { status: "turnaround", meaning: "only setup or teardown time" },
    { status: "unavailable", meaning: "a recorded unavailable period" },
    { status: "closed", meaning: "outside opening hours, or a retired venue" },
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-2">
      {entries.map(({ status, meaning }) => (
        <li key={status} className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ring-inset",
              STATUS_TONE[status]
            )}
          >
            {STATUS_LABEL[status]}
          </span>
          {meaning}
        </li>
      ))}
    </ul>
  );
}

/// "Overlaps with …" - AC5, named by event or by reason and dates.
function OverlapNote({
  overlaps,
  bookingsById,
  blocksById,
}: { overlaps: AvailabilityBooking["overlaps"] } & Lookups) {
  const names = [
    ...overlaps.bookingIds.map((id) => bookingsById.get(id)?.eventTitle ?? "another booking"),
    ...overlaps.unavailabilityIds.map((id) => {
      const block = blocksById.get(id);
      return block
        ? `${reasonLabel(block.reason)} (${formatDate(block.startsAt)} to ${formatDate(block.endsAt)})`
        : "an unavailable period";
    }),
  ];
  if (names.length === 0) return null;
  return <p className="text-sm font-medium text-tone-warning-fg">Overlaps with: {names.join("; ")}</p>;
}

function BookingsCard({ bookings, ...lookups }: { bookings: AvailabilityBooking[] } & Lookups) {
  return (
    <Card>
      <CardHeader title="Approved bookings" />
      <CardBody>
        {bookings.length === 0 ? (
          <p className="text-sm text-ink-3">No approved bookings in this range.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{b.eventTitle ?? "Untitled event"}</span>
                  {/* The EVENT's status, for information. It never decides
                      whether the room is taken - the booking is approved,
                      which is what blocks the slots above (AC3/AC7). */}
                  <StatusBadge status={b.eventStatus} />
                  {b.sessionLabel && <span className="text-sm text-ink-3">{b.sessionLabel}</span>}
                </div>
                <p className="text-sm text-ink-2">{formatDateTimeRange(b.startsAt, b.endsAt)}</p>
                <p className="text-sm text-ink-2">Room in use {roomInUse(b.occupiedFrom, b.occupiedTo)}</p>
                {b.layoutName && <p className="text-sm text-ink-3">Layout: {layoutLabel(b.layoutName)}</p>}
                {b.minutesOutsideSlots > 0 && (
                  <p className="text-sm text-tone-warning-fg">
                    {b.minutesOutsideSlots} minutes of this booking fall outside the AM, PM and Night slots, so
                    the grid above does not show all of it.
                  </p>
                )}
                <OverlapNote overlaps={b.overlaps} {...lookups} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function UnavailabilityCard({ blocks, ...lookups }: { blocks: AvailabilityBlock[] } & Lookups) {
  return (
    <Card>
      <CardHeader title="Unavailable periods" />
      <CardBody>
        {blocks.length === 0 ? (
          <p className="text-sm text-ink-3">No unavailable periods in this range.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {blocks.map((u) => (
              <li key={u.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <span className="font-medium text-ink">{reasonLabel(u.reason)}</span>
                {u.notes && <p className="text-sm text-ink-2">{u.notes}</p>}
                <p className="text-sm text-ink-2">
                  {formatDate(u.startsAt)} to {formatDate(u.endsAt)}
                </p>
                <OverlapNote overlaps={u.overlaps} {...lookups} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

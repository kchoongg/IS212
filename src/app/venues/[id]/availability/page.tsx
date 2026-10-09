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
import { TIME_ZONE, formatDate, formatDateTimeRange } from "@/lib/format";
import { addDays, timeRangeLabel } from "@/lib/venueTime";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import {
  reasonLabel,
  type AvailabilityBlock,
  type AvailabilityBooking,
  type AvailabilityDay,
  type AvailabilityHold,
  type AvailabilityResponse,
  type EntryKind,
} from "@/lib/venueAvailability";

// S-21, the venue availability calendar - SPM-46 "View Venue Availability".
//
// SPM-93 AC9: one row per day, listing what is on at its actual times - each
// booking's or hold's setup, its own time and its turnaround as separate
// entries, and unavailable periods - instead of AM / PM / Night columns.
// Layout follows the S-21 mockup otherwise (breadcrumb, venue name and code,
// the range and opening hours under it, week navigation at the top right, a key
// under the table). How fine-grained the calendar is was left to us (#6).
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

const KIND_LABEL: Record<EntryKind, string> = {
  setup: "Setup",
  booked: "Booked",
  turnaround: "Turnaround",
  requested: "Requested",
  unavailable: "Unavailable",
};

/// Colour is never the only signal - every entry also says what it is in words
/// (UI_DESIGN.md §5.2).
const KIND_TONE: Record<EntryKind | "free" | "closed", string> = {
  booked: "bg-tone-info-bg text-tone-info-fg ring-tone-info-ring",
  setup: "bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-ring",
  turnaround: "bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-ring",
  requested: "bg-tone-neutral-bg text-tone-neutral-fg ring-tone-neutral-ring",
  unavailable: "bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-ring",
  free: "bg-tone-success-bg text-tone-success-fg ring-tone-success-ring",
  closed: "bg-tone-neutral-bg text-tone-neutral-fg ring-tone-neutral-ring",
};

const WEEKDAY = new Intl.DateTimeFormat("en-SG", { weekday: "short", timeZone: TIME_ZONE });

/// "2026-12-01" -> "Tue 1 Dec 2026". A day key parsed as UTC midnight is 08:00
/// the same day in Singapore, so both halves land on the right date.
function dayLabel(dayKey: string): string {
  const instant = new Date(`${dayKey}T00:00:00Z`);
  return `${WEEKDAY.format(instant)} ${formatDate(instant)}`;
}

/// "u_shape" -> "U-shape", matching how the venue form labels layouts.
function layoutLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, "-");
}

/// "09:30–12:45" within one day, otherwise both full timestamps.
function roomInUse(from: Date | string, to: Date | string): string {
  return timeRangeLabel({ startsAt: new Date(from), endsAt: new Date(to) });
}

function Pill({ tone, children }: { tone: keyof typeof KIND_TONE; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        KIND_TONE[tone]
      )}
    >
      {children}
    </span>
  );
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
    {
      key: "schedule",
      header: "Schedule",
      render: (day) => <DaySchedule day={day} venueActive={data?.venue.isActive ?? true} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title={data ? `${data.venue.name} availability` : "Venue availability"}
        subtitle={
          data
            ? `${formatDate(`${data.range.from}T00:00:00Z`)} – ${formatDate(`${data.range.to}T00:00:00Z`)} · ` +
              `open ${data.venue.opensAt}–${data.venue.closesAt} · ` +
              `setup ${data.venue.setupMinutes} min, turnaround ${data.venue.teardownMinutes} min`
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
              It is no longer offered for new bookings, so no day is shown as free. Anything already booked
              here is still listed below.
            </Alert>
          )}

          {/* AC5 - one flag for the whole range, so an overlap is never missed
              just because it is below the fold. */}
          {data.hasOverlaps && (
            <Alert variant="warning" title="Some bookings or unavailable periods overlap">
              Each one is marked &lsquo;Overlaps with&rsquo; below. Overlaps are worked out from the times the
              room is in use, setup and turnaround included.
            </Alert>
          )}

          <div>
            <Table
              columns={columns}
              rows={data.days}
              rowKey={(day) => day.date}
              caption={`Availability of ${venueName}, by day`}
            />
            <Key />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <BookingsCard bookings={data.bookings} bookingsById={bookingsById} blocksById={blocksById} />
            <UnavailabilityCard blocks={data.unavailability} bookingsById={bookingsById} blocksById={blocksById} />
            <HoldsCard holds={data.holds} />
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

/// One day's row: every entry at its times, in order - "Setup 09:30–10:00 ·
/// SPM93 Morning Masterclass" - or "Free" when nothing is on ("Closed" for a
/// retired venue, which is never offered as free).
function DaySchedule({ day, venueActive }: { day: AvailabilityDay; venueActive: boolean }) {
  if (day.entries.length === 0) {
    return venueActive ? <Pill tone="free">Free</Pill> : <Pill tone="closed">Closed</Pill>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {day.entries.map((entry, i) => (
        <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone={entry.kind}>{KIND_LABEL[entry.kind]}</Pill>
          <span className="tabular-nums text-ink">
            {entry.from}–{entry.to}
          </span>
          <span className={entry.kind === "booked" ? "font-medium text-ink" : "text-ink-2"}>· {entry.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Key() {
  const entries: { tone: keyof typeof KIND_TONE; label: string; meaning: string }[] = [
    { tone: "booked", label: "Booked", meaning: "an approved booking's own times" },
    { tone: "setup", label: "Setup", meaning: "the venue's setup time before a booking or request" },
    { tone: "turnaround", label: "Turnaround", meaning: "the venue's turnaround time after it" },
    { tone: "requested", label: "Requested", meaning: "asked for, not yet approved" },
    { tone: "unavailable", label: "Unavailable", meaning: "a recorded unavailable period" },
    { tone: "free", label: "Free", meaning: "nothing on that day" },
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-2">
      {entries.map(({ tone, label, meaning }) => (
        <li key={label} className="flex items-center gap-2">
          <Pill tone={tone}>{label}</Pill>
          {meaning}
        </li>
      ))}
    </ul>
  );
}

/// "Overlaps with …" - AC5, named by event or by reason and times.
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
        ? `${reasonLabel(block.reason)} (${formatDateTimeRange(block.startsAt, block.endsAt)})`
        : "an unavailable period";
    }),
  ];
  if (names.length === 0) return null;
  return <p className="text-sm font-medium text-tone-warning-fg">Overlaps with: {names.join("; ")}</p>;
}

/// Tentative holds - pending requests. Deliberately its own card, below the
/// approved bookings, so nothing here can be mistaken for a commitment. #41:
/// "Only one active tentative hold or confirmed booking should exist for the
/// same venue and overlapping time period."
function HoldsCard({ holds }: { holds: AvailabilityHold[] }) {
  if (holds.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Requested, not yet approved" />
      <CardBody>
        <ul className="flex flex-col gap-3">
          {holds.map((h) => (
            <li key={h.id} className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">{h.eventTitle ?? "Untitled event"}</span>
              <p className="text-sm text-ink-2">{formatDateTimeRange(h.startsAt, h.endsAt)}</p>
              <p className="text-sm text-ink-2">Room in use {roomInUse(h.occupiedFrom, h.occupiedTo)}</p>
              <p className="text-sm text-ink-3">
                These times are not booked yet, but someone has already asked for this room. Check with the
                Event Coordinator before requesting it as well.
              </p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
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
                      which is what blocks the times above (AC3/AC7). */}
                  <StatusBadge status={b.eventStatus} />
                  {b.sessionLabel && <span className="text-sm text-ink-3">{b.sessionLabel}</span>}
                </div>
                <p className="text-sm text-ink-2">{formatDateTimeRange(b.startsAt, b.endsAt)}</p>
                <p className="text-sm text-ink-2">Room in use {roomInUse(b.occupiedFrom, b.occupiedTo)}</p>
                {b.layoutName && <p className="text-sm text-ink-3">Layout: {layoutLabel(b.layoutName)}</p>}
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
                <p className="text-sm text-ink-2">{formatDateTimeRange(u.startsAt, u.endsAt)}</p>
                <OverlapNote overlaps={u.overlaps} {...lookups} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

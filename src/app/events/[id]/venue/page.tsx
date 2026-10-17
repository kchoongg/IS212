"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { SAFETY_CLOSED_NOTICE } from "@/lib/safetyResolution";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { RequirePermission } from "@/components/RequirePermission";
import { cn } from "@/lib/cn";
import { formatDateTime, formatDateTimeRange, formatVenue } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";
import { LAYOUTS, toOptions } from "@/lib/eventForm";
import {
  SPACE_ATTENDANCE_ERROR,
  describeUnmet,
  layoutLabel,
  parseSpaceAttendance,
  type UnmetRequirement,
} from "@/lib/venueSuitability";

// SPM-41, "Find a venue" (design/mockups/VenueSearch.dc.html). Every active
// venue is judged against the event's attendance, layout, facilities and
// accessibility needs. Unsuitable venues stay visible, greyed, with the reason.
//
// SPM-42: a suitable venue gets "Request booking" (S-15); an unsuitable one
// does not (team decision, 2026-10-01). A multi-session event picks a session
// first, and venues are then judged on that session's attendance and layout.
//
// SPM-90: an event may book several rooms, each for its own use, so the venues
// are judged for one SPACE at a time. "The space you need" starts on the
// event's (or session's) own attendance and layout; the Coordinator changes
// them for a smaller space - a breakout room - and checks again, and "Request
// booking" carries them to the request form. Facilities and accessibility
// needs stay the event's. Each request is listed with what its space is for.
//
// SPM-67: the assigned Coordinator withdraws a pending request or releases an
// approved booking from the "Booking requests" card, with an optional reason.
// The booking stays listed with its new status, and the venues below still
// offer "Request booking", so a different room can be asked for straight away.

interface Result {
  venue: {
    id: string;
    code: string;
    name: string;
    building: string;
    floor: string | null;
    maxCapacity: number;
    layouts: { layoutName: string; capacity: number }[];
  };
  suitable: boolean;
  unmet: UnmetRequirement[];
  optionalMissing: UnmetRequirement[];
}

interface Payload {
  event: {
    expectedAttendance: number | null;
    preferredLayout: string | null;
    requirements: { facilityId: string; name: string; category: string; isMandatory: boolean }[];
    missing: ("expectedAttendance" | "preferredLayout")[];
  };
  results: Result[];
}

interface BookingInfo {
  sessions: { id: string; label: string | null; startsAt: string; endsAt: string }[];
  cannotRequest: string | null;
  /// SPM-67: whether this user may withdraw or release the event's bookings.
  canChangeBookings?: boolean;
  /// SPM-65: whether this user may open the Attendees tab.
  canViewRegistrationList?: boolean;
  bookings: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    layoutName: string | null;
    /// SPM-90: what the space is for, and how many people it is for. Null on
    /// a booking made before they were recorded.
    purpose?: string | null;
    expectedAttendance?: number | null;
    /// SPM-82: when a pending request's tentative hold expires, or when an
    /// expired one did. Null on a request made before holds expired.
    holdExpiresAt?: string | null;
    decisionReason: string | null;
    suggestedAlternative: string | null;
    suggestedVenue: { id: string; code: string; name: string; isActive: boolean } | null;
    /// SPM-67: the Coordinator's reason, on a withdrawn or released booking.
    cancellationReason?: string | null;
    session: { id: string; label: string | null } | null;
    venue: { code: string; name: string };
  }[];
}

type Booking = BookingInfo["bookings"][number];
type ChangeAction = "withdraw" | "release";

/// SPM-67: the wording of each action, from its button to what it says after.
const CHANGE = {
  withdraw: {
    button: "Withdraw request",
    title: "Withdraw this request?",
    keep: "Keep request",
    consequence: "will no longer be requested, and Venue Staff will no longer see it on their Booking Requests list.",
    done: "Request withdrawn",
    status: "withdrawn",
    afterwards: "You can request another venue below.",
  },
  release: {
    button: "Release booking",
    title: "Release this booking?",
    keep: "Keep booking",
    consequence: "will be freed for other events, and Venue Staff will be notified.",
    done: "Booking released",
    status: "released",
    afterwards: "Venue Staff have been notified. You can request another venue below.",
  },
} as const;

/// "Hall A (HALL-A) on 4 Mar 2027, 13:30–17:00", with the session if it has one.
function describeBooking(b: Booking): string {
  const session = b.session ? ` for ${b.session.label ?? "Session"}` : "";
  return `${formatVenue(b.venue.name, b.venue.code)}${session} on ${formatDateTimeRange(b.startsAt, b.endsAt)}`;
}

/// SPM-90: the space the venues were last checked for.
interface Space {
  attendance: number;
  /// "" when no layout is set.
  layout: string;
}

const LAYOUT_OPTIONS = [{ value: "", label: "Not set" }, ...toOptions(LAYOUTS)];

const MISSING_LABEL = {
  expectedAttendance: "expected attendance",
  preferredLayout: "preferred layout",
} as const;

// SPM-85 (AC7): a role without venue:view who types this address - the Safety
// Officer, Technical Support, an organiser or attendee - is refused before
// anything is fetched, so no venue, booking or suitability result reaches the
// page. Venue Staff and the Operations Manager keep the read-only view.
export default function EventVenuePage() {
  const params = useParams<{ id: string }>();
  return (
    <RequirePermission
      action="venue:view"
      title="Find a venue"
      breadcrumbs={[
        { label: "Events", href: "/events" },
        { label: "Event", href: `/events/${params.id}` },
        { label: "Venue" },
      ]}
      reason="Finding and booking a venue is for the Event Coordinator. The rooms booked for this event are on its Overview."
    >
      <EventVenueScreen />
    </RequirePermission>
  );
}

function EventVenueScreen() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [data, setData] = useState<Payload | null>(null);
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // SPM-90: the space the Coordinator asked the venues to be checked for (null
  // = the event's or session's own), and what is typed in its two fields.
  const [space, setSpace] = useState<Space | null>(null);
  const [spaceAttendance, setSpaceAttendance] = useState("");
  const [spaceLayout, setSpaceLayout] = useState("");
  const [spaceError, setSpaceError] = useState<string | null>(null);
  // SPM-67: the booking being withdrawn or released, and what happened.
  const [changing, setChanging] = useState<{ booking: Booking; action: ChangeAction } | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const info = await authedFetch(`/api/events/${eventId}/venue-bookings`);
      if (info.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/venue`));
        return;
      }
      if (info.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!info.ok) throw new Error("Could not load this event's booking requests.");
      const bookingInfo: BookingInfo = await info.json();
      setBooking(bookingInfo);
      // AC4: a multi-session event is booked per session - judge venues for one.
      const session = sessionId ?? bookingInfo.sessions[0]?.id ?? null;
      setSessionId(session);

      const asked = [
        ...(session ? [`session=${session}`] : []),
        ...(space ? [`attendance=${space.attendance}`, `layout=${encodeURIComponent(space.layout)}`] : []),
      ];
      const query = asked.length > 0 ? `?${asked.join("&")}` : "";
      const res = await authedFetch(`/api/events/${eventId}/venue-suitability${query}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/venue`));
        return;
      }
      if (res.status === 403) {
        setError("Venue suitability is for ConnectSphere staff.");
        return;
      }
      if (res.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!res.ok) throw new Error("Could not check venues for this event.");
      const payload: Payload = await res.json();
      setData(payload);
      // SPM-90 (AC2): until the Coordinator asks for a space of their own, the
      // fields show what was checked - the event's or session's own.
      if (!space) {
        setSpaceAttendance(payload.event.expectedAttendance?.toString() ?? "");
        setSpaceLayout(payload.event.preferredLayout ?? "");
      }
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router, sessionId, space]);

  // RequirePermission sends an anonymous visitor to log in before this renders.
  useEffect(() => {
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load]);

  /// SPM-90: check every venue again, for the space in the two fields.
  function checkSpace(e: React.FormEvent) {
    e.preventDefault();
    const attendance = parseSpaceAttendance(spaceAttendance);
    if (attendance === null) {
      setSpaceError(SPACE_ATTENDANCE_ERROR);
      return;
    }
    setSpaceError(null);
    setSpace({ attendance, layout: spaceLayout });
  }

  /// The space in the address of the request form, once one has been checked.
  const spaceQuery = space ? `&attendance=${space.attendance}&layout=${encodeURIComponent(space.layout)}` : "";

  function startChange(target: Booking, action: ChangeAction) {
    setReason("");
    setNotice(null);
    setChangeError(null);
    setChanging({ booking: target, action });
  }

  async function confirmChange() {
    if (!changing) return;
    const { booking: target, action } = changing;
    setSaving(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/venue-bookings/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify(reason.trim() ? { action, reason: reason.trim() } : { action }),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/venue`));
        return;
      }
      if (!res.ok) {
        // The refusal says what to do instead (e.g. release a request Venue
        // Staff approved meanwhile), and the reload below shows why.
        const failure = await res.json().catch(() => null);
        setChangeError(failure?.error ?? "Could not save the change. Please try again.");
      } else {
        const words = CHANGE[action];
        // SPM-88: a change while the event rests on a safety check closes it.
        const changed = await res.json().catch(() => ({}));
        const closed = changed.safetyCheckClosed ? ` ${SAFETY_CLOSED_NOTICE}` : "";
        setNotice({
          title: words.done,
          body: `${describeBooking(target)} is now ${statusLabel(words.status)}. ${words.afterwards}${closed}`,
        });
      }
      setChanging(null);
      await load();
    } catch {
      setChangeError("Could not save the change. Please try again.");
      setChanging(null);
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading" || (state === "authenticated" && !user)) {
    return null;
  }

  // v8 ignore next -- RequirePermission renders this screen only for a signed-in user
  const tabs = user ? eventTabItemsFor(user.role, eventId, booking?.canViewRegistrationList) : [];
  const suitableCount = data?.results.filter((r) => r.suitable).length ?? 0;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Find a venue"
        subtitle="Each venue is checked against the attendance and layout of the space you need, and this event's facilities and accessibility needs."
        breadcrumbs={[
          // Never "My Events": an organiser cannot open this tab (no venue:view).
          { label: "Events", href: "/events" },
          { label: "Event", href: `/events/${eventId}` },
          { label: "Venue" },
        ]}
        actions={
          // SPM-40: the same event's requirements as search FILTERS - only the
          // matching venues, narrowed further by date, location and so on.
          <ButtonLink href={`/venues/search?event=${eventId}`} variant="secondary">
            Search with filters
          </ButtonLink>
        }
      />

      {tabs.length > 0 && <Tabs items={tabs} activeKey="venue" className="mb-6" />}

      {error ? (
        <Alert
          variant="error"
          title="Could not load this"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : !data ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="flex flex-col gap-4">
          {booking && booking.sessions.length > 0 && (
            <Field label="Session">
              <Select
                value={sessionId ?? ""}
                onChange={(e) => {
                  // Another session has its own attendance and layout to start on.
                  setSpace(null);
                  setSpaceError(null);
                  setSessionId(e.target.value);
                }}
                options={booking.sessions.map((s) => ({
                  value: s.id,
                  label: `${s.label ?? "Session"} — ${formatDateTimeRange(s.startsAt, s.endsAt)}`,
                }))}
              />
            </Field>
          )}

          {booking?.cannotRequest && <Alert variant="info">{booking.cannotRequest}</Alert>}

          {notice && (
            <Alert variant="success" title={notice.title}>
              {notice.body}
            </Alert>
          )}
          {changeError && <Alert variant="error">{changeError}</Alert>}

          {booking && booking.bookings.length > 0 && (
            <BookingRequests
              bookings={booking.bookings}
              onChange={booking.canChangeBookings ? startChange : null}
              requestHrefFor={
                booking.cannotRequest
                  ? null
                  : (venueId, session) =>
                      `/events/${eventId}/booking/new?venue=${venueId}${session ? `&session=${session}` : ""}`
              }
            />
          )}

          <Card>
            <CardHeader
              title="The space you need"
              subtitle={`Starts on this ${booking && booking.sessions.length > 0 ? "session" : "event"}'s own attendance and layout. Change them to check venues for a smaller space, such as a breakout room.`}
            />
            <CardBody>
              <form onSubmit={checkSpace} noValidate className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Expected attendance for this space" error={spaceError ?? undefined}>
                    <Input
                      type="number"
                      min={1}
                      value={spaceAttendance}
                      onChange={(e) => {
                        setSpaceAttendance(e.target.value);
                        setSpaceError(null);
                      }}
                    />
                  </Field>
                  <Field label="Room layout">
                    <Select value={spaceLayout} onChange={(e) => setSpaceLayout(e.target.value)} options={LAYOUT_OPTIONS} />
                  </Field>
                </div>
                <div>
                  <Button type="submit" variant="secondary">
                    Check venues
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {data.event.missing.length > 0 && (
            <Alert variant="info" title="This check is incomplete">
              The event has no {data.event.missing.map((m) => MISSING_LABEL[m]).join(" or ")} yet, so
              that part of the check was skipped.
            </Alert>
          )}

          <p className="text-sm text-ink-3">
            {data.results.length} venues checked · {suitableCount} suitable
          </p>

          {data.results.map((result) => (
            <VenueResult
              key={result.venue.id}
              result={result}
              requestHref={
                booking && !booking.cannotRequest && result.suitable
                  ? `/events/${eventId}/booking/new?venue=${result.venue.id}${sessionId ? `&session=${sessionId}` : ""}${spaceQuery}`
                  : null
              }
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={changing !== null}
        title={changing ? CHANGE[changing.action].title : ""}
        confirmLabel={changing ? CHANGE[changing.action].button : ""}
        cancelLabel={changing ? CHANGE[changing.action].keep : undefined}
        loading={saving}
        onConfirm={() => void confirmChange()}
        onCancel={() => setChanging(null)}
      >
        {changing && (
          <div className="flex flex-col gap-3">
            <p>
              {describeBooking(changing.booking)} {CHANGE[changing.action].consequence}
            </p>
            <Field label="Reason (optional)">
              <Textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

/// SPM-42 AC5, AC8: this event's requests, each with its session and status.
/// SPM-43 AC6: a rejected one carries Venue Staff's reason and any suggested
/// alternative. The suggestion books nothing (#45) - "Request this venue"
/// only opens the request form on the suggested room, for the same session.
/// SPM-90 AC5: each row says what its space is for, with that space's layout
/// and attendance.
/// SPM-67: a pending row can be withdrawn and an approved one released; a
/// withdrawn or released row shows the Coordinator's reason.
function BookingRequests({
  bookings,
  onChange,
  requestHrefFor,
}: {
  bookings: BookingInfo["bookings"];
  /// Null when this user cannot withdraw or release the event's bookings.
  onChange: ((booking: Booking, action: ChangeAction) => void) | null;
  /// Null when this user cannot request a booking for the event.
  requestHrefFor: ((venueId: string, sessionId: string | null) => string) | null;
}) {
  return (
    <Card>
      <CardHeader title="Booking requests" />
      <CardBody className="flex flex-col gap-3">
        {bookings.map((b) => (
          <div key={b.id} className="text-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-ink">{formatVenue(b.venue.name, b.venue.code)}</p>
                {/* SPM-90 (AC5): what the space is for first, then its own
                    layout and attendance. */}
                <p className="text-xs text-ink-3">
                  {[
                    b.purpose?.trim(),
                    b.session && (b.session.label ?? "Session"),
                    formatDateTimeRange(b.startsAt, b.endsAt),
                    b.layoutName && layoutLabel(b.layoutName),
                    b.expectedAttendance != null && `${b.expectedAttendance} attendees`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <HoldExpiryLine status={b.status} holdExpiresAt={b.holdExpiresAt ?? null} />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusBadge status={b.status} />
                {onChange && (b.status === "pending" || b.status === "approved") && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onChange(b, b.status === "pending" ? "withdraw" : "release")}
                  >
                    {CHANGE[b.status === "pending" ? "withdraw" : "release"].button}
                  </Button>
                )}
              </div>
            </div>
            {(b.status === "withdrawn" || b.status === "released") && b.cancellationReason && (
              <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-ink-2">
                <span className="font-medium text-ink">
                  {b.status === "withdrawn" ? "Reason for withdrawal:" : "Reason for release:"}
                </span>{" "}
                {b.cancellationReason}
              </p>
            )}
            {b.status === "rejected" && (b.decisionReason || b.suggestedVenue || b.suggestedAlternative) && (
              <div className="mt-2 flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2 text-ink-2">
                {b.decisionReason && (
                  <p>
                    <span className="font-medium text-ink">Reason from Venue Staff:</span> {b.decisionReason}
                  </p>
                )}
                {(b.suggestedVenue || b.suggestedAlternative) && (
                  <p>
                    <span className="font-medium text-ink">Suggested alternative:</span>{" "}
                    {[b.suggestedVenue && formatVenue(b.suggestedVenue.name, b.suggestedVenue.code), b.suggestedAlternative]
                      .filter(Boolean)
                      .join(" — ")}
                  </p>
                )}
                {b.suggestedVenue?.isActive && requestHrefFor && (
                  <div className="mt-1">
                    <ButtonLink
                      href={requestHrefFor(b.suggestedVenue.id, b.session?.id ?? null)}
                      variant="secondary"
                      size="sm"
                    >
                      Request this venue
                    </ButtonLink>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function VenueResult({ result, requestHref }: { result: Result; requestHref: string | null }) {
  const { venue, suitable, unmet, optionalMissing } = result;
  return (
    <Card className={cn(!suitable && "bg-surface-2")}>
      <CardBody className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={cn("font-medium", suitable ? "text-ink" : "text-ink-2")}>
            {formatVenue(venue.name, venue.code)}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {venue.floor ? `${venue.building} — ${venue.floor}` : venue.building} · max{" "}
            {venue.maxCapacity} overall
            {venue.layouts.length > 0 &&
              ` · ${venue.layouts.map((l) => `${layoutLabel(l.layoutName)} ${l.capacity}`).join(", ")}`}
          </p>

          {/* Which requirement failed - the point of AC6. One line each, so a
              venue failing three things shows three lines, not the first. */}
          {unmet.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-tone-warning-fg">
              {unmet.map((u, i) => (
                <li key={i}>{describeUnmet(u)}</li>
              ))}
            </ul>
          )}
          {optionalMissing.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-3">
              {optionalMissing.map((u, i) => (
                <li key={i}>Nice-to-have not available. {describeUnmet(u)}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
              suitable
                ? "bg-tone-success-bg text-tone-success-fg ring-tone-success-ring"
                : "bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-ring"
            )}
          >
            {suitable ? "Suitable" : "Not suitable"}
          </span>
          {requestHref && (
            <ButtonLink href={requestHref} size="sm">
              Request booking
            </ButtonLink>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/// SPM-82: a pending request is a tentative hold that expires unless Venue
/// Staff approve it first (AC1); an expired one stays on the record, saying
/// when it ran out (AC8). An approved booking never expires (AC11), and a hold
/// made before expiries were recorded has none - neither gets a line.
function HoldExpiryLine({ status, holdExpiresAt }: { status: string; holdExpiresAt: string | null }) {
  if (status === "pending" && holdExpiresAt) {
    return <p className="text-xs text-ink-3">Hold expires {formatDateTime(holdExpiresAt)}</p>;
  }
  if (status === "expired") {
    return (
      <p className="text-xs text-ink-3">
        {holdExpiresAt ? `Hold expired on ${formatDateTime(holdExpiresAt)}` : "Hold expired"}
      </p>
    );
  }
  return null;
}

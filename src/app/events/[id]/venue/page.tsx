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
  PageHeader,
  Select,
  SkeletonRows,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { cn } from "@/lib/cn";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";
import { describeUnmet, layoutLabel, type UnmetRequirement } from "@/lib/venueSuitability";

// SPM-41, "Find a venue" (design/mockups/VenueSearch.dc.html). Every active
// venue is judged against the event's attendance, layout, facilities and
// accessibility needs. Unsuitable venues stay visible, greyed, with the reason.
//
// SPM-42: a suitable venue gets "Request booking" (S-15); an unsuitable one
// does not (team decision, 2026-10-01). A multi-session event picks a session
// first, and venues are then judged on that session's attendance and layout.
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
  bookings: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    layoutName: string | null;
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

const MISSING_LABEL = {
  expectedAttendance: "expected attendance",
  preferredLayout: "preferred layout",
} as const;

export default function EventVenuePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [data, setData] = useState<Payload | null>(null);
  const [booking, setBooking] = useState<BookingInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

      const query = session ? `?session=${session}` : "";
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
      setData(await res.json());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router, sessionId]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(`/events/${eventId}/venue`));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router, eventId]);

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
        setNotice({
          title: words.done,
          body: `${describeBooking(target)} is now ${statusLabel(words.status)}. ${words.afterwards}`,
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

  const tabs = user ? eventTabItemsFor(user.role, eventId) : [];
  const suitableCount = data?.results.filter((r) => r.suitable).length ?? 0;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Find a venue"
        subtitle="Each venue is checked against this event's attendance, layout, facilities and accessibility needs."
        breadcrumbs={[
          { label: user?.role === "organiser" ? "My Events" : "Events", href: "/events" },
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
                onChange={(e) => setSessionId(e.target.value)}
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
                  ? `/events/${eventId}/booking/new?venue=${result.venue.id}${sessionId ? `&session=${sessionId}` : ""}`
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
                <p className="text-xs text-ink-3">
                  {b.session && `${b.session.label ?? "Session"} · `}
                  {formatDateTimeRange(b.startsAt, b.endsAt)}
                  {b.layoutName && ` · ${layoutLabel(b.layoutName)}`}
                </p>
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

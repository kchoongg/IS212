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
  Field,
  PageHeader,
  Select,
  SkeletonRows,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { RequirePermission } from "@/components/RequirePermission";
import { cn } from "@/lib/cn";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { describeUnmet, layoutLabel, type UnmetRequirement } from "@/lib/venueSuitability";

// SPM-41, "Find a venue" (design/mockups/VenueSearch.dc.html). Every active
// venue is judged against the event's attendance, layout, facilities and
// accessibility needs. Unsuitable venues stay visible, greyed, with the reason.
//
// SPM-42: a suitable venue gets "Request booking" (S-15); an unsuitable one
// does not (team decision, 2026-10-01). A multi-session event picks a session
// first, and venues are then judged on that session's attendance and layout.

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
  bookings: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    layoutName: string | null;
    decisionReason: string | null;
    suggestedAlternative: string | null;
    suggestedVenue: { id: string; code: string; name: string; isActive: boolean } | null;
    session: { id: string; label: string | null } | null;
    venue: { code: string; name: string };
  }[];
}

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

          {booking && booking.bookings.length > 0 && (
            <BookingRequests
              bookings={booking.bookings}
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
    </div>
  );
}

/// SPM-42 AC5, AC8: this event's requests, each with its session and status.
/// SPM-43 AC6: a rejected one carries Venue Staff's reason and any suggested
/// alternative. The suggestion books nothing (#45) - "Request this venue"
/// only opens the request form on the suggested room, for the same session.
function BookingRequests({
  bookings,
  requestHrefFor,
}: {
  bookings: BookingInfo["bookings"];
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
              <StatusBadge status={b.status} />
            </div>
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

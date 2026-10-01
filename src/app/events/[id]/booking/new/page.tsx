"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  Checkbox,
  DetailList,
  Field,
  Fieldset,
  Input,
  PageHeader,
  SkeletonRows,
  Textarea,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { layoutLabel } from "@/lib/venueSuitability";
import { SLOTS, slotRangeLabel, type Slot } from "@/lib/venueSlots";
import { defaultSlots, requestedWindow, setupAndTurnaround, slotCellLabel } from "@/lib/venueBookingRequest";

// S-15, Venue booking request (SPM-42). Reached from "Request booking" on the
// event's Venue tab, with the venue and (for a multi-session event) the
// session in the query string. The coordinator picks a date and one or more
// fixed slots (AC2); the setup and turnaround slots the venue adds are shown,
// not chosen (AC3). Every rule is enforced again by the server.

interface Info {
  event: { title: string | null; preferredLayout: string | null };
  schedule: { startsAt: string | null; endsAt: string | null };
  sessions: { id: string; label: string | null; startsAt: string; endsAt: string; preferredLayout: string | null }[];
  cannotRequest: string | null;
}

interface Venue {
  id: string;
  code: string;
  name: string;
  setupMinutes: number;
  teardownMinutes: number;
}

export default function BookingRequestPage() {
  return (
    // useSearchParams needs a Suspense boundary above it.
    <Suspense fallback={null}>
      <BookingRequestForm />
    </Suspense>
  );
}

function BookingRequestForm() {
  const router = useRouter();
  const eventId = useParams<{ id: string }>().id;
  const search = useSearchParams();
  const venueId = search.get("venue");
  const sessionId = search.get("session");
  const { state } = useCurrentUser();
  const backHref = `/events/${eventId}/venue`;

  const [info, setInfo] = useState<Info | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [requirementsNote, setRequirementsNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const session = info?.sessions.find((s) => s.id === sessionId) ?? null;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [infoRes, venueRes] = await Promise.all([
        authedFetch(`/api/events/${eventId}/venue-bookings`),
        authedFetch(`/api/venues/${venueId}`),
      ]);
      if (infoRes.status === 401 || venueRes.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/venue`));
        return;
      }
      if (!infoRes.ok || !venueRes.ok) throw new Error("This event or venue could not be found.");
      const loaded: Info = await infoRes.json();
      setInfo(loaded);
      setVenue(await venueRes.json());

      // AC4: start on the session's own date and slots, or the event's.
      const own = loaded.sessions.find((s) => s.id === sessionId) ?? loaded.schedule;
      const start = own.startsAt && own.endsAt ? defaultSlots({ startsAt: new Date(own.startsAt), endsAt: new Date(own.endsAt) }) : null;
      if (start) {
        setDay(start.day);
        setSlots(start.slots);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, venueId, sessionId, router]);

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

  const holds = useMemo(() => {
    if (!venue) return null;
    const window = day ? requestedWindow(day, slots) : null;
    return window ? setupAndTurnaround(window, venue) : null;
  }, [venue, day, slots]);

  function toggle(slot: Slot) {
    setSlots((current) => (current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/venue-bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, sessionId: sessionId ?? undefined, day, slots, requirementsNote }),
      });
      if (res.ok) {
        setSent(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setSubmitError(body.error === "Validation failed" ? "Check the date and slots, then try again." : body.error);
    } catch {
      setSubmitError("Could not send the request. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <PageHeader
      title="Request a venue booking"
      breadcrumbs={[
        { label: "Events", href: "/events" },
        { label: "Event", href: `/events/${eventId}` },
        { label: "Venue", href: backHref },
        { label: "Request booking" },
      ]}
    />
  );

  if (loadError || !venueId) {
    return (
      <div className="max-w-2xl">
        {header}
        <Alert variant="error" title="Could not load this">
          {loadError ?? "Choose a venue from the event's Venue tab first."}
        </Alert>
      </div>
    );
  }
  if (!info || !venue) {
    return (
      <div className="max-w-2xl">
        {header}
        <SkeletonRows rows={4} />
      </div>
    );
  }

  const layout = session ? session.preferredLayout : info.event.preferredLayout;
  const noTurnaround = venue.setupMinutes === 0 && venue.teardownMinutes === 0;

  return (
    <div className="max-w-2xl">
      {header}

      {sent ? (
        <Alert
          variant="success"
          title="Booking request sent to Venue Staff."
          action={<ButtonLink href={backHref} variant="secondary" size="sm">Back to Venue</ButtonLink>}
        >
          It is Pending until Venue Staff review it.
        </Alert>
      ) : info.cannotRequest ? (
        <Alert variant="info">{info.cannotRequest}</Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Card>
            <CardBody>
              <DetailList
                items={[
                  { label: "Event", value: info.event.title ?? "Untitled event" },
                  ...(session
                    ? [{ label: "Session", value: `${session.label ?? "Session"} — ${formatDateTimeRange(session.startsAt, session.endsAt)}` }]
                    : []),
                  { label: "Venue", value: formatVenue(venue.name, venue.code) },
                  { label: "Layout", value: layout ? layoutLabel(layout) : "Not set" },
                ]}
              />
            </CardBody>
          </Card>

          <Field label="Date" required>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </Field>

          <Fieldset legend="Slots" description="Each slot is booked in full.">
            {SLOTS.map((slot) => (
              <Checkbox
                key={slot}
                label={`${slot} (${slotRangeLabel(slot)})`}
                checked={slots.includes(slot)}
                onChange={() => toggle(slot)}
              />
            ))}
          </Fieldset>

          <div className="text-sm text-ink-2">
            {noTurnaround ? (
              <p>No setup or turnaround needed at this venue.</p>
            ) : holds ? (
              <>
                {holds.setup && <p>Setup: {slotCellLabel(holds.setup)}</p>}
                {holds.turnaround && <p>Turnaround: {slotCellLabel(holds.turnaround)}</p>}
              </>
            ) : null}
          </div>

          <Field label="Venue requirements" hint="Optional. Anything Venue Staff need to set up.">
            <Textarea value={requirementsNote} onChange={(e) => setRequirementsNote(e.target.value)} maxLength={2000} />
          </Field>

          {submitError && <Alert variant="error">{submitError}</Alert>}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
            <ButtonLink href={backHref} variant="secondary">
              Cancel
            </ButtonLink>
          </div>
        </form>
      )}
    </div>
  );
}

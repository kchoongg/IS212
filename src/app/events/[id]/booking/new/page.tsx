"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  DetailList,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Textarea,
} from "@/components/ui";
import { BeginPlanningDialog } from "@/components/BeginPlanningDialog";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { LAYOUTS, toOptions } from "@/lib/eventForm";
import {
  DEFAULT_SPACE_PURPOSE,
  SPACE_ATTENDANCE_ERROR,
  SPACE_PURPOSE_MAX,
  SPACE_PURPOSE_REQUIRED,
  parseSpaceAttendance,
} from "@/lib/venueSuitability";
import { timeRangeLabel } from "@/lib/venueTime";
import {
  checkRequestTimes,
  defaultTimes,
  requestedWindow,
  setupAndTurnaround,
  type RequestTimeErrors,
} from "@/lib/venueBookingRequest";

// S-15, Venue booking request (SPM-42). Reached from "Request booking" on the
// event's Venue tab, with the venue and (for a multi-session event) the
// session in the query string. Since SPM-93 the coordinator gives a date and a
// start and end time on the 15-minute grid (AC1), starting from the event's or
// session's own times widened to the grid (AC2). The setup and turnaround the
// venue adds, and the whole time the room is in use, are shown, not chosen
// (AC6). Every rule is enforced again by the server.
//
// SPM-90: the coordinator also says what this space is for, and its expected
// attendance and room layout (AC1). They start on the event's own, or the
// session's (AC2), or on what the Venue tab was last checked for when its
// "Request booking" carried a space here. The venue is judged against them.

interface Info {
  event: { title: string | null; preferredLayout: string | null; expectedAttendance?: number | null };
  schedule: { startsAt: string | null; endsAt: string | null };
  sessions: {
    id: string;
    label: string | null;
    startsAt: string;
    endsAt: string;
    preferredLayout: string | null;
    expectedAttendance?: number | null;
  }[];
  cannotRequest: string | null;
  /// The event's requests so far - whether this is its first room (SPM-90).
  bookings: { status: string; session: { id: string } | null }[];
  /// SPM-54: this request would move the event from Approved to Planning.
  willBeginPlanning?: boolean;
}

const LAYOUT_OPTIONS = [{ value: "", label: "Not set" }, ...toOptions(LAYOUTS)];

/// The statuses in which a booking holds, or asks for, a room.
const ACTIVE_BOOKING = ["pending", "approved"];

type SpaceErrors = { purpose?: string; attendance?: string };

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
  // SPM-90: the space the Venue tab was last checked for, if it sent one.
  const spaceAttendance = search.get("attendance");
  const spaceLayout = search.get("layout");
  // SPM-68: what the space is for, when a flagged booking's replacement is
  // being requested - the same space the booking being replaced was for.
  const spacePurpose = search.get("purpose");
  const { state } = useCurrentUser();
  const backHref = `/events/${eventId}/venue`;

  const [info, setInfo] = useState<Info | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [timeErrors, setTimeErrors] = useState<RequestTimeErrors>({});
  // SPM-90: the space this room is for.
  const [purpose, setPurpose] = useState("");
  const [attendance, setAttendance] = useState("");
  const [layoutName, setLayoutName] = useState("");
  const [spaceErrors, setSpaceErrors] = useState<SpaceErrors>({});
  const [requirementsNote, setRequirementsNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [planningStarted, setPlanningStarted] = useState(false);
  /// Open while the coordinator is being asked whether to begin planning.
  const [confirmPlanning, setConfirmPlanning] = useState(false);

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

      // SPM-93 AC2: start on the session's own times, or the event's, widened
      // to the 15-minute grid.
      // SPM-90 (AC2): the space starts on the session's own attendance and
      // layout, or the event's - unless the Venue tab sent a space along.
      const asked = loaded.sessions.find((s) => s.id === sessionId) ?? loaded.event;
      setAttendance(spaceAttendance ?? asked.expectedAttendance?.toString() ?? "");
      setLayoutName(spaceLayout ?? asked.preferredLayout ?? "");
      // The first room of an event (or of a session) is its main programme;
      // a further one has to be named.
      const others = loaded.bookings.filter(
        (b) => ACTIVE_BOOKING.includes(b.status) && (!sessionId || b.session?.id === sessionId)
      );
      setPurpose(spacePurpose ?? (others.length === 0 ? DEFAULT_SPACE_PURPOSE : ""));

      const own = loaded.sessions.find((s) => s.id === sessionId) ?? loaded.schedule;
      const start = own.startsAt && own.endsAt ? defaultTimes({ startsAt: new Date(own.startsAt), endsAt: new Date(own.endsAt) }) : null;
      if (start) {
        setDay(start.day);
        setStartTime(start.startTime);
        setEndTime(start.endTime);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, venueId, sessionId, spaceAttendance, spaceLayout, spacePurpose, router]);

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

  // Only once the times themselves are acceptable - an off-grid or inverted
  // pair has no room-in-use period worth showing.
  const holds = useMemo(() => {
    if (!venue || Object.keys(checkRequestTimes({ startTime, endTime })).length > 0) return null;
    const window = requestedWindow(day, startTime, endTime);
    return window ? setupAndTurnaround(window, venue) : null;
  }, [venue, day, startTime, endTime]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    // SPM-90 AC1: what the space is for, and a real attendance for it.
    const space: SpaceErrors = {};
    if (purpose.trim() === "") space.purpose = SPACE_PURPOSE_REQUIRED;
    if (parseSpaceAttendance(attendance) === null) space.attendance = SPACE_ATTENDANCE_ERROR;
    setSpaceErrors(space);
    // AC3: an off-grid time, or an end not after the start, is named under its
    // field. The server checks the same rule.
    const errors = checkRequestTimes({ startTime, endTime });
    setTimeErrors(errors);
    if (Object.keys(errors).length > 0 || Object.keys(space).length > 0) return;
    // SPM-54: the first request for an Approved event begins planning - ask first.
    if (info?.willBeginPlanning) {
      setConfirmPlanning(true);
      return;
    }
    void send();
  }

  async function send() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/venue-bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId,
          sessionId: sessionId ?? undefined,
          day,
          startTime,
          endTime,
          requirementsNote,
          purpose: purpose.trim(),
          // Checked in submit(): a whole number of at least 1.
          expectedAttendance: Number(attendance),
          layoutName: layoutName || null,
        }),
      });
      if (res.ok) {
        // SPM-54: the first request for an Approved event begins planning.
        const created = await res.json().catch(() => ({}));
        setPlanningStarted(created.planningStarted === true);
        setSent(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.field === "startTime" || body.field === "endTime") {
        setTimeErrors({ [body.field]: body.error });
        return;
      }
      setSubmitError(body.error === "Validation failed" ? "Check the date and times, then try again." : body.error);
    } catch {
      setSubmitError("Could not send the request. Try again.");
    } finally {
      setSubmitting(false);
      setConfirmPlanning(false);
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

  const noTurnaround = venue.setupMinutes === 0 && venue.teardownMinutes === 0;

  return (
    <div className="max-w-2xl">
      {header}

      {sent ? (
        <div className="flex flex-col gap-4">
          <Alert
            variant="success"
            title="Booking request sent to Venue Staff."
            action={<ButtonLink href={backHref} variant="secondary" size="sm">Back to Venue</ButtonLink>}
          >
            It is Pending until Venue Staff review it.
          </Alert>
          {planningStarted && (
            <Alert variant="success" title="Planning has started">
              This event has moved from Approved to Planning now that a venue booking has been requested.
            </Alert>
          )}
        </div>
      ) : info.cannotRequest ? (
        <Alert variant="info">{info.cannotRequest}</Alert>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Card>
            <CardBody>
              <DetailList
                items={[
                  { label: "Event", value: info.event.title ?? "Untitled event" },
                  ...(session
                    ? [{ label: "Session", value: `${session.label ?? "Session"} — ${formatDateTimeRange(session.startsAt, session.endsAt)}` }]
                    : []),
                  { label: "Venue", value: formatVenue(venue.name, venue.code) },
                ]}
              />
            </CardBody>
          </Card>

          {/* SPM-90 AC1: the space this room is for. The venue is judged
              against this attendance and layout, not the whole event's. */}
          <Field
            label="What is this space for?"
            required
            hint="For example main programme or breakout room."
            error={spaceErrors.purpose}
          >
            <Input
              value={purpose}
              maxLength={SPACE_PURPOSE_MAX}
              onChange={(e) => {
                setPurpose(e.target.value);
                setSpaceErrors((current) => ({ ...current, purpose: undefined }));
              }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expected attendance for this space" required error={spaceErrors.attendance}>
              <Input
                type="number"
                min={1}
                value={attendance}
                onChange={(e) => {
                  setAttendance(e.target.value);
                  setSpaceErrors((current) => ({ ...current, attendance: undefined }));
                }}
              />
            </Field>
            <Field label="Room layout">
              <Select value={layoutName} onChange={(e) => setLayoutName(e.target.value)} options={LAYOUT_OPTIONS} />
            </Field>
          </div>

          <Field label="Date" required>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </Field>

          {/* No `step` on the time fields: the browser would then block an
              off-grid time itself, before the page can say which one (AC3). */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time" required hint="In 15-minute steps." error={timeErrors.startTime}>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setTimeErrors({});
                }}
              />
            </Field>
            <Field label="End time" required error={timeErrors.endTime}>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setTimeErrors({});
                }}
              />
            </Field>
          </div>

          <div className="text-sm text-ink-2">
            {noTurnaround && <p>No setup or turnaround needed at this venue.</p>}
            {holds && (
              <>
                {holds.setup && <p>Setup: {timeRangeLabel(holds.setup)} ({venue.setupMinutes} min)</p>}
                {holds.turnaround && <p>Turnaround: {timeRangeLabel(holds.turnaround)} ({venue.teardownMinutes} min)</p>}
                <p className="font-medium text-ink">Room in use: {timeRangeLabel(holds.occupied)}</p>
              </>
            )}
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

      <BeginPlanningDialog
        open={confirmPlanning}
        loading={submitting}
        onConfirm={() => void send()}
        onCancel={() => setConfirmPlanning(false)}
      />
    </div>
  );
}

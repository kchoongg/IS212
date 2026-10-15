"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  DataState,
  DetailList,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { authedFetch } from "@/lib/session";
import { loginUrlFor } from "@/lib/useCurrentUser";
import { formatDateTime, formatDateTimeRange, formatVenue } from "@/lib/format";
import { toLocalInput } from "@/lib/holdExpiry";
import { statusLabel } from "@/lib/statuses";
import { layoutLabel } from "@/lib/venueSuitability";
import { localDayKey, occupiedWindow, timeRangeLabel } from "@/lib/venueTime";
import { setupAndTurnaround } from "@/lib/venueBookingRequest";
import { BOOKING_REJECTION_REASON_REQUIRED } from "@/lib/venueBookingReview";

// S-22, Booking Requests (design/mockups/BookingQueue.dc.html). SPM-42 AC7
// built the pending list; SPM-43 makes it the place Venue Staff decide:
//   AC1, AC2  each pending request with its venue, date, times and event
//   AC3       Approve, behind a confirm dialog naming what it books
//   AC4-AC6   Reject, with a required reason and an optional suggestion -
//             another venue and/or an alternative arrangement - for the
//             coordinator to act on. One form, because AC6 offers the
//             suggestion "when rejecting" (the mockup's separate "Suggest
//             another room" button is folded into it).
// A request that would clash is flagged before anyone clicks Approve; the
// server checks again either way. SPM-93 AC8: each request shows its times and
// the whole time the room is in use, setup and turnaround included.

interface Request {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  layoutName: string | null;
  /// SPM-90: what the space is for, and how many people it is for. Both null
  /// on a request made before they were recorded.
  purpose?: string | null;
  /// SPM-82 (AC1): when this tentative hold expires; null on a request made
  /// before holds expired.
  holdExpiresAt?: string | null;
  expectedAttendance?: number | null;
  requirementsNote: string | null;
  requester: { fullName: string };
  event: {
    reference: string;
    title: string | null;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    expectedAttendance: number | null;
    organisation: string | null;
  };
  session: { label: string | null; startsAt: string; endsAt: string; expectedAttendance: number | null } | null;
  venue: { id: string; code: string; name: string; setupMinutes: number; teardownMinutes: number };
  conflict: string | null;
}

interface VenueOption {
  id: string;
  code: string;
  name: string;
}

interface RejectForm {
  reason: string;
  suggestedVenueId: string;
  suggestedAlternative: string;
}

const EMPTY_FORM: RejectForm = { reason: "", suggestedVenueId: "", suggestedAlternative: "" };

export default function BookingsPage() {
  return (
    <RequirePermission
      action="venue_booking:decide"
      title="Booking Requests"
      reason="Reviewing venue bookings is Venue Staff's role."
    >
      <BookingRequests />
    </RequirePermission>
  );
}

const windowOf = (r: Request) => ({ startsAt: new Date(r.startsAt), endsAt: new Date(r.endsAt) });
const timesOf = (r: Request) => formatDateTimeRange(r.startsAt, r.endsAt);
const eventName = (r: Request) => `${r.event.reference} ${r.event.title ?? "Untitled event"}`;

function BookingRequests() {
  const router = useRouter();
  const [rows, setRows] = useState<Request[] | null>(null);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // One request is acted on at a time.
  const [approving, setApproving] = useState<Request | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [form, setForm] = useState<RejectForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<{ reason?: string; suggestedVenueId?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/venue-bookings");
      if (res.status === 401) {
        router.push(loginUrlFor("/bookings"));
        return;
      }
      if (!res.ok) throw new Error("Could not load booking requests.");
      setRows(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // The venues Venue Staff can suggest instead (AC6). The picker is optional,
    // so a failure here leaves it empty rather than blocking the screen.
    authedFetch("/api/venues")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: VenueOption[]) => setVenues([...list].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setVenues([]));
  }, [load]);

  function startReject(id: string) {
    setRejectingId(id);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setActionError(null);
  }

  function cancelReject() {
    setRejectingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
  }

  async function decide(request: Request, body: Record<string, unknown>) {
    setSubmitting(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/venue-bookings/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push(loginUrlFor("/bookings"));
        return;
      }
      if (!res.ok) {
        const failure = await res.json().catch(() => null);
        const message = failure?.error ?? "Could not save your decision. Please try again.";
        if (failure?.field === "reason" || failure?.field === "suggestedVenueId") {
          setFieldErrors({ [failure.field]: message });
        } else {
          setActionError({ id: request.id, message });
          // The list may be stale - decided elsewhere, or a room just taken.
          void load();
        }
        return;
      }

      const what = `${formatVenue(request.venue.name, request.venue.code)} for ${eventName(request)} on ${timesOf(request)}`;
      setNotice(
        body.decision === "approve"
          ? {
              title: "Booking approved",
              body: `${what} is now ${statusLabel("approved")} — the room is booked.`,
            }
          : {
              title: "Booking request rejected",
              body: `${what} is now ${statusLabel("rejected")}. The Coordinator can see your reason${
                form.suggestedVenueId || form.suggestedAlternative.trim() ? " and suggestion" : ""
              } on the event's Venue tab.`,
            }
      );
      cancelReject();
      // Reloaded rather than filtered locally: an approval can put another
      // pending request for the same room into conflict.
      await load();
    } catch {
      setActionError({ id: request.id, message: "Could not save your decision. Please try again." });
    } finally {
      setSubmitting(false);
      setApproving(null);
    }
  }

  function submitReject(request: Request) {
    if (form.reason.trim() === "") {
      setFieldErrors({ reason: BOOKING_REJECTION_REASON_REQUIRED });
      return;
    }
    void decide(request, {
      decision: "reject",
      reason: form.reason.trim(),
      suggestedVenueId: form.suggestedVenueId || undefined,
      suggestedAlternative: form.suggestedAlternative.trim() || undefined,
    });
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Booking Requests"
        subtitle={
          rows && rows.length > 0
            ? `${rows.length} pending ${rows.length === 1 ? "decision" : "decisions"}.`
            : "Venue bookings requested by coordinators, waiting for review."
        }
      />

      {notice && (
        <Alert variant="success" title={notice.title} className="mb-4">
          {notice.body}
        </Alert>
      )}

      {/* A refusal whose request has since left the list - decided in another
          tab, say - has no card to sit on, so it is shown here instead. */}
      {actionError && rows && !rows.some((r) => r.id === actionError.id) && (
        <Alert variant="error" className="mb-4">
          {actionError.message}
        </Alert>
      )}

      <DataState
        data={rows}
        error={error}
        onRetry={() => void load()}
        empty={{
          title: "No pending booking requests",
          description: "When a coordinator requests a venue, it appears here for you to approve or reject.",
        }}
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            {data.map((request) => (
              <RequestCard
                key={request.id}
                onExpiryChanged={(id, holdExpiresAt) => {
                  setRows((current) => current && current.map((r) => (r.id === id ? { ...r, holdExpiresAt } : r)));
                  setNotice({
                    title: "Hold expiry changed",
                    body: `Hold expiry changed to ${formatDateTime(holdExpiresAt)}.`,
                  });
                }}
                request={request}
                venues={venues.filter((v) => v.id !== request.venue.id)}
                rejecting={rejectingId === request.id}
                form={form}
                fieldErrors={fieldErrors}
                submitting={submitting}
                actionError={actionError?.id === request.id ? actionError.message : null}
                onApprove={() => {
                  cancelReject();
                  setActionError(null);
                  setApproving(request);
                }}
                onStartReject={() => startReject(request.id)}
                onCancelReject={cancelReject}
                onChange={(patch) => {
                  setForm((current) => ({ ...current, ...patch }));
                  setFieldErrors({});
                }}
                onSubmitReject={() => submitReject(request)}
              />
            ))}
          </div>
        )}
      </DataState>

      <ConfirmDialog
        open={approving !== null}
        title="Approve this booking?"
        confirmLabel="Approve"
        confirmVariant="primary"
        loading={submitting}
        onConfirm={() => approving && void decide(approving, { decision: "approve" })}
        onCancel={() => setApproving(null)}
      >
        {approving && <ApproveSummary request={approving} />}
      </ConfirmDialog>
    </div>
  );
}

/// What approving books: the request's times, and the whole time the room is
/// then out of use (SPM-93 AC8).
function ApproveSummary({ request }: { request: Request }) {
  const [from, to] = timeRangeLabel(occupiedWindow(windowOf(request), request.venue)).split("–").map((part) => part.trim());
  const withTurnaround = request.venue.setupMinutes > 0 || request.venue.teardownMinutes > 0;
  return (
    <>
      This books {formatVenue(request.venue.name, request.venue.code)} for {eventName(request)} on {timesOf(request)}.
      No other event can then be booked into the room from {from} to {to}
      {withTurnaround ? ", which includes its setup and turnaround time." : "."}
    </>
  );
}

interface RequestCardProps {
  request: Request;
  venues: VenueOption[];
  rejecting: boolean;
  form: RejectForm;
  fieldErrors: { reason?: string; suggestedVenueId?: string };
  submitting: boolean;
  actionError: string | null;
  onApprove: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onChange: (patch: Partial<RejectForm>) => void;
  onSubmitReject: () => void;
  /// SPM-82 (AC3): Venue Staff moved the hold's expiry.
  onExpiryChanged: (id: string, holdExpiresAt: string) => void;
}

function RequestCard({
  request,
  venues,
  rejecting,
  form,
  fieldErrors,
  submitting,
  actionError,
  onApprove,
  onStartReject,
  onCancelReject,
  onChange,
  onSubmitReject,
  onExpiryChanged,
}: RequestCardProps) {
  const window = windowOf(request);
  const holds = setupAndTurnaround(window, request.venue);
  // A session's own times where the request is for one (SPM-42 AC4).
  const schedule = request.session ?? request.event;
  // SPM-90: the attendance of the space being asked for, not the event's
  // total. The session's or event's is the fallback for an older request.
  const attendance =
    request.expectedAttendance ?? request.session?.expectedAttendance ?? request.event.expectedAttendance;

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-ink">
              {request.venue.name} <span className="font-sans font-normal text-ink-3">({request.venue.code})</span>
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">
              for{" "}
              <Link href={`/events/${request.event.reference}`} className="font-medium text-ink hover:underline">
                {request.event.reference}
              </Link>{" "}
              {request.event.title ?? "Untitled event"}
              {request.event.organisation && ` · ${request.event.organisation}`}
            </p>
            {request.session && (
              <p className="text-xs text-ink-3">Session: {request.session.label ?? "Session"}</p>
            )}
          </div>
          {/* Text as well as colour (UI_DESIGN.md §8). Not a StatusBadge: a
              conflict is computed, not a stored status. */}
          {request.conflict ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-tone-danger-bg px-2.5 py-0.5 text-xs font-medium text-tone-danger-fg ring-1 ring-inset ring-tone-danger-ring">
              Conflict
            </span>
          ) : (
            <StatusBadge status={request.status} className="shrink-0" />
          )}
        </div>

        <DetailList
          items={[
            {
              label: "Requested",
              value: (
                <>
                  {timesOf(request)}
                  {holds.setup && (
                    <span className="block text-xs text-ink-3">
                      Setup: {timeRangeLabel(holds.setup)} ({request.venue.setupMinutes} min)
                    </span>
                  )}
                  {holds.turnaround && (
                    <span className="block text-xs text-ink-3">
                      Turnaround: {timeRangeLabel(holds.turnaround)} ({request.venue.teardownMinutes} min)
                    </span>
                  )}
                  <span className="block text-xs text-ink-2">Room in use: {timeRangeLabel(holds.occupied)}</span>
                </>
              ),
            },
            // SPM-82 (AC1, AC3): when this tentative hold expires unless
            // approved first, and the way to move it.
            { label: "Hold expires", value: <HoldExpiry request={request} onChanged={onExpiryChanged} /> },
            {
              label: request.session ? "Session time" : "Event time",
              value: formatDateTimeRange(schedule.startsAt, schedule.endsAt),
            },
            // SPM-90 (AC5): what this room is wanted for.
            { label: "Space", value: request.purpose?.trim() || "Not recorded" },
            { label: "Layout", value: request.layoutName ? layoutLabel(request.layoutName) : "Not set" },
            { label: "Expected attendance", value: attendance ?? "Not set" },
            { label: "Venue requirements", value: request.requirementsNote ?? "None given" },
            {
              label: "Requested by",
              value: (
                <>
                  {request.requester.fullName}
                  <span className="block text-xs text-ink-3">Event is {statusLabel(request.event.status)}</span>
                </>
              ),
            },
          ]}
        />

        {request.conflict && (
          <Alert
            variant="error"
            title="This request cannot be approved as it stands"
            action={
              <Link
                href={`/venues/${request.venue.id}/availability?from=${localDayKey(window.startsAt)}`}
                className="text-sm font-medium underline"
              >
                Open the calendar
              </Link>
            }
          >
            {request.conflict}
          </Alert>
        )}

        {actionError && <Alert variant="error">{actionError}</Alert>}

        {rejecting ? (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <Field
              label="Reason for rejection"
              required
              hint="The Coordinator sees this message."
              error={fieldErrors.reason}
            >
              <Textarea
                value={form.reason}
                onChange={(e) => onChange({ reason: e.target.value })}
                placeholder="Explain why this venue cannot be made available…"
                maxLength={2000}
                rows={3}
              />
            </Field>
            <Field
              label="Suggest another venue"
              hint="Optional. Nothing is booked — the Coordinator reviews it and submits a new request."
              error={fieldErrors.suggestedVenueId}
            >
              <Select
                value={form.suggestedVenueId}
                onChange={(e) => onChange({ suggestedVenueId: e.target.value })}
                options={[
                  { value: "", label: "No venue suggested" },
                  ...venues.map((v) => ({ value: v.id, label: formatVenue(v.name, v.code) })),
                ]}
              />
            </Field>
            <Field
              label="Alternative arrangement"
              hint="Optional. For example another date or time, or a different layout."
            >
              <Textarea
                value={form.suggestedAlternative}
                onChange={(e) => onChange({ suggestedAlternative: e.target.value })}
                maxLength={2000}
                rows={2}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={onSubmitReject} loading={submitting} loadingText="Rejecting…">
                Reject request
              </Button>
              <Button variant="secondary" onClick={onCancelReject} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={onApprove} disabled={Boolean(request.conflict) || submitting}>
              Approve
            </Button>
            <Button variant="danger" onClick={onStartReject} disabled={submitting}>
              Reject with a reason
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/// SPM-82 (AC1, AC3): the hold's expiry, and Venue Staff's way to move it
/// while the hold is active - to any time from now up to the start of the event
/// (the server's rule, checkHoldExpiryChange(), whose refusal is shown here).
function HoldExpiry({
  request,
  onChanged,
}: {
  request: Request;
  onChanged: (id: string, holdExpiresAt: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = request.holdExpiresAt ?? null;

  function start() {
    setValue(current ? toLocalInput(new Date(current)) : "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (!value) {
      setError("Choose the date and time the hold should expire.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/venue-bookings/${request.id}/expiry`, {
        method: "PATCH",
        // The field is the browser's own wall clock; the server stores an instant.
        body: JSON.stringify({ holdExpiresAt: new Date(value).toISOString() }),
      });
      if (res.status === 401) {
        router.push(loginUrlFor("/bookings"));
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not change the expiry. Try again.");
        return;
      }
      setEditing(false);
      onChanged(request.id, body.holdExpiresAt ?? new Date(value).toISOString());
    } catch {
      setError("Could not change the expiry. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <span>{current ? formatDateTime(current) : "No expiry set"}</span>
      {!editing && (
        <Button variant="secondary" size="sm" className="ml-3" onClick={start}>
          Change expiry
        </Button>
      )}
      {editing && (
        <div className="mt-2 flex flex-col gap-2">
          <Field label="New expiry" error={error ?? undefined}>
            <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} loading={saving} loadingText="Saving…">
              Save expiry
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

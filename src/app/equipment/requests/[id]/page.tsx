"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataState,
  Field,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { formatDate, formatDateTime, formatDateTimeRange, orEmpty } from "@/lib/format";
import { eventAllowsReserving, reservingClosedMessage } from "@/lib/equipmentAvailability";
import {
  type FulfilmentRefusal,
  checkFulfilmentUpdate,
  eventAllowsFulfilmentUpdate,
  fulfilmentOptionsFor,
} from "@/lib/equipmentFulfilment";
import { availabilityStatusKey, statusLabel } from "@/lib/statuses";

// S-25 (detail). SPM-48: for each equipment line an event has requested, is
// there enough suitable stock free for its dates? Shown automatically on load -
// the mockup (design/mockups/EquipmentRequests.dc.html) has no "check" button.
//
// SPM-49 (reserve): a line that still has something to give can be reserved
// with one click - no quantity to type in, see the Reserve button below and
// POST .../reserve. Reserving is its own permission (canReserveEquipment),
// checked server-side; this page only decides whether to show the button.
//
// SPM-50 (review and update): each line also shows the Coordinator's
// technical requirements (AC1) and Technical Support's own update - an
// "Update" panel per line to set the fulfilment status and record technical
// notes (AC2-AC4). The rules are in src/lib/equipmentFulfilment.ts, shared
// with PATCH .../fulfilment.

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
  technicalRequirements: string | null;
  staffNotes: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
}

interface UpdateDraft {
  status: string;
  staffNotes: string;
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
  // SPM-50: the one line whose Update panel is open, and what is typed in it.
  const [editing, setEditing] = useState<{ requestId: string; draft: UpdateDraft } | null>(null);
  const [updateError, setUpdateError] = useState<FulfilmentRefusal | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [updateNotices, setUpdateNotices] = useState<Record<string, string>>({});

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
        // Also what Technical Support gets for an event the Coordinator has
        // not started planning yet (TECH_SUPPORT_EQUIPMENT_STATUSES).
        setError("This event was not found, or its equipment is not ready for Technical Support yet.");
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

  function startUpdate(line: Line) {
    setEditing({ requestId: line.requestId, draft: { status: line.requestStatus, staffNotes: line.staffNotes ?? "" } });
    setUpdateError(null);
    setUpdateNotices((current) => ({ ...current, [line.requestId]: "" }));
  }

  function cancelUpdate() {
    setEditing(null);
    setUpdateError(null);
  }

  async function saveUpdate(line: Line) {
    if (!editing) return;
    const { draft } = editing;
    // Same rules the route enforces - checked here first so the message
    // appears without a round trip.
    const refusal = checkFulfilmentUpdate(line.requestStatus, draft.status, draft.staffNotes);
    if (refusal) {
      setUpdateError(refusal);
      return;
    }

    setSavingUpdate(true);
    setUpdateError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment/${line.requestId}/fulfilment`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(path));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setUpdateError({
          message: body?.error ?? "Could not save this update.",
          field: body?.field === "staffNotes" ? "staffNotes" : null,
        });
        return;
      }
      setEditing(null);
      setUpdateNotices((current) => ({ ...current, [line.requestId]: "Update saved." }));
      // Marking a reserved line "Cannot be provided" frees its units, which changes
      // what every other line on the page shows - re-read the whole request.
      await load();
    } catch {
      setUpdateError({ message: "Could not reach the server.", field: null });
    } finally {
      setSavingUpdate(false);
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
  // SPM-50: the same rule as reserving - Planning only (BPMN).
  const updatingOpen = event ? eventAllowsFulfilmentUpdate(event.status) : false;

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
                  canUpdate={isTechSupport && updatingOpen}
                  draft={editing?.requestId === line.requestId ? editing.draft : null}
                  updateError={editing?.requestId === line.requestId ? updateError : null}
                  savingUpdate={savingUpdate}
                  updateNotice={updateNotices[line.requestId]}
                  onStartUpdate={() => startUpdate(line)}
                  onChangeDraft={(draft) => {
                    setEditing({ requestId: line.requestId, draft });
                    setUpdateError(null);
                  }}
                  onCancelUpdate={cancelUpdate}
                  onSaveUpdate={() => saveUpdate(line)}
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
  canUpdate: boolean;
  /// Non-null while this line's Update panel is open.
  draft: UpdateDraft | null;
  updateError: FulfilmentRefusal | null;
  savingUpdate: boolean;
  updateNotice?: string;
  onStartUpdate: () => void;
  onChangeDraft: (draft: UpdateDraft) => void;
  onCancelUpdate: () => void;
  onSaveUpdate: () => void;
}

function LineRow({
  line,
  canReserve,
  reserving,
  reserveError,
  reserveNotice,
  onReserve,
  canUpdate,
  draft,
  updateError,
  savingUpdate,
  updateNotice,
  onStartUpdate,
  onChangeDraft,
  onCancelUpdate,
  onSaveUpdate,
}: LineRowProps) {
  const { result } = line;
  const statusOptions = fulfilmentOptionsFor(line.requestStatus);
  // Errors about the notes go under the notes field; anything else (a lost
  // race, a closed event) goes above the panel.
  const notesError = updateError?.field === "staffNotes" ? updateError.message : null;
  const panelError = updateError && updateError.field !== "staffNotes" ? updateError.message : null;

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

        <LineDetail label="Technical requirements" value={line.technicalRequirements} />
        <LineDetail label="Technical Support notes" value={line.staffNotes} />
        {line.reviewedByName && line.reviewedAt && (
          <p className="text-xs text-ink-3">
            Last updated by {line.reviewedByName}, {formatDateTime(line.reviewedAt)}
          </p>
        )}
        {updateNotice && <p className="text-xs text-tone-success-fg">{updateNotice}</p>}

        {draft && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSaveUpdate();
            }}
            className="mt-2 flex max-w-xl flex-col gap-3 rounded-md border border-line bg-surface-2 p-3"
            noValidate
          >
            {panelError && <Alert variant="error">{panelError}</Alert>}
            <Field label="Fulfilment status">
              <Select
                options={statusOptions.map((s) => ({ value: s, label: statusLabel(s) }))}
                value={draft.status}
                onChange={(e) => onChangeDraft({ ...draft, status: e.target.value })}
              />
            </Field>
            <Field
              label="Technical notes"
              hint={
                draft.status === "unavailable"
                  ? "Required: why it cannot be provided, and any alternative you can suggest."
                  : "Anything the Coordinator or the team should know - setup, alternatives, constraints."
              }
              error={notesError}
            >
              <Textarea
                value={draft.staffNotes}
                onChange={(e) => onChangeDraft({ ...draft, staffNotes: e.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={savingUpdate} loadingText="Saving…">
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelUpdate} disabled={savingUpdate}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        {/* Fixed-width columns, so Requested, Reserved and the chips line up
            from one row to the next whatever the chips say. Two by two on a
            phone - four fixed columns are wider than its screen. */}
        <div className="grid grid-cols-2 gap-4 text-center text-sm sm:grid-cols-[4rem_4rem_9.5rem_7rem]">
          <Column label="Requested">
            <NumberBox value={line.quantityRequested} />
          </Column>
          <Column label="Reserved">
            <NumberBox value={line.quantityReserved} />
          </Column>
          {/* SPM-50: the line's own fulfilment status - what Technical Support
              has decided - kept apart from Availability, which is worked out
              from stock ("Cannot be provided" vs "None available"). */}
          <Column label="Status">
            <div className="flex h-9 items-center justify-center">
              <StatusBadge status={line.requestStatus} />
            </div>
          </Column>
          <Column label="Availability">
            <div className="flex h-9 items-center justify-center">
              {result ? <StatusBadge status={availabilityStatusKey(result.status)} /> : <span className="text-ink-3">—</span>}
            </div>
          </Column>
        </div>
        <div className="flex gap-2">
          {canUpdate && !draft && statusOptions.length > 0 && (
            <Button variant="secondary" size="sm" onClick={onStartUpdate}>
              Update
            </Button>
          )}
          {canReserve && canOfferReserve(line) && (
            <Button variant="secondary" size="sm" onClick={onReserve} disabled={reserving}>
              {reserving ? "Reserving…" : "Reserve"}
            </Button>
          )}
        </div>
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

/// A labelled line of text under the availability figures; "—" when empty.
function LineDetail({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="text-xs text-ink-2">
      <span className="font-medium text-ink">{label}:</span> {orEmpty(value)}
    </p>
  );
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
    <div className="mx-auto flex h-9 w-16 items-center justify-center rounded-md border border-line-strong bg-surface text-base text-ink">
      {value ?? "—"}
    </div>
  );
}

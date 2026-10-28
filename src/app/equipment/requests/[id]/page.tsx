"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { formatDate, formatDateTime, formatDateTimeRange, orEmpty } from "@/lib/format";
import {
  RECHECK_REQUEST_STATUSES,
  eventAllowsReserving,
  holdsStock,
  reservingClosedMessage,
} from "@/lib/equipmentAvailability";
import { checkAdjustment, checkReleaseReason } from "@/lib/equipmentReservation";
import {
  type FulfilmentRefusal,
  checkFulfilmentUpdate,
  eventAllowsFulfilmentUpdate,
  fulfilmentOptionsFor,
} from "@/lib/equipmentFulfilment";
import { canSuggestFor, checkSuggestionNote, suggestedQuantityFor } from "@/lib/equipmentSuggestion";
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
//
// SPM-69 (release or adjust): a line that holds stock can have its reservation
// changed - "Adjust" sets a new quantity, "Release" frees all of it after
// asking first. PATCH / DELETE .../reservation; the rules are in
// src/lib/equipmentReservation.ts, shared with the route.
//
// SPM-77 (suggest an alternative): a line that cannot be provided, or only in
// part, can get a suggested alternative - "Suggest alternative" opens a form
// that shows the alternative's availability for the event's dates before it is
// recorded (AC2). POST .../suggestion; the rules are in
// src/lib/equipmentSuggestion.ts. The line then shows the suggestion until the
// Coordinator decides on it.

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
  /// Set for a multi-session event's session-specific line.
  sessionId: string | null;
  sessionLabel: string | null;
  venueChosen: boolean;
  transferMinutes: number;
  result: AvailabilityResult | null;
  technicalRequirements: string | null;
  staffNotes: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /// SPM-77: the item this line asks for, and the alternative waiting for the
  /// Coordinator's decision.
  equipmentId: string;
  pendingSuggestion?: PendingSuggestion | null;
}

interface PendingSuggestion {
  id: string;
  equipmentName: string;
  quantity: number;
  note: string;
  suggestedByName: string;
  suggestedAt: string;
}

interface CatalogueItem {
  id: string;
  name: string;
  category: string | null;
}

interface UpdateDraft {
  status: string;
  staffNotes: string;
}

interface AdjustDraft {
  requestId: string;
  /// As typed - checked as a whole number on save.
  quantity: string;
}

const WHOLE_NUMBER_MESSAGE = "Enter a whole number of at least 1. To free all of it, use Release.";

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
  // SPM-69: the one line whose Adjust form is open, and the line Release is
  // asking about. Their outcomes go in reserveNotices / reserveErrors, which
  // are about the line's reservation too.
  const [adjusting, setAdjusting] = useState<AdjustDraft | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [releasing, setReleasing] = useState<Line | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  // Why it is being released - required, and sent to the Coordinator.
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);
  // SPM-77: the one line whose Suggest alternative form is open; the form
  // keeps its own draft. The confirmation shows on the line after the reload.
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [suggestNotices, setSuggestNotices] = useState<Record<string, string>>({});

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

  function clearLineMessages(requestId: string) {
    setReserveErrors((current) => ({ ...current, [requestId]: "" }));
    setReserveNotices((current) => ({ ...current, [requestId]: "" }));
  }

  function startAdjust(line: Line) {
    // v8 ignore next -- Adjust is only offered on a line holding stock, which always has a quantity reserved
    setAdjusting({ requestId: line.requestId, quantity: String(line.quantityReserved ?? "") });
    setAdjustError(null);
    clearLineMessages(line.requestId);
  }

  async function saveAdjust(line: Line) {
    // v8 ignore next -- only the open Adjust form can save, so a draft is always set
    if (!adjusting) return;
    const typed = adjusting.quantity.trim();
    const quantity = Number(typed);
    // Same rules the route enforces, checked here first.
    const refusal =
      !/^\d+$/.test(typed) || quantity < 1
        ? WHOLE_NUMBER_MESSAGE
        : checkAdjustment(
            { status: line.requestStatus, quantityRequested: line.quantityRequested, quantityReserved: line.quantityReserved },
            quantity,
            line.result?.available ?? null
          );
    if (refusal) {
      setAdjustError(refusal);
      return;
    }

    setSavingAdjust(true);
    setAdjustError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment/${line.requestId}/reservation`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(path));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setAdjustError(body?.error ?? "Could not change this reservation.");
        return;
      }
      setAdjusting(null);
      setReserveNotices((current) => ({ ...current, [line.requestId]: `Reservation changed: ${quantity} reserved.` }));
      // A change frees or takes units, which every other line's availability shows.
      await load();
    } catch {
      setAdjustError("Could not reach the server.");
    } finally {
      setSavingAdjust(false);
    }
  }

  function startRelease(line: Line) {
    setReleasing(line);
    setReleaseReason("");
    setReleaseError(null);
  }

  async function confirmRelease() {
    // v8 ignore next -- the dialog only opens, and so can only confirm, with a line chosen
    if (!releasing) return;
    const { requestId } = releasing;
    // Same rule the route enforces; the dialog stays open to fix it.
    const refusal = checkReleaseReason(releaseReason);
    if (refusal) {
      setReleaseError(refusal);
      return;
    }
    setReleaseBusy(true);
    clearLineMessages(requestId);
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment/${requestId}/reservation`, {
        method: "DELETE",
        body: JSON.stringify({ reason: releaseReason.trim() }),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(path));
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setReserveErrors((current) => ({ ...current, [requestId]: body?.error ?? "Could not release this reservation." }));
        return;
      }
      setReserveNotices((current) => ({ ...current, [requestId]: "Reservation released." }));
      await load();
    } catch {
      setReserveErrors((current) => ({ ...current, [requestId]: "Could not release this reservation." }));
    } finally {
      setReleaseBusy(false);
      setReleasing(null);
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
          { label: "Equipment Requests", href: "/equipment/requests" },
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
                  adjustDraft={adjusting?.requestId === line.requestId ? adjusting.quantity : null}
                  adjustError={adjusting?.requestId === line.requestId ? adjustError : null}
                  savingAdjust={savingAdjust}
                  onStartAdjust={() => startAdjust(line)}
                  onChangeAdjust={(quantity) => {
                    setAdjusting({ requestId: line.requestId, quantity });
                    setAdjustError(null);
                  }}
                  onCancelAdjust={() => {
                    setAdjusting(null);
                    setAdjustError(null);
                  }}
                  onSaveAdjust={() => saveAdjust(line)}
                  onRelease={() => startRelease(line)}
                  canSuggest={isTechSupport && reservingOpen}
                  suggestNotice={suggestNotices[line.requestId]}
                  onStartSuggest={() => {
                    setSuggestingId(line.requestId);
                    setSuggestNotices((current) => ({ ...current, [line.requestId]: "" }));
                  }}
                  suggestForm={
                    suggestingId === line.requestId ? (
                      <SuggestAlternativeForm
                        eventId={eventId}
                        line={line}
                        requestedIds={lines.filter((l) => l.sessionId === line.sessionId).map((l) => l.equipmentId)}
                        onCancel={() => setSuggestingId(null)}
                        onSignedOut={() => router.push(loginUrlFor(path))}
                        onSaved={async () => {
                          setSuggestingId(null);
                          setSuggestNotices((current) => ({ ...current, [line.requestId]: "Suggestion sent to the Coordinator." }));
                          await load();
                        }}
                      />
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </DataState>
      </Card>

      <ConfirmDialog
        open={releasing !== null}
        title="Release this reservation?"
        confirmLabel="Release"
        loading={releaseBusy}
        onConfirm={confirmRelease}
        onCancel={() => setReleasing(null)}
      >
        {releasing && (
          <div className="space-y-3">
            <p>
              This frees the {releasing.quantityReserved} {releasing.equipmentName} reserved for{" "}
              {event?.title ?? "this event"} for other events. The event&apos;s Coordinator is told.
            </p>
            <Field
              label="Reason for releasing"
              required
              hint="Shown to the event's Coordinator, and saved as your technical notes."
              error={releaseError}
            >
              <Textarea
                value={releaseReason}
                onChange={(e) => {
                  setReleaseReason(e.target.value);
                  setReleaseError(null);
                }}
              />
            </Field>
          </div>
        )}
      </ConfirmDialog>
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
  /// SPM-69: the quantity typed in this line's Adjust form; null while closed.
  adjustDraft: string | null;
  adjustError: string | null;
  savingAdjust: boolean;
  onStartAdjust: () => void;
  onChangeAdjust: (quantity: string) => void;
  onCancelAdjust: () => void;
  onSaveAdjust: () => void;
  onRelease: () => void;
  /// SPM-77: Technical Support may suggest alternatives on this event now.
  canSuggest: boolean;
  suggestNotice?: string;
  onStartSuggest: () => void;
  /// The open Suggest alternative form for this line; null while closed.
  suggestForm: ReactNode;
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
  adjustDraft,
  adjustError,
  savingAdjust,
  onStartAdjust,
  onChangeAdjust,
  onCancelAdjust,
  onSaveAdjust,
  onRelease,
  canSuggest,
  suggestNotice,
  onStartSuggest,
  suggestForm,
}: Readonly<LineRowProps>) {
  const { result } = line;
  // SPM-69: only a line that holds stock has a reservation to change.
  const holding = holdsStock(line.requestStatus, line.quantityReserved);
  const released = line.requestStatus === "released";
  // AC7: the Coordinator changed a reserved requirement - it is back here as
  // Requested, still holding what was reserved.
  const sentBack = holding && RECHECK_REQUEST_STATUSES.includes(line.requestStatus);
  const statusOptions = fulfilmentOptionsFor(line.requestStatus);
  // Errors about the notes go under the notes field; anything else (a lost
  // race, a closed event) goes above the panel.
  const notesError = updateError?.field === "staffNotes" ? updateError.message : null;
  const panelError = updateError && updateError.field !== "staffNotes" ? updateError.message : null;
  const pending = line.pendingSuggestion ?? null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
      {/* SPM-102: grows into the space beside the controls and wraps its own
          text there, so long notes no longer push the controls below. They
          still drop below on a phone, where the details have under 16rem. */}
      <div className="min-w-0 flex-[1_1_16rem] space-y-1">
        <p className="text-sm font-medium text-ink">
          {line.equipmentName}
          {line.sessionLabel && <span className="font-normal text-ink-3"> · {line.sessionLabel}</span>}
        </p>

        {result ? (
          <>
            <p className="text-xs text-ink-2">
              {result.total} total − {result.inMaintenance} out of service − {result.reservedElsewhere} reserved
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

        {sentBack && (
          <p className="text-xs text-tone-warning-fg">
            The Coordinator changed this requirement — {line.quantityReserved} still reserved. Review it again.
          </p>
        )}
        {/* AC8: kept on the record, and told apart from an active reservation. */}
        {released && line.quantityReserved != null && (
          <p className="text-xs text-ink-3">Released — {line.quantityReserved} were reserved.</p>
        )}

        <LineDetail label="Technical requirements" value={line.technicalRequirements} />
        <LineDetail label="Technical Support notes" value={line.staffNotes} />
        {line.reviewedByName && line.reviewedAt && (
          <p className="text-xs text-ink-3">
            Last updated by {line.reviewedByName}, {formatDateTime(line.reviewedAt)}
          </p>
        )}
        {updateNotice && <p className="text-xs text-tone-success-fg">{updateNotice}</p>}

        {/* SPM-77 (AC3): recorded, and waiting for the Coordinator. */}
        {pending && (
          <div className="mt-2 max-w-xl rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
            <p className="font-medium text-ink">
              {`Suggested alternative: ${pending.quantity} × ${pending.equipmentName} — waiting for the Coordinator's decision.`}
            </p>
            <p>Note: {pending.note}</p>
            <p className="text-ink-3">
              Suggested by {pending.suggestedByName}, {formatDateTime(pending.suggestedAt)}
            </p>
          </div>
        )}
        {suggestNotice && <p className="text-xs text-tone-success-fg">{suggestNotice}</p>}
        {suggestForm}

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

        {adjustDraft !== null && (
          <form
            aria-label="Adjust reservation"
            onSubmit={(e) => {
              e.preventDefault();
              onSaveAdjust();
            }}
            className="mt-2 flex max-w-xs flex-col gap-3 rounded-md border border-line bg-surface-2 p-3"
            noValidate
          >
            <Field
              label="Reserved quantity"
              hint={`Up to ${line.quantityRequested} requested. Fewer frees units for other events.`}
              error={adjustError}
            >
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={adjustDraft}
                onChange={(e) => onChangeAdjust(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={savingAdjust} loadingText="Saving…">
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelAdjust} disabled={savingAdjust}>
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
            {/* A released line holds nothing; what it held is said above. */}
            <NumberBox value={released ? null : line.quantityReserved} />
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
          {canReserve && holding && adjustDraft === null && (
            <>
              <Button variant="secondary" size="sm" onClick={onStartAdjust}>
                Adjust
              </Button>
              <Button variant="secondary" size="sm" onClick={onRelease}>
                Release
              </Button>
            </>
          )}
          {canSuggest && canSuggestFor(line.requestStatus) && !pending && !suggestForm && (
            <Button variant="secondary" size="sm" onClick={onStartSuggest}>
              Suggest alternative
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

/// How long the quantity must stay unchanged before its availability is checked.
const AVAILABILITY_CHECK_DELAY_MS = 300;

interface SuggestAlternativeFormProps {
  eventId: string;
  line: Line;
  /// Every item the event already requests for this line's session (or for
  /// the whole event) - none of them can be suggested, as the route refuses
  /// them too. Another session's items can: each session requests its own.
  requestedIds: string[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onSignedOut: () => void;
}

/// What the alternative's availability check said, for the item and quantity
/// it was asked about ("<equipmentId>:<quantity>").
interface AlternativeCheck {
  key: string;
  result: AvailabilityResult | null;
  failed?: boolean;
}

interface SuggestErrors {
  equipmentId?: string;
  quantity?: string;
  note?: string;
  form?: string;
}

/// SPM-77: the form Technical Support suggests an alternative with (AC1). The
/// catalogue is read when it opens, and the chosen item's availability for the
/// event's dates is shown before anything is recorded (AC2).
function SuggestAlternativeForm({
  eventId,
  line,
  requestedIds,
  onCancel,
  onSaved,
  onSignedOut,
}: Readonly<SuggestAlternativeFormProps>) {
  const [catalogue, setCatalogue] = useState<CatalogueItem[] | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState("");
  const [quantity, setQuantity] = useState(String(suggestedQuantityFor(line)));
  const [note, setNote] = useState("");
  const [check, setCheck] = useState<AlternativeCheck | null>(null);
  const [errors, setErrors] = useState<SuggestErrors>({});
  const [saving, setSaving] = useState(false);

  const typed = quantity.trim();
  const quantityValid = /^\d+$/.test(typed) && Number(typed) >= 1;
  const checkKey = equipmentId && quantityValid ? `${equipmentId}:${Number(typed)}` : null;
  // An answer about an earlier choice says nothing about this one.
  const currentCheck = check?.key === checkKey ? check : null;

  useEffect(() => {
    let cancelled = false;
    async function loadCatalogue() {
      try {
        const res = await authedFetch("/api/equipment");
        if (!res.ok) throw new Error("catalogue");
        const items: CatalogueItem[] = await res.json();
        if (!cancelled) setCatalogue(items);
      } catch {
        if (!cancelled) setCatalogueError("Could not load the equipment catalogue.");
      }
    }
    void loadCatalogue();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!checkKey) return;
    let cancelled = false;
    async function checkAvailability(key: string) {
      const [item, count] = key.split(":");
      try {
        const res = await authedFetch(
          `/api/events/${eventId}/equipment/${line.requestId}/suggestion/availability?equipmentId=${encodeURIComponent(item)}&quantity=${count}`
        );
        if (!res.ok) throw new Error("availability");
        const body = await res.json();
        if (!cancelled) setCheck({ key, result: body.result });
      } catch {
        if (!cancelled) setCheck({ key, result: null, failed: true });
      }
    }
    // Wait until typing in the quantity box pauses, rather than asking once
    // per keystroke.
    const timer = setTimeout(() => void checkAvailability(checkKey), AVAILABILITY_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checkKey, eventId, line.requestId]);

  const options = (catalogue ?? [])
    .filter((item) => !requestedIds.includes(item.id))
    .map((item) => ({ value: item.id, label: item.category ? `${item.name} — ${item.category}` : item.name }));
  const short = currentCheck?.result ? currentCheck.result.available < Number(typed) : false;

  async function save() {
    const found: SuggestErrors = {};
    if (!equipmentId) found.equipmentId = "Choose an alternative item.";
    if (!quantityValid) found.quantity = "Enter a whole number of at least 1.";
    const noteRefusal = checkSuggestionNote(note);
    if (noteRefusal) found.note = noteRefusal;
    setErrors(found);
    // Falling short is already said under the quantity; the route refuses it too.
    if (Object.keys(found).length > 0 || short) return;

    setSaving(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment/${line.requestId}/suggestion`, {
        method: "POST",
        body: JSON.stringify({ equipmentId, quantity: Number(typed), note: note.trim() }),
      });
      if (res.status === 401) {
        onSignedOut();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErrors({ form: body?.error ?? "Could not record this suggestion." });
        return;
      }
      await onSaved();
    } catch {
      setErrors({ form: "Could not reach the server." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label="Suggest alternative"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="mt-2 flex max-w-xl flex-col gap-3 rounded-md border border-line bg-surface-2 p-3"
      noValidate
    >
      {errors.form && <Alert variant="error">{errors.form}</Alert>}
      {catalogueError && <Alert variant="error">{catalogueError}</Alert>}
      <Field label="Alternative item" required error={errors.equipmentId}>
        <Select
          placeholder="Choose an item"
          options={options}
          value={equipmentId}
          disabled={catalogue === null}
          onChange={(e) => setEquipmentId(e.target.value)}
        />
      </Field>
      <Field label="Quantity" required hint="Starts from what this line is still missing." error={errors.quantity}>
        <Input
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </Field>
      {checkKey && <AlternativeAvailabilityNote check={currentCheck} quantity={Number(typed)} />}
      <Field
        label="Note for the Coordinator"
        required
        hint="Why this alternative would meet the requirement."
        error={errors.note}
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={saving} loadingText="Recording…">
          Record suggestion
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/// AC2: whether the alternative is free for the event's dates, said before it
/// is recorded.
function AlternativeAvailabilityNote({ check, quantity }: Readonly<{ check: AlternativeCheck | null; quantity: number }>) {
  if (!check) return <p className="text-xs text-ink-3">Checking availability…</p>;
  if (check.failed) return <p className="text-xs text-tone-danger-fg">Could not check availability.</p>;
  if (!check.result) return <p className="text-xs text-ink-3">Cannot be checked yet — the event has no dates.</p>;
  if (check.result.available < quantity) {
    return (
      <p className="text-xs text-tone-warning-fg">Only {check.result.available} available for this event&apos;s dates.</p>
    );
  }
  return (
    <p className="text-xs text-tone-success-fg">
      {check.result.available} available for these dates — enough for this suggestion.
    </p>
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
function LineDetail({ label, value }: Readonly<{ label: string; value: string | null }>) {
  return (
    <p className="text-xs text-ink-2">
      <span className="font-medium text-ink">{label}:</span> {orEmpty(value)}
    </p>
  );
}

function Column({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/// A count in a bordered box, like the mockup's quantity boxes. "—" when there
/// is no number yet (nothing reserved so far).
function NumberBox({ value }: Readonly<{ value: number | null }>) {
  return (
    <div className="mx-auto flex h-9 w-16 items-center justify-center rounded-md border border-line-strong bg-surface text-base text-ink">
      {value ?? "—"}
    </div>
  );
}

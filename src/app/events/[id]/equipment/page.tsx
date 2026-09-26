"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ConfirmDialog,
  DataState,
  Field,
  Fieldset,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { eventReference, formatDateTimeRange, orEmpty } from "@/lib/format";
import { isTerminalEventStatus } from "@/lib/statuses";
import { EventGlance } from "../EventGlance";

// S-16. "As an Event Coordinator, I want to record the equipment required for
// an event so that Technical Support Staff can assess whether the requested
// resources can be provided" (SPM-47).
//
// The Organiser's create-event form (S-08) already lets equipment be
// requested at the same time as the event. This screen is the second half:
// recording and revising equipment requirements once the event already
// exists, which is the Coordinator's own job during planning (AC6).
//
// The Organiser gets a read-only view of their own event's equipment here
// too — broader than AC6's literal wording ("Technical Support Staff can
// view the requirements"), confirmed 2026-09-19 as intended: they reasonably
// want to see what's been recorded against the event they raised. Only the
// owning Organiser, the assigned Coordinator (who manages it), and Technical
// Support (AC6) can reach this screen.

interface EventSessionInfo {
  id: string;
  label: string | null;
  startsAt: string;
  endsAt: string;
}

interface EventInfo {
  id: string;
  sequenceNumber: number;
  title: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  submittedAt: string | null;
  coordinator: { fullName: string } | null;
  // ADDED (SPM-47): a multi-session event's own sessions (class clarification
  // #74). Always [] today — EventSession is schema-only groundwork from
  // SPM-25, nothing creates one yet — so the session picker below stays
  // hidden for every event that currently exists, and activates on its own
  // once event creation actually supports adding sessions.
  sessions: EventSessionInfo[];
}

interface EquipmentRequestRow {
  id: string;
  equipmentId: string;
  quantityRequested: number;
  quantityReserved: number | null;
  technicalRequirements: string | null;
  status: string;
  equipment: { id: string; name: string; category: string | null };
  session: EventSessionInfo | null;
}

interface EquipmentItem {
  id: string;
  name: string;
  category: string | null;
}

interface NewRow {
  equipmentId: string;
  quantityRequested: string;
  technicalRequirements: string;
  /// "" means the requirement applies to the whole event, not one session.
  sessionId: string;
}

const EMPTY_NEW_ROW: NewRow = {
  equipmentId: "",
  quantityRequested: "1",
  technicalRequirements: "",
  sessionId: "",
};

/// "Day 1 Morning" if labelled, else just the time range.
function sessionLabel(session: EventSessionInfo): string {
  const when = formatDateTimeRange(session.startsAt, session.endsAt);
  return session.label ? `${session.label} — ${when}` : when;
}

export default function EventEquipmentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [requests, setRequests] = useState<EquipmentRequestRow[] | null>(null);
  const [catalogue, setCatalogue] = useState<EquipmentItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Draft edits per row, keyed by EquipmentRequest id — only rows the
  // Coordinator has touched appear here, so "Save" only shows on dirty rows.
  const [drafts, setDrafts] = useState<Record<string, { quantityRequested: string; technicalRequirements: string }>>(
    {}
  );
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [newRow, setNewRow] = useState<NewRow>(EMPTY_NEW_ROW);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [eventRes, requestsRes] = await Promise.all([
        authedFetch(`/api/events/${eventId}`),
        authedFetch(`/api/events/${eventId}/equipment`),
      ]);
      if (eventRes.status === 401 || requestsRes.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/equipment`));
        return;
      }
      if (!eventRes.ok) throw new Error("Could not load this event.");
      if (!requestsRes.ok) throw new Error("Could not load equipment requirements.");
      setEvent(await eventRes.json());
      setRequests(await requestsRes.json());
    } catch (err) {
      setEvent(null);
      setRequests(null);
      setLoadError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router]);

  const loadCatalogue = useCallback(async () => {
    try {
      const res = await authedFetch("/api/equipment");
      if (!res.ok) return;
      setCatalogue(await res.json());
    } catch {
      // The list still works without the catalogue; "Add equipment" just
      // stays disabled rather than blocking the rest of the screen.
    }
  }, []);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(`/events/${eventId}/equipment`));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router, eventId]);

  const isCoordinator = user?.role === "coordinator";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isCoordinator) void loadCatalogue();
  }, [isCoordinator, loadCatalogue]);

  // Technical Support views it (AC6); the Coordinator sees it because they
  // manage it; the Organiser gets a read-only view of their own event's
  // equipment, confirmed 2026-09-19 as intended even though it's broader
  // than AC6's literal wording. Ownership for the Organiser case is enforced
  // server-side (canViewEquipmentRequests) — a role check is enough here.
  const canView = user && ["organiser", "coordinator", "tech_support"].includes(user.role);
  const locked = event ? isTerminalEventStatus(event.status) : false;
  const canEdit = isCoordinator && !locked;

  const equipmentOptions = useMemo(() => {
    // Scoped to the session currently chosen in "Add equipment" - uniqueness
    // is per (event, session), not per event (see the partial unique indexes
    // on EquipmentRequest), so an item already requested for a DIFFERENT
    // session must still be offered here, not hidden across the whole event.
    const requestedIds = new Set(
      (requests ?? [])
        .filter((r) => (r.session?.id ?? "") === newRow.sessionId)
        .map((r) => r.equipmentId)
    );
    return (catalogue ?? [])
      .filter((item) => !requestedIds.has(item.id))
      .map((item) => ({
        value: item.id,
        label: item.category ? `${item.name} — ${item.category}` : item.name,
      }));
  }, [catalogue, requests, newRow.sessionId]);

  function draftFor(row: EquipmentRequestRow) {
    return (
      drafts[row.id] ?? {
        quantityRequested: String(row.quantityRequested),
        technicalRequirements: row.technicalRequirements ?? "",
      }
    );
  }

  function isDirty(row: EquipmentRequestRow) {
    const draft = drafts[row.id];
    if (!draft) return false;
    return (
      draft.quantityRequested !== String(row.quantityRequested) ||
      draft.technicalRequirements !== (row.technicalRequirements ?? "")
    );
  }

  function setDraft(row: EquipmentRequestRow, patch: Partial<{ quantityRequested: string; technicalRequirements: string }>) {
    setDrafts((current) => ({ ...current, [row.id]: { ...draftFor(row), ...patch } }));
    setRowError((current) => {
      if (!current[row.id]) return current;
      const next = { ...current };
      delete next[row.id];
      return next;
    });
  }

  async function saveRow(row: EquipmentRequestRow) {
    const draft = draftFor(row);
    const quantity = Number(draft.quantityRequested);
    if (!draft.quantityRequested || !Number.isInteger(quantity) || quantity < 1) {
      setRowError((current) => ({ ...current, [row.id]: "Enter a whole number, at least 1." }));
      return;
    }

    setSavingId(row.id);
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quantityRequested: quantity,
          technicalRequirements: draft.technicalRequirements || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRowError((current) => ({ ...current, [row.id]: body.error ?? "Could not save this row." }));
        return;
      }
      setRequests((current) => current?.map((r) => (r.id === row.id ? body : r)) ?? current);
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    } catch {
      setRowError((current) => ({ ...current, [row.id]: "Could not reach the server." }));
    } finally {
      setSavingId(null);
    }
  }

  async function removeRow(id: string) {
    setRemovingId(id);
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json();
        setLoadError(body.error ?? "Could not remove this row.");
        return;
      }
      setRequests((current) => current?.filter((r) => r.id !== id) ?? current);
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setRemovingId(null);
      setConfirmRemoveId(null);
    }
  }

  async function addRow() {
    setAddError(null);
    const quantity = Number(newRow.quantityRequested);
    if (!newRow.equipmentId) {
      setAddError("Choose an item to add.");
      return;
    }
    if (!newRow.quantityRequested || !Number.isInteger(quantity) || quantity < 1) {
      setAddError("Enter a whole number, at least 1.");
      return;
    }

    setAdding(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/equipment`, {
        method: "POST",
        body: JSON.stringify({
          equipmentId: newRow.equipmentId,
          quantityRequested: quantity,
          technicalRequirements: newRow.technicalRequirements || undefined,
          sessionId: newRow.sessionId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setAddError(body.error ?? "Could not add this item.");
        return;
      }
      setRequests((current) => [...(current ?? []), body]);
      setNewRow(EMPTY_NEW_ROW);
    } catch {
      setAddError("Could not reach the server.");
    } finally {
      setAdding(false);
    }
  }

  if (state === "loading" || (state === "authenticated" && !user)) {
    return null;
  }

  const tabs = user ? eventTabItemsFor(user.role, eventId) : [];

  if (!canView) {
    return (
      <Alert variant="error" title="Not authorised">
        You don&apos;t have access to this event.
      </Alert>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Equipment requirements"
        subtitle={
          event
            ? formatDateTimeRange(event.startsAt, event.endsAt)
            : "What Technical Support needs to prepare for this event."
        }
        meta={
          event && (
            <>
              <span className="text-xs text-ink-3">{eventReference(event.sequenceNumber)}</span>
              <StatusBadge status={event.status} />
            </>
          )
        }
        breadcrumbs={[
          { label: "Events", href: "/events" },
          { label: event?.title || "Event" },
          { label: "Equipment" },
        ]}
        // SPM-48: Technical Support goes from what was requested to whether it
        // can be supported. Only they can use the check, so nobody else sees it.
        actions={
          user?.role === "tech_support" ? (
            <ButtonLink href={`/equipment/requests/${eventId}`} variant="secondary">
              Check availability
            </ButtonLink>
          ) : undefined
        }
      />

      {tabs.length > 0 && <Tabs items={tabs} activeKey="equipment" className="mb-6" />}

      {/* Main content + "Event at a glance" sidebar, matching the hub layout
          in design/mockups/OrganiserEventDetail.dc.html. */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_320px] md:items-start">
        <div className="flex flex-col gap-4">
          {locked && (
            <Alert variant="info">
              This event is {event ? event.status.replace(/_/g, " ") : "finished"} — equipment
              requirements can no longer be changed.
            </Alert>
          )}

          <DataState
            data={requests}
            error={loadError}
            onRetry={load}
            empty={{
              title: "Nothing requested yet",
              description: canEdit
                ? "Add projectors, microphones, video conferencing, or anything else Technical Support needs to prepare."
                : "Nothing has been recorded for this event.",
            }}
          >
            {(rows) => (
              // One card holding every row, divided by a border rather than
              // separate floating boxes — matches design/mockups/
              // EquipmentRequests.dc.html's ".card" + ".row" layout, and is
              // the same pattern Table.tsx already uses elsewhere in this app
              // (divide-y inside one bordered container).
              <Card>
                <CardHeader
                  title="Requested items"
                  aside={
                    <span className="text-xs text-ink-3">
                      {rows.length} item{rows.length === 1 ? "" : "s"}
                    </span>
                  }
                />
                <div className="divide-y divide-line">
                  {rows.map((row) => {
                    const draft = draftFor(row);
                    const dirty = isDirty(row);
                    return (
                      <div key={row.id} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-ink">{row.equipment.name}</p>
                            <p className="text-xs text-ink-3">{orEmpty(row.equipment.category)}</p>
                            {/* Null for every row until sessions can actually be
                                created (SPM-25) — see EventInfo.sessions above. */}
                            {row.session && (
                              <p className="mt-1 text-xs text-ink-3">
                                <span className="rounded-full bg-surface-2 px-2 py-0.5 ring-1 ring-inset ring-line">
                                  {sessionLabel(row.session)}
                                </span>
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={row.status} />
                            {row.quantityReserved != null && (
                              <span className="text-xs text-ink-3">{row.quantityReserved} reserved</span>
                            )}
                          </div>
                        </div>

                        {rowError[row.id] && (
                          <Alert variant="error" className="mt-3">
                            {rowError[row.id]}
                          </Alert>
                        )}

                        {canEdit ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void saveRow(row);
                            }}
                            className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start"
                            noValidate
                          >
                            <Field label="Quantity" className="sm:w-28">
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                inputMode="numeric"
                                value={draft.quantityRequested}
                                onChange={(e) => setDraft(row, { quantityRequested: e.target.value })}
                              />
                            </Field>
                            <Field
                              label="Technical requirements"
                              hint="Anything our technical team should know — connections, positioning, timing."
                              className="flex-1"
                            >
                              <Input
                                value={draft.technicalRequirements}
                                onChange={(e) => setDraft(row, { technicalRequirements: e.target.value })}
                              />
                            </Field>
                            <div className="flex gap-2 sm:pt-7">
                              {dirty && (
                                <Button
                                  type="submit"
                                  size="sm"
                                  loading={savingId === row.id}
                                  loadingText="Saving…"
                                >
                                  Save
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmRemoveId(row.id)}
                              >
                                Remove
                              </Button>
                            </div>
                          </form>
                        ) : (
                          // Read-only viewer (Organiser, Technical Support): plain
                          // text, not a disabled input — there's nothing here to
                          // interact with, so it shouldn't look like a form.
                          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
                            <div className="sm:w-28">
                              <p className="text-sm font-medium text-ink">Quantity</p>
                              <p className="mt-1.5 text-ink">{row.quantityRequested}</p>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-ink">Technical requirements</p>
                              <p className="mt-1.5 text-ink">{orEmpty(row.technicalRequirements)}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </DataState>

          {canEdit && (
            <Fieldset legend="Add equipment">
              {addError && <Alert variant="error">{addError}</Alert>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addRow();
                }}
                className="flex flex-col gap-4 sm:flex-row sm:items-start"
                noValidate
              >
                <Field label="Equipment" className="flex-1">
                  <Select
                    placeholder={catalogue === null ? "Loading…" : "Choose an item"}
                    options={equipmentOptions}
                    value={newRow.equipmentId}
                    disabled={catalogue === null}
                    onChange={(e) => setNewRow((current) => ({ ...current, equipmentId: e.target.value }))}
                  />
                </Field>
                {/* Only shown for a multi-session event — hidden entirely
                    otherwise, the same "don't offer a choice that never
                    applies" rule the rest of this form already follows. */}
                {event && event.sessions.length > 0 && (
                  <Field label="Session" className="sm:w-56">
                    <Select
                      options={[
                        { value: "", label: "Whole event" },
                        ...event.sessions.map((s) => ({ value: s.id, label: sessionLabel(s) })),
                      ]}
                      value={newRow.sessionId}
                      onChange={(e) => {
                        const sessionId = e.target.value;
                        setNewRow((current) => {
                          // If the currently chosen equipment is already
                          // requested for the session just picked, it would
                          // silently drop out of equipmentOptions above -
                          // leaving the <select> showing some other item
                          // while state still held the old one. Clear it back
                          // to "Choose an item" instead of letting that happen.
                          const stillValid = !(requests ?? []).some(
                            (r) =>
                              (r.session?.id ?? "") === sessionId &&
                              r.equipmentId === current.equipmentId
                          );
                          return {
                            ...current,
                            sessionId,
                            equipmentId: stillValid ? current.equipmentId : "",
                          };
                        });
                      }}
                    />
                  </Field>
                )}
                <Field label="Quantity" className="sm:w-28">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={newRow.quantityRequested}
                    onChange={(e) =>
                      setNewRow((current) => ({ ...current, quantityRequested: e.target.value }))
                    }
                  />
                </Field>
                <Field
                  label="Technical requirements"
                  hint="Anything our technical team should know — connections, positioning, timing."
                  className="flex-1"
                >
                  <Input
                    value={newRow.technicalRequirements}
                    onChange={(e) =>
                      setNewRow((current) => ({ ...current, technicalRequirements: e.target.value }))
                    }
                  />
                </Field>
                <div className="sm:pt-7">
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    loading={adding}
                    loadingText="Adding…"
                    disabled={catalogue === null}
                  >
                    Add
                  </Button>
                </div>
              </form>
            </Fieldset>
          )}
        </div>

        {event && <EventGlance event={event} />}
      </div>

      <ConfirmDialog
        open={confirmRemoveId !== null}
        title="Remove this equipment requirement?"
        confirmLabel="Remove"
        loading={removingId !== null}
        onConfirm={() => confirmRemoveId && void removeRow(confirmRemoveId)}
        onCancel={() => setConfirmRemoveId(null)}
      >
        Technical Support will no longer see this item requested for this event.
      </ConfirmDialog>
    </div>
  );
}

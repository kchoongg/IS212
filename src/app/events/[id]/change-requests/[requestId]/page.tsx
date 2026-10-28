"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, ButtonLink, ConfirmDialog, Field, Fieldset, PageHeader, StatusBadge, Textarea } from "@/components/ui";
import { SkeletonRows } from "@/components/ui/DataState";
import { ChangeRequestList, type ListedChangeRequest } from "@/components/ChangeRequestList";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventCrumbs } from "@/lib/breadcrumbs";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";
import { canProcessChangeRequests } from "@/lib/permissions";
import { BACK_TO_PLANNING_SAVED, backToPlanningWarning } from "@/lib/safetyResolution";
import { importantFor, type RequestableField } from "@/lib/eventChangeRequest";
import {
  ALREADY_PROCESSED,
  APPROVE_CANCELLATION,
  EQUIPMENT_ITEM,
  EQUIPMENT_TO_DO,
  NOT_ASSIGNED,
  APPROVE_POSTPONEMENT,
  PROCESSED_MESSAGE,
  REQUEST_REASON_REQUIRED,
  RESCHEDULED,
  UNDECIDED,
  itemLabel,
  reasonRequired,
  type Outcome,
} from "@/lib/changeRequestDecision";

// Process Event Change Request (SPM-32), S-17: the assigned coordinator
// decides an organiser's change request. A change of details is decided item
// by item - each field, and the equipment change - with a reason for each
// rejection (AC2, AC3); a postponement or cancellation request can only be
// rejected here, since it is carried out by postponing or cancelling the event.
//
// What an approval does is decided on the server, with Update Event
// Information's rules (SPM-62): this screen asks first when the event would go
// back to Planning, as Edit event information does, and afterwards shows what
// was flagged.

interface LoadedEvent {
  sequenceNumber: number;
  title: string | null;
  status: string;
  organiserId: string;
  organisationId: string | null;
  coordinatorId: string | null;
}

interface DecisionResult {
  request: ListedChangeRequest;
  statusReverted: boolean;
  safetyCheckClosed: boolean;
  flagged: string[];
  rescheduled: boolean;
  equipmentToDo: boolean;
}

interface Choice {
  outcome: Outcome | null;
  reason: string;
}

const TITLE = "Review change request";
const RESCHEDULE_NOTE = "This event is Postponed. Approving its new date moves it to Approved, ready for planning again.";

export default function ReviewChangeRequestPage() {
  const router = useRouter();
  const params = useParams<{ id: string; requestId: string }>();
  const eventId = params.id;
  const requestId = params.requestId;
  const self = `/events/${eventId}/change-requests/${requestId}`;
  const formRef = useRef<HTMLFormElement>(null);
  const { user, state: authState } = useCurrentUser();

  const [event, setEvent] = useState<LoadedEvent | null>(null);
  const [request, setRequest] = useState<ListedChangeRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [requestReason, setRequestReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<DecisionResult | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setNotFound(false);
    try {
      const [eventRes, listRes] = await Promise.all([
        authedFetch(`/api/events/${eventId}`),
        authedFetch(`/api/events/${eventId}/change-requests`),
      ]);
      if (eventRes.status === 401 || listRes.status === 401) {
        router.push(loginUrlFor(self));
        return;
      }
      if (eventRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (!eventRes.ok || !listRes.ok) {
        setLoadError("Could not load this change request.");
        return;
      }
      const loadedEvent: LoadedEvent = await eventRes.json();
      const found = ((await listRes.json()) as ListedChangeRequest[]).find((r) => r.id === requestId) ?? null;
      setEvent(loadedEvent);
      setRequest(found);
      setNotFound(found === null);
    } catch {
      setLoadError("Could not reach the server. Check your connection and try again.");
    }
  }, [eventId, requestId, router, self]);

  useEffect(() => {
    if (authState === "anonymous") {
      router.push(loginUrlFor(self));
      return;
    }
    if (authState === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [authState, load, router, self]);

  // The items decided one by one: each changed field, then the equipment change.
  const items = useMemo(() => {
    if (!request || request.kind !== "change") return [];
    const list = request.rows.map((row) => ({ key: row.field as string, label: row.label, current: row.current, proposed: row.proposed }));
    if (request.equipmentChanges) {
      list.push({ key: EQUIPMENT_ITEM, label: itemLabel(EQUIPMENT_ITEM), current: "", proposed: request.equipmentChanges });
    }
    return list;
  }, [request]);

  const refusal =
    user && event && !canProcessChangeRequests({ id: user.id, role: user.role, organisationId: null }, event) ? NOT_ASSIGNED : null;

  function choose(key: string, outcome: Outcome) {
    setChoices((current) => ({ ...current, [key]: { outcome, reason: current[key]?.reason ?? "" } }));
    setFormError(null);
    clearError(key);
  }

  function chooseAll(outcome: Outcome) {
    setChoices((current) =>
      Object.fromEntries(items.map((item) => [item.key, { outcome, reason: current[item.key]?.reason ?? "" }]))
    );
    setFormError(null);
    setErrors({});
  }

  function setReason(key: string, reason: string) {
    setChoices((current) => ({ ...current, [key]: { ...current[key], reason } }));
    clearError(key);
  }

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /// The approved fields that are important - what would send the event back to Planning.
  const approvedImportant = importantFor(
    items.filter((item) => item.key !== EQUIPMENT_ITEM && choices[item.key]?.outcome === "approved").map((item) => ({ field: item.key as RequestableField })),
    choices[EQUIPMENT_ITEM]?.outcome === "approved" ? "x" : null
  ).filter((change) => change !== "equipment");

  function submit() {
    // Every problem at once: a missing reason shows even while another
    // change is still undecided.
    const missing: FieldErrors = {};
    for (const item of items) {
      if (choices[item.key]?.outcome === "rejected" && !choices[item.key].reason.trim()) missing[item.key] = reasonRequired(item.label);
    }
    setErrors(missing);
    const undecided = items.some((item) => !choices[item.key]?.outcome);
    setFormError(undecided ? UNDECIDED : null);
    if (undecided || Object.keys(missing).length > 0) {
      focusFirstError(formRef.current, missing);
      return;
    }
    if (event && approvedImportant.length > 0 && backToPlanningWarning(event.title, event.status, "information")) {
      setAsking(true);
      return;
    }
    void send(decisionsBody());
  }

  function decisionsBody() {
    return {
      decisions: Object.fromEntries(
        items.map((item) => {
          const { outcome, reason } = choices[item.key];
          return [item.key, outcome === "rejected" ? { outcome, reason: reason.trim() } : { outcome }];
        })
      ),
    };
  }

  function rejectRequest() {
    setFormError(null);
    if (!requestReason.trim()) {
      setErrors({ reason: REQUEST_REASON_REQUIRED });
      focusFirstError(formRef.current, { reason: REQUEST_REASON_REQUIRED });
      return;
    }
    void send({ outcome: "rejected", reason: requestReason.trim() });
  }

  async function send(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/change-requests/${requestId}/decision`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(self));
        return;
      }
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(answer, "Could not save the decision.");
        setErrors(fieldErrors);
        // At the top too: a field's reason box is only open while it is rejected.
        // v8 ignore next -- the route sends `error` with every refusal; `?? null` only satisfies the type
        setFormError(message ?? answer.error ?? null);
        focusFirstError(formRef.current, fieldErrors);
        // AC7: decided elsewhere meanwhile - show it as it now is.
        if (res.status === 409) void load();
        return;
      }
      setResult(answer as DecisionResult);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      focusFirstError(formRef.current, {});
    } finally {
      setSaving(false);
      setAsking(false);
    }
  }

  const header = (
    <PageHeader
      title={TITLE}
      subtitle={event?.title ?? undefined}
      meta={event && <StatusBadge status={event.status} />}
      breadcrumbs={eventCrumbs(user?.role, eventId, event?.title, { label: TITLE })}
    />
  );
  const backToEvent = (
    <ButtonLink href={`/events/${eventId}`} variant="secondary">
      Back to event
    </ButtonLink>
  );

  if (loadError) {
    return (
      <div className="max-w-3xl">
        {header}
        <Alert
          variant="error"
          title="Could not load this"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-3xl">
        {header}
        <Alert variant="error" title="Not found">
          This change request doesn&apos;t exist, or you don&apos;t have access to it.
        </Alert>
      </div>
    );
  }

  if (!event || !request || !user) {
    return (
      <div className="max-w-3xl">
        {header}
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (result) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        {header}
        <Alert variant="success" title={PROCESSED_MESSAGE}>
          {result.rescheduled && <p>{RESCHEDULED}</p>}
          {(result.statusReverted || result.safetyCheckClosed) && <p>{BACK_TO_PLANNING_SAVED}</p>}
          {result.equipmentToDo && <p>{EQUIPMENT_TO_DO}</p>}
        </Alert>
        {result.flagged.length > 0 && (
          <Alert variant="warning" title="Flagged for review">
            <p>These were arranged for the event&apos;s earlier details and have not been changed.</p>
            <ul className="mt-2 list-disc pl-5">
              {result.flagged.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Alert>
        )}
        <ChangeRequestList requests={[result.request]} />
        <div>{backToEvent}</div>
      </div>
    );
  }

  if (refusal) {
    return (
      <div className="max-w-3xl">
        {header}
        <Alert variant="error" title="You can't review this change request">
          {refusal}
        </Alert>
        <div className="mt-4">{backToEvent}</div>
      </div>
    );
  }

  // AC7: decided already - read-only.
  if (request.status !== "pending") {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        {header}
        <Alert variant="info">{ALREADY_PROCESSED}</Alert>
        <ChangeRequestList requests={[request]} />
        <div>{backToEvent}</div>
      </div>
    );
  }

  const asked = (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">{request.kindLabel}</p>
        <StatusBadge status={request.status} />
      </div>
      <p className="text-ink-3">
        Requested by {request.requestedBy} on {formatDateTime(request.requestedAt)}
      </p>
      {request.important && request.affects.length > 0 && (
        <p className="text-tone-warning-fg">Affects existing arrangements: {request.affects.join(", ")}.</p>
      )}
      <p className="text-ink">Reason: {request.reason}</p>
    </div>
  );

  if (request.kind !== "change") {
    return (
      <div className="max-w-3xl">
        {header}
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            rejectRequest();
          }}
          className="flex flex-col gap-6"
          noValidate
        >
          {asked}
          {formError && <Alert variant="error">{formError}</Alert>}
          <Alert variant="info">{request.kind === "cancel" ? APPROVE_CANCELLATION : APPROVE_POSTPONEMENT}</Alert>
          <Field label="Reason for rejecting" error={errors.reason}>
            <Textarea
              name="reason"
              rows={3}
              value={requestReason}
              onChange={(e) => {
                setRequestReason(e.target.value);
                clearError("reason");
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" loading={saving} loadingText="Saving…">
              Reject request
            </Button>
            {backToEvent}
          </div>
        </form>
      </div>
    );
  }

  const reschedules =
    event.status === "postponed" && items.some((item) => item.key === "startsAt" || item.key === "endsAt");

  return (
    <div className="max-w-3xl">
      {header}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-6"
        noValidate
      >
        {asked}
        {reschedules && <Alert variant="info">{RESCHEDULE_NOTE}</Alert>}
        {formError && <Alert variant="error">{formError}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => chooseAll("approved")}>
            Approve all
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => chooseAll("rejected")}>
            Reject all
          </Button>
        </div>

        {items.map((item) => {
          const choice = choices[item.key];
          return (
            <Fieldset key={item.key} legend={item.label}>
              <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
                {item.key !== EQUIPMENT_ITEM && (
                  <>
                    <dt className="text-ink-3">Current</dt>
                    <dd className="text-ink-2">{item.current}</dd>
                  </>
                )}
                <dt className="text-ink-3">Proposed</dt>
                <dd className="text-ink">{item.proposed}</dd>
              </dl>
              <div role="radiogroup" aria-label={item.label} className="flex flex-wrap gap-2">
                {(["approved", "rejected"] as const).map((outcome) => (
                  <label
                    key={outcome}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border bg-surface px-3 py-1.5 text-sm text-ink",
                      choice?.outcome === outcome ? "border-ink ring-1 ring-inset ring-ink" : "border-line"
                    )}
                  >
                    <input
                      type="radio"
                      name={`decision-${item.key}`}
                      checked={choice?.outcome === outcome}
                      onChange={() => choose(item.key, outcome)}
                      className="h-4 w-4 accent-ink"
                    />
                    {outcome === "approved" ? "Approve" : "Reject"}
                  </label>
                ))}
              </div>
              {choice?.outcome === "rejected" && (
                <Field label="Reason for rejecting" required error={errors[item.key]}>
                  <Textarea
                    name={item.key}
                    rows={2}
                    value={choice.reason}
                    onChange={(e) => setReason(item.key, e.target.value)}
                  />
                </Field>
              )}
            </Fieldset>
          );
        })}

        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface-2 px-4 py-3 sm:mx-0 sm:rounded-md sm:px-4">
          <Button type="submit" loading={saving && !asking} loadingText="Saving…">
            Save decision
          </Button>
          {backToEvent}
        </div>
      </form>

      <ConfirmDialog
        open={asking}
        title="Move this event back to Planning?"
        confirmLabel="Save and move to Planning"
        cancelLabel="Keep editing"
        confirmVariant="primary"
        loading={saving}
        onConfirm={() => void send(decisionsBody())}
        onCancel={() => setAsking(false)}
      >
        {backToPlanningWarning(event.title, event.status, "information")}
      </ConfirmDialog>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  CheckboxGroup,
  Field,
  Fieldset,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { SkeletonRows } from "@/components/ui/DataState";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventCrumbs } from "@/lib/breadcrumbs";
import { cn } from "@/lib/cn";
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";
import { CATEGORIES, LAYOUTS, toFormValues, toOptions, type EventRecord, type Facility } from "@/lib/eventForm";
import { formatDateTimeRange } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";
import { canRequestEventChange } from "@/lib/permissions";
import {
  CHANGE_REQUEST_OWNER_MESSAGE,
  CHANGE_REQUEST_STATUS_MESSAGE,
  NOTHING_CHANGED,
  REASON_REQUIRED,
  SESSIONS_FIXED,
  canRequestChangeIn,
  type ChangeRequestKind,
} from "@/lib/eventChangeRequest";
import { changedPayload, informationValues, validateInformation, type InformationValues } from "@/lib/eventInformationForm";

// Request Event Change (SPM-35), S-10: the organiser who owns the event asks
// for a change to it - new details, or that it be postponed or cancelled. The
// details are Edit event information's fields (SPM-62), filled in with the
// event's present values; only the ones changed are sent.
//
// Sending only records the request (POST /api/events/[id]/change-requests).
// The event stays exactly as it is until the coordinator processes it.

type LoadedEvent = EventRecord & {
  sequenceNumber: number;
  status: string;
  organiserId: string;
  organisationId: string | null;
  coordinatorId: string | null;
};

const TITLE = "Request a change";

const KINDS: { value: ChangeRequestKind; label: string }[] = [
  { value: "change", label: "Change the event's details" },
  { value: "postpone", label: "Postpone the event" },
  { value: "cancel", label: "Cancel the event" },
];

export default function RequestEventChangePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const formRef = useRef<HTMLFormElement>(null);
  const { user, state: authState } = useCurrentUser();
  const self = `/events/${eventId}/change-request`;

  const [event, setEvent] = useState<LoadedEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<InformationValues | null>(null);
  const [values, setValues] = useState<InformationValues | null>(null);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [kind, setKind] = useState<ChangeRequestKind>("change");
  const [equipmentChanges, setEquipmentChanges] = useState("");
  const [reason, setReason] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(self));
        return;
      }
      if (res.status === 404) {
        setLoadError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!res.ok) {
        setLoadError("Could not load this event.");
        return;
      }
      const loaded: LoadedEvent = await res.json();
      const formValues = informationValues(toFormValues(loaded));
      setEvent(loaded);
      setInitial(formValues);
      setValues(formValues);
    } catch {
      setLoadError("Could not reach the server. Check your connection and try again.");
    }
  }, [eventId, router, self]);

  const loadFacilities = useCallback(async () => {
    try {
      const res = await authedFetch("/api/facilities");
      if (res.ok) setFacilities(await res.json());
    } catch {
      // The checkboxes stay in their loading state; the rest of the form works.
    }
  }, []);

  useEffect(() => {
    if (authState === "anonymous") {
      router.push(loginUrlFor(self));
      return;
    }
    if (authState === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
      void loadFacilities();
    }
  }, [authState, load, loadFacilities, router, self]);

  const sessions = event?.sessions ?? [];
  const scheduleEditable = sessions.length === 0;

  // The route's rules, so a refused user sees why instead of a form that
  // cannot be sent.
  const refusal = (() => {
    if (!user || !event) return null;
    const actor = { id: user.id, role: user.role, organisationId: null };
    if (!canRequestEventChange(actor, event)) {
      return CHANGE_REQUEST_OWNER_MESSAGE;
    }
    if (!canRequestChangeIn(event.status)) return CHANGE_REQUEST_STATUS_MESSAGE;
    return null;
  })();

  function clearError(field: string) {
    if (!errors[field]) return;
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function setValue<K extends keyof InformationValues>(field: K, value: InformationValues[K]) {
    // The fields only render once the event has loaded, so `current` is set.
    setValues((current) => ({ ...(current as InformationValues), [field]: value }));
    clearError(field);
  }

  function toggleFacility(id: string) {
    setValues((current) => {
      const now = current as InformationValues;
      return {
        ...now,
        facilityIds: now.facilityIds.includes(id) ? now.facilityIds.filter((f) => f !== id) : [...now.facilityIds, id],
      };
    });
  }

  function submit() {
    // v8 ignore next -- the form, and so its submit, only renders once the event has loaded
    if (!initial || !values) return;
    setFormError(null);
    // The registration period is the coordinator's to move when they apply the
    // change, so it is not checked here.
    const clientErrors: FieldErrors =
      kind === "change"
        ? validateInformation(initial, values, { scheduleEditable, registrationOpensAt: null, registrationClosesAt: null })
        : {};
    if (!reason.trim()) clientErrors.reason = REASON_REQUIRED;
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) {
      focusFirstError(formRef.current, clientErrors);
      return;
    }
    const changes = kind === "change" ? changedPayload(initial, values, scheduleEditable) : {};
    if (kind === "change" && Object.keys(changes).length === 0 && !equipmentChanges.trim()) {
      setFormError(NOTHING_CHANGED);
      focusFirstError(formRef.current, {});
      return;
    }
    void send(kind === "change" ? { kind, reason, changes, equipmentChanges } : { kind, reason });
  }

  async function send(body: Record<string, unknown>) {
    setSending(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/change-requests`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push(loginUrlFor(self));
        return;
      }
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(answer, "Could not send the change request.");
        setErrors(fieldErrors);
        setFormError(message);
        focusFirstError(formRef.current, fieldErrors);
        return;
      }
      setSent(true);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      focusFirstError(formRef.current, {});
    } finally {
      setSending(false);
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
    <Button type="button" variant="ghost" onClick={() => router.push(`/events/${eventId}`)}>
      Back to event
    </Button>
  );

  if (loadError) {
    return (
      <div className="max-w-2xl">
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

  if (!event || !values || !initial || !user) {
    return (
      <div className="max-w-2xl">
        {header}
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (refusal) {
    return (
      <div className="max-w-2xl">
        {header}
        <Alert variant="error" title="You can't request a change to this event">
          {refusal}
        </Alert>
        <div className="mt-4">{backToEvent}</div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        {header}
        <Alert variant="success" title="Change request sent to your coordinator.">
          Nothing about the event changes until your coordinator processes the request.
        </Alert>
        <div>
          <ButtonLink href={`/events/${eventId}`}>Back to event</ButtonLink>
        </div>
      </div>
    );
  }

  const facilityOptions = facilities ?? [];
  const status = statusLabel(event.status);

  return (
    <div className="max-w-2xl">
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
        {formError && <Alert variant="error">{formError}</Alert>}

        <Fieldset legend="What do you need?">
          <div role="radiogroup" aria-label="What do you need?" className="flex flex-col gap-2">
            {KINDS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-3 py-2 text-sm text-ink",
                  kind === option.value ? "border-ink ring-1 ring-inset ring-ink" : "border-line"
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={option.value}
                  checked={kind === option.value}
                  onChange={() => {
                    setKind(option.value);
                    setFormError(null);
                  }}
                  className="h-4 w-4 accent-ink"
                />
                {option.label}
              </label>
            ))}
          </div>
          {kind !== "change" && (
            <Alert variant="info">
              {`Your coordinator decides whether to ${kind === "postpone" ? "postpone" : "cancel"} the event. It stays ${status} until then.`}
            </Alert>
          )}
        </Fieldset>

        {kind === "change" && (
          <>
            <Fieldset legend="Basics">
              <Field label="Event name" required error={errors.title}>
                <Input name="title" value={values.title} onChange={(e) => setValue("title", e.target.value)} />
              </Field>
              <Field label="Type of event" required error={errors.category}>
                <Select
                  name="category"
                  placeholder="Select a type"
                  options={toOptions(CATEGORIES)}
                  value={values.category}
                  onChange={(e) => setValue("category", e.target.value)}
                />
              </Field>
              <Field label="Purpose" hint="What the event is for, in a line or two.">
                <Textarea name="purpose" rows={2} value={values.purpose} onChange={(e) => setValue("purpose", e.target.value)} />
              </Field>
              <Field label="Description" hint="Programme, audience, anything the team should know.">
                <Textarea
                  name="description"
                  rows={4}
                  value={values.description}
                  onChange={(e) => setValue("description", e.target.value)}
                />
              </Field>
            </Fieldset>

            {scheduleEditable ? (
              <>
                <Fieldset legend="Schedule">
                  <Field label="Starts at" required error={errors.startsAt}>
                    <Input
                      name="startsAt"
                      type="datetime-local"
                      value={values.startsAt}
                      onChange={(e) => setValue("startsAt", e.target.value)}
                    />
                  </Field>
                  <Field label="Ends at" required error={errors.endsAt}>
                    <Input
                      name="endsAt"
                      type="datetime-local"
                      value={values.endsAt}
                      onChange={(e) => setValue("endsAt", e.target.value)}
                    />
                  </Field>
                </Fieldset>
                <Fieldset legend="Attendance">
                  <Field label="Expected attendance" required error={errors.expectedAttendance}>
                    <Input
                      name="expectedAttendance"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={values.expectedAttendance}
                      onChange={(e) => setValue("expectedAttendance", e.target.value)}
                    />
                  </Field>
                  <Field label="Preferred room layout">
                    <Select
                      name="preferredLayout"
                      placeholder="No preference"
                      options={toOptions(LAYOUTS)}
                      value={values.preferredLayout}
                      onChange={(e) => setValue("preferredLayout", e.target.value)}
                    />
                  </Field>
                </Fieldset>
              </>
            ) : (
              <Fieldset legend="Sessions">
                <Alert variant="info">{SESSIONS_FIXED}</Alert>
                <ul className="flex flex-col gap-1 text-sm text-ink-2">
                  {sessions.map((session) => (
                    <li key={session.id}>
                      {session.label ? `${session.label}: ` : ""}
                      {formatDateTimeRange(session.startsAt, session.endsAt)}
                    </li>
                  ))}
                </ul>
              </Fieldset>
            )}

            <Fieldset legend="Venue requirements">
              <CheckboxGroup
                legend="The venue must have"
                options={facilityOptions.filter((f) => f.category === "facility")}
                selected={values.facilityIds}
                onToggle={toggleFacility}
                loading={facilities === null}
              />
              <CheckboxGroup
                legend="Accessibility needs"
                options={facilityOptions.filter((f) => f.category === "accessibility")}
                selected={values.facilityIds}
                onToggle={toggleFacility}
                loading={facilities === null}
              />
              <Field label="Other accessibility notes">
                <Textarea
                  name="accessibilityNotes"
                  rows={2}
                  value={values.accessibilityNotes}
                  onChange={(e) => setValue("accessibilityNotes", e.target.value)}
                />
              </Field>
              <Field label="Anything else about the space">
                <Textarea
                  name="specialRequirements"
                  rows={3}
                  value={values.specialRequirements}
                  onChange={(e) => setValue("specialRequirements", e.target.value)}
                />
              </Field>
            </Fieldset>

            <Fieldset legend="Equipment">
              <Field
                label="Equipment changes"
                hint="Describe what to add, remove or change. Your coordinator updates the equipment list."
              >
                <Textarea
                  name="equipmentChanges"
                  rows={3}
                  value={equipmentChanges}
                  onChange={(e) => setEquipmentChanges(e.target.value)}
                />
              </Field>
            </Fieldset>
          </>
        )}

        <Field label="Reason for the change" required error={errors.reason}>
          <Textarea
            name="reason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              clearError("reason");
            }}
          />
        </Field>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface-2 px-4 py-3 sm:mx-0 sm:rounded-md sm:px-4">
          <Button type="submit" loading={sending} loadingText="Sending…">
            Send change request
          </Button>
          {backToEvent}
        </div>
      </form>
    </div>
  );
}

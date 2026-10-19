"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  ButtonLink,
  CheckboxGroup,
  ConfirmDialog,
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
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";
import { CATEGORIES, LAYOUTS, toFormValues, toOptions, type EventRecord, type Facility } from "@/lib/eventForm";
import { formatDateTimeRange } from "@/lib/format";
import { CHANGE_LABELS } from "@/lib/eventChangeImpact";
import {
  EVENT_INFORMATION_EDIT_STATUSES,
  EVENT_INFORMATION_STATUS_MESSAGE,
  canUpdateEventInformation,
} from "@/lib/permissions";
import { BACK_TO_PLANNING_SAVED, backToPlanningWarning } from "@/lib/safetyResolution";
import {
  changedPayload,
  formChanges,
  informationValues,
  validateInformation,
  type InformationValues,
} from "@/lib/eventInformationForm";

// Update Event Information (SPM-62): the assigned coordinator changes an
// event's permitted information after approval. The organiser's draft editor
// (../edit) is a different screen for a different person and status.
//
// What it saves: PATCH /api/events/[id]/information, only the fields that
// changed. What a change affects is decided on the server
// (src/lib/eventChangeImpact.ts); this screen warns as the form is edited,
// asks before a Confirmed event goes back to Planning, and afterwards shows
// what the save flagged. Showing flags later is Track Outstanding
// Arrangements (SPM-33) and Review Flagged Arrangements (SPM-68).

type LoadedEvent = EventRecord & {
  sequenceNumber: number;
  status: string;
  organiserId: string;
  organisationId: string | null;
  coordinatorId: string | null;
};

interface SaveResult {
  /// Back in Planning: from Confirmed (SPM-62), or with its safety check
  /// closed (SPM-88).
  backInPlanning: boolean;
  flagged: string[];
}

const TITLE = "Edit event information";

export default function UpdateEventInformationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const formRef = useRef<HTMLFormElement>(null);
  const { user, state: authState } = useCurrentUser();

  const [event, setEvent] = useState<LoadedEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<InformationValues | null>(null);
  const [values, setValues] = useState<InformationValues | null>(null);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/update`));
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
  }, [eventId, router]);

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
      router.push(loginUrlFor(`/events/${eventId}/update`));
      return;
    }
    if (authState === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
      void loadFacilities();
    }
  }, [authState, load, loadFacilities, eventId, router]);

  const scheduleEditable = (event?.sessions ?? []).length === 0;
  const changes = useMemo(() => (initial && values ? formChanges(initial, values) : []), [initial, values]);

  // Same rules as the route, so a refused user sees why instead of a form
  // that cannot be saved.
  const refusal = (() => {
    if (!user || !event) return null;
    const actor = { id: user.id, role: user.role, organisationId: null };
    if (!canUpdateEventInformation(actor, { ...event, coordinatorId: event.coordinatorId ?? null })) {
      return "Only the coordinator assigned to this event can change its information.";
    }
    if (!EVENT_INFORMATION_EDIT_STATUSES.includes(event.status)) {
      return EVENT_INFORMATION_STATUS_MESSAGE;
    }
    return null;
  })();

  function setValue<K extends keyof InformationValues>(field: K, value: InformationValues[K]) {
    setValues((current) => (current ? { ...current, [field]: value } : current));
    if (errors[field]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function toggleFacility(id: string) {
    setValues((current) =>
      current
        ? {
            ...current,
            facilityIds: current.facilityIds.includes(id)
              ? current.facilityIds.filter((f) => f !== id)
              : [...current.facilityIds, id],
          }
        : current
    );
  }

  function submit() {
    if (!event || !initial || !values) return;
    setFormError(null);
    const clientErrors = validateInformation(initial, values, {
      scheduleEditable,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
    });
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) {
      focusFirstError(formRef.current, clientErrors);
      return;
    }
    // AC6: a Confirmed event goes back to Planning on an important change,
    // which the organiser and the rest of the team will see - ask first.
    // SPM-88: so does one in Safety review or Safety approved.
    if (backToPlanningWarning(event.title, event.status, "information") && changes.length > 0) {
      setAsking(true);
      return;
    }
    void save();
  }

  async function save() {
    if (!initial || !values) return;
    setSaving(true);
    try {
      const res = await authedFetch(`/api/events/${eventId}/information`, {
        method: "PATCH",
        body: JSON.stringify(changedPayload(initial, values, scheduleEditable)),
      });
      const body = await res.json();
      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(body, "Could not save the event information.");
        setErrors(fieldErrors);
        setFormError(message);
        focusFirstError(formRef.current, fieldErrors);
        return;
      }
      setResult({
        backInPlanning: Boolean(body.statusReverted || body.safetyCheckClosed),
        flagged: body.flagged ?? [],
      });
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
        <Alert variant="error" title="You can't edit this event's information">
          {refusal}
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => router.push(`/events/${eventId}`)}>
            Back to event
          </Button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        {header}
        <Alert variant="success">
          {result.backInPlanning ? BACK_TO_PLANNING_SAVED : "Event information updated."}
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
        <div>
          <ButtonLink href={`/events/${eventId}`}>Back to event</ButtonLink>
        </div>
      </div>
    );
  }

  const facilityOptions = facilities ?? [];

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
          // Editing sessions is a follow-up story: they are saved by replacing
          // them, which would also delete each session's bookings and equipment.
          <Fieldset legend="Sessions">
            <Alert variant="info">Session times and attendance can&apos;t be changed here yet.</Alert>
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {(event.sessions ?? []).map((session) => (
                <li key={session.id}>
                  {session.label ? `${session.label}: ` : ""}
                  {formatDateTimeRange(session.startsAt, session.endsAt)}
                  {session.expectedAttendance != null ? ` · ${session.expectedAttendance} expected` : ""}
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
          <Alert variant="info">Equipment is changed on the Equipment tab.</Alert>
        </Fieldset>

        {changes.length > 0 && (
          <Alert variant="warning" title="These changes affect existing arrangements">
            {`You've changed: ${changes.map((change) => CHANGE_LABELS[change]).join(", ")}. Any venue booking, equipment or registrations already arranged will be flagged for review, not changed.`}
          </Alert>
        )}

        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface-2 px-4 py-3 sm:mx-0 sm:rounded-md sm:px-4">
          <Button type="submit" loading={saving && !asking} loadingText="Saving…">
            Save changes
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push(`/events/${eventId}`)}>
            Cancel
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={asking}
        title="Move this event back to Planning?"
        confirmLabel="Save and move to Planning"
        cancelLabel="Keep editing"
        confirmVariant="primary"
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setAsking(false)}
      >
        {backToPlanningWarning(event.title, event.status, "information")}
      </ConfirmDialog>
    </div>
  );
}

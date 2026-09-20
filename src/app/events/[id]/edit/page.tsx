"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Checkbox,
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
import { SessionFields } from "@/components/SessionFields";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";
import {
  CATEGORIES,
  LAYOUTS,
  toOptions,
  INITIAL,
  validateForm,
  toIso,
  sessionsPayload,
  toFormValues,
  availableEquipmentOptions,
  type FormValues,
  type EquipmentRow,
  type Facility,
  type EquipmentItem,
  type EventRecord,
} from "@/lib/eventForm";

// SPM-24: edit a saved draft before submitting it. Same fields and the same
// validation as "New event request" (src/lib/eventForm.ts) — the difference
// is this screen loads an existing draft first, saves over PATCH instead of
// POST, and only ever operates on a draft: PATCH /api/events/[id] refuses a
// content edit once the event has left draft status, so this page has to
// refuse it too rather than let someone submit into a 400.

export default function EditDraftPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const formRef = useRef<HTMLFormElement>(null);
  const { state: authState } = useCurrentUser();

  const [values, setValues] = useState<FormValues>(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<"draft" | "submit" | null>(null);

  // null = still loading; a string = the draft could not be loaded (not
  // found, not yours, or already submitted) and the form is not shown.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [reference, setReference] = useState<{
    facilities: Facility[];
    equipment: EquipmentItem[];
  } | null>(null);

  const loadReference = useCallback(async () => {
    try {
      const [facilitiesRes, equipmentRes] = await Promise.all([
        authedFetch("/api/facilities"),
        authedFetch("/api/equipment"),
      ]);
      if (!facilitiesRes.ok || !equipmentRes.ok) return;
      setReference({
        facilities: await facilitiesRes.json(),
        equipment: await equipmentRes.json(),
      });
    } catch {
      // The rest of the form still works without these; the pickers stay in
      // their loading state rather than blocking the whole request.
    }
  }, []);

  const loadDraft = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/edit`));
        return;
      }
      if (res.status === 404) {
        setLoadError("This draft could not be found. It may have been removed, or it isn't yours.");
        return;
      }
      if (!res.ok) {
        setLoadError("Could not load this draft.");
        return;
      }
      const event: EventRecord & { status: string } = await res.json();
      if (event.status !== "draft") {
        setLoadError("This request has already been submitted, so it can no longer be edited here.");
        return;
      }
      setValues(toFormValues(event));
      setLoaded(true);
    } catch {
      setLoadError("Could not reach the server. Check your connection and try again.");
    }
  }, [eventId, router]);

  useEffect(() => {
    if (authState === "anonymous") {
      router.push(loginUrlFor(`/events/${eventId}/edit`));
      return;
    }
    if (authState === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDraft();
      void loadReference();
    }
  }, [authState, loadDraft, loadReference, eventId, router]);

  const facilities = reference?.facilities ?? [];
  const equipmentCatalogue = reference?.equipment ?? [];
  const selectedEquipmentIds = new Set(values.equipment.map((row) => row.equipmentId).filter(Boolean));
  const allEquipmentSelected =
    equipmentCatalogue.length > 0 && selectedEquipmentIds.size >= equipmentCatalogue.length;
  const hasDates = Boolean(values.startsAt && values.endsAt);

  function toggleFacility(id: string) {
    setValues((current) => ({
      ...current,
      facilityIds: current.facilityIds.includes(id)
        ? current.facilityIds.filter((f) => f !== id)
        : [...current.facilityIds, id],
    }));
  }

  function addEquipmentRow() {
    setValues((current) => ({
      ...current,
      equipment: [
        ...current.equipment,
        { equipmentId: "", quantityRequested: "1", technicalRequirements: "" },
      ],
    }));
  }

  function setEquipmentRow(index: number, patch: Partial<EquipmentRow>) {
    setValues((current) => ({
      ...current,
      equipment: current.equipment.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
    clearError("equipment");
  }

  function removeEquipmentRow(index: number) {
    setValues((current) => ({
      ...current,
      equipment: current.equipment.filter((_, i) => i !== index),
    }));
    clearError("equipment");
  }

  function clearError(field: string) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function setValue<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field as string]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field as string];
        return next;
      });
    }
  }

  /// Unlike creating a new event, an edit has to be able to say "remove
  /// this" — clearing a text field back to empty, or clearing the last
  /// facility or equipment row — not just "add more". So every field the
  /// draft can already hold is always sent, rather than turned into
  /// `undefined` when empty (`undefined` means "leave alone" to the PATCH
  /// route, which is right for the fields below that the UI never lets the
  /// user blank out again once set).
  function toDraftPayload(v: FormValues) {
    return {
      title: v.title.trim(),
      category: v.category || undefined,
      purpose: v.purpose,
      description: v.description,
      // A multi-session event's schedule, attendance and layout live on its
      // sessions; the server works the event's own out from them.
      startsAt: v.multiSession ? undefined : toIso(v.startsAt),
      endsAt: v.multiSession ? undefined : toIso(v.endsAt),
      expectedAttendance: !v.multiSession && v.expectedAttendance ? Number(v.expectedAttendance) : undefined,
      preferredLayout: (!v.multiSession && v.preferredLayout) || undefined,
      accessibilityNotes: v.accessibilityNotes,
      specialRequirements: v.specialRequirements,
      registrationEnabled: v.registrationEnabled,
      registrationCapacity: v.registrationEnabled ? Number(v.registrationCapacity) : undefined,
      registrationOpensAt: v.registrationEnabled ? toIso(v.registrationOpensAt) : undefined,
      registrationClosesAt: v.registrationEnabled ? toIso(v.registrationClosesAt) : undefined,
      facilityIds: v.facilityIds,
      // Always sent, even empty: `[]` is how an edit drops the event-wide
      // equipment (multi-session moves it onto the sessions) or, for sessions,
      // how a draft goes back to being an ordinary single-session event.
      equipment: v.multiSession
        ? []
        : v.equipment.map((row) => ({
            equipmentId: row.equipmentId,
            quantityRequested: Number(row.quantityRequested),
            technicalRequirements: row.technicalRequirements || undefined,
          })),
      sessions: v.multiSession ? sessionsPayload(v) : [],
    };
  }

  async function save(intent: "draft" | "submit") {
    setFormError(null);

    const clientErrors = validateForm(values, intent);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      focusFirstError(formRef.current, clientErrors);
      return;
    }

    setPending(intent);
    try {
      const res = await authedFetch(`/api/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify(toDraftPayload(values)),
      });

      const body = await res.json();
      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(body, "Could not save this draft");
        setErrors(fieldErrors);
        setFormError(message);
        focusFirstError(formRef.current, fieldErrors);
        return;
      }

      if (intent === "draft") {
        router.push("/events");
        return;
      }

      // Content is saved either way; submitting is the second step, and the
      // server re-checks completeness before it lets the status change.
      const submitRes = await authedFetch(`/api/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "submitted" }),
      });

      if (!submitRes.ok) {
        const submitBody = await submitRes.json();
        setFormError(
          `${submitBody.error ?? "Could not submit this request"} Your changes have been saved as a draft.`
        );
        return;
      }

      router.push(`/events/${eventId}`);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      focusFirstError(formRef.current, {});
    } finally {
      setPending(null);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="Edit draft"
          breadcrumbs={[{ label: "My Events", href: "/events" }, { label: "Edit draft" }]}
        />
        <Alert variant="error" title="Could not open this draft">
          {loadError}
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => router.push("/events")}>
            Back to My Events
          </Button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="Edit draft"
          breadcrumbs={[{ label: "My Events", href: "/events" }, { label: "Edit draft" }]}
        />
        <SkeletonRows rows={4} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Edit draft"
        subtitle="Pick up where you left off. Nothing here is sent until you submit it."
        breadcrumbs={[{ label: "My Events", href: "/events" }, { label: "Edit draft" }]}
        meta={<StatusBadge status="draft" />}
      />

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void save("submit");
        }}
        className="flex flex-col gap-6"
        noValidate
      >
        {formError && <Alert variant="error">{formError}</Alert>}

        <Fieldset legend="Basics">
          <Field label="Event name" required error={errors.title}>
            <Input
              name="title"
              value={values.title}
              onChange={(e) => setValue("title", e.target.value)}
            />
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
            <Textarea
              name="purpose"
              rows={2}
              value={values.purpose}
              onChange={(e) => setValue("purpose", e.target.value)}
            />
          </Field>

          <Field label="Description" hint="Programme, audience, anything your coordinator should know.">
            <Textarea
              name="description"
              rows={4}
              value={values.description}
              onChange={(e) => setValue("description", e.target.value)}
            />
          </Field>
        </Fieldset>

        <SessionFields
          values={values}
          setValues={setValues}
          errors={errors}
          setErrors={setErrors}
          equipmentCatalogue={equipmentCatalogue}
          referenceLoading={reference === null}
        />

        {/* A multi-session event has its schedule and attendance per session
            (above), so those two sections are not shown for it at all rather
            than shown and ignored. Event-wide Equipment, further down, is
            hidden the same way. */}
        {!values.multiSession && (
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

              <Field
                label="Ends at"
                required
                hint="Include the full programme. Setup and turnaround time is added by ConnectSphere."
                error={errors.endsAt}
              >
                <Input
                  name="endsAt"
                  type="datetime-local"
                  value={values.endsAt}
                  onChange={(e) => setValue("endsAt", e.target.value)}
                />
              </Field>
            </Fieldset>

            <Fieldset legend="Attendance">
              <Field
                label="Expected attendance"
                required
                hint="Used to check a venue is large enough. An estimate is fine."
                error={errors.expectedAttendance}
              >
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
        )}

        <Fieldset
          legend="Venue requirements"
          description={values.multiSession ? "These apply to every session." : undefined}
        >
          <CheckboxGroup
            legend="The venue must have"
            hint="We only offer you venues that meet everything you tick here."
            options={facilities.filter((f) => f.category === "facility")}
            selected={values.facilityIds}
            onToggle={(id) => toggleFacility(id)}
            loading={reference === null}
          />

          <CheckboxGroup
            legend="Accessibility needs"
            hint="What your attendees need in order to take part."
            options={facilities.filter((f) => f.category === "accessibility")}
            selected={values.facilityIds}
            onToggle={(id) => toggleFacility(id)}
            loading={reference === null}
          />

          <Field
            label="Other accessibility notes"
            hint="Anything not covered above that your attendees need."
          >
            <Textarea
              name="accessibilityNotes"
              rows={2}
              value={values.accessibilityNotes}
              onChange={(e) => setValue("accessibilityNotes", e.target.value)}
            />
          </Field>

          <Field
            label="Anything else about the space"
            hint="Room layout notes, signage, catering arrangements, or other special requests."
          >
            <Textarea
              name="specialRequirements"
              rows={3}
              value={values.specialRequirements}
              onChange={(e) => setValue("specialRequirements", e.target.value)}
            />
          </Field>
        </Fieldset>

        {/* Event-wide equipment only applies to a single-session event; a
            multi-session one requests it per session, above. */}
        {!values.multiSession && (
          <Fieldset legend="Equipment">
            {!hasDates ? (
              <Alert variant="info">
                Add the event date and time above, then you can request equipment here.
              </Alert>
            ) : (
              <>
                {errors.equipment && <Alert variant="error">{errors.equipment}</Alert>}

                {values.equipment.length === 0 && (
                  <p className="text-sm text-ink-2">
                    Nothing requested yet. Add projectors, microphones, video conferencing, or
                    anything else you need on the day.
                  </p>
                )}

                {values.equipment.map((row, index) => (
                  <div key={index} className="rounded-lg border border-line bg-surface-2 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      <Field label="Equipment" className="flex-1">
                        <Select
                          name={`equipment.${index}.equipmentId`}
                          placeholder="Choose an item"
                          options={availableEquipmentOptions(equipmentCatalogue, values.equipment, index)}
                          value={row.equipmentId}
                          onChange={(e) => setEquipmentRow(index, { equipmentId: e.target.value })}
                        />
                      </Field>

                      <Field label="Quantity" className="sm:w-28">
                        <Input
                          name={`equipment.${index}.quantityRequested`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={row.quantityRequested}
                          onChange={(e) =>
                            setEquipmentRow(index, { quantityRequested: e.target.value })
                          }
                        />
                      </Field>

                      <div className="sm:pt-7">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeEquipmentRow(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>

                    <Field
                      label="Technical requirements"
                      hint="Anything our technical team should know — connections, positioning, timing."
                      className="mt-2"
                    >
                      <Input
                        name={`equipment.${index}.technicalRequirements`}
                        value={row.technicalRequirements}
                        onChange={(e) =>
                          setEquipmentRow(index, { technicalRequirements: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                ))}

                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addEquipmentRow}
                    disabled={reference === null || allEquipmentSelected}
                  >
                    Add equipment
                  </Button>
                  {allEquipmentSelected && (
                    <p className="mt-1.5 text-sm text-ink-3">
                      Every catalogue item is already in your request.
                    </p>
                  )}
                </div>
              </>
            )}
          </Fieldset>
        )}

        <Fieldset legend="Registration">
          <Checkbox
            name="registrationEnabled"
            label="Attendees need to register for this event"
            hint="Turn this on if you want ConnectSphere to collect registrations."
            checked={values.registrationEnabled}
            onChange={(e) => setValue("registrationEnabled", e.target.checked)}
          />

          {values.registrationEnabled && (
            <>
              <Field
                label="Registration capacity"
                required
                hint="How many attendees can register. This can differ from expected attendance."
                error={errors.registrationCapacity}
              >
                <Input
                  name="registrationCapacity"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={values.registrationCapacity}
                  onChange={(e) => setValue("registrationCapacity", e.target.value)}
                />
              </Field>

              <Field
                label="Registration opens"
                hint="When attendees can start registering. Leave blank to open immediately."
                error={errors.registrationOpensAt}
              >
                <Input
                  name="registrationOpensAt"
                  type="datetime-local"
                  value={values.registrationOpensAt}
                  onChange={(e) => setValue("registrationOpensAt", e.target.value)}
                />
              </Field>

              <Field
                label="Registration closes"
                hint="Must be before the event starts."
                error={errors.registrationClosesAt}
              >
                <Input
                  name="registrationClosesAt"
                  type="datetime-local"
                  value={values.registrationClosesAt}
                  onChange={(e) => setValue("registrationClosesAt", e.target.value)}
                />
              </Field>
            </>
          )}
        </Fieldset>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface-2 px-4 py-3 sm:mx-0 sm:rounded-md sm:px-4">
          <Button type="submit" loading={pending === "submit"} loadingText="Submitting…">
            Submit request
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void save("draft")}
            loading={pending === "draft"}
            loadingText="Saving…"
          >
            Save draft
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/events")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

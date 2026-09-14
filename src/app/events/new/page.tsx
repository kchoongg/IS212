"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  Textarea,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { focusFirstError, readServerError, type FieldErrors } from "@/lib/formErrors";

// S-08, the core form of the system. See UI_DESIGN.md §6.2.
//
// Two submits, because a draft may be incomplete and anything past draft may
// not. "Save draft" checks only the title; "Submit request" checks the five
// fields PATCH /api/events/[id] requires before an event may leave draft. The
// two sets are deliberately the same as the server's — a form that lets you
// press Submit and then shows a server error is the failure this spec exists
// to prevent.

const CATEGORIES = [
  "conference",
  "workshop",
  "training",
  "exhibition",
  "meeting",
  "seminar",
  "networking",
  "other",
];

const LAYOUTS = ["theatre", "classroom", "boardroom", "banquet", "exhibition", "u_shape", "cabaret"];

const toOptions = (values: string[]) =>
  values.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, "-"),
  }));

interface FormValues {
  title: string;
  category: string;
  purpose: string;
  description: string;
  startsAt: string;
  endsAt: string;
  expectedAttendance: string;
  preferredLayout: string;
  accessibilityNotes: string;
  specialRequirements: string;
  registrationEnabled: boolean;
  registrationCapacity: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  /// Facility ids from GET /api/facilities — both categories in one list,
  /// because that is how the API takes them.
  facilityIds: string[];
  equipment: EquipmentRow[];
}

/// Quantities are held as strings while typing: a number input mid-edit is
/// legitimately "" or "1", neither of which should become NaN.
interface EquipmentRow {
  equipmentId: string;
  quantityRequested: string;
  technicalRequirements: string;
}

interface Facility {
  id: string;
  name: string;
  category: string;
}

interface EquipmentItem {
  id: string;
  name: string;
  category: string | null;
}

const INITIAL: FormValues = {
  title: "",
  category: "",
  purpose: "",
  description: "",
  startsAt: "",
  endsAt: "",
  expectedAttendance: "",
  preferredLayout: "",
  accessibilityNotes: "",
  specialRequirements: "",
  registrationEnabled: false,
  registrationCapacity: "",
  registrationOpensAt: "",
  registrationClosesAt: "",
  facilityIds: [],
  equipment: [],
};

/// Mirrors the server's rules. `intent` is what separates a draft from a
/// submission — everything below the title is only required to submit.
function validateForm(values: FormValues, intent: "draft" | "submit"): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.title.trim()) errors.title = "Give the event a name so you can find it again.";
  if (intent === "draft") return errors;

  if (!values.category) errors.category = "Choose the type of event.";
  if (!values.startsAt) errors.startsAt = "Enter when the event starts.";
  if (!values.endsAt) errors.endsAt = "Enter when the event ends.";

  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) {
    errors.endsAt = "Ends at must be after starts at.";
  }
  if (values.startsAt && new Date(values.startsAt) < new Date()) {
    errors.startsAt = "The start date is in the past.";
  }

  const attendance = Number(values.expectedAttendance);
  if (!values.expectedAttendance) {
    errors.expectedAttendance = "Enter how many people you expect.";
  } else if (!Number.isInteger(attendance) || attendance < 1) {
    errors.expectedAttendance = "Enter a whole number of people, at least 1.";
  }

  // Enforced by createEventSchema too; checked here so the user is told before
  // the round trip.
  if (values.registrationEnabled) {
    const capacity = Number(values.registrationCapacity);
    if (!values.registrationCapacity) {
      errors.registrationCapacity = "Enter how many attendees can register.";
    } else if (!Number.isInteger(capacity) || capacity < 1) {
      errors.registrationCapacity = "Enter a whole number, at least 1.";
    }

    // Both optional, but if given they must make sense against each other
    // and against the event's own start (mirrors createEventSchema).
    if (
      values.registrationOpensAt &&
      values.registrationClosesAt &&
      new Date(values.registrationClosesAt) <= new Date(values.registrationOpensAt)
    ) {
      errors.registrationClosesAt = "Registration closes at must be after it opens.";
    }
    if (
      values.registrationOpensAt &&
      values.startsAt &&
      new Date(values.registrationOpensAt) >= new Date(values.startsAt)
    ) {
      errors.registrationOpensAt = "Registration must open before the event starts.";
    }
    if (
      values.registrationClosesAt &&
      values.startsAt &&
      new Date(values.registrationClosesAt) >= new Date(values.startsAt) &&
      !errors.registrationClosesAt
    ) {
      errors.registrationClosesAt = "Registration must close before the event starts.";
    }
  }

  // Equipment rows are only meaningful once the event has dates — the
  // reservation window is derived from them (mirrors createEventSchema).
  if (values.equipment.length > 0) {
    if (!values.startsAt || !values.endsAt) {
      errors.equipment = "Set the event date and time before requesting equipment.";
    } else if (values.equipment.some((row) => !row.equipmentId)) {
      errors.equipment = "Choose an item for every equipment row, or remove the empty ones.";
    } else if (values.equipment.some((row) => Number(row.quantityRequested) < 1)) {
      errors.equipment = "Every equipment row needs a quantity of at least 1.";
    } else {
      const ids = values.equipment.map((row) => row.equipmentId);
      if (new Set(ids).size !== ids.length) {
        errors.equipment =
          "Each item can only be requested once — change the quantity instead of adding a second row.";
      }
    }
  }

  return errors;
}

/// datetime-local gives "YYYY-MM-DDTHH:mm"; the API expects a full ISO string.
function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function NewEventPage() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [values, setValues] = useState<FormValues>(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<"draft" | "submit" | null>(null);

  // Reference data for the requirement pickers. null means "still loading";
  // the pickers show placeholders rather than an empty list, which would read
  // as "there are none to choose".
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReference();
  }, [loadReference]);

  const facilities = reference?.facilities ?? [];
  const equipmentOptions = (reference?.equipment ?? []).map((item) => ({
    value: item.id,
    label: item.category ? `${item.name} — ${item.category}` : item.name,
  }));
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
      const res = await authedFetch("/api/events", {
        method: "POST",
        body: JSON.stringify({
          title: values.title.trim(),
          category: values.category || undefined,
          purpose: values.purpose || undefined,
          description: values.description || undefined,
          startsAt: toIso(values.startsAt),
          endsAt: toIso(values.endsAt),
          expectedAttendance: values.expectedAttendance
            ? Number(values.expectedAttendance)
            : undefined,
          preferredLayout: values.preferredLayout || undefined,
          accessibilityNotes: values.accessibilityNotes || undefined,
          specialRequirements: values.specialRequirements || undefined,
          registrationEnabled: values.registrationEnabled,
          registrationCapacity: values.registrationEnabled
            ? Number(values.registrationCapacity)
            : undefined,
          registrationOpensAt: values.registrationEnabled ? toIso(values.registrationOpensAt) : undefined,
          registrationClosesAt: values.registrationEnabled
            ? toIso(values.registrationClosesAt)
            : undefined,
          facilityIds: values.facilityIds.length ? values.facilityIds : undefined,
          equipment: values.equipment.length
            ? values.equipment.map((row) => ({
                equipmentId: row.equipmentId,
                quantityRequested: Number(row.quantityRequested),
                technicalRequirements: row.technicalRequirements || undefined,
              }))
            : undefined,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        const { formError: message, fieldErrors } = readServerError(body, "Could not save this request");
        setErrors(fieldErrors);
        setFormError(message);
        focusFirstError(formRef.current, fieldErrors);
        return;
      }

      if (intent === "draft") {
        router.push("/events");
        return;
      }

      // The event is created as a draft; submitting is a second step, and the
      // server re-checks completeness before it lets the status change.
      const submitRes = await authedFetch(`/api/events/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "submitted" }),
      });

      if (!submitRes.ok) {
        const submitBody = await submitRes.json();
        // The draft is saved either way, so say so — losing the typing here
        // would be the worst outcome.
        setFormError(
          `${submitBody.error ?? "Could not submit this request"} Your draft has been saved.`
        );
        return;
      }

      router.push(`/events/${body.id}`);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New event request"
        subtitle="Tell us what you need. You can save a draft and finish it later."
        breadcrumbs={[{ label: "My Events", href: "/events" }, { label: "New request" }]}
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

        <Fieldset legend="Venue requirements">
          {/* Ticked boxes, not prose: these are stored as rows so venue search
              can match them against what each room actually has (§7.4). A
              free-text "needs a hearing loop" is unmatchable. */}
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

          {/* The boxes are what venue search can match on; this is for the
              needs no checkbox covers (§6.2, "checkbox group + notes"). */}
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

        <Fieldset legend="Equipment">
          {/* Hidden until the event has dates, the same way registration
              capacity is hidden until registration is enabled (§6.2).
              EquipmentRequest rows carry a reservation window derived from the
              event times, so without dates there is nowhere to hang them. */}
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
                <div
                  key={index}
                  className="rounded-lg border border-line bg-surface-2 p-4"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <Field label="Equipment" className="flex-1">
                      <Select
                        name={`equipment.${index}.equipmentId`}
                        placeholder="Choose an item"
                        options={equipmentOptions}
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
                  disabled={reference === null}
                >
                  Add equipment
                </Button>
              </div>
            </>
          )}
        </Fieldset>

        <Fieldset legend="Registration">
          <Checkbox
            name="registrationEnabled"
            label="Attendees need to register for this event"
            hint="Turn this on if you want ConnectSphere to collect registrations."
            checked={values.registrationEnabled}
            onChange={(e) => setValue("registrationEnabled", e.target.checked)}
          />

          {/* Hidden until it applies, rather than shown disabled: a disabled
              field the user cannot explain is worse than no field (§6.2). */}
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

"use client";

import {
  Alert,
  Button,
  CheckboxGroup,
  Field,
  Fieldset,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import {
  availableLayoutOptions,
  toOptions,
  LAYOUTS,
  type Facility,
  type LayoutRow,
  type VenueFormValues,
} from "@/lib/venueForm";
import type { FieldErrors } from "@/lib/formErrors";

// The fields of a venue, shared by S-19's "add venue" and S-20's "edit venue"
// screens. The events form kept only its *logic* in one place and duplicated
// ~200 lines of markup between new/page.tsx and [id]/edit/page.tsx; this puts
// the markup in one place too, so the two venue screens cannot drift visually
// either.
//
// Presentational: the pages own the state, the loading and the submitting, the
// same way they do for events. This renders fields and reports changes.

interface VenueFormProps {
  values: VenueFormValues;
  setValues: React.Dispatch<React.SetStateAction<VenueFormValues>>;
  errors: FieldErrors;
  clearError: (field: string) => void;
  facilities: Facility[];
  /// Reference data still loading: the pickers show placeholders rather than an
  /// empty group, which would read as "there are none".
  facilitiesLoading: boolean;
}

export function VenueForm({
  values,
  setValues,
  errors,
  clearError,
  facilities,
  facilitiesLoading,
}: VenueFormProps) {
  function setValue<K extends keyof VenueFormValues>(field: K, value: VenueFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    clearError(field as string);
  }

  function toggleFacility(id: string) {
    setValues((current) => ({
      ...current,
      facilityIds: current.facilityIds.includes(id)
        ? current.facilityIds.filter((f) => f !== id)
        : [...current.facilityIds, id],
    }));
  }

  function addLayoutRow() {
    setValues((current) => ({
      ...current,
      layouts: [...current.layouts, { layoutName: "", capacity: "" }],
    }));
    clearError("layouts");
  }

  function setLayoutRow(index: number, patch: Partial<LayoutRow>) {
    setValues((current) => ({
      ...current,
      layouts: current.layouts.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
    clearError("layouts");
  }

  function removeLayoutRow(index: number) {
    setValues((current) => ({
      ...current,
      layouts: current.layouts.filter((_, i) => i !== index),
    }));
    clearError("layouts");
  }

  const allLayoutsUsed = values.layouts.length >= LAYOUTS.length;

  return (
    <>
      <Fieldset legend="Identity">
        <Field
          label="Code"
          required
          hint="The short key staff say aloud, e.g. MAR-GH. Must be unique."
          error={errors.code}
        >
          <Input name="code" value={values.code} onChange={(e) => setValue("code", e.target.value)} />
        </Field>

        <Field label="Name" required error={errors.name}>
          <Input name="name" value={values.name} onChange={(e) => setValue("name", e.target.value)} />
        </Field>

        <Field label="Description" hint="How the room is normally used, and anything unusual about it.">
          <Textarea
            name="description"
            rows={3}
            value={values.description}
            onChange={(e) => setValue("description", e.target.value)}
          />
        </Field>
      </Fieldset>

      <Fieldset
        legend="Location"
        description="Building and floor are filterable on their own, so put the location here rather than burying it in the address."
      >
        <Field label="Building" required error={errors.building}>
          <Input
            name="building"
            value={values.building}
            onChange={(e) => setValue("building", e.target.value)}
          />
        </Field>

        <Field label="Floor" error={errors.floor}>
          <Input
            name="floor"
            value={values.floor}
            onChange={(e) => setValue("floor", e.target.value)}
          />
        </Field>

        <Field label="Address" error={errors.address}>
          <Input
            name="address"
            value={values.address}
            onChange={(e) => setValue("address", e.target.value)}
          />
        </Field>
      </Fieldset>

      <Fieldset legend="Capacity">
        <Field
          label="Maximum capacity"
          required
          hint="The absolute ceiling for the room. Each layout's own capacity is usually lower."
          error={errors.maxCapacity}
        >
          <Input
            name="maxCapacity"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={values.maxCapacity}
            onChange={(e) => setValue("maxCapacity", e.target.value)}
          />
        </Field>

        {/* Per-layout capacity is what suitability checking actually uses: the
            same room seats 500 theatre-style but 250 as a classroom, so a
            single number on the venue cannot answer "does this fit 100?". */}
        <div>
          <p className="text-sm font-medium text-ink">Layouts and their capacities</p>
          <p className="mt-1 text-xs text-ink-3">
            How many people fit in each seating plan. This is what venue search matches an event
            against, so a room with no layouts here will not be offered for one.
          </p>

          {errors.layouts && (
            <Alert variant="error" className="mt-3">
              {errors.layouts}
            </Alert>
          )}

          {values.layouts.length > 0 && (
            <ul className="mt-3 flex flex-col gap-3">
              {values.layouts.map((row, index) => (
                <li key={index} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                  <Field label="Layout" className="flex-1">
                    <Select
                      name={`layouts.${index}.layoutName`}
                      placeholder="Select a layout"
                      options={availableLayoutOptions(values.layouts, index)}
                      value={row.layoutName}
                      onChange={(e) => setLayoutRow(index, { layoutName: e.target.value })}
                    />
                  </Field>

                  <Field label="Seats" className="sm:w-28">
                    <Input
                      name={`layouts.${index}.capacity`}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={row.capacity}
                      onChange={(e) => setLayoutRow(index, { capacity: e.target.value })}
                    />
                  </Field>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeLayoutRow(index)}
                    aria-label={`Remove ${row.layoutName || "this"} layout`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={addLayoutRow} disabled={allLayoutsUsed}>
              Add a layout
            </Button>
            {allLayoutsUsed && (
              <p className="mt-2 text-xs text-ink-3">Every layout is already listed.</p>
            )}
          </div>
        </div>
      </Fieldset>

      <Fieldset legend="Opening hours">
        {/* No `step` on these: <input type="time"> yields "HH:mm" and gains a
            seconds component only when step drops below 60, which would then
            fail the HH:MM check in validateVenueForm. The browser renders the
            picker in the viewer's own locale - a 12-hour AM/PM face in some -
            but the value it reports is always 24-hour, so nothing here needs
            to restate the stored format. */}
        <Field
          label="Opens at"
          required
          hint="When the room becomes available for bookings."
          error={errors.opensAt}
        >
          <Input
            name="opensAt"
            type="time"
            value={values.opensAt}
            onChange={(e) => setValue("opensAt", e.target.value)}
          />
        </Field>

        <Field label="Closes at" required error={errors.closesAt}>
          <Input
            name="closesAt"
            type="time"
            value={values.closesAt}
            onChange={(e) => setValue("closesAt", e.target.value)}
          />
        </Field>

        <Field
          label="Setup minutes"
          hint="How long the room is occupied before an event starts."
          error={errors.setupMinutes}
        >
          <Input
            name="setupMinutes"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={values.setupMinutes}
            onChange={(e) => setValue("setupMinutes", e.target.value)}
          />
        </Field>

        <Field label="Teardown minutes" error={errors.teardownMinutes}>
          <Input
            name="teardownMinutes"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={values.teardownMinutes}
            onChange={(e) => setValue("teardownMinutes", e.target.value)}
          />
        </Field>
      </Fieldset>

      <Fieldset legend="Facilities">
        {/* Rows, not prose: an event that requires a hearing loop is matched
            against the venues that have one. Removing a facility here is what
            can flag an existing booking for review. */}
        <CheckboxGroup
          legend="This venue has"
          hint="What the room offers. An event's mandatory requirements are matched against this list."
          options={facilities.filter((f) => f.category === "facility")}
          selected={values.facilityIds}
          onToggle={toggleFacility}
          loading={facilitiesLoading}
        />

        <CheckboxGroup
          legend="Accessibility"
          hint="Removing one of these can make an already-approved booking unsuitable."
          options={facilities.filter((f) => f.category === "accessibility")}
          selected={values.facilityIds}
          onToggle={toggleFacility}
          loading={facilitiesLoading}
        />
      </Fieldset>
    </>
  );
}

/// Kept here so both venue screens import their options from one place.
export { toOptions };

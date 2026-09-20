"use client";

import type { Dispatch, SetStateAction } from "react";
import { Alert, Button, Checkbox, Field, Fieldset, Input, Select } from "@/components/ui";
import type { FieldErrors } from "@/lib/formErrors";
import {
  LAYOUTS,
  MIN_SESSIONS,
  blankSession,
  toOptions,
  availableSessionEquipmentOptions,
  type EquipmentItem,
  type EquipmentRow,
  type FormValues,
  type SessionRow,
} from "@/lib/eventForm";

// The "Sessions" section of S-08 (SPM-23, class clarification #74): an event
// can be split into sessions, each with its own timing, expected attendance,
// room layout and equipment - a multi-day conference with a different room
// each day. Shared by the new-request and edit-draft screens, like the rest of
// the form, so the two cannot drift apart.
//
// While "This event has multiple sessions" is ticked, the event-level Schedule,
// Attendance and Equipment sections are not shown at all (the page hides them):
// the sessions hold those, and the event's own start, end and headcount are
// worked out from them on save.

interface SessionFieldsProps {
  values: FormValues;
  setValues: Dispatch<SetStateAction<FormValues>>;
  errors: FieldErrors;
  setErrors: Dispatch<SetStateAction<FieldErrors>>;
  equipmentCatalogue: EquipmentItem[];
  /// Reference data still loading: the Add equipment button waits for it.
  referenceLoading: boolean;
}

export function SessionFields({
  values,
  setValues,
  errors,
  setErrors,
  equipmentCatalogue,
  referenceLoading,
}: SessionFieldsProps) {
  const { sessions } = values;

  // Clears one error, or every error under a prefix ("sessions" clears
  // sessions.0.startsAt too). Removing a session shifts the indices of the
  // ones after it, so its errors cannot be kept: they would land on the wrong
  // card.
  function clearErrors(prefix: string, { exact = false } = {}) {
    setErrors((current) => {
      const keys = Object.keys(current).filter(
        (key) => key === prefix || (!exact && key.startsWith(`${prefix}.`))
      );
      if (keys.length === 0) return current;
      const next = { ...current };
      keys.forEach((key) => delete next[key]);
      return next;
    });
  }

  function setMultiSession(on: boolean) {
    setValues((current) => {
      if (!on || current.sessions.length >= MIN_SESSIONS) {
        return { ...current, multiSession: on };
      }
      // First time on: what was already typed at event level becomes Session 1
      // rather than vanishing when the section it lived in is hidden, and the
      // event-level equipment moves with it (equipment lives on sessions now).
      const first: SessionRow = {
        label: "",
        startsAt: current.startsAt,
        endsAt: current.endsAt,
        expectedAttendance: current.expectedAttendance,
        preferredLayout: current.preferredLayout,
        equipment: current.equipment,
      };
      return {
        ...current,
        multiSession: true,
        sessions: [first, blankSession()],
        equipment: [],
      };
    });
    // Whichever set of fields just went away takes its messages with it.
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.startsWith("sessions") || ["startsAt", "endsAt", "expectedAttendance", "equipment"].includes(key)) {
          delete next[key];
        }
      }
      return next;
    });
  }

  function patchSession(index: number, patch: Partial<SessionRow>, ...clear: string[]) {
    setValues((current) => ({
      ...current,
      sessions: current.sessions.map((session, i) => (i === index ? { ...session, ...patch } : session)),
    }));
    // A change to a session's dates also settles the "not enough sessions" /
    // duplicate-equipment message about the set, so that goes too.
    clear.forEach((field) => clearErrors(`sessions.${index}.${field}`, { exact: true }));
    clearErrors("sessions", { exact: true });
  }

  function addSession() {
    setValues((current) => ({ ...current, sessions: [...current.sessions, blankSession()] }));
    clearErrors("sessions", { exact: true });
  }

  function removeSession(index: number) {
    setValues((current) => ({
      ...current,
      sessions: current.sessions.filter((_, i) => i !== index),
    }));
    clearErrors("sessions");
  }

  function addEquipmentRow(sessionIndex: number) {
    setValues((current) => ({
      ...current,
      sessions: current.sessions.map((session, i) =>
        i === sessionIndex
          ? {
              ...session,
              equipment: [
                ...session.equipment,
                { equipmentId: "", quantityRequested: "1", technicalRequirements: "" },
              ],
            }
          : session
      ),
    }));
  }

  function patchEquipmentRow(sessionIndex: number, rowIndex: number, patch: Partial<EquipmentRow>) {
    setValues((current) => ({
      ...current,
      sessions: current.sessions.map((session, i) =>
        i === sessionIndex
          ? {
              ...session,
              equipment: session.equipment.map((row, r) => (r === rowIndex ? { ...row, ...patch } : row)),
            }
          : session
      ),
    }));
    clearErrors(`sessions.${sessionIndex}.equipment`, { exact: true });
    clearErrors("sessions", { exact: true });
  }

  function removeEquipmentRow(sessionIndex: number, rowIndex: number) {
    setValues((current) => ({
      ...current,
      sessions: current.sessions.map((session, i) =>
        i === sessionIndex
          ? { ...session, equipment: session.equipment.filter((_, r) => r !== rowIndex) }
          : session
      ),
    }));
    clearErrors(`sessions.${sessionIndex}.equipment`, { exact: true });
    clearErrors("sessions", { exact: true });
  }

  // Every catalogue item already requested somewhere on the event: the item
  // can be requested once per event, so "Add equipment" has nothing left to
  // offer.
  const usedEquipmentIds = new Set(
    sessions.flatMap((session) => session.equipment.map((row) => row.equipmentId)).filter(Boolean)
  );
  const allEquipmentUsed =
    equipmentCatalogue.length > 0 && usedEquipmentIds.size >= equipmentCatalogue.length;

  return (
    <Fieldset legend="Sessions">
      <Checkbox
        name="multiSession"
        label="This event has multiple sessions"
        hint="For example, a multi-day conference with a different room each day. Each session gets its own times, expected attendance, room layout and equipment."
        checked={values.multiSession}
        onChange={(e) => setMultiSession(e.target.checked)}
      />

      {values.multiSession && (
        <>
          {errors.sessions && <Alert variant="error">{errors.sessions}</Alert>}

          {sessions.map((session, index) => {
            const key = (field: string) => `sessions.${index}.${field}`;
            const hasDates = Boolean(session.startsAt && session.endsAt);

            return (
              <div
                key={index}
                role="group"
                aria-label={`Session ${index + 1}`}
                className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">Session {index + 1}</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSession(index)}
                    disabled={sessions.length <= MIN_SESSIONS}
                  >
                    Remove session
                  </Button>
                </div>

                <Field label="Session name" hint={'Optional. For example "Day 1 — Keynotes".'}>
                  <Input
                    name={key("label")}
                    value={session.label}
                    onChange={(e) => patchSession(index, { label: e.target.value })}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Starts at" required error={errors[key("startsAt")]}>
                    <Input
                      name={key("startsAt")}
                      type="datetime-local"
                      value={session.startsAt}
                      onChange={(e) => patchSession(index, { startsAt: e.target.value }, "startsAt")}
                    />
                  </Field>

                  <Field label="Ends at" required error={errors[key("endsAt")]}>
                    <Input
                      name={key("endsAt")}
                      type="datetime-local"
                      value={session.endsAt}
                      onChange={(e) => patchSession(index, { endsAt: e.target.value }, "endsAt")}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Expected attendance"
                    required
                    hint="Used to check a venue is large enough for this session."
                    error={errors[key("expectedAttendance")]}
                  >
                    <Input
                      name={key("expectedAttendance")}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={session.expectedAttendance}
                      onChange={(e) =>
                        patchSession(index, { expectedAttendance: e.target.value }, "expectedAttendance")
                      }
                    />
                  </Field>

                  <Field label="Preferred room layout">
                    <Select
                      name={key("preferredLayout")}
                      placeholder="No preference"
                      options={toOptions(LAYOUTS)}
                      value={session.preferredLayout}
                      onChange={(e) => patchSession(index, { preferredLayout: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <div>
                    <h4 className="text-sm font-medium text-ink">Equipment for this session</h4>
                    <p className="text-xs text-ink-3">
                      An item can only be requested once for the whole event. If several sessions
                      need it, request it once and say so under Technical requirements.
                    </p>
                  </div>

                  {errors[key("equipment")] && <Alert variant="error">{errors[key("equipment")]}</Alert>}

                  {!hasDates ? (
                    <Alert variant="info">
                      Add this session&apos;s start and end above, then you can request equipment for it.
                    </Alert>
                  ) : (
                    <>
                      {session.equipment.length === 0 && (
                        <p className="text-sm text-ink-2">Nothing requested for this session yet.</p>
                      )}

                      {session.equipment.map((row, rowIndex) => (
                        <div key={rowIndex} className="rounded-lg border border-line bg-surface p-4">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            <Field label="Equipment" className="flex-1">
                              <Select
                                name={`sessions.${index}.equipment.${rowIndex}.equipmentId`}
                                placeholder="Choose an item"
                                options={availableSessionEquipmentOptions(
                                  equipmentCatalogue,
                                  sessions,
                                  index,
                                  rowIndex
                                )}
                                value={row.equipmentId}
                                onChange={(e) =>
                                  patchEquipmentRow(index, rowIndex, { equipmentId: e.target.value })
                                }
                              />
                            </Field>

                            <Field label="Quantity" className="sm:w-28">
                              <Input
                                name={`sessions.${index}.equipment.${rowIndex}.quantityRequested`}
                                type="number"
                                min={1}
                                step={1}
                                inputMode="numeric"
                                value={row.quantityRequested}
                                onChange={(e) =>
                                  patchEquipmentRow(index, rowIndex, { quantityRequested: e.target.value })
                                }
                              />
                            </Field>

                            <div className="sm:pt-7">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeEquipmentRow(index, rowIndex)}
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
                              name={`sessions.${index}.equipment.${rowIndex}.technicalRequirements`}
                              value={row.technicalRequirements}
                              onChange={(e) =>
                                patchEquipmentRow(index, rowIndex, { technicalRequirements: e.target.value })
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
                          onClick={() => addEquipmentRow(index)}
                          disabled={referenceLoading || allEquipmentUsed}
                        >
                          Add equipment
                        </Button>
                        {allEquipmentUsed && (
                          <p className="mt-1.5 text-sm text-ink-3">
                            Every catalogue item is already in your request.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          <div>
            <Button type="button" variant="secondary" size="sm" onClick={addSession}>
              Add session
            </Button>
          </div>
        </>
      )}
    </Fieldset>
  );
}

"use client";

import { createContext, useContext, useId } from "react";
import { cn } from "@/lib/cn";

// UI_DESIGN.md §6.1 and §8: labels are always visible and always bound to
// their control, errors are announced through aria-describedby, and the field
// carries aria-invalid. The wiring lives here once so no screen can forget it.

interface FieldContextValue {
  controlId: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldContext() {
  return useContext(FieldContext);
}

interface FieldProps {
  label: string;
  /// Marks the control with * and sets `required` on it.
  required?: boolean;
  /// Explains why the system needs this value, where that is not obvious.
  hint?: string;
  /// A message here puts the whole field into its error state.
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, required, hint, error, children, className }: FieldProps) {
  const controlId = useId();
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  const describedBy = cn(hint ? hintId : "", error ? errorId : "").trim() || undefined;

  return (
    <FieldContext.Provider value={{ controlId, describedBy, invalid: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={controlId} className="text-sm font-medium text-ink">
          {label}
          {required && (
            <span className="ml-0.5 text-tone-danger-fg" aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="sr-only"> (required)</span>}
        </label>

        {children}

        {hint && !error && (
          <p id={hintId} className="text-xs text-ink-3">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs font-medium text-tone-danger-fg">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

const CONTROL_BASE =
  "w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-3 focus:outline focus:outline-2 focus:outline-offset-0 " +
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3";

function controlClasses(invalid: boolean, className?: string) {
  return cn(
    CONTROL_BASE,
    invalid
      ? "border-tone-danger-fg focus:outline-tone-danger-fg"
      : "border-line-strong focus:outline-brand-600",
    className
  );
}

/// Applies the id and aria wiring from the surrounding Field. Controls used
/// outside a Field still render; they just carry no generated id.
function useControlProps() {
  const ctx = useFieldContext();
  return {
    id: ctx?.controlId,
    "aria-describedby": ctx?.describedBy,
    "aria-invalid": ctx?.invalid || undefined,
    invalid: ctx?.invalid ?? false,
  };
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const { invalid, ...aria } = useControlProps();
  return <input {...aria} {...props} className={controlClasses(invalid, className)} />;
}

export function Textarea({
  className,
  rows = 3,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { invalid, ...aria } = useControlProps();
  return <textarea {...aria} rows={rows} {...props} className={controlClasses(invalid, className)} />;
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  /// Rendered as a disabled first option, so an unanswered select is visibly
  /// unanswered rather than silently defaulting to whatever sorts first.
  placeholder?: string;
}

export function Select({ options, placeholder, className, ...props }: SelectProps) {
  const { invalid, ...aria } = useControlProps();
  return (
    <select {...aria} {...props} className={controlClasses(invalid, className)}>
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
}

/// Carries its own label, because a checkbox reads left-to-right rather than
/// label-above-control like the other Field children.
export function Checkbox({ label, hint, className, ...props }: CheckboxProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint ? hintId : undefined}
        {...props}
        className="mt-0.5 h-4 w-4 rounded border-line-strong text-ink focus:ring-brand-600"
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-xs text-ink-3">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

interface FieldsetProps {
  legend: string;
  description?: string;
  children: React.ReactNode;
}

/// Groups a long form into titled sections (UI_DESIGN.md §6.1: anything over
/// roughly 8 fields).
export function Fieldset({ legend, description, children }: FieldsetProps) {
  return (
    <fieldset className="border-t border-line pt-5">
      <legend className="pr-3 text-sm font-semibold uppercase tracking-wide text-ink-3">
        {legend}
      </legend>
      {description && <p className="mb-4 text-sm text-ink-3">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </fieldset>
  );
}

interface CheckboxGroupOption {
  id: string;
  name: string;
}

interface CheckboxGroupProps {
  legend: string;
  hint?: string;
  options: CheckboxGroupOption[];
  /// Ids currently ticked. The same array may back several groups — each
  /// group renders only the options it was given.
  selected: string[];
  onToggle: (id: string) => void;
  /// Reference data still loading: show placeholders rather than an empty
  /// group, which would read as "there are none".
  loading?: boolean;
}

/// A set of related checkboxes under one legend — required facilities,
/// accessibility needs. A real <fieldset>, so a screen reader announces the
/// group name before each option instead of reading twelve bare labels.
export function CheckboxGroup({
  legend,
  hint,
  options,
  selected,
  onToggle,
  loading = false,
}: CheckboxGroupProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}

      {loading ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-line" aria-hidden="true" />
          ))}
        </div>
      ) : options.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">None available.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <Checkbox
              key={option.id}
              label={option.name}
              checked={selected.includes(option.id)}
              onChange={() => onToggle(option.id)}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}

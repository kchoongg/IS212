import { cn } from "@/lib/cn";

// UI_DESIGN.md §7.2. Alerts are for messages that persist until dealt with.
// Errors never go in a toast — a toast disappears before it is read.
//
// The left rule carries the tone at a glance without the whole block shouting;
// a full-saturation panel next to a form makes the form harder to read.

export type AlertVariant = "info" | "success" | "warning" | "error";

const VARIANTS: Record<AlertVariant, string> = {
  info: "border-tone-info-ring bg-tone-info-bg text-tone-info-fg",
  success: "border-tone-success-ring bg-tone-success-bg text-tone-success-fg",
  warning: "border-tone-warning-ring bg-tone-warning-bg text-tone-warning-fg",
  error: "border-tone-danger-ring bg-tone-danger-bg text-tone-danger-fg",
};

const RULES: Record<AlertVariant, string> = {
  info: "before:bg-tone-info-fg",
  success: "before:bg-tone-success-fg",
  warning: "before:bg-tone-warning-fg",
  error: "before:bg-tone-danger-fg",
};

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children?: React.ReactNode;
  /// A next step, e.g. Retry, or a link to the conflicting booking.
  action?: React.ReactNode;
  className?: string;
}

export function Alert({ variant = "info", title, children, action, className }: AlertProps) {
  // Errors and warnings interrupt; info and success are announced politely.
  const assertive = variant === "error" || variant === "warning";

  return (
    <div
      role={assertive ? "alert" : "status"}
      className={cn(
        "relative overflow-hidden rounded-md border py-3 pl-5 pr-4 text-sm",
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        VARIANTS[variant],
        RULES[variant],
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && "mt-1", "opacity-90")}>{children}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

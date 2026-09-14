import { cn } from "@/lib/cn";
import { statusLabel, statusTone, type Tone } from "@/lib/statuses";

// UI_DESIGN.md §5.2. The only way a status is ever rendered. Colour carries no
// meaning on its own — the label always says what the colour is saying, so the
// badge still works in greyscale and for colour-blind users.
//
// The tones are warm-tuned to sit on the ivory ground rather than the stock
// Tailwind scales, which look pasted in from another product.

const TONES: Record<Tone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral-fg ring-tone-neutral-ring",
  info: "bg-tone-info-bg text-tone-info-fg ring-tone-info-ring",
  progress: "bg-tone-progress-bg text-tone-progress-fg ring-tone-progress-ring",
  success: "bg-tone-success-bg text-tone-success-fg ring-tone-success-ring",
  warning: "bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-ring",
  danger: "bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-ring",
};

interface StatusBadgeProps {
  /// The raw database value, e.g. "under_review".
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5",
        "text-xs font-medium ring-1 ring-inset",
        TONES[statusTone(status)],
        className
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

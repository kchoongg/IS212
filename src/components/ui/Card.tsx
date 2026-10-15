import { cn } from "@/lib/cn";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  /// Status badge, count, or a single low-emphasis action.
  aside?: React.ReactNode;
}

export function CardHeader({ title, subtitle, aside }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        {/* Serif, like the page title — card headings are the second level of
            the same editorial hierarchy, not UI chrome. */}
        <h2 className="truncate font-display text-base font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

export function CardBody({ children, className }: CardProps) {
  return <div className={cn("px-4 py-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: CardProps) {
  return (
    <div className={cn("border-t border-line bg-surface-2 px-4 py-3", className)}>{children}</div>
  );
}

interface DetailListProps {
  items: Array<{ label: string; value: React.ReactNode }>;
  /// Two columns on desktop suits most event and venue summaries; one column
  /// is for narrow side panels.
  columns?: 1 | 2;
}

/// Label/value pairs — the workhorse of the Overview tab and venue detail.
/// A real <dl> so screen readers announce the pairing.
export function DetailList({ items, columns = 2 }: DetailListProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4",
        columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
      )}
    >
      {/* Labels can repeat - two rooms booked for the whole event are both
          "Whole event" - so the position is part of the key. */}
      {items.map((item, i) => (
        <div key={`${i}-${item.label}`}>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{item.label}</dt>
          <dd className="mt-1 text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

"use client";

import { cn } from "@/lib/cn";
import { Alert } from "./Alert";
import { Button } from "./Button";

// UI_DESIGN.md §7.3: every screen that loads data handles loading, empty,
// error and loaded. DataState makes that the default rather than something a
// screen has to remember.

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand-600",
        className
      )}
    />
  );
}

/// Skeletons match the shape of the content that replaces them, so the page
/// does not jump when data arrives.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-line", className)} />;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-4 shadow-card">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  /// What this screen is for — not an apology.
  description?: string;
  /// The action that fills the screen.
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

interface DataStateProps<T> {
  /// null means "still loading"; the array (possibly empty) means loaded.
  data: T[] | null;
  error?: string | null;
  onRetry?: () => void;
  empty: EmptyStateProps;
  skeletonRows?: number;
  children: (data: T[]) => React.ReactNode;
}

/// Error takes priority over loading: a failed request must not sit under a
/// skeleton forever.
export function DataState<T>({
  data,
  error,
  onRetry,
  empty,
  skeletonRows = 3,
  children,
}: DataStateProps<T>) {
  if (error) {
    return (
      <Alert
        variant="error"
        title="Could not load this"
        action={
          onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )
        }
      >
        {error}
      </Alert>
    );
  }

  if (data === null) return <SkeletonRows rows={skeletonRows} />;
  if (data.length === 0) return <EmptyState {...empty} />;

  return <>{children(data)}</>;
}

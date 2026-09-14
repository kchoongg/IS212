import Link from "next/link";
import { cn } from "@/lib/cn";

// UI_DESIGN.md §5.1: one primary action per screen. Secondary actions sit
// beside it at lower emphasis; `danger` is reserved for actions that destroy
// or release something; `accent` is the clay call-to-action and is spent on
// at most one button per screen — usually "New event request".

export type ButtonVariant = "primary" | "accent" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:hover:bg-brand-600",
  accent: "bg-clay-600 text-white shadow-sm hover:bg-clay-700 disabled:hover:bg-clay-600",
  secondary:
    "border border-line-strong bg-surface text-ink shadow-sm hover:bg-surface-2 disabled:hover:bg-surface",
  danger: "bg-tone-danger-fg text-white shadow-sm hover:bg-clay-700 disabled:hover:bg-tone-danger-fg",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink disabled:hover:bg-transparent",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return cn(BASE, VARIANTS[variant], SIZES[size]);
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /// Shows a pending label and disables the button. Use for form submits so
  /// the user never double-submits a request.
  loading?: boolean;
  loadingText?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingText,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size), className)}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
        />
      )}
      {loading ? loadingText ?? "Working…" : children}
    </button>
  );
}

interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/// A link that looks like a button — for navigation, not submission. Keeping
/// it a real anchor means middle-click and "open in new tab" still work.
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonLinkProps) {
  return <Link {...props} className={cn(buttonClasses(variant, size), className)} />;
}

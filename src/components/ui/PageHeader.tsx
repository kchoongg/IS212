import Link from "next/link";

// UI_DESIGN.md §5.1: breadcrumb, title, optional subtitle, one primary action.
// Every content screen opens with this, in this order.

export interface Crumb {
  label: string;
  /// Omitted on the final crumb, which is the current page.
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-brand-700 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  className={last ? "font-medium text-ink-2" : undefined}
                  aria-current={last ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-line-strong">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  /// Status badge or similar, shown beside the title.
  meta?: React.ReactNode;
  /// The single primary action for this screen, plus any secondary buttons.
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumbs, meta, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 border-b border-line pb-5">
      {breadcrumbs && <Breadcrumb items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {/* The serif title is the strongest single signal that this is a
                considered product rather than a scaffold. */}
            <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
            {meta}
          </div>
          {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

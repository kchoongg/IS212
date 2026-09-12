"use client";

import { cn } from "@/lib/cn";

// UI_DESIGN.md §4.5: a table on desktop, stacked label/value cards below md.
// Venue Staff read these on a phone while standing in a room, and a table that
// scrolls sideways is unusable there.

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  /// Hidden in the stacked mobile view — for columns whose value is already
  /// obvious from the row's title.
  hideLabelOnMobile?: boolean;
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /// Whole-row navigation. Rows become buttons, so keyboard users reach them.
  onRowClick?: (row: T) => void;
  caption?: string;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, caption }: TableProps<T>) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-hidden rounded-lg border border-line bg-surface shadow-card md:block">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-line bg-surface-2">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-3",
                    column.className
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && "cursor-pointer hover:bg-surface-2")}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-4 py-3 align-top text-ink", column.className)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cn(
                "rounded-lg border border-line bg-surface p-4 shadow-card",
                onRowClick && "cursor-pointer hover:bg-surface-2"
              )}
            >
              <dl className="flex flex-col gap-2">
                {columns.map((column) => (
                  <div key={column.key}>
                    {!column.hideLabelOnMobile && (
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                        {column.header}
                      </dt>
                    )}
                    <dd className="text-sm text-ink">{column.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

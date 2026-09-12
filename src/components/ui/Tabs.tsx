"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

// UI_DESIGN.md §4.3. Tabs are links, so a tab is bookmarkable and shareable —
// "look at the Readiness tab of event X" has to be a URL.
//
// A tab the role may not see is simply absent from `items`. Never pass a
// disabled tab: a greyed-out "Readiness" tells an external user that internal
// planning information exists, which §8b of the briefing forbids.

export interface TabItem {
  key: string;
  label: string;
  href: string;
  /// e.g. an unanswered clarification count.
  badge?: number;
}

interface TabsProps {
  items: TabItem[];
  activeKey: string;
  className?: string;
}

export function Tabs({ items, activeKey, className }: TabsProps) {
  return (
    <div className={cn("border-b border-line", className)}>
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Sections">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand-600 text-ink"
                  : "border-transparent text-ink-3 hover:border-line-strong hover:text-ink-2"
              )}
            >
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

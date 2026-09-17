import { EVENT_TAB_LABELS, eventTabsFor, type EventTab } from "@/lib/roles";
import type { TabItem } from "@/components/ui";

// Shared between the hub (S-06, /events/[id]) and every tab screen that hangs
// off it, so the tab bar is identical wherever it's rendered.
//
// Only tabs with a real screen behind them are offered. Discussion, Venue,
// Attendees, Readiness, and History are separate stories (S-09, S-15, S-11,
// S-18) not yet built — UI_DESIGN.md §4.3 already says a tab the role can't
// see is left out entirely, never shown disabled; a tab that 404s is worse
// than one that's merely disabled, so unbuilt tabs get the same treatment
// until those stories land.
const IMPLEMENTED_TABS: EventTab[] = ["overview", "equipment"];

export function eventTabItemsFor(role: string, eventId: string): TabItem[] {
  const allowed = eventTabsFor(role);
  return IMPLEMENTED_TABS.filter((tab) => allowed.includes(tab)).map((tab) => ({
    key: tab,
    label: EVENT_TAB_LABELS[tab],
    href: tab === "overview" ? `/events/${eventId}` : `/events/${eventId}/${tab}`,
  }));
}

import { EVENT_TAB_LABELS, eventTabsFor, type EventTab } from "@/lib/roles";
import { can } from "@/lib/permissions";
import type { TabItem } from "@/components/ui";

// Shared between the hub (S-06, /events/[id]) and every tab screen that hangs
// off it, so the tab bar is identical wherever it's rendered.
//
// Only tabs with a real screen behind them are offered. Discussion and
// History are separate stories (S-09) not yet built — UI_DESIGN.md §4.3 already says a tab the role can't
// see is left out entirely, never shown disabled; a tab that 404s is worse
// than one that's merely disabled, so unbuilt tabs get the same treatment
// until those stories land.
//
// Readiness (S-18) is built by SPM-33; only a coordinator has it in
// EVENT_TABS_BY_ROLE.
//
// Attendees (S-11) is built by SPM-65; the organiser and the coordinator have
// it in EVENT_TABS_BY_ROLE, but only for their own event.
const IMPLEMENTED_TABS: EventTab[] = ["overview", "venue", "equipment", "attendees", "readiness"];

/// `canViewRegistrationList` is the server's canViewRegistrationList() for
/// this event, from whichever API the screen loads. Until it is known the
/// Attendees tab is left out, so it never shows only to be refused.
export function eventTabItemsFor(role: string, eventId: string, canViewRegistrationList = false): TabItem[] {
  const allowed = eventTabsFor(role);
  return IMPLEMENTED_TABS.filter(
    // The Venue tab is the suitability check (SPM-41), which reads the venue
    // catalogue. An organiser has the tab in EVENT_TABS_BY_ROLE but not
    // venue:view, so it would only ever 403 for them - leave it out.
    // Attendees is per event: another organiser at the same client, or a
    // coordinator not assigned to it, can open the event but not its list.
    (tab) =>
      allowed.includes(tab) &&
      (tab !== "venue" || can(role, "venue:view")) &&
      (tab !== "attendees" || canViewRegistrationList)
  ).map((tab) => ({
    key: tab,
    label: EVENT_TAB_LABELS[tab],
    href: tab === "overview" ? `/events/${eventId}` : `/events/${eventId}/${tab}`,
  }));
}

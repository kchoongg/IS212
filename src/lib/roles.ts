// Roles, their human labels, and the navigation each one sees.
//
// See UI_DESIGN.md §2 and §4.2. Navigation lives here as data rather than as
// conditionals inside the sidebar, so adding a screen for a role is a one-line
// change in one file and the sidebar component never grows an if-statement.

export const ROLES = [
  "organiser",
  "coordinator",
  "venue_staff",
  "tech_support",
  "attendee",
  "ops_manager",
  // SPM-85 (Week 7 change #6): reviews the operational safety of planned
  // events. SPM-86 already notifies users with this key.
  "safety_officer",
] as const;

export type Role = (typeof ROLES)[number];

/// Never render a raw role key. `venue_staff` is a database value; "Venue
/// Staff" is what a person reads.
export const ROLE_LABELS: Record<Role, string> = {
  organiser: "Event Organiser",
  coordinator: "Event Coordinator",
  venue_staff: "Venue Staff",
  tech_support: "Technical Support",
  attendee: "Attendee",
  // SPM-84 (Week 7 change #5, forum #129): the same role, renamed. The key
  // stays ops_manager so accounts, permissions and records are unchanged.
  ops_manager: "Event Coordinator Lead",
  safety_officer: "Safety Officer",
};

/// External users belong to a client organisation and must never see internal
/// planning information (customer briefing §8b).
export const EXTERNAL_ROLES: readonly Role[] = ["organiser", "attendee"];

export function isExternalRole(role: string): boolean {
  return EXTERNAL_ROLES.includes(role as Role);
}

/// The roles a stranger is allowed to give themselves at the public
/// registration form (S-02). The four internal roles are NOT on this list:
/// POST /api/auth/register takes no session, so whatever it accepts here is
/// what any anonymous caller can become. Letting it accept `ops_manager` or
/// `coordinator` would make the whole of permissions.ts decorative - the rules
/// would still be enforced perfectly against a role the attacker picked.
///
/// This happens to be the same set as EXTERNAL_ROLES today, and is kept
/// separate on purpose: "is not a ConnectSphere employee" and "may be claimed
/// without proof" are different questions that could stop agreeing. Internal
/// accounts are created by the seed or, eventually, by an admin screen.
export const SELF_REGISTERABLE_ROLES: readonly Role[] = ["organiser", "attendee"];

export function isSelfRegisterableRole(role: string): boolean {
  return SELF_REGISTERABLE_ROLES.includes(role as Role);
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export interface NavItem {
  href: string;
  label: string;
}

const DASHBOARD: NavItem = { href: "/dashboard", label: "Dashboard" };
const NOTIFICATIONS: NavItem = { href: "/notifications", label: "Notifications" };

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  organiser: [
    DASHBOARD,
    { href: "/events", label: "My Events" },
    NOTIFICATIONS,
  ],
  coordinator: [
    DASHBOARD,
    { href: "/queue", label: "Review Queue" },
    // SPM-68: the coordinator's other work list - arrangements on their
    // events that a change has flagged for another look.
    { href: "/flagged", label: "Flagged Arrangements" },
    // SPM-35: the organisers' change requests waiting on the coordinator's events.
    { href: "/change-requests", label: "Change Requests" },
    { href: "/events", label: "All Events" },
    { href: "/venues", label: "Venues" },
    { href: "/equipment", label: "Equipment" },
    NOTIFICATIONS,
  ],
  venue_staff: [
    DASHBOARD,
    { href: "/venues", label: "Venues" },
    { href: "/bookings", label: "Booking Requests" },
    NOTIFICATIONS,
  ],
  tech_support: [
    DASHBOARD,
    { href: "/equipment", label: "Equipment" },
    { href: "/equipment/requests", label: "Equipment Requests" },
    NOTIFICATIONS,
  ],
  attendee: [
    DASHBOARD,
    { href: "/browse", label: "Browse Events" },
    { href: "/registrations", label: "My Registrations" },
    NOTIFICATIONS,
  ],
  ops_manager: [
    DASHBOARD,
    { href: "/assignments", label: "Assignments" },
    { href: "/events", label: "All Events" },
    // An Ops Manager holds venue:view, so the venue catalogue and the
    // availability calendar behind it (S-21, SPM-46) are theirs to read - but
    // until 2026-09-27 there was no link to either, and the only way in was to
    // type the address. Found while checking SPM-46-TC11, which asks an Ops
    // Manager to reach the calendar from this sidebar.
    //
    // Read-only, like a coordinator's: venue:manage is what makes the rows
    // clickable, and this role does not hold it.
    { href: "/venues", label: "Venues" },
    NOTIFICATIONS,
  ],
  // SPM-85 (AC2). Safety Checks is the role's own work list, as Review Queue
  // is the coordinator's. No Venues: the rooms an event actually has are on
  // the event itself, and the catalogue is not part of a safety review.
  safety_officer: [
    DASHBOARD,
    { href: "/safety-checks", label: "Safety Checks" },
    { href: "/events", label: "All Events" },
    NOTIFICATIONS,
  ],
};

export function navFor(role: string): NavItem[] {
  return NAV_BY_ROLE[role as Role] ?? [DASHBOARD];
}

/// Which sidebar link to highlight for this page. A link matches its own
/// address and anything under it ("/events" stays lit on "/events/EVT-000123"),
/// and "/" matches only itself. When several match - Technical Support's
/// "Equipment" (/equipment) and "Equipment Requests" (/equipment/requests) on
/// /equipment/requests/EVT-000123 - only the most specific one is lit, never
/// both. null when nothing matches.
export function activeNavHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const matches = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/// Tabs on the event detail hub (UI_DESIGN.md §4.3). A tab the role may not
/// see is not rendered at all — rendering it disabled would tell an external
/// user that internal planning information exists.
export const EVENT_TABS = [
  "overview",
  "discussion",
  "venue",
  "equipment",
  "attendees",
  "readiness",
  "history",
] as const;

export type EventTab = (typeof EVENT_TABS)[number];

const EVENT_TABS_BY_ROLE: Record<Role, EventTab[]> = {
  organiser: ["overview", "discussion", "venue", "equipment", "attendees"],
  coordinator: [...EVENT_TABS],
  venue_staff: ["overview", "venue"],
  tech_support: ["overview", "equipment"],
  attendee: ["overview"],
  ops_manager: ["overview", "discussion", "history"],
  // SPM-85 (AC3, AC6): what a safety review reads, read-only. No Attendees
  // (who registered is personal), and no Venue - that tab is the
  // coordinator's search for a room; the rooms booked are on the Overview.
  safety_officer: ["overview", "equipment"],
};

export function eventTabsFor(role: string): EventTab[] {
  return EVENT_TABS_BY_ROLE[role as Role] ?? ["overview"];
}

export const EVENT_TAB_LABELS: Record<EventTab, string> = {
  overview: "Overview",
  discussion: "Discussion",
  venue: "Venue",
  equipment: "Equipment",
  attendees: "Attendees",
  readiness: "Readiness",
  history: "History",
};

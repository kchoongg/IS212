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
  ops_manager: "Operations Manager",
};

/// External users belong to a client organisation and must never see internal
/// planning information (customer briefing §8b).
export const EXTERNAL_ROLES: readonly Role[] = ["organiser", "attendee"];

export function isExternalRole(role: string): boolean {
  return EXTERNAL_ROLES.includes(role as Role);
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
    NOTIFICATIONS,
  ],
};

export function navFor(role: string): NavItem[] {
  return NAV_BY_ROLE[role as Role] ?? [DASHBOARD];
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

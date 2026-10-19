import type { Crumb } from "@/components/ui";

// SPM-98: every breadcrumb in the system follows one pattern (UI_DESIGN.md
// §4.1): <list> / <record> / <page>. These build the trails for event and
// venue pages so no page writes its own and they cannot drift apart again.
//
//   - The list crumb links to the list.
//   - The record crumb is the record's own name, linking to its main page;
//     'Event' or 'Venue' until it has loaded.
//   - The last crumb is the current page and is never a link.
//
// A page builds its trail once and shows it in every state - loading, loaded,
// error and access refused - so the trail never changes under the user.

/// The events list as the viewer's sidebar names it: an organiser only ever
/// sees their own events.
export function eventsListCrumb(role: string | undefined): Crumb {
  return { label: role === "organiser" ? "My Events" : "Events", href: "/events" };
}

/// `Events / <event title> / <page>`. With no page, the event itself is the
/// current page (its Overview), so the title is not a link.
export function eventCrumbs(
  role: string | undefined,
  eventId: string,
  title: string | null | undefined,
  ...pages: Crumb[]
): Crumb[] {
  const record: Crumb = { label: title || "Event" };
  if (pages.length > 0) record.href = `/events/${eventId}`;
  return [eventsListCrumb(role), record, ...pages];
}

/// `Venues / <venue name> / <page>`. A venue has no page of its own, so the
/// caller says where its name links to - or leaves it plain.
export function venueCrumbs(name: string | null | undefined, page: string, recordHref?: string): Crumb[] {
  return [
    { label: "Venues", href: "/venues" },
    { label: name || "Venue", href: recordHref },
    { label: page },
  ];
}

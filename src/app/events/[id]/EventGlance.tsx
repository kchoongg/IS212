import { Card, CardBody, CardHeader, DetailList } from "@/components/ui";
import { formatDate, formatDateTimeRange, orEmpty } from "@/lib/format";

// The "Event at a glance" sidebar from design/mockups/OrganiserEventDetail.dc.html —
// shown beside a tab's own content so a role doesn't have to bounce back to
// Overview for the basics. Overview itself doesn't render this: its own main
// content already is the full version of the same facts.

export interface GlanceEvent {
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  submittedAt: string | null;
  coordinator: { fullName: string } | null;
  /// SPM-34: approved bookings only. Optional so a caller that does not load
  /// them still compiles - it then reads as "Not booked yet", as before.
  venueBookings?: { session: { label: string | null } | null; venue: { name: string; code: string } }[];
}

function glanceVenue(bookings: GlanceEvent["venueBookings"]): string {
  if (!bookings || bookings.length === 0) return "Not booked yet";
  return bookings
    .map((b) => (b.session?.label ? `${b.session.label}: ${b.venue.name}` : b.venue.name))
    .join(" · ");
}

export function EventGlance({ event }: { event: GlanceEvent }) {
  return (
    <Card className="self-start">
      <CardHeader title="Event at a glance" />
      <CardBody>
        <DetailList
          columns={1}
          items={[
            { label: "When", value: formatDateTimeRange(event.startsAt, event.endsAt) },
            { label: "Expected attendance", value: orEmpty(event.expectedAttendance) },
            { label: "Coordinator", value: event.coordinator?.fullName ?? "Not yet assigned" },
            // CHANGED (SPM-34): venue booking (S-15) shipped with SPM-42, so
            // this is a real value now rather than a placeholder.
            { label: "Venue", value: glanceVenue(event.venueBookings) },
            { label: "Submitted", value: formatDate(event.submittedAt) },
          ]}
        />
      </CardBody>
    </Card>
  );
}

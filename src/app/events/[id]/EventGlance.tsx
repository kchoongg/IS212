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
            // Venue booking (S-15) isn't built yet, so this is always the
            // fallback for now rather than a real check.
            { label: "Venue", value: "Not booked yet" },
            { label: "Submitted", value: formatDate(event.submittedAt) },
          ]}
        />
      </CardBody>
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DetailList,
  PageHeader,
  SkeletonRows,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { EMPTY, formatDateTimeRange, orEmpty } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";

// S-06 — "the hub" (UI_DESIGN.md §3.1): every role lands here first when they
// open an event, then moves to a tab (Equipment is S-16 / SPM-47). Every role
// has the Overview tab (roles.ts EVENT_TABS_BY_ROLE), so there is no access
// gate here the way there is on the Equipment tab.

interface FacilityRequirement {
  facilityId: string;
  isMandatory: boolean;
  facility: { id: string; name: string; category: string };
}

interface EventDetail {
  id: string;
  title: string | null;
  description: string | null;
  purpose: string | null;
  category: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  accessibilityNotes: string | null;
  specialRequirements: string | null;
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  facilityRequirements: FacilityRequirement[];
}

export default function EventOverviewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}`));
        return;
      }
      if (res.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!res.ok) throw new Error("Could not load this event.");
      setEvent(await res.json());
    } catch (err) {
      setEvent(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(`/events/${eventId}`));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router, eventId]);

  if (state === "loading" || (state === "authenticated" && !user)) {
    return null;
  }

  const tabs = user ? eventTabItemsFor(user.role, eventId) : [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={event?.title || (error ? "Event" : "Loading…")}
        subtitle={event?.purpose ?? undefined}
        meta={event && <StatusBadge status={event.status} />}
        breadcrumbs={[
          { label: user?.role === "organiser" ? "My Events" : "Events", href: "/events" },
          { label: event?.title || "Event" },
        ]}
      />

      {tabs.length > 0 && <Tabs items={tabs} activeKey="overview" className="mb-6" />}

      {error ? (
        <Alert
          variant="error"
          title="Could not load this"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : !event ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="flex flex-col gap-6">
          {event.status === "draft" && (
            <Alert variant="info">
              This is a draft — only visible to you until it&apos;s submitted. Full draft editing
              isn&apos;t available yet.
            </Alert>
          )}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Category", value: orEmpty(event.category) },
                  { label: "Status", value: statusLabel(event.status) },
                  { label: "When", value: formatDateTimeRange(event.startsAt, event.endsAt) },
                  { label: "Expected attendance", value: orEmpty(event.expectedAttendance) },
                  { label: "Preferred layout", value: orEmpty(event.preferredLayout) },
                  { label: "Description", value: orEmpty(event.description) },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Venue requirements" />
            <CardBody>
              <DetailList
                items={[
                  {
                    label: "Required facilities",
                    value:
                      event.facilityRequirements.length === 0 ? (
                        EMPTY
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {event.facilityRequirements.map((req) => (
                            <li key={req.facilityId}>
                              {req.facility.name}
                              {!req.isMandatory && <span className="text-ink-3"> (nice-to-have)</span>}
                            </li>
                          ))}
                        </ul>
                      ),
                  },
                  { label: "Accessibility notes", value: orEmpty(event.accessibilityNotes) },
                  { label: "Special requirements", value: orEmpty(event.specialRequirements) },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Registration" />
            <CardBody>
              <DetailList
                items={
                  event.registrationEnabled
                    ? [
                        { label: "Capacity", value: orEmpty(event.registrationCapacity) },
                        {
                          label: "Window",
                          value: formatDateTimeRange(event.registrationOpensAt, event.registrationClosesAt),
                        },
                      ]
                    : [{ label: "Registration", value: "Not enabled for this event" }]
                }
              />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

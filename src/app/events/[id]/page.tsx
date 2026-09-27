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
import { EMPTY, eventReference, formatDateTimeRange, orEmpty } from "@/lib/format";
import { humanise, statusLabel } from "@/lib/statuses";

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
  // Present for every role, including an Attendee - see ATTENDEE_EVENT_FIELDS
  // (src/lib/permissions.ts). Format with eventReference() for display.
  sequenceNumber: number;
  title: string | null;
  description: string | null;
  purpose: string | null;
  category: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  // Absent (not just empty/null) for an Attendee: ATTENDEE_EVENT_FIELDS
  // (src/lib/permissions.ts) omits them entirely, since expected attendance,
  // preferred layout, accessibility/special requirements, the organiser's own
  // name, the coordinator, and facility requirements are all either internal
  // planning information or simply not relevant to someone deciding whether
  // to register (docs/PERMISSIONS.md §4). Each is rendered only when present,
  // rather than as an empty "—" row/card an Attendee has no reason to see.
  expectedAttendance?: number | null;
  preferredLayout?: string | null;
  accessibilityNotes?: string | null;
  specialRequirements?: string | null;
  organiser?: { fullName: string };
  coordinator?: { fullName: string } | null;
  facilityRequirements?: FacilityRequirement[];
  // Present for an Attendee too - which company is running the event is
  // public, even though who personally organised it (above) is not.
  organisation?: { name: string } | null;
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
      const data = await res.json();
      // The Overview hub is for a submitted request onwards; a draft is
      // edited, not overviewed - only its owning organiser can ever reach
      // this far (canViewEvent hides a draft from everyone else), so send
      // them to the draft editor instead of a page with nothing to show.
      if (data.status === "draft") {
        router.replace(`/events/${eventId}/edit`);
        return;
      }
      setEvent(data);
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
        meta={
          event && (
            <>
              <span className="text-xs text-ink-3">{eventReference(event.sequenceNumber)}</span>
              <StatusBadge status={event.status} />
            </>
          )
        }
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
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  { label: "Category", value: orEmpty(event.category && humanise(event.category)) },
                  { label: "Status", value: statusLabel(event.status) },
                  { label: "When", value: formatDateTimeRange(event.startsAt, event.endsAt) },
                  // Not relevant to someone deciding whether to register, and
                  // absent from an Attendee's response entirely - see the
                  // comment on EventDetail above.
                  ...(event.expectedAttendance !== undefined
                    ? [{ label: "Expected attendance", value: orEmpty(event.expectedAttendance) }]
                    : []),
                  ...(event.preferredLayout !== undefined
                    ? [
                        {
                          label: "Preferred layout",
                          value: orEmpty(event.preferredLayout && humanise(event.preferredLayout)),
                        },
                      ]
                    : []),
                  { label: "Description", value: orEmpty(event.description) },
                  // Absent entirely for an Attendee (internal planning info) —
                  // shown here, not only on the Equipment tab's "at a glance"
                  // sidebar, so every other authorised role sees it without
                  // having to leave Overview (SPM-31).
                  ...(event.organiser !== undefined
                    ? [{ label: "Organiser", value: event.organiser.fullName }]
                    : []),
                  // Independent of Organiser above: an Attendee gets this
                  // row (which company is running the event) without the
                  // organiser's personal name.
                  ...(event.organisation !== undefined
                    ? [{ label: "Company", value: orEmpty(event.organisation?.name) }]
                    : []),
                  ...(event.coordinator !== undefined
                    ? [{ label: "Coordinator", value: event.coordinator?.fullName ?? "Not yet assigned" }]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          {/* Absent entirely, not just empty, for an Attendee - internal
              planning information they have no reason to see (SPM-31). */}
          {event.facilityRequirements !== undefined && (
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
          )}

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

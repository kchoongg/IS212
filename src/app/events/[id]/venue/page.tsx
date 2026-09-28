"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  CardBody,
  PageHeader,
  SkeletonRows,
  Tabs,
} from "@/components/ui";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { cn } from "@/lib/cn";
import { formatVenue } from "@/lib/format";
import { describeUnmet, layoutLabel, type UnmetRequirement } from "@/lib/venueSuitability";

// SPM-41, "Find a venue" (design/mockups/VenueSearch.dc.html). Every active
// venue is judged against the event's attendance, layout, facilities and
// accessibility needs. Unsuitable venues stay visible, greyed, with the reason:
// a coordinator may still want to ask about one.

interface Result {
  venue: {
    id: string;
    code: string;
    name: string;
    building: string;
    floor: string | null;
    maxCapacity: number;
    layouts: { layoutName: string; capacity: number }[];
  };
  suitable: boolean;
  unmet: UnmetRequirement[];
  optionalMissing: UnmetRequirement[];
}

interface Payload {
  event: {
    expectedAttendance: number | null;
    preferredLayout: string | null;
    requirements: { facilityId: string; name: string; category: string; isMandatory: boolean }[];
    missing: ("expectedAttendance" | "preferredLayout")[];
  };
  results: Result[];
}

const MISSING_LABEL = {
  expectedAttendance: "expected attendance",
  preferredLayout: "preferred layout",
} as const;

export default function EventVenuePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { user, state } = useCurrentUser();

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventId}/venue-suitability`);
      if (res.status === 401) {
        router.push(loginUrlFor(`/events/${eventId}/venue`));
        return;
      }
      if (res.status === 403) {
        setError("Venue suitability is for ConnectSphere staff.");
        return;
      }
      if (res.status === 404) {
        setError("This event doesn't exist, or you don't have access to it.");
        return;
      }
      if (!res.ok) throw new Error("Could not check venues for this event.");
      setData(await res.json());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [eventId, router]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(`/events/${eventId}/venue`));
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
  const suitableCount = data?.results.filter((r) => r.suitable).length ?? 0;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Find a venue"
        subtitle="Each venue is checked against this event's attendance, layout, facilities and accessibility needs."
        breadcrumbs={[
          { label: user?.role === "organiser" ? "My Events" : "Events", href: "/events" },
          { label: "Event", href: `/events/${eventId}` },
          { label: "Venue" },
        ]}
      />

      {tabs.length > 0 && <Tabs items={tabs} activeKey="venue" className="mb-6" />}

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
      ) : !data ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="flex flex-col gap-4">
          {data.event.missing.length > 0 && (
            <Alert variant="info" title="This check is incomplete">
              The event has no {data.event.missing.map((m) => MISSING_LABEL[m]).join(" or ")} yet, so
              that part of the check was skipped.
            </Alert>
          )}

          <p className="text-sm text-ink-3">
            {data.results.length} venues checked · {suitableCount} suitable
          </p>

          {data.results.map((result) => (
            <VenueResult key={result.venue.id} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

function VenueResult({ result }: { result: Result }) {
  const { venue, suitable, unmet, optionalMissing } = result;
  return (
    <Card className={cn(!suitable && "bg-surface-2")}>
      <CardBody className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={cn("font-medium", suitable ? "text-ink" : "text-ink-2")}>
            {formatVenue(venue.name, venue.code)}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {venue.floor ? `${venue.building} — ${venue.floor}` : venue.building} · max{" "}
            {venue.maxCapacity} overall
            {venue.layouts.length > 0 &&
              ` · ${venue.layouts.map((l) => `${layoutLabel(l.layoutName)} ${l.capacity}`).join(", ")}`}
          </p>

          {/* Which requirement failed - the point of AC6. One line each, so a
              venue failing three things shows three lines, not the first. */}
          {unmet.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-tone-warning-fg">
              {unmet.map((u, i) => (
                <li key={i}>{describeUnmet(u)}</li>
              ))}
            </ul>
          )}
          {optionalMissing.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-3">
              {optionalMissing.map((u, i) => (
                <li key={i}>Nice-to-have not available. {describeUnmet(u)}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0">
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
              suitable
                ? "bg-tone-success-bg text-tone-success-fg ring-tone-success-ring"
                : "bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-ring"
            )}
          >
            {suitable ? "Suitable" : "Not suitable"}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, SkeletonRows } from "@/components/ui";
import { ChangeRequestList, type ListedChangeRequest } from "@/components/ChangeRequestList";
import { authedFetch } from "@/lib/session";

// Request Event Change (SPM-35, AC2): the event's change requests on its
// Overview, newest first. The page shows this only when the event says it has
// some (changeRequestCount), so most events never ask for them.

export function ChangeRequestsCard({ eventRef }: { eventRef: string }) {
  const [requests, setRequests] = useState<ListedChangeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/events/${eventRef}/change-requests`);
      if (!res.ok) throw new Error();
      setRequests(await res.json());
    } catch {
      setRequests(null);
      setError("Could not load the change requests.");
    }
  }, [eventRef]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader title="Change requests" subtitle="What the organiser has asked to change. Nothing changes until the coordinator processes a request." />
      <CardBody>
        {error ? (
          <Alert
            variant="error"
            action={
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        ) : requests === null ? (
          <SkeletonRows rows={2} />
        ) : (
          <ChangeRequestList requests={requests} />
        )}
      </CardBody>
    </Card>
  );
}

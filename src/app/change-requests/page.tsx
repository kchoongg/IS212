"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, EmptyState, PageHeader, SkeletonRows } from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { ChangeRequestList, type ListedChangeRequest } from "@/components/ChangeRequestList";
import { authedFetch } from "@/lib/session";
import { loginUrlFor } from "@/lib/useCurrentUser";

// Request Event Change (SPM-35, AC4): the change requests waiting for the
// signed-in coordinator, on the events assigned to them, newest first, each
// marked Important where it affects existing arrangements. Approving or
// rejecting them is Process Event Change Request (SPM-32).

const SELF = "/change-requests";

export default function ChangeRequestsPage() {
  return (
    <RequirePermission
      action="event:confirm"
      title="Change Requests"
      reason="Change requests are processed by the event's coordinator. You can still see the events you are involved in from your Dashboard."
    >
      <ChangeRequestsScreen />
    </RequirePermission>
  );
}

function ChangeRequestsScreen() {
  const router = useRouter();
  const [requests, setRequests] = useState<ListedChangeRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await authedFetch("/api/change-requests");
      if (res.status === 401) {
        router.push(loginUrlFor(SELF));
        return;
      }
      if (!res.ok) throw new Error();
      setRequests(await res.json());
    } catch {
      setRequests(null);
      setLoadError("Could not load the change requests.");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Change Requests" subtitle="Pending change requests on the events assigned to you." />
      {loadError ? (
        <Alert
          variant="error"
          title="Could not load this"
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : requests === null ? (
        <SkeletonRows rows={3} />
      ) : requests.length === 0 ? (
        <EmptyState
          title="No change requests waiting"
          description="When an organiser asks to change one of your events, the request appears here."
        />
      ) : (
        <ChangeRequestList requests={requests} />
      )}
    </div>
  );
}

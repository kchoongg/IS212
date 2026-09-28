"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: the sidebar offers this route to the Event Coordinator, so the route has to
// exist. It is guarded first and empty second - a role without the permission
// never sees the placeholder, only the refusal.

export default function QueuePage() {
  return (
    <RequirePermission
      action="event:review"
      title="Review Queue"
      reason="Reviewing event requests is the Event Coordinator's role. You can still see events you are involved in from All Events."
    >
      <NotBuiltYet
        title="Review Queue"
        screen="S-12 (Event Review Queue)"
        description="Events submitted for review, waiting for a coordinator to pick them up."
      />
    </RequirePermission>
  );
}

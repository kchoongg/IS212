"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: the sidebar offers this route to the Event Operations Manager, so the route has to
// exist. It is guarded first and empty second - a role without the permission
// never sees the placeholder, only the refusal.

export default function AssignmentsPage() {
  return (
    <RequirePermission
      action="event:assign_coordinator"
      title="Assignments"
      reason="Assigning coordinators is the Event Operations Manager's role."
    >
      <NotBuiltYet
        title="Assignments"
        screen="S-28 (Coordinator Assignment)"
        description="Submitted events waiting to be assigned to a coordinator."
      />
    </RequirePermission>
  );
}

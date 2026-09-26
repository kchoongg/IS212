"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: the sidebar offers this route to Technical Support, so the route has to
// exist. It is guarded first and empty second - a role without the permission
// never sees the placeholder, only the refusal.

export default function EquipmentRequestsPage() {
  return (
    <RequirePermission
      action="equipment_request:review"
      title="Equipment Requests"
      reason="Deciding equipment requests is Technical Support Staff's role."
    >
      <NotBuiltYet
        title="Equipment Requests"
        screen="S-16 (Equipment Request Review)"
        description="Equipment requested against events, waiting for Technical Support to decide."
      />
    </RequirePermission>
  );
}

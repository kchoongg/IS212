"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: the sidebar offers this route to coordinators and Technical Support, so the route has to
// exist. It is guarded first and empty second - a role without the permission
// never sees the placeholder, only the refusal.

export default function EquipmentPage() {
  return (
    <RequirePermission
      action="equipment:view"
      title="Equipment"
      reason="The equipment catalogue is for ConnectSphere staff and the organisers who request from it."
    >
      <NotBuiltYet
        title="Equipment"
        screen="S-25 (Equipment Catalogue)"
        description="The equipment ConnectSphere can provide, and what is available when."
      />
    </RequirePermission>
  );
}

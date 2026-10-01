"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: the sidebar offers this route to Attendees, so the route has to
// exist. It is guarded first and empty second - a role without the permission
// never sees the placeholder, only the refusal.

export default function BrowsePage() {
  return (
    <RequirePermission
      action="registration:create"
      title="Browse Events"
      reason="Browsing and registering for events is what an Attendee account is for."
    >
      <NotBuiltYet
        title="Browse Events"
        screen="S-26 (Attendee Event Browsing)"
        description="Confirmed events that are open for registration."
      />
    </RequirePermission>
  );
}

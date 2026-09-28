"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: the sidebar offers this route to Attendees, so the route has to
// exist. It is guarded first and empty second - a role without the permission
// never sees the placeholder, only the refusal.

export default function RegistrationsPage() {
  return (
    <RequirePermission
      action="registration:create"
      title="My Registrations"
      reason="Registrations belong to an Attendee account."
    >
      <NotBuiltYet
        title="My Registrations"
        screen="S-27 (My Registrations)"
        description="The events you have registered for, and their status."
      />
    </RequirePermission>
  );
}

"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: the sidebar offers this route to Venue Staff, so the route has to
// exist. It is guarded first and empty second - a role without the permission
// never sees the placeholder, only the refusal.

export default function BookingsPage() {
  return (
    <RequirePermission
      action="venue_booking:decide"
      title="Booking Requests"
      reason="Deciding venue bookings is Venue Staff's role."
    >
      <NotBuiltYet
        title="Booking Requests"
        screen="S-22 (Venue Booking Approval)"
        description="Venue bookings requested by coordinators, waiting for a decision."
      />
    </RequirePermission>
  );
}

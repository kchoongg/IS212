"use client";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { RequirePermission } from "@/components/RequirePermission";

// SPM-22: every role carries Notifications in its sidebar (roles.ts
// NAV_BY_ROLE), so this is the one guarded route with no permission of its
// own - being signed in is the whole requirement. RequirePermission is still
// what stands in front of it, so an anonymous visitor is sent to log in rather
// than shown an empty screen.

export default function NotificationsPage() {
  return (
    <RequirePermission title="Notifications">
      <NotBuiltYet
        title="Notifications"
        screen="S-04 (Notification Centre)"
        description="What has happened on your events since you last looked."
      />
    </RequirePermission>
  );
}

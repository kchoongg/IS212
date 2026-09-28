"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Alert, Button, PageHeader, type Crumb } from "@/components/ui";
import { can, type Action } from "@/lib/permissions";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";

// SPM-22. One gate for every screen, so "who may open this page" is answered
// the same way everywhere instead of each page inventing its own handling.
//
// Three states, and the difference between them matters:
//
//   anonymous      -> send them to /login?next=… . They are not refused, they
//                     are simply not signed in yet.
//   wrong role     -> render an access-denied state and NOTHING ELSE. The
//                     children never mount, so no restricted request is sent
//                     and no restricted data reaches the page. A page that
//                     fetched first and hid the result afterwards would still
//                     have put the data in the browser.
//   permitted      -> render the screen.
//
// This is interface-level only. Every API route re-checks the same permission
// with the same can() (docs/PERMISSIONS.md §6) - hiding a screen is courtesy,
// not security. Using can() here rather than a list of roles is what keeps the
// two from drifting apart.

interface RequirePermissionProps {
  /// The permission the viewer needs. Omit for a screen any signed-in user may
  /// open but which still must not render for an anonymous visitor.
  action?: Action;
  /// Shown as the page title beside the refusal, so the screen still looks like
  /// a screen rather than a bare error.
  title: string;
  breadcrumbs?: Crumb[];
  /// Why this role cannot be here, in the user's own terms. Say what the role
  /// CAN do where that helps - a refusal that offers a next step is kinder
  /// than one that only says no.
  reason?: string;
  children: React.ReactNode;
}

export function RequirePermission({
  action,
  title,
  breadcrumbs,
  reason,
  children,
}: RequirePermissionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, state } = useCurrentUser();

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor(pathname));
    }
  }, [state, router, pathname]);

  // Render nothing while we do not yet know who is asking. Showing the screen
  // first and removing it once the role arrives is a flash of exactly the
  // content this component exists to withhold.
  if (state === "loading" || state === "anonymous" || !user) {
    return null;
  }

  if (action && !can(user.role, action)) {
    return (
      <div className="max-w-2xl">
        <PageHeader title={title} breadcrumbs={breadcrumbs} />
        <Alert variant="error" title="You do not have access to this">
          {reason ?? "This screen is not part of your role in ConnectSphere."}
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => router.push("/dashboard")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

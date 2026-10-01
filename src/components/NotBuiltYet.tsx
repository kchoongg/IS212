"use client";

import { Alert, Card, CardBody, PageHeader, type Crumb } from "@/components/ui";

// SPM-22. A nav item that 404s teaches the user that the product is broken; a
// nav item that says "this screen belongs to a story we have not built yet"
// teaches them the product is unfinished, which is the truth. UI_DESIGN.md §10
// already tracks what is specified but not built - this is that table, shown
// to whoever clicked.
//
// It is only ever reached by a role that IS allowed the screen: the route
// wraps this in RequirePermission, so a role without the permission sees the
// access-denied state instead and never gets this far. That ordering is what
// lets SPM-22 be tested on every nav item rather than only the built ones.

interface NotBuiltYetProps {
  title: string;
  /// The screen id and story from UI_DESIGN.md §3, e.g. "S-28 (Coordinator
  /// Assignment)". Named so a tester can look it up rather than wonder.
  screen: string;
  /// What this screen will do, so the person who clicked knows whether they
  /// were in the right place.
  description: string;
  breadcrumbs?: Crumb[];
}

export function NotBuiltYet({ title, screen, description, breadcrumbs }: NotBuiltYetProps) {
  return (
    <div className="max-w-2xl">
      <PageHeader title={title} breadcrumbs={breadcrumbs} subtitle={description} />
      <Card>
        <CardBody>
          <Alert variant="info" title="This screen is not built yet">
            <p>
              {screen} is specified in UI_DESIGN.md but has not been implemented. Your role
              does have access to it — there is simply nothing here to show you yet.
            </p>
          </Alert>
        </CardBody>
      </Card>
    </div>
  );
}

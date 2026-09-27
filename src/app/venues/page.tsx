"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ButtonLink,
  DataState,
  PageHeader,
  Select,
  Table,
  type Column,
} from "@/components/ui";
import { orEmpty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";

// S-19, the venue catalogue. Two audiences on one route, which is what
// NAV_BY_ROLE already implies - "Venues" is in both the coordinator's and Venue
// Staff's sidebar:
//
//   - Venue Staff hold venue:manage (briefing §3, "responsible for venue
//     information"), so they get Add venue and can open a room to edit it.
//   - A coordinator holds venue:view only. They get the same list, read-only:
//     no Add button, and rows do not navigate, because the only venue screen
//     built so far is the editor and sending them there would be a dead end.
//
// The gate is can(), the same function the API routes use, so the interface and
// the server cannot disagree about who may do what. Hiding a button is not
// access control - PATCH /api/venues/[id] re-checks venue:manage regardless.

interface VenueRow {
  id: string;
  code: string;
  name: string;
  building: string;
  floor: string | null;
  maxCapacity: number;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
  layouts: { layoutName: string; capacity: number }[];
}

export default function VenuesPage() {
  const router = useRouter();
  const { user, state } = useCurrentUser();
  const [venues, setVenues] = useState<VenueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");

  const canManage = can(user?.role ?? "", "venue:manage");

  const load = useCallback(async () => {
    setError(null);
    try {
      // Only someone who can manage the catalogue has any use for a retired
      // room - to see it is retired, or to bring it back. For everyone else the
      // default (active only) is the right list.
      const path = canManage ? "/api/venues?includeRetired=true" : "/api/venues";
      const res = await authedFetch(path);
      if (res.status === 401) {
        router.push(loginUrlFor("/venues"));
        return;
      }
      if (res.status === 403) {
        setError("The venue catalogue is for ConnectSphere staff.");
        return;
      }
      if (!res.ok) throw new Error("Could not load the venue catalogue.");
      setVenues(await res.json());
    } catch (err) {
      setVenues(null);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router, canManage]);

  useEffect(() => {
    if (state === "anonymous") {
      router.push(loginUrlFor("/venues"));
      return;
    }
    if (state === "authenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [state, load, router]);

  const buildingOptions = useMemo(() => {
    const buildings = Array.from(new Set((venues ?? []).map((v) => v.building))).sort();
    return [
      { value: "all", label: "All buildings" },
      ...buildings.map((building) => ({ value: building, label: building })),
    ];
  }, [venues]);

  // A read-only viewer never receives retired venues from the API, so offering
  // them a "Retired" filter is a dead option that always shows zero results -
  // the same reasoning that hides the "Draft" status from a coordinator on
  // /events.
  const activeFilterOptions = useMemo(
    () => [
      { value: "all", label: canManage ? "Active and retired" : "All venues" },
      { value: "active", label: "Active only" },
      ...(canManage ? [{ value: "retired", label: "Retired only" }] : []),
    ],
    [canManage]
  );

  const filtered = useMemo(() => {
    if (!venues) return null;
    return venues.filter((venue) => {
      if (buildingFilter !== "all" && venue.building !== buildingFilter) return false;
      if (activeFilter === "active" && !venue.isActive) return false;
      if (activeFilter === "retired" && venue.isActive) return false;
      return true;
    });
  }, [venues, buildingFilter, activeFilter]);

  const columns: Column<VenueRow>[] = [
    {
      key: "name",
      header: "Venue",
      hideLabelOnMobile: true,
      render: (row) => (
        <div>
          <span className="font-medium">{row.name}</span>
          <span className="ml-2 text-xs text-ink-3">{row.code}</span>
        </div>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (row) => (row.floor ? `${row.building} — ${row.floor}` : row.building),
    },
    {
      key: "capacity",
      header: "Max capacity",
      render: (row) => orEmpty(row.maxCapacity),
    },
    {
      key: "layouts",
      header: "Layouts",
      render: (row) =>
        row.layouts.length === 0 ? (
          // A room with no layouts is never offered by venue search, which is
          // not obvious from a blank cell.
          <span className="text-tone-warning-fg">None set</span>
        ) : (
          <span>
            {row.layouts.length}{" "}
            <span className="text-ink-3">
              (max {Math.max(...row.layouts.map((l) => l.capacity))} seated)
            </span>
          </span>
        ),
    },
    {
      key: "hours",
      header: "Hours",
      render: (row) => `${row.opensAt}–${row.closesAt}`,
    },
    // Only worth a column where retired rows can actually appear; for a
    // read-only viewer every value would read "Active".
    ...(canManage
      ? [
          {
            key: "status",
            header: "Status",
            render: (row: VenueRow) =>
              row.isActive ? (
                <span className="text-ink-2">Active</span>
              ) : (
                <span className="font-medium text-tone-warning-fg">Retired</span>
              ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Venues"
        subtitle={
          canManage
            ? "The rooms ConnectSphere can offer. Retiring one keeps its past bookings intact."
            : "The rooms ConnectSphere can offer. Venue Staff maintain these details."
        }
        actions={
          <>
            {/* SPM-40: S-14 filters this same catalogue against a date,
                attendance, location, layout and facilities. */}
            <ButtonLink href="/venues/search" variant={canManage ? "secondary" : "accent"}>
              Find a venue
            </ButtonLink>
            {canManage && (
              <ButtonLink href="/venues/new" variant="accent">
                Add venue
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-4">
        <div className="max-w-xs flex-1">
          <label htmlFor="building-filter" className="mb-1.5 block text-sm font-medium text-ink">
            Filter by building
          </label>
          <Select
            id="building-filter"
            options={buildingOptions}
            value={buildingFilter}
            onChange={(e) => setBuildingFilter(e.target.value)}
          />
        </div>

        <div className="max-w-xs flex-1">
          <label htmlFor="active-filter" className="mb-1.5 block text-sm font-medium text-ink">
            Show
          </label>
          <Select
            id="active-filter"
            options={activeFilterOptions}
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
          />
        </div>
      </div>

      <DataState
        data={filtered}
        error={error}
        onRetry={load}
        empty={{
          title: venues?.length ? "No venues match these filters" : "No venues yet",
          description: venues?.length
            ? "Try a different building, or show active and retired together."
            : canManage
              ? "Add the rooms ConnectSphere can offer so coordinators can book them."
              : "Venue Staff have not added any rooms yet.",
          action: canManage ? (
            <ButtonLink href="/venues/new" variant="accent">
              Add the first venue
            </ButtonLink>
          ) : undefined,
        }}
      >
        {(rows) => (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={canManage ? (row) => router.push(`/venues/${row.id}/edit`) : undefined}
            caption="Venue catalogue"
          />
        )}
      </DataState>
    </div>
  );
}

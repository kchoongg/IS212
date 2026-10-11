"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  DataState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Textarea,
  type Column,
} from "@/components/ui";
import { RequirePermission } from "@/components/RequirePermission";
import { authedFetch } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/permissions";
import { orEmpty } from "@/lib/format";
import {
  OUT_OF_SERVICE_TYPES,
  operationalStatus,
  outOfServiceSummary,
  outOfServiceTypeLabel,
} from "@/lib/equipmentOutOfService";

// S-24 Equipment catalogue - Record Equipment Unavailability (SPM-55).
//
// Every item with its current operational status (AC6), for internal staff
// only: the organiser may pick from the catalogue on the request form, but
// what is out of service, and why, is ConnectSphere's own business
// (equipment:view_status). Technical Support record how many units are
// unavailable, damaged or under maintenance (AC1, AC2) and return them (AC5).
// A reservation the change leaves short is flagged and its coordinator
// notified by the route (AC4); this page lists what was flagged, because the
// Notifications screen (SPM-71) is not built yet.

interface EquipmentItem {
  id: string;
  name: string;
  category: string | null;
  totalQuantity: number;
  quantityInMaintenance: number;
  outOfServiceType: string | null;
  outOfServiceReason: string | null;
}

interface FlaggedReservation {
  requestId: string;
  eventTitle: string | null;
  sessionLabel: string | null;
  reserved: number;
  available: number;
}

interface SaveResult {
  item: string;
  flagged: FlaggedReservation[];
  message: string;
}

const PATH = "/equipment";
const WHOLE_NUMBER = /^\d+$/;
const UNITS_ERROR = "Enter a whole number of units, 0 or more.";
const UNREACHABLE = "Could not reach the server. Check your connection and try again.";

const TYPE_OPTIONS = OUT_OF_SERVICE_TYPES.map((value) => ({ value, label: outOfServiceTypeLabel(value) }));

export default function EquipmentPage() {
  return (
    <RequirePermission
      action="equipment:view_status"
      title="Equipment"
      reason="Equipment status is for ConnectSphere staff."
    >
      <EquipmentCatalogue />
    </RequirePermission>
  );
}

function EquipmentCatalogue() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const mayManage = user ? can(user.role, "equipment:manage") : false;

  const [items, setItems] = useState<EquipmentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // One dialog, in one of two modes, so the page never holds two at once.
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<{ item: EquipmentItem; mode: "record" | "return" } | null>(null);
  const [units, setUnits] = useState("");
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch("/api/equipment");
      if (res.status === 401) {
        router.push(loginUrlFor(PATH));
        return;
      }
      if (!res.ok) throw new Error("Could not load the equipment catalogue.");
      setItems(await res.json());
    } catch {
      setItems(null);
      setError("Could not load the equipment catalogue.");
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editing && !dialog.open) dialog.showModal();
    if (!editing && dialog.open) dialog.close();
  }, [editing]);

  function openDialog(item: EquipmentItem, mode: "record" | "return") {
    setUnits(String(item.quantityInMaintenance));
    setType(item.outOfServiceType ?? "");
    setReason(item.outOfServiceReason ?? "");
    setUnitsError(null);
    setTypeError(null);
    setFormError(null);
    setEditing({ item, mode });
  }

  function closeDialog() {
    if (!saving) setEditing(null);
  }

  async function send(item: EquipmentItem, body: Record<string, unknown>) {
    setSaving(true);
    setFormError(null);
    setPageError(null);
    try {
      const res = await authedFetch(`/api/equipment/${item.id}/out-of-service`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (editing?.mode === "record" && res.status === 400 && payload.error && payload.error !== "Validation failed") {
          // "Only 4 units in total - cannot mark 5 as out of service"
          setUnitsError(payload.error);
          return;
        }
        setEditing(null);
        setPageError(payload.error && payload.error !== "Validation failed" ? payload.error : "Could not update this equipment.");
        return;
      }
      const out = Number(body.quantityOutOfService);
      setResult({
        item: item.name,
        flagged: payload.flaggedReservations ?? [],
        message:
          out === 0 && editing?.mode === "return"
            ? `All ${item.name} units are back in service.`
            : `Saved. ${out} of ${item.totalQuantity} ${item.name} units are out of service. No reservations were affected.`,
      });
      setEditing(null);
      void load();
    } catch {
      if (editing?.mode === "record") setFormError(UNREACHABLE);
      else {
        setEditing(null);
        setPageError(UNREACHABLE);
      }
    } finally {
      setSaving(false);
    }
  }

  function submitRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const trimmed = units.trim();
    const unitsOk = WHOLE_NUMBER.test(trimmed);
    const out = unitsOk ? Number(trimmed) : 0;
    const typeMissing = unitsOk && out > 0 && !type;
    setUnitsError(unitsOk ? null : UNITS_ERROR);
    setTypeError(typeMissing ? "Choose a type." : null);
    if (!unitsOk || typeMissing) return;

    void send(editing.item, {
      quantityOutOfService: out,
      ...(out > 0 ? { type } : {}),
      ...(out > 0 && reason.trim() ? { reason: reason.trim() } : {}),
    });
  }

  const columns: Column<EquipmentItem>[] = [
    { key: "name", header: "Equipment", render: (row) => <span className="font-medium text-ink">{row.name}</span> },
    { key: "category", header: "Category", render: (row) => orEmpty(row.category) },
    { key: "total", header: "Total units", render: (row) => row.totalQuantity },
    { key: "out", header: "Out of service", render: (row) => row.quantityInMaintenance },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={operationalStatus(row)} /> },
    {
      key: "reason",
      header: "Reason",
      render: (row) =>
        row.quantityInMaintenance > 0 ? orEmpty(outOfServiceSummary(row.outOfServiceType, row.outOfServiceReason)) : orEmpty(null),
    },
    {
      key: "actions",
      header: "",
      hideLabelOnMobile: true,
      render: (row) =>
        mayManage && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => openDialog(row, "record")}>
              Record unavailability
            </Button>
            {row.quantityInMaintenance > 0 && (
              <Button variant="secondary" size="sm" onClick={() => openDialog(row, "return")}>
                Return all to available
              </Button>
            )}
          </div>
        ),
    },
  ];

  const flaggedCount = result?.flagged.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Equipment"
        subtitle="Every item ConnectSphere can provide, and how many units are out of service."
      />

      {pageError && (
        <Alert variant="error" className="mb-5">
          {pageError}
        </Alert>
      )}
      {result && flaggedCount === 0 && (
        <Alert variant="success" className="mb-5">
          {result.message}
        </Alert>
      )}
      {result && flaggedCount > 0 && (
        <Alert
          variant="warning"
          className="mb-5"
          title={`Saved - ${flaggedCount} ${flaggedCount === 1 ? "reservation" : "reservations"} flagged for review, coordinators notified`}
        >
          <p>
            These reservations have not been changed or cancelled. Each is flagged for its coordinator to decide
            what to do.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {result.flagged.map((f) => (
              <li key={f.requestId}>
                {`${f.eventTitle ?? "Untitled event"}${f.sessionLabel ? ` (${f.sessionLabel})` : ""}: ${f.reserved} reserved, ${f.available} available`}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <DataState
        data={items}
        error={error}
        onRetry={load}
        empty={{ title: "No equipment yet", description: "Items appear here once they are added to the catalogue." }}
      >
        {(data) => <Table columns={columns} rows={data} rowKey={(row) => row.id} caption="Equipment" />}
      </DataState>

      <dialog
        ref={dialogRef}
        onCancel={(e) => {
          e.preventDefault();
          closeDialog();
        }}
        aria-labelledby="equipment-dialog-title"
        className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-line p-0 shadow-raised backdrop:bg-ink/40"
      >
        {editing?.mode === "record" && (
          <form noValidate onSubmit={submitRecord}>
            <div className="flex flex-col gap-4 px-5 py-4">
              <h2 id="equipment-dialog-title" className="font-display text-lg font-semibold text-ink">
                {`Record unavailability - ${editing.item.name}`}
              </h2>
              <p className="text-sm text-ink-2">
                {editing.item.totalQuantity} units in total. Units out of service are not counted as available for
                any event until they are returned.
              </p>
              {formError && <Alert variant="error">{formError}</Alert>}
              <Field label="Units out of service" error={unitsError}>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                />
              </Field>
              <Field label="Type" error={typeError}>
                <Select
                  options={TYPE_OPTIONS}
                  placeholder="Choose a type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                />
              </Field>
              <Field label="Reason (optional)">
                <Textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
              <Button type="button" variant="secondary" onClick={closeDialog} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save
              </Button>
            </div>
          </form>
        )}
        {editing?.mode === "return" && (
          <>
            <div className="px-5 py-4">
              <h2 id="equipment-dialog-title" className="font-display text-lg font-semibold text-ink">
                Return all units to available?
              </h2>
              <p className="mt-2 text-sm text-ink-2">
                {`The ${editing.item.quantityInMaintenance} ${editing.item.quantityInMaintenance === 1 ? "unit" : "units"} out of service will be counted as available again for every event.`}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
              <Button variant="secondary" onClick={closeDialog} disabled={saving}>
                Cancel
              </Button>
              <Button loading={saving} onClick={() => void send(editing.item, { quantityOutOfService: 0 })}>
                Return to available
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

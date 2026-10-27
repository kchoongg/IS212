import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { DescribedChangeRequest } from "@/lib/eventChangeRequest";

// Request Event Change (SPM-35): change requests as the event's Change requests
// card and the coordinator's Change Requests page show them - what is asked for,
// why, and whether it is Important (AC2, AC4). Processing a request is Process
// Event Change Request (SPM-32): once processed, each field's outcome and the
// reason for each rejection are shown here too (SPM-32 AC3), and the assigned
// coordinator gets a Review link on a pending one.

export interface ListedChangeRequest extends DescribedChangeRequest {
  /// On the coordinator's page, the event it is about.
  event?: { reference: string; title: string | null; status: string };
}

/// AC4. A marker, not a status, so not a StatusBadge - but drawn the same way,
/// in the warning tone.
function ImportantBadge() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-tone-warning-bg px-2.5 py-0.5 text-xs font-medium text-tone-warning-fg ring-1 ring-inset ring-tone-warning-ring">
      Important
    </span>
  );
}

/// SPM-32 (AC3): "Approved", or "Rejected: <reason>".
function outcomeText(outcome: "approved" | "rejected" | null, reason: string | null): string {
  if (outcome === "approved") return "Approved";
  return reason ? `Rejected: ${reason}` : "Rejected";
}

function ChangeRequestItem({ request, reviewHref }: { request: ListedChangeRequest; reviewHref?: string }) {
  const processed = request.status !== "pending";
  const decided = request.rows.some((row) => row.outcome !== null);
  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-ink">{request.kindLabel}</p>
        {request.important && <ImportantBadge />}
        <StatusBadge status={request.status} />
        {reviewHref && request.status === "pending" && (
          <Link href={reviewHref} className="ml-auto text-sm font-medium text-ink underline underline-offset-2">
            Review
          </Link>
        )}
      </div>
      {request.event && (
        <p className="mt-1 text-sm text-ink-2">
          for{" "}
          <Link href={`/events/${request.event.reference}`} className="font-medium text-ink underline underline-offset-2">
            {request.event.reference}
          </Link>{" "}
          {request.event.title || "Untitled event"}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-3">
        Requested by {request.requestedBy} on {formatDateTime(request.requestedAt)}
      </p>
      {request.important && request.affects.length > 0 && (
        <p className="mt-1 text-sm text-tone-warning-fg">Affects existing arrangements: {request.affects.join(", ")}.</p>
      )}
      {processed && request.reviewedBy && request.reviewedAt && (
        <p className="mt-1 text-sm text-ink-3">
          Processed by {request.reviewedBy} on {formatDateTime(request.reviewedAt)}
        </p>
      )}
      <p className="mt-2 text-sm text-ink">Reason: {request.reason}</p>
      {request.reviewNotes && (
        <p className="mt-1 text-sm text-ink">
          {request.status === "rejected" ? `Reason for rejecting: ${request.reviewNotes}` : request.reviewNotes}
        </p>
      )}
      {request.rows.length > 0 && (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-ink-3">
            <tr>
              <th className="py-1 pr-3 font-medium">Field</th>
              <th className="py-1 pr-3 font-medium">Current</th>
              <th className="py-1 pr-3 font-medium">Proposed</th>
              {decided && <th className="py-1 font-medium">Outcome</th>}
            </tr>
          </thead>
          <tbody>
            {request.rows.map((row) => (
              <tr key={row.field} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 font-medium text-ink">{row.label}</td>
                <td className="py-1.5 pr-3 text-ink-2">{row.current}</td>
                <td className="py-1.5 pr-3 text-ink">{row.proposed}</td>
                {decided && <td className="py-1.5 text-ink">{outcomeText(row.outcome, row.outcomeReason)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {request.equipmentChanges && (
        <p className="mt-2 text-sm text-ink">
          Equipment: {request.equipmentChanges}
          {request.equipmentOutcome && ` (${outcomeText(request.equipmentOutcome, request.equipmentOutcomeReason)})`}
        </p>
      )}
    </li>
  );
}

export function ChangeRequestList({
  requests,
  reviewHref,
}: {
  requests: ListedChangeRequest[];
  /// SPM-32: where the assigned coordinator reviews a pending request; absent
  /// for everyone else, who get no Review link.
  reviewHref?: (request: ListedChangeRequest) => string;
}) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Change requests">
      {requests.map((request) => (
        <ChangeRequestItem key={request.id} request={request} reviewHref={reviewHref?.(request)} />
      ))}
    </ul>
  );
}

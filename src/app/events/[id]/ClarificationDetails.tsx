import { clarificationFieldLabels } from "@/lib/clarification";
import { formatDateTime } from "@/lib/format";

/// The open clarification as GET /api/events/[id] sends it (SPM-29) - to the
/// organiser and the assigned coordinator only.
export interface OpenClarification {
  id: string;
  fields: string[];
  message: string;
  requestedAt: string;
  requester: { fullName: string };
}

/// What needs clarifying, the coordinator's message, and who asked when -
/// the same lines on the event page and the review page.
export function ClarificationDetails({ clarification }: { clarification: OpenClarification }) {
  return (
    <div className="flex flex-col gap-1">
      <p>
        <span className="font-medium">Needs clarification:</span> {clarificationFieldLabels(clarification.fields).join(", ")}
      </p>
      <p className="whitespace-pre-line">{clarification.message}</p>
      <p className="text-xs opacity-80">
        Asked by {clarification.requester.fullName} on {formatDateTime(clarification.requestedAt)}
      </p>
    </div>
  );
}

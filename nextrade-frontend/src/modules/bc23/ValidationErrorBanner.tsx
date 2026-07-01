import { useTranslation } from "react-i18next";
import { AlertOctagon } from "lucide-react";

export interface ValidationError {
  id: string;
  referenceType: string; // e.g. "invoice_number"
  expectedValue: string;
  actualValue: string;
  conflictingDocumentName?: string;
}

const FIELD_LABELS: Record<string, string> = {
  invoice_number: "Invoice Number",
  po_number: "PO Number",
  bl_number: "B/L Number",
  manifest_number: "Manifest Number",
};

// Blocking validation banner — distinct from the soft "needs review"
// badges in CheckpointSummary. This is the UI for the exact case raised:
// Invoice + Packing List both say invoice_number 0126051, then a
// document carrying invoice_number 0126057 for the same shipment shows
// up HERE as a hard error, not a low-confidence checkpoint row. Most OCR
// products never run this cross-document check at all, so they never
// surface anything in this shape — that's the gap this component closes.
export function ValidationErrorBanner({
  errors,
  onResolve,
}: {
  errors: ValidationError[];
  onResolve: (errorId: string) => void;
}) {
  const { t } = useTranslation();
  if (errors.length === 0) return null;

  return (
    <div className="mb-4 rounded border border-danger-600 bg-danger-100">
      <div className="flex items-center gap-2 border-b border-danger-600/30 px-4 py-2.5">
        <AlertOctagon size={16} className="text-danger-600" />
        <span className="text-sm font-semibold text-danger-600">
          {t("validation.title", "Validation Error")}
        </span>
        <span className="text-2xs text-danger-600/80">
          {t("validation.count", "{{count}} cross-document mismatch found", { count: errors.length })}
        </span>
      </div>
      <div className="divide-y divide-danger-600/20">
        {errors.map((err) => (
          <div key={err.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-32 shrink-0 text-sm font-medium text-surface-text">
              {FIELD_LABELS[err.referenceType] ?? err.referenceType}
            </span>
            <span className="data-id text-sm text-surface-text">
              {t("validation.mismatch", "{{expected}} vs {{actual}}", {
                expected: err.expectedValue,
                actual: err.actualValue,
              })}
            </span>
            {err.conflictingDocumentName && (
              <span className="text-2xs text-surface-muted">
                ({t("validation.conflictsWith", "conflicts with")} {err.conflictingDocumentName})
              </span>
            )}
            <button
              onClick={() => onResolve(err.id)}
              className="ml-auto rounded border border-surface-border px-2 py-1 text-2xs font-medium text-surface-text hover:bg-surface-card"
            >
              {t("validation.markResolved", "Mark Resolved")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

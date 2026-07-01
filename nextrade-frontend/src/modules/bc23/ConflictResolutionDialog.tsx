import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { CheckpointField } from "../../types/review";
import clsx from "clsx";

export function ConflictResolutionDialog({
  field,
  open,
  onOpenChange,
  onResolve,
}: {
  field: CheckpointField | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (fieldId: string, chosenValue: string) => void;
}) {
  const { t } = useTranslation();
  if (!field) return null;

  // Recommended = highest-confidence source, per Smart Reconciliation Engine
  const recommended = [...field.sources].sort((a, b) => b.confidence - a.confidence)[0];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-navy-950/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded border border-surface-border bg-surface-card shadow-card">
          <div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
            <Dialog.Title className="text-sm font-semibold text-surface-text">
              {t("review.detailedReview", "Tinjauan Detail")}: {field.label}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-surface-muted hover:text-surface-text">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4">
            <p className="mb-3 text-sm text-surface-muted">
              {t("review.conflictIssue", "Ditemukan {{count}} nilai berbeda dari beberapa dokumen", {
                count: field.sources.length,
              })}
            </p>

            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-2xs uppercase text-surface-muted">
                  <th className="py-1.5 font-medium">{t("documents.source")}</th>
                  <th className="py-1.5 font-medium">{t("review.value", "Nilai")}</th>
                  <th className="py-1.5 font-medium">{t("common.confidence")}</th>
                  <th className="py-1.5 font-medium">{t("review.reasoning", "Alasan")}</th>
                </tr>
              </thead>
              <tbody>
                {field.sources.map((source, i) => (
                  <tr
                    key={i}
                    className={clsx(
                      "border-b border-surface-border last:border-0",
                      source === recommended && "bg-intel-50"
                    )}
                  >
                    <td className="py-2 text-surface-text">{source.documentName}</td>
                    <td className="data-id py-2 text-surface-text">{source.value}</td>
                    <td className="py-2 font-mono text-xs text-surface-muted">
                      {(source.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 text-xs text-surface-muted">{source.reasoning ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {recommended && (
              <div className="ai-badge mt-3">
                {t("common.aiRecommendation")}: {recommended.documentName} ({recommended.value})
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-surface-border px-5 py-3">
            <Dialog.Close asChild>
              <button className="rounded border border-surface-border px-3 py-1.5 text-sm text-surface-text hover:bg-surface-page">
                {t("review.skip", "Lewati")}
              </button>
            </Dialog.Close>
            <button
              onClick={() => recommended && onResolve(field.id, recommended.value)}
              className="rounded bg-intel-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-intel-400"
            >
              {t("review.useRecommended", "Gunakan Rekomendasi")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useState } from "react";
import {
  CheckCircle, AlertTriangle, Plus, Eye, Copy,
  ChevronDown, ChevronRight, RotateCcw, Send, X
} from "lucide-react";

export interface SessionFile {
  id: string;
  original_filename: string;
  detected_type: string;
  detected_category: string;
  action: string;
  confidence_tier: string;
  match_confidence: number;
  matched_shipment_id?: string;
  shipment_number?: string;
  analysis_detail?: { reasoning: string };
}

interface DryRunPreviewProps {
  sessionId: string;
  files: SessionFile[];
  summary: {
    totalFiles: number;
    autoAttach: number;
    suggest: number;
    manualReview: number;
    newShipment: number;
    conflict: number;
    duplicate: number;
    canCommit: boolean;
  };
  onResolveConflict: (fileId: string, action: string, shipmentId?: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  isCommitting: boolean;
}

const TIER_CONFIG = {
  AUTO_ATTACH: { label: "Auto Attach", className: "badge-success", icon: CheckCircle },
  SUGGEST: { label: "Disarankan", className: "badge bg-blue-50 text-blue-700", icon: CheckCircle },
  MANUAL_REVIEW: { label: "Perlu Review", className: "badge-warning", icon: AlertTriangle },
  NEW_SHIPMENT: { label: "Shipment New", className: "badge-neutral", icon: Plus },
  CONFLICT: { label: "Konflik", className: "badge-danger", icon: AlertTriangle },
  DUPLICATE: { label: "Duplicate", className: "badge-neutral", icon: Copy },
  PENDING_CONFLICT_RESOLUTION: { label: "Konflik", className: "badge-danger", icon: AlertTriangle },
};

function FileGroup({ title, files, color, expanded: initExpanded, onResolve, showConflict = false }: {
  title: string; files: SessionFile[]; color: string;
  expanded: boolean; onResolve?: (fileId: string, action: string, shipmentId?: string) => void;
  showConflict?: boolean;
}) {
  const [expanded, setExpanded] = useState(initExpanded);
  if (files.length === 0) return null;

  return (
    <div className={`rounded-md border overflow-hidden ${color}`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:opacity-90 transition-opacity"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-sm font-semibold">{title}</span>
        <span className="ml-auto text-xs font-mono">{files.length} file</span>
      </button>

      {expanded && (
        <div className="bg-white divide-y divide-surface-border">
          {files.map(f => {
            const cfg = TIER_CONFIG[f.action as keyof typeof TIER_CONFIG] ?? TIER_CONFIG.MANUAL_REVIEW;
            const Icon = cfg.icon;
            const conf = Math.round((f.match_confidence ?? 0) * 100);
            return (
              <div key={f.id} className="px-4 py-3">
                <div className="flex items-center gap-3 mb-1">
                  <Icon size={13} className={showConflict ? "text-danger-600" : "text-surface-muted"} />
                  <span className="text-sm font-medium text-surface-text flex-1 truncate">{f.original_filename}</span>
                  <span className={`badge text-2xs ${cfg.className}`}>{cfg.label}</span>
                  {conf > 0 && (
                    <span className={`text-2xs font-mono font-semibold ${conf >= 90 ? "text-success-600" : conf >= 70 ? "text-warning-600" : "text-danger-600"}`}>
                      {conf}%
                    </span>
                  )}
                </div>
                <div className="ml-5 flex items-center gap-3">
                  <span className={`badge text-2xs ${docCategoryColor(f.detected_category)}`}>{f.detected_type || f.detected_category}</span>
                  {f.shipment_number && (
                    <span className="text-2xs text-surface-muted">→ {f.shipment_number}</span>
                  )}
                  {f.analysis_detail?.reasoning && (
                    <span className="text-2xs text-surface-muted truncate max-w-xs">{f.analysis_detail.reasoning}</span>
                  )}
                </div>

                {/* Conflict resolution inline */}
                {showConflict && onResolve && (
                  <div className="ml-5 mt-2 flex flex-wrap gap-2">
                    <span className="text-2xs text-danger-600 font-medium mb-1 w-full">
                      Shipment sudah READY_FOR_CEISA — pilih tindakan:
                    </span>
                    {[
                      { action: "REPLACE_EXISTING", label: "Replace Dokumen" },
                      { action: "ADD_SUPPORTING", label: "Tambah Pendukung" },
                      { action: "NEW_SHIPMENT", label: "Buat Shipment New" },
                      { action: "SKIP", label: "Skip" },
                    ].map(opt => (
                      <button
                        key={opt.action}
                        onClick={() => onResolve(f.id, opt.action, f.matched_shipment_id)}
                        className="btn-secondary text-2xs py-1"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function docCategoryColor(cat: string) {
  const m: Record<string, string> = {
    COMMERCIAL: "bg-blue-50 text-blue-700", TRANSPORT: "bg-purple-50 text-purple-700",
    CUSTOMS: "bg-teal-50 text-teal-700", COMPLIANCE: "bg-yellow-50 text-yellow-700",
    SUPPORTING: "badge-neutral", INTERNAL: "badge-neutral",
  };
  return m[cat] ?? "badge-neutral";
}

export function DryRunPreview({
  files, summary, onResolveConflict, onCommit, onCancel, isCommitting,
}: DryRunPreviewProps) {
  const groups = {
    AUTO_ATTACH:                files.filter(f => f.action === 'AUTO_ATTACH'),
    SUGGEST:                    files.filter(f => f.action === 'SUGGEST'),
    MANUAL_REVIEW:              files.filter(f => f.action === 'MANUAL_REVIEW'),
    NEW_SHIPMENT:               files.filter(f => f.action === 'NEW_SHIPMENT'),
    PENDING_CONFLICT_RESOLUTION: files.filter(f => f.action === 'PENDING_CONFLICT_RESOLUTION'),
    DUPLICATE:                  files.filter(f => f.action === 'DUPLICATE'),
    SKIP:                       files.filter(f => f.action === 'SKIP'),
  };

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="grid grid-cols-6 gap-2">
        {[
          { label: "Auto Attach", value: summary.autoAttach, color: "text-success-600" },
          { label: "Disarankan", value: summary.suggest, color: "text-blue-700" },
          { label: "Perlu Review", value: summary.manualReview, color: "text-warning-600" },
          { label: "Shipment New", value: summary.newShipment, color: "text-surface-text" },
          { label: "Konflik", value: summary.conflict, color: "text-danger-600" },
          { label: "Duplicate", value: summary.duplicate, color: "text-surface-muted" },
        ].map(({ label, value, color }) => (
          <div key={label} className="kpi-card text-center py-3">
            <p className="kpi-label">{label}</p>
            <p className={`text-xl font-bold font-mono mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Conflict warning */}
      {summary.conflict > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-danger-600 bg-danger-100 p-3">
          <AlertTriangle size={16} className="text-danger-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-danger-600">
            <strong>{summary.conflict} file</strong> konflik dengan shipment yang sudah READY_FOR_CEISA.
            Semua konflik harus diselesaikan sebelum bisa commit.
          </p>
        </div>
      )}

      {/* File groups */}
      <FileGroup title={`Update Shipment Existing — Auto (${groups.AUTO_ATTACH.length})`}
        files={groups.AUTO_ATTACH} color="border-success-600 bg-success-100" expanded={false} />
      <FileGroup title={`Update Shipment Existing — Disarankan (${groups.SUGGEST.length})`}
        files={groups.SUGGEST} color="border-blue-200 bg-blue-50" expanded={true} />
      <FileGroup title={`Perlu Review Manual (${groups.MANUAL_REVIEW.length})`}
        files={groups.MANUAL_REVIEW} color="border-warning-600 bg-warning-100" expanded={true} />
      <FileGroup title={`Buat Shipment New (${groups.NEW_SHIPMENT.length})`}
        files={groups.NEW_SHIPMENT} color="border-surface-border bg-white" expanded={true} />
      <FileGroup title={`Konflik — Shipment READY_FOR_CEISA (${groups.PENDING_CONFLICT_RESOLUTION.length})`}
        files={groups.PENDING_CONFLICT_RESOLUTION} color="border-danger-600 bg-danger-100"
        expanded={true} onResolve={onResolveConflict} showConflict />
      <FileGroup title={`Duplicate — Sudah Ada di Sistem (${groups.DUPLICATE.length})`}
        files={groups.DUPLICATE} color="border-surface-border bg-surface-page" expanded={false} />

      {/* Commit bar */}
      <div className="sticky bottom-0 flex items-center gap-3 rounded-md border border-surface-border bg-white p-3 shadow-card">
        <button onClick={onCancel} className="btn-secondary gap-1">
          <X size={13} /> Batal
        </button>
        <span className="text-xs text-surface-muted flex-1">
          {summary.canCommit
            ? `${summary.totalFiles - summary.duplicate} file siap di-commit (${summary.duplicate} duplikat dilewati)`
            : `Selesaikan ${summary.conflict} konflik terlebih dahulu`}
        </span>
        <button
          onClick={onCommit}
          disabled={!summary.canCommit || isCommitting}
          className="btn-primary gap-1 disabled:opacity-50"
        >
          {isCommitting ? <RotateCcw size={13} className="animate-spin" /> : <Send size={13} />}
          {isCommitting ? "Memproses..." : `Commit ${summary.totalFiles - summary.duplicate} File`}
        </button>
      </div>
    </div>
  );
}

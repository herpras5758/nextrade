import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle, AlertTriangle, Clock, ChevronRight,
  FileText, Send, RefreshCw, ExternalLink, Shield
} from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";
import { EnterpriseDataTable } from "../../components/ui/EnterpriseDataTable";
import { ColumnDef } from "@tanstack/react-table";

interface Shipment {
  id: string;
  shipment_number: string;
  status: string;
  health: string;
  ceisa_readiness_score: number;
  party_from_name: string;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  DRAFT:            { label: "Draft",            color: "badge-neutral",                           icon: Clock },
  UNDER_REVIEW:     { label: "Under Review",     color: "badge bg-blue-50 text-blue-700",          icon: RefreshCw },
  READY_FOR_CEISA:  { label: "Siap CEISA",       color: "badge-success",                           icon: CheckCircle },
  SUBMITTED:        { label: "Dikirim",          color: "badge bg-purple-50 text-purple-700",      icon: Send },
  SPPB:             { label: "SPPB Diterima",    color: "badge-success",                           icon: Shield },
  CLOSED:           { label: "Selesai",          color: "badge-neutral",                           icon: CheckCircle },
};

const HEALTH_CONFIG = {
  HEALTHY:         { color: "text-success-600", dot: "bg-success-600" },
  NEEDS_ATTENTION: { color: "text-warning-600", dot: "bg-warning-600" },
  CRITICAL:        { color: "text-danger-600",  dot: "bg-danger-600"  },
};

// CEISA Submit Modal
function CeisaSubmitModal({ shipment, onClose, onSuccess }: {
  shipment: Shipment;
  onClose: () => void;
  onSuccess: (result: any) => void;
}) {
  const { currentTenant } = useTenant();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!currentTenant) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await apiClient.post(
        `/tenants/${currentTenant.id}/shipments/${shipment.id}/ceisa-submit`
      );
      setResult(data);
      if (data.success) onSuccess(data);
    } catch (e: any) {
      setError(e.response?.data?.error ?? "Gagal mengirim ke CEISA");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-surface-border bg-white shadow-lg">
        <div className="border-b border-surface-border px-5 py-4">
          <h3 className="section-title">Kirim ke CEISA</h3>
          <p className="text-xs text-surface-muted mt-0.5">Shipment: {shipment.shipment_number}</p>
        </div>

        <div className="p-5">
          {!result ? (
            <>
              <div className="mb-4 rounded-md border border-surface-border bg-surface-page p-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-surface-muted">Status</span>
                  <span className="font-semibold text-success-600">{shipment.status}</span>
                </div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-surface-muted">Readiness Score</span>
                  <span className="font-mono font-semibold">{shipment.ceisa_readiness_score}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-surface-muted">Mode CEISA</span>
                  <span className="badge-intel badge text-2xs">Mock</span>
                </div>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 rounded border border-danger-600 bg-danger-100 p-3">
                  <AlertTriangle size={13} className="text-danger-600 flex-shrink-0" />
                  <p className="text-xs text-danger-600">{error}</p>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button onClick={onClose} className="btn-secondary text-xs">Batal</button>
                <button onClick={submit} disabled={submitting} className="btn-primary text-xs gap-1 disabled:opacity-50">
                  {submitting ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                  {submitting ? "Mengirim..." : "Kirim ke CEISA"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`mb-4 flex flex-col items-center py-6 rounded-md ${result.success ? "bg-success-100" : "bg-danger-100"}`}>
                {result.success
                  ? <CheckCircle size={32} className="text-success-600 mb-2" />
                  : <AlertTriangle size={32} className="text-danger-600 mb-2" />}
                <p className="font-semibold text-sm">{result.success ? "Berhasil Dikirim!" : "Pengiriman Gagal"}</p>
                <p className="text-2xs text-surface-muted mt-1">{result.message}</p>
              </div>

              {result.success && (
                <div className="space-y-2 mb-4">
                  {[
                    { label: "Nomor Permohonan", value: result.nomor_permohonan },
                    { label: "Nomor BC",          value: result.nomor_bc },
                    { label: "Tanggal BC",        value: result.tanggal_bc },
                    { label: "Status CEISA",      value: result.status },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-surface-muted">{label}</span>
                      <span className="font-mono font-semibold">{value}</span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={onClose} className="btn-primary text-xs w-full justify-center">Tutup</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Bc23WorkflowPage() {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [submitTarget, setSubmitTarget] = useState<Shipment | null>(null);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient.get(`/tenants/${currentTenant.id}/shipments`)
      .then(r => setShipments(r.data))
      .finally(() => setIsLoading(false));
  }, [currentTenant]);

  function handleSubmitSuccess(result: any) {
    setShipments(prev => prev.map(s =>
      s.id === submitTarget?.id ? { ...s, status: "SUBMITTED" } : s
    ));
  }

  const columns: ColumnDef<Shipment, any>[] = [
    {
      accessorKey: "shipment_number",
      header: "No. Shipment",
      cell: info => (
        <button onClick={() => navigate(`/bc23/${info.row.original.id}`)}
          className="font-mono text-xs text-intel-500 hover:underline">
          {info.getValue() as string}
        </button>
      ),
    },
    {
      accessorKey: "party_from_name",
      header: "Supplier",
      cell: info => <span className="text-xs text-surface-text">{(info.getValue() as string) ?? "—"}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: info => {
        const cfg = STATUS_CONFIG[info.getValue() as string] ?? STATUS_CONFIG.DRAFT;
        const Icon = cfg.icon;
        return <span className={`badge gap-1 ${cfg.color}`}><Icon size={10} />{cfg.label}</span>;
      },
    },
    {
      accessorKey: "health",
      header: "Health",
      cell: info => {
        const h = (info.getValue() as string) ?? "HEALTHY";
        const cfg = HEALTH_CONFIG[h as keyof typeof HEALTH_CONFIG] ?? HEALTH_CONFIG.HEALTHY;
        return (
          <span className={`flex items-center gap-1.5 text-xs font-medium ${cfg.color}`}>
            <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
            {h.replace("_", " ")}
          </span>
        );
      },
    },
    {
      accessorKey: "ceisa_readiness_score",
      header: "Readiness",
      cell: info => {
        const score = info.getValue() as number ?? 0;
        return (
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 rounded-full bg-surface-page overflow-hidden">
              <div className={`h-full rounded-full ${score >= 90 ? "bg-success-600" : score >= 70 ? "bg-warning-600" : "bg-danger-600"}`}
                style={{ width: `${score}%` }} />
            </div>
            <span className="text-xs font-mono">{score}%</span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: info => {
        const s = info.row.original;
        return (
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(`/idp-studio/${s.id}`)}
              className="btn-secondary text-2xs py-0.5 gap-1">
              <ExternalLink size={10} /> IDP Studio
            </button>
            {s.status === "READY_FOR_CEISA" && (
              <button onClick={() => setSubmitTarget(s)}
                className="btn-primary text-2xs py-0.5 gap-1">
                <Send size={10} /> Submit CEISA
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Alur Kerja BC 2.3</h1>
        <p className="page-subtitle">Monitor status shipment dari DRAFT hingga SPPB</p>
      </div>

      {/* State machine legend */}
      <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-2">
        {Object.entries(STATUS_CONFIG).map(([status, cfg], idx) => {
          const Icon = cfg.icon;
          return (
            <div key={status} className="flex items-center gap-1 flex-shrink-0">
              <span className={`badge gap-1 ${cfg.color}`}><Icon size={10} />{cfg.label}</span>
              {idx < Object.keys(STATUS_CONFIG).length - 1 && (
                <ChevronRight size={12} className="text-surface-muted" />
              )}
            </div>
          );
        })}
      </div>

      {isLoading ? (
        <p className="text-sm text-surface-muted">Memuat shipment...</p>
      ) : (
        <EnterpriseDataTable
          data={shipments}
          columns={columns}
          searchPlaceholder="Cari shipment..."
          emptyMessage="Belum ada shipment. Upload dokumen terlebih dahulu."
          onRowClick={row => navigate(`/bc23/${row.id}`)}
        />
      )}

      {submitTarget && (
        <CeisaSubmitModal
          shipment={submitTarget}
          onClose={() => setSubmitTarget(null)}
          onSuccess={handleSubmitSuccess}
        />
      )}
    </div>
  );
}

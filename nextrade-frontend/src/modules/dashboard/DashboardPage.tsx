import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Minus, ArrowRight, Upload, AlertTriangle, CheckCircle, Clock, FileText } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";

interface DashboardSummary {
  shipmentStatusCounts: Record<string, number>;
  sourceBreakdown: Array<{ source: string; count: number }>;
  pendingReviewShipments: number;
  documentMismatchShipments: number;
  autoApprovalRate: number | null;
  recentDocuments: Array<{ id: string; file_name: string; status: string; intake_source: string; uploaded_at: string }>;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; className: string }> = {
  uploaded: { label: "Menunggu proses", icon: Clock, className: "text-surface-muted" },
  extracting: { label: "Mengekstrak...", icon: Clock, className: "text-warning-600" },
  extracted: { label: "Selesai diekstrak", icon: CheckCircle, className: "text-success-600" },
  needs_review: { label: "Perlu tinjauan", icon: AlertTriangle, className: "text-warning-600" },
  pending_upload: { label: "Mengupload...", icon: Clock, className: "text-surface-muted" },
};

function KpiCard({ label, value, sub, trend, icon: Icon, accentColor = "text-surface-text" }: {
  label: string; value: string | number; sub?: string;
  trend?: "up" | "down" | "flat"; icon?: typeof CheckCircle; accentColor?: string;
}) {
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <p className="kpi-label">{label}</p>
        {Icon && <Icon size={16} className="text-surface-muted" />}
      </div>
      <p className={`kpi-value ${accentColor}`}>{value}</p>
      {sub && (
        <div className="kpi-delta">
          {trend === "up" && <TrendingUp size={11} className="text-success-600" />}
          {trend === "down" && <TrendingDown size={11} className="text-danger-600" />}
          {trend === "flat" && <Minus size={11} className="text-surface-muted" />}
          <span className={trend === "up" ? "text-success-600" : trend === "down" ? "text-danger-600" : "text-surface-muted"}>
            {sub}
          </span>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return <span className="badge-neutral badge">{status}</span>;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-2xs font-medium ${cfg.className}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;
    const fetch = () =>
      apiClient.get(`/tenants/${currentTenant.id}/dashboard/summary`)
        .then((res) => setSummary(res.data))
        .catch(console.error)
        .finally(() => setIsLoading(false));
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [currentTenant]);

  const totalShipments = summary
    ? Object.values(summary.shipmentStatusCounts).reduce((s, c) => s + c, 0) : 0;
  const readyCount = summary?.shipmentStatusCounts["ready"] ?? 0;
  const isEmpty = !isLoading && totalShipments === 0 && (summary?.recentDocuments.length ?? 0) === 0;

  return (
    <div className="page-container">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="page-title">Dashboard Eksekutif</h1>
        <p className="page-subtitle">Ringkasan operasional, kepatuhan, dan risiko perdagangan</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="kpi-card animate-pulse">
              <div className="h-3 w-24 rounded bg-surface-border mb-3" />
              <div className="h-7 w-12 rounded bg-surface-border" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* KPI Row */}
          <div className="mb-6 grid grid-cols-4 gap-4">
            <KpiCard
              label="Shipment Aktif"
              value={totalShipments}
              sub={totalShipments > 0 ? "sedang diproses" : "mulai upload dokumen"}
              trend="flat"
              icon={FileText}
            />
            <KpiCard
              label="Menunggu Tinjauan"
              value={summary?.pendingReviewShipments ?? 0}
              sub="perlu keputusan operator"
              icon={AlertTriangle}
              accentColor={summary?.pendingReviewShipments ? "text-warning-600" : "text-surface-text"}
            />
            <KpiCard
              label="Siap Submit CEISA"
              value={readyCount}
              sub="payload BC sudah siap"
              icon={CheckCircle}
              accentColor={readyCount > 0 ? "text-success-600" : "text-surface-text"}
            />
            <KpiCard
              label="Persetujuan Otomatis"
              value={summary?.autoApprovalRate != null ? `${Math.round(summary.autoApprovalRate)}%` : "—"}
              sub="dokumen lolos tanpa review"
              trend={summary?.autoApprovalRate != null && summary.autoApprovalRate > 80 ? "up" : "flat"}
            />
          </div>

          {isEmpty ? (
            /* Empty state — Salesforce style */
            <div className="card">
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-intel-50">
                  <Upload size={24} className="text-intel-500" />
                </div>
                <h3 className="section-title mb-1">Belum ada aktivitas</h3>
                <p className="text-sm text-surface-muted mb-4">
                  Upload dokumen shipment pertama untuk memulai proses ekstraksi dan validasi otomatis.
                </p>
                <Link to="/documents" className="btn-primary">
                  Upload dokumen
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {/* Recent Documents */}
              <div className="col-span-2 card">
                <div className="card-header">
                  <span className="section-title">Dokumen terbaru</span>
                  <Link to="/documents" className="text-2xs text-intel-500 hover:underline flex items-center gap-1">
                    Lihat semua <ArrowRight size={11} />
                  </Link>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-border">
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-surface-muted text-2xs">Dokumen</th>
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-surface-muted text-2xs">Status</th>
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-surface-muted text-2xs">Sumber</th>
                      <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide text-surface-muted text-2xs">Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary?.recentDocuments ?? []).slice(0, 8).map((doc) => (
                      <tr key={doc.id} className="border-b border-surface-border last:border-0 hover:bg-surface-page transition-colors">
                        <td className="px-4 py-2.5">
                          <Link to={`/idp-studio/${doc.id}`} className="text-xs font-medium text-surface-text hover:text-intel-500 transition-colors truncate max-w-[200px] block">
                            {doc.file_name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5"><StatusDot status={doc.status} /></td>
                        <td className="px-4 py-2.5">
                          <span className="badge-neutral badge">{doc.intake_source?.replace("_", " ")}</span>
                        </td>
                        <td className="px-4 py-2.5 text-surface-muted">
                          {new Date(doc.uploaded_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Source breakdown */}
              <div className="card">
                <div className="card-header">
                  <span className="section-title">Sumber dokumen</span>
                </div>
                <div className="p-4 space-y-3">
                  {(summary?.sourceBreakdown ?? []).map((s) => {
                    const total = summary?.sourceBreakdown.reduce((acc, x) => acc + x.count, 0) ?? 1;
                    const pct = Math.round((s.count / total) * 100);
                    return (
                      <div key={s.source}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-surface-text capitalize">{s.source.replace(/_/g, " ")}</span>
                          <span className="font-mono text-surface-muted">{s.count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden bg-surface-page">
                          <div className="h-full rounded-full bg-intel-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {(summary?.sourceBreakdown ?? []).length === 0 && (
                    <p className="text-sm text-surface-muted text-center py-4">Belum ada data</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

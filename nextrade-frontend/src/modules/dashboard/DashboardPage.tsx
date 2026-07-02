import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  TrendingUp, TrendingDown, ArrowRight, AlertTriangle,
  CheckCircle, Clock, Upload, Sparkles, RefreshCw,
  FileText, Shield, BarChart2, Zap, AlertCircle,
  Package, Activity, ChevronRight, Plus
} from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";
import { AiChatWidget } from "../../components/ui/AiChatWidget";

interface DashboardData {
  shipments: {
    total: number; submitted: number; ready_for_ceisa: number;
    pending_review: number; critical: number; avg_readiness: number;
    by_status: Record<string, number>; by_health: Record<string, number>;
  };
  documents: { total: number; by_type: Record<string, number> };
  extraction_quality: { avg_confidence: number };
  raw_shipments: any[];
  recent_activity: any[];
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = '#1B2A4A', icon: Icon, alert = false }: {
  label: string; value: string | number; sub?: string;
  color?: string; icon?: any; alert?: boolean;
}) {
  return (
    <div className={`kpi-card relative overflow-hidden ${alert ? 'border-[#FF5630]' : ''}`}>
      {alert && <div className="absolute top-0 left-0 w-0.5 h-full bg-[#FF5630]" />}
      <div className="flex items-start justify-between">
        <p className="kpi-label">{label}</p>
        {Icon && <Icon size={15} className={alert ? 'text-[#FF5630]' : 'text-[#DFE1E6]'} />}
      </div>
      <p className="kpi-value" style={{ color }}>{value}</p>
      {sub && <p className="kpi-delta"><span className="text-[#6B778C]">{sub}</span></p>}
    </div>
  );
}

// ── Mini Badge ────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', UNDER_REVIEW: 'Under Review', READY_FOR_CEISA: 'Ready',
  SUBMITTED: 'Submitted', SPPB: 'SPPB', CLOSED: 'Closed',
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: '#DFE1E6', UNDER_REVIEW: '#4C9AFF', READY_FOR_CEISA: '#36B37E',
  SUBMITTED: '#1B2A4A', SPPB: '#0EA5A4', CLOSED: '#6B778C',
};
const HEALTH_BADGE: Record<string, string> = {
  HEALTHY: 'badge-success', NEEDS_ATTENTION: 'badge-warning', CRITICAL: 'badge-danger',
};
const PIPELINE_ORDER = ['DRAFT','UNDER_REVIEW','READY_FOR_CEISA','SUBMITTED','SPPB','CLOSED'];

// ── Activity event label ───────────────────────────────────────────────────────
function eventLabel(evt: any): string {
  const map: Record<string, string> = {
    SHIPMENT_CREATED: 'New shipment created',
    DOCUMENT_RECEIVED: 'Document received',
    DOCUMENT_EXTRACTED: 'Fields extracted by AI',
    SHIPMENT_STATUS_CHANGED: `Status → ${evt.payload?.to_status ?? ''}`,
    CONFIG_CHANGED: 'Configuration updated',
    SHIPMENT_MATCHED: 'Document matched to shipment',
  };
  return map[evt.event_type] ?? evt.event_type;
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const [data, setData]         = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    if (!currentTenant) return;
    setRefreshing(true);
    apiClient.get(`/tenants/${currentTenant.id}/reports/summary`)
      .then(r => {
        setData(r.data);
        if (r.data.shipments.total > 0 && !aiInsight) {
          apiClient.post(`/tenants/${currentTenant.id}/reports/ai-narrative`, {
            prompt: 'Give 2 concise executive insight sentences about risks and opportunities from this data.'
          }).then(nr => {
            const lines = nr.data.narrative?.split('\n').filter((l: string) => l.trim()).slice(0, 2);
            setAiInsight(lines?.join(' ') ?? null);
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => { setIsLoading(false); setRefreshing(false); });
  }

  useEffect(() => { load(); }, [currentTenant]);

  if (isLoading) return (
    <div className="page-container">
      <div className="grid grid-cols-6 gap-3 mb-5">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="kpi-card animate-pulse">
            <div className="h-3 w-20 rounded bg-[#DFE1E6] mb-3" />
            <div className="h-7 w-12 rounded bg-[#DFE1E6]" />
          </div>
        ))}
      </div>
    </div>
  );

  const s = data?.shipments;
  const isEmpty = !data || (s?.total ?? 0) === 0;
  const criticalShipments = (data?.raw_shipments ?? []).filter(sh => sh.health === 'CRITICAL');
  const needsAttentionShipments = (data?.raw_shipments ?? []).filter(sh => sh.health === 'NEEDS_ATTENTION');

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <p className="page-subtitle">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-[#6B778C] border border-[#DFE1E6] hover:bg-[#F4F5F7] transition-colors">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link to="/upload" className="btn-primary gap-1.5">
            <Plus size={14} /> {t('dashboard.uploadFirst')}
          </Link>
        </div>
      </div>

      {/* AI Insight Banner */}
      {aiInsight && (
        <div className="ai-panel mb-4 flex items-start gap-3">
          <Sparkles size={15} className="text-[#0EA5A4] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#0EA5A4] mb-1">
              {t('dashboard.aiInsight')}
            </p>
            <p className="text-xs text-[#1B2A4A] leading-relaxed">{aiInsight}</p>
          </div>
        </div>
      )}

      {/* Critical Alert */}
      {criticalShipments.length > 0 && (
        <div className="mb-4 rounded border border-[#FF5630] bg-red-50 px-4 py-3 flex items-center gap-3">
          <AlertCircle size={16} className="text-[#FF5630] flex-shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-[#FF5630]">
              {criticalShipments.length} {t('dashboard.criticalAlert')}
            </p>
            <p className="text-[11px] text-[#6B778C] mt-0.5">
              {criticalShipments.slice(0, 3).map(sh => sh.shipment_number).join(', ')}
            </p>
          </div>
          <button onClick={() => navigate('/bc23')}
            className="text-[11px] text-[#FF5630] font-medium hover:underline flex items-center gap-1">
            View <ChevronRight size={12} />
          </button>
        </div>
      )}

      {isEmpty ? (
        <div className="card flex flex-col items-center justify-center py-24 text-center">
          <div className="h-20 w-20 rounded-full bg-[#F4F5F7] flex items-center justify-center mb-5">
            <Upload size={32} className="text-[#DFE1E6]" />
          </div>
          <h3 className="section-title mb-2">{t('dashboard.emptyState')}</h3>
          <p className="text-sm text-[#6B778C] mb-6 max-w-sm">{t('dashboard.emptyStateDesc')}</p>
          <Link to="/upload" className="btn-primary gap-2">
            <Upload size={14} /> {t('dashboard.uploadFirst')}
          </Link>
        </div>
      ) : (
        <>
          {/* ── 6 KPI Cards ── */}
          <div className="grid grid-cols-6 gap-3 mb-5">
            <KpiCard
              label={t('dashboard.kpi.activeShipments')}
              value={s!.total}
              sub={t('dashboard.kpi.allStatus')}
              icon={BarChart2}
            />
            <KpiCard
              label={t('dashboard.kpi.pendingReview')}
              value={s!.pending_review ?? 0}
              sub={t('dashboard.kpi.awaitingDecision')}
              icon={Clock}
              color="#FFAB00"
            />
            <KpiCard
              label={t('dashboard.kpi.readyForCeisa')}
              value={s!.ready_for_ceisa}
              sub={t('dashboard.kpi.awaitingSubmit')}
              icon={CheckCircle}
              color="#36B37E"
            />
            <KpiCard
              label={t('dashboard.kpi.submitted')}
              value={s!.submitted}
              sub={t('dashboard.kpi.submittedSppb')}
              icon={Shield}
              color="#1B2A4A"
            />
            <KpiCard
              label={t('dashboard.kpi.critical')}
              value={s!.critical ?? criticalShipments.length}
              sub={t('dashboard.kpi.needsAttention')}
              icon={AlertTriangle}
              color={criticalShipments.length > 0 ? '#FF5630' : '#36B37E'}
              alert={criticalShipments.length > 0}
            />
            <KpiCard
              label={t('dashboard.kpi.avgReadiness')}
              value={`${s!.avg_readiness}%`}
              sub={t('dashboard.kpi.aiConfidence')}
              icon={Zap}
              color={s!.avg_readiness >= 85 ? '#36B37E' : s!.avg_readiness >= 70 ? '#FFAB00' : '#FF5630'}
            />
          </div>

          {/* ── Row 2: Pipeline Funnel + Recent Shipments ── */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            {/* Pipeline */}
            <div className="card">
              <div className="card-header">
                <span className="section-title">{t('dashboard.pipeline')}</span>
              </div>
              <div className="p-4 space-y-2.5">
                {PIPELINE_ORDER.map((status, idx) => {
                  const count = s?.by_status[status] ?? 0;
                  const total = s?.total ?? 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={status}>
                      <div className="flex justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
                          <span className="text-[#6B778C]">{STATUS_LABEL[status]}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 rounded-full overflow-hidden bg-[#F4F5F7]">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, background: STATUS_COLOR[status] }} />
                          </div>
                          <span className="font-mono font-semibold text-[#1B2A4A] w-4 text-right">{count}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent Shipments */}
            <div className="card col-span-2">
              <div className="card-header">
                <span className="section-title">{t('dashboard.recentShipments')}</span>
                <Link to="/bc23" className="text-[10px] text-[#0EA5A4] hover:underline flex items-center gap-1">
                  {t('dashboard.viewAll')} <ArrowRight size={11} />
                </Link>
              </div>
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th>Shipment</th>
                    <th>Status</th>
                    <th>Health</th>
                    <th>Readiness</th>
                    <th>Docs</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.raw_shipments ?? []).slice(0, 8).map((sh: any) => (
                    <tr key={sh.id} className="cursor-pointer" onClick={() => navigate(`/bc23/${sh.id}`)}>
                      <td>
                        <div className="font-mono text-xs font-medium text-[#1B2A4A]">{sh.shipment_number}</div>
                        {sh.doc_count > 0 && <div className="text-[10px] text-[#6B778C]">{sh.doc_count} documents</div>}
                      </td>
                      <td>
                        <span className={`badge ${sh.status === 'READY_FOR_CEISA' || sh.status === 'SPPB' ? 'badge-success' : sh.status === 'SUBMITTED' ? 'badge-navy' : sh.status === 'UNDER_REVIEW' ? 'badge-blue' : 'badge-neutral'}`}>
                          {STATUS_LABEL[sh.status] ?? sh.status}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${HEALTH_BADGE[sh.health] ?? 'badge-neutral'}`}>
                          {sh.health?.replace('_', ' ') ?? '—'}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 w-28">
                          <div className="h-1 flex-1 rounded-full overflow-hidden bg-[#F4F5F7]">
                            <div className="h-full rounded-full" style={{
                              width: `${sh.ceisa_readiness_score ?? 0}%`,
                              background: (sh.ceisa_readiness_score ?? 0) >= 85 ? '#36B37E'
                                : (sh.ceisa_readiness_score ?? 0) >= 70 ? '#FFAB00' : '#FF5630',
                            }} />
                          </div>
                          <span className="text-[10px] font-mono text-[#6B778C] w-8">{sh.ceisa_readiness_score ?? 0}%</span>
                        </div>
                      </td>
                      <td><span className="font-mono text-[10px] text-[#6B778C]">{sh.doc_count ?? 0}</span></td>
                      <td><ArrowRight size={12} className="text-[#DFE1E6]" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Row 3: Risk Radar + Extraction Quality + Activity + Doc Types ── */}
          <div className="grid grid-cols-4 gap-4">
            {/* Risk Radar */}
            <div className="card">
              <div className="card-header">
                <span className="section-title flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-[#FF5630]" />
                  {t('dashboard.riskRadar')}
                </span>
              </div>
              <div className="p-3 space-y-2">
                {criticalShipments.length === 0 && needsAttentionShipments.length === 0 ? (
                  <div className="py-6 text-center">
                    <CheckCircle size={20} className="text-[#36B37E] mx-auto mb-1.5" />
                    <p className="text-xs text-[#36B37E] font-medium">All clear</p>
                    <p className="text-[10px] text-[#6B778C]">No critical shipments</p>
                  </div>
                ) : (
                  <>
                    {criticalShipments.slice(0, 3).map(sh => (
                      <button key={sh.id} onClick={() => navigate(`/bc23/${sh.id}`)}
                        className="w-full text-left rounded border border-[#FF5630] bg-red-50 px-2.5 py-2 hover:bg-red-100 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] font-semibold text-[#FF5630]">{sh.shipment_number}</span>
                          <span className="badge badge-danger text-[9px]">CRITICAL</span>
                        </div>
                        <p className="text-[10px] text-[#6B778C] mt-0.5">{sh.ceisa_readiness_score ?? 0}% ready</p>
                      </button>
                    ))}
                    {needsAttentionShipments.slice(0, 2).map(sh => (
                      <button key={sh.id} onClick={() => navigate(`/bc23/${sh.id}`)}
                        className="w-full text-left rounded border border-[#FFAB00] bg-yellow-50 px-2.5 py-2 hover:bg-yellow-100 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] font-semibold text-[#FFAB00]">{sh.shipment_number}</span>
                          <span className="badge badge-warning text-[9px]">ATTENTION</span>
                        </div>
                        <p className="text-[10px] text-[#6B778C] mt-0.5">{sh.ceisa_readiness_score ?? 0}% ready</p>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Extraction Quality */}
            <div className="card">
              <div className="card-header">
                <span className="section-title">{t('dashboard.extractionQuality')}</span>
              </div>
              <div className="p-4">
                {/* Confidence ring */}
                <div className="flex items-center justify-center mb-4">
                  <div className="relative">
                    <svg width="80" height="80" viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="32" fill="none" stroke="#F4F5F7" strokeWidth="8" />
                      <circle cx="40" cy="40" r="32" fill="none"
                        stroke={data!.extraction_quality.avg_confidence >= 85 ? '#36B37E'
                          : data!.extraction_quality.avg_confidence >= 70 ? '#FFAB00' : '#FF5630'}
                        strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={`${(data!.extraction_quality.avg_confidence / 100) * 201} 201`}
                        strokeDashoffset="50" transform="rotate(-90 40 40)" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-bold text-[#1B2A4A]">{data?.extraction_quality.avg_confidence ?? 0}%</span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-[#6B778C] text-center">{t('dashboard.thresholds')}</p>

                {/* Health breakdown */}
                <div className="mt-3 space-y-1.5">
                  {[['HEALTHY', '#36B37E'], ['NEEDS_ATTENTION', '#FFAB00'], ['CRITICAL', '#FF5630']].map(([h, color]) => (
                    <div key={h} className="flex justify-between text-[10px]">
                      <span className="text-[#6B778C]">{h.replace('_', ' ')}</span>
                      <span className="font-mono font-semibold" style={{ color: color as string }}>
                        {s?.by_health?.[h] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="card">
              <div className="card-header">
                <span className="section-title">{t('dashboard.recentActivity')}</span>
              </div>
              <div className="divide-y divide-[#F4F5F7]">
                {(data?.recent_activity ?? []).length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#6B778C]">{t('dashboard.noActivity')}</div>
                ) : (
                  (data?.recent_activity ?? []).slice(0, 6).map((evt: any, i: number) => (
                    <div key={i} className="px-3 py-2 flex items-start gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#0EA5A4] mt-1.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[#1B2A4A] truncate">{eventLabel(evt)}</p>
                        {evt.shipment_number && (
                          <p className="text-[10px] text-[#6B778C] font-mono">{evt.shipment_number}</p>
                        )}
                        <p className="text-[10px] text-[#6B778C]">
                          {new Date(evt.event_time).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Document Types + Quick Actions */}
            <div className="card">
              <div className="card-header">
                <span className="section-title">{t('dashboard.documentTypes')}</span>
              </div>
              <div className="p-4 space-y-2 mb-2">
                {Object.entries(data?.documents.by_type ?? {}).slice(0, 5).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-[#6B778C] truncate">{type || 'Unknown'}</span>
                        <span className="font-mono font-semibold text-[#1B2A4A]">{count as number}</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden bg-[#F4F5F7]">
                        <div className="h-full rounded-full bg-[#0EA5A4] opacity-60"
                          style={{ width: `${Math.round((count as number) / (data?.documents.total ?? 1) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
                {Object.keys(data?.documents.by_type ?? {}).length === 0 && (
                  <p className="text-sm text-[#6B778C] text-center py-2">No documents yet</p>
                )}
              </div>
              {/* Quick Actions */}
              <div className="border-t border-[#DFE1E6] p-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B778C] mb-2">
                  {t('dashboard.quickActions')}
                </p>
                {[
                  { label: 'Upload Documents', to: '/upload', icon: Upload },
                  { label: 'BC 2.3 Workflow', to: '/bc23', icon: FileText },
                  { label: 'Review Queue', to: '/review-queue', icon: Activity },
                  { label: 'Analytics', to: '/analytics', icon: BarChart2 },
                ].map(({ label, to, icon: Icon }) => (
                  <Link key={to} to={to}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[#6B778C] hover:bg-[#F4F5F7] hover:text-[#1B2A4A] transition-colors">
                    <Icon size={12} />
                    {label}
                    <ChevronRight size={10} className="ml-auto" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <AiChatWidget />
    </div>
  );
}

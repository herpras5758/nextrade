import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  CheckCircle, AlertTriangle, XCircle, Clock, ChevronRight,
  FileText, Sparkles, Send, RefreshCw, Upload, ArrowLeft,
  Download, Eye, Edit3, Shield
} from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Shipment {
  id: string; shipment_number: string; status: string; health: string;
  ceisa_readiness_score: number; created_at: string;
}
interface Document {
  id: string; file_name: string; document_type: string;
  category: string; status: string;
}
interface CtdmField {
  id: string; field_key: string; resolved_value: string; confidence: number; status: string;
}
interface Checkpoint {
  id: number; code: string; label: string; weight: number;
  status: 'PASS' | 'WARN' | 'FAIL' | 'NA'; detail: string; confidence: number;
}
interface Readiness {
  score?: number;
  overallStatus?: string;
  checkpoints?: any[];
  reasoning?: { summary: string; recommendation: string; failed_items?: string[]; warned_items?: string[] };
  summary?: { pass: number; warn: number; fail: number; mandatoryFieldsMissing?: any[] };
  is_ready?: boolean;
  fail?: number;
  warn?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  DRAFT:           { label: 'Draft',           badge: 'badge-neutral' },
  UNDER_REVIEW:    { label: 'Under Review',     badge: 'badge-blue'    },
  READY_FOR_CEISA: { label: 'Siap CEISA',       badge: 'badge-success' },
  SUBMITTED:       { label: 'Dikirim',          badge: 'badge-navy'    },
  SPPB:            { label: 'SPPB Diterima',    badge: 'badge-success' },
  CLOSED:          { label: 'Selesai',          badge: 'badge-neutral' },
};

const HEALTH_CONFIG: Record<string, { color: string; dot: string; label: string }> = {
  HEALTHY:         { color: 'text-[#36B37E]', dot: 'bg-[#36B37E]', label: 'Healthy'          },
  NEEDS_ATTENTION: { color: 'text-[#FFAB00]', dot: 'bg-[#FFAB00]', label: 'Needs Attention'  },
  CRITICAL:        { color: 'text-[#FF5630]', dot: 'bg-[#FF5630]', label: 'Critical'          },
};

const DOC_CATEGORY_COLOR: Record<string, string> = {
  COMMERCIAL: 'bg-blue-50 text-blue-700',
  TRANSPORT:  'bg-purple-50 text-purple-700',
  CUSTOMS:    'bg-teal-50 text-[#0EA5A4]',
  COMPLIANCE: 'bg-yellow-50 text-yellow-700',
  SUPPORTING: 'badge-neutral',
  INTERNAL:   'badge-neutral',
};

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 85 ? '#36B37E' : value >= 70 ? '#FFAB00' : '#FF5630';
  const pct = Math.round(value);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full overflow-hidden bg-[#F4F5F7]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono font-semibold min-w-[32px]" style={{ color }}>{pct}%</span>
    </div>
  );
}

function CheckpointItem({ cp }: { cp: Checkpoint }) {
  const cls = cp.status === 'PASS' ? 'checkpoint-pass' : cp.status === 'WARN' ? 'checkpoint-warn' : cp.status === 'FAIL' ? 'checkpoint-fail' : 'checkpoint-na';
  const Icon = cp.status === 'PASS' ? CheckCircle : cp.status === 'WARN' ? AlertTriangle : cp.status === 'FAIL' ? XCircle : Clock;
  const iconColor = cp.status === 'PASS' ? 'text-[#36B37E]' : cp.status === 'WARN' ? 'text-[#FFAB00]' : cp.status === 'FAIL' ? 'text-[#FF5630]' : 'text-[#6B778C]';
  return (
    <div className={cls}>
      <Icon size={15} className={`${iconColor} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#1B2A4A]">{cp.id}. {cp.label}</span>
          <span className="text-[10px] text-[#6B778C] font-mono">{cp.weight}pt</span>
        </div>
        <p className="text-[11px] text-[#6B778C] mt-0.5">{cp.detail}</p>
        {cp.confidence > 0 && (
          <div className="mt-1 w-32"><ConfidenceBar value={cp.confidence} /></div>
        )}
      </div>
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
type TabId = 'documents' | 'fields' | 'checkpoint' | 'draft' | 'ceisa';

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'documents',  label: 'Documents',      icon: FileText   },
  { id: 'fields',     label: 'Fields & AI', icon: Sparkles   },
  { id: 'checkpoint', label: 'Checkpoints',   icon: Shield     },
  { id: 'draft',      label: 'Draft BC 2.3', icon: FileText   },
  { id: 'ceisa',      label: 'Submit CEISA', icon: Send       },
];

// ── Main ───────────────────────────────────────────────────────────────────────
export function Bc23ShipmentDetail() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  const [tab, setTab]             = useState<TabId>('documents');
  const [shipment, setShipment]   = useState<Shipment | null>(null);
  const [docs, setDocs]           = useState<Document[]>([]);
  const [fields, setFields]       = useState<CtdmField[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [ceisaResult, setCeisaResult] = useState<any>(null);
  const [draft, setDraft]             = useState<any>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentTenant || !shipmentId) return;
    try {
      const [sRes, dRes, fRes, rRes] = await Promise.all([
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipmentId}`),
        apiClient.get(`/tenants/${currentTenant.id}/documents?shipment_id=${shipmentId}`),
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipmentId}/fields`).catch(() => ({ data: { allFields: [], totalFields: 0 } })),
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipmentId}/ceisa-readiness`).catch(() => ({ data: null })),
      ]);
      setShipment(sRes.data);
      setDocs(dRes.data);
      setFields(fRes.data?.allFields ?? fRes.data ?? []);
      const r = rRes.data;
      if (r) {
        // Map new format to existing UI expectations
        setReadiness({
          score: r.score,
          overallStatus: r.overallStatus,
          checkpoints: (r.checkpoints ?? []).map((cp: any) => ({
            ...cp,
            status: cp.status === 'PASS' ? 'PASS' : cp.status === 'WARN' ? 'WARN' : 'FAIL',
          })),
          reasoning: {
            summary: r.overallStatus === 'READY' ? 'Semua checkpoint terpenuhi — siap untuk submit ke CEISA'
              : r.overallStatus === 'NEARLY_READY' ? `Hampir siap — ${r.summary?.warn ?? 0} checkpoint perlu perhatian`
              : `Not ready — ${r.summary?.fail ?? 0} checkpoints failed: ${(r.checkpoints ?? []).filter((c:any) => c.status === 'FAIL').map((c:any) => c.name).slice(0,3).join(', ')}`,
            recommendation: r.summary?.mandatoryFieldsMissing?.length > 0
              ? `Field wajib CEISA yang belum ada: ${r.summary.mandatoryFieldsMissing.slice(0,5).map((f:any) => f.display_name ?? f.field_key).join(', ')}`
              : r.overallStatus === 'READY' ? 'Ready to proceed to Draft BC 2.3' : 'Upload missing documents or verify fields that need review',
          },
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentTenant, shipmentId]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmitCeisa() {
    if (!currentTenant || !shipmentId) return;
    setSubmitting(true);
    try {
      const { data } = await apiClient.post(`/tenants/${currentTenant.id}/shipments/${shipmentId}/ceisa-submit`);
      setCeisaResult(data);
      if (data.success) load();
    } finally { setSubmitting(false); }
  }

  if (isLoading) return (
    <div className="flex h-64 items-center justify-center text-sm text-[#6B778C]">Loading...</div>
  );
  if (!shipment) return (
    <div className="flex h-64 items-center justify-center text-sm text-[#6B778C]">Shipment tidak ditemukan.</div>
  );

  const statusCfg = STATUS_CONFIG[shipment.status] ?? STATUS_CONFIG.DRAFT;
  const healthCfg = HEALTH_CONFIG[shipment.health] ?? HEALTH_CONFIG.HEALTHY;
  const score = readiness?.score ?? shipment.ceisa_readiness_score ?? 0;

  return (
    <div className="page-container">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[#6B778C] mb-4">
        <Link to="/bc23" className="hover:text-[#1B2A4A] transition-colors">Alur Kerja BC 2.3</Link>
        <ChevronRight size={12} />
        <span className="font-mono text-[#1B2A4A]">{shipment.shipment_number}</span>
      </div>

      {/* Header */}
      <div className="card mb-4">
        <div className="px-4 py-3 flex items-center gap-4">
          <button onClick={() => navigate('/bc23')} className="text-[#6B778C] hover:text-[#1B2A4A] transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-base font-bold text-[#1B2A4A]">{shipment.shipment_number}</h1>
              <span className={`badge ${statusCfg.badge}`}>{statusCfg.label}</span>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${healthCfg.color}`}>
                <span className={`h-2 w-2 rounded-full ${healthCfg.dot}`} />
                {healthCfg.label}
              </span>
            </div>
            <p className="text-xs text-[#6B778C] mt-0.5">
              {docs.length} documents · {fields.length} fields extracted
            </p>
          </div>

          {/* Readiness meter */}
          <div className="flex items-center gap-4 border-l border-[#DFE1E6] pl-4">
            <div className="text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B778C]">CEISA Readiness</p>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono text-2xl font-bold" style={{ color: score >= 85 ? '#36B37E' : score >= 70 ? '#FFAB00' : '#FF5630' }}>{score}</span>
                <span className="text-sm text-[#6B778C]">%</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {readiness && <>
                <span className="text-[10px] text-[#36B37E]">✅ {(readiness as any).pass ?? readiness?.summary?.pass ?? 0} pass</span>
                <span className="text-[10px] text-[#FFAB00]">⚠️ {readiness.warn} warn</span>
                <span className="text-[10px] text-[#FF5630]">❌ {readiness.fail} fail</span>
              </>}
            </div>
          </div>

          {/* Upload more */}
          <button onClick={() => navigate('/upload')} className="btn-secondary gap-1">
            <Upload size={13} /> + Add Document
          </button>
        </div>

        {/* AI summary bar */}
        {(readiness as any)?.reasoning?.summary && (
          <div className="border-t border-[#DFE1E6] px-4 py-2.5 bg-teal-50 flex items-start gap-2">
            <Sparkles size={13} className="text-[#0EA5A4] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#0EA5A4]">
              <strong>AI:</strong> {readiness.reasoning.summary}
            </p>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="tab-bar rounded-t border border-[#DFE1E6] bg-white -mb-px">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`tab-item flex items-center gap-1.5 ${tab === t.id ? 'tab-item-active' : 'tab-item-inactive'}`}>
              <Icon size={13} />
              {t.label}
              {t.id === 'checkpoint' && readiness && readiness.fail > 0 && (
                <span className="rounded-full bg-[#FF5630] px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">{readiness.fail}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="card rounded-t-none">

        {/* ── DOCUMENTS ── */}
        {tab === 'documents' && (
          <div className="p-0 overflow-hidden">
            {docs.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <FileText size={32} strokeWidth={1} className="text-[#DFE1E6] mb-3" />
                <p className="text-sm text-[#6B778C]">Belum ada dokumen. Upload dari tombol di atas.</p>
              </div>
            ) : (
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th>Nama File</th>
                    <th>Tipe</th>
                    <th>Kategori</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map(doc => (
                    <tr key={doc.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          <FileText size={13} className="text-[#6B778C] flex-shrink-0" />
                          <span className="font-medium truncate max-w-[240px]">{doc.file_name}</span>
                        </span>
                      </td>
                      <td><span className="badge-neutral badge">{doc.document_type || '—'}</span></td>
                      <td><span className={`badge ${DOC_CATEGORY_COLOR[doc.category] ?? 'badge-neutral'}`}>{doc.category || '—'}</span></td>
                      <td>
                        <span className={`badge ${doc.status === 'extracted' ? 'badge-success' : doc.status === 'needs_review' ? 'badge-warning' : 'badge-neutral'}`}>
                          {doc.status}
                        </span>
                      </td>
                      <td>
                        <button onClick={() => navigate(`/idp-studio/${doc.id}`)}
                          className="flex items-center gap-1 text-[10px] text-[#0EA5A4] hover:underline">
                          <Eye size={11} /> IDP Studio
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── FIELDS ── */}
        {tab === 'fields' && (
          <div className="p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#DFE1E6] bg-[#F4F5F7] flex items-center gap-2">
              <Sparkles size={13} className="text-[#0EA5A4]" />
              <span className="text-xs text-[#6B778C]">Confidence ≥85% auto-approved · 70-84% recommended · &lt;70% perlu review manual</span>
            </div>
            {fields.length === 0 ? (
              <div className="py-16 text-center text-sm text-[#6B778C]">Pipeline has not finished extracting fields.</div>
            ) : (
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Doc Type</th>
                    <th>Nilai</th>
                    <th style={{ width: '160px' }}>Confidence AI</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map(f => (
                    <tr key={f.id}>
                      <td><div className="font-medium text-[11px]">{(f as any).display_name ?? f.field_key}</div><div className="font-mono text-[10px] text-[#6B778C]">{f.field_key}</div></td>
                      <td><span className="font-medium">{f.resolved_value || '—'}</span></td>
                      <td><ConfidenceBar value={(f.confidence ?? 0) * 100} /></td>
                      <td>
                        <span className={`badge ${f.status === 'auto_approved' ? 'badge-success' : f.status === 'review_required' ? 'badge-danger' : 'badge-warning'}`}>
                          {f.status}
                        </span>
                      </td>
                      <td>
                        <button className="flex items-center gap-1 text-[10px] text-[#6B778C] hover:text-[#1B2A4A]">
                          <Edit3 size={11} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── CHECKPOINT ── */}
        {tab === 'checkpoint' && (
          <div className="p-4">
            {!readiness ? (
              <div className="py-12 text-center text-sm text-[#6B778C]">
                <RefreshCw size={24} className="mx-auto mb-2 text-[#DFE1E6]" />
                Computing checkpoints...
              </div>
            ) : (
              <>
                {/* AI Recommendation */}
                <div className="ai-panel mb-4">
                  <div className="flex items-start gap-2">
                    <Sparkles size={14} className="text-[#0EA5A4] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-[#0EA5A4] mb-1">AI Analysis — 9 DJBC Checkpoints</p>
                      <p className="text-xs text-[#1B2A4A]">{readiness.reasoning.summary}</p>
                      <p className="text-xs text-[#6B778C] mt-1">{readiness.reasoning.recommendation}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {readiness.checkpoints.map(cp => (
                    <CheckpointItem key={cp.id} cp={cp} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── DRAFT CEISA ── */}
        {tab === 'draft' && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="section-title">Draft BC 2.3 Preview</p>
                <p className="text-xs text-[#6B778C] mt-0.5">Preview payload yang akan dikirim ke CEISA. Submit dari tab CEISA.</p>
              </div>
              <button className="btn-secondary gap-1" onClick={() => {
                setDraft(null);
                setLoadingDraft(true);
                apiClient.get(`/tenants/${currentTenant?.id}/shipments/${shipmentId}/ceisa-draft`)
                  .then(r => setDraft(r.data?.payload)).catch(() => {}).finally(() => setLoadingDraft(false));
              }}><RefreshCw size={13} /> Refresh</button>
            </div>

            {loadingDraft ? (
              <div className="py-12 text-center text-sm text-[#6B778C]">Loading draft...</div>
            ) : !draft ? (
              <div className="py-12 text-center text-sm text-[#6B778C]">
                <p>Draft not yet available — document extraction must complete first.</p>
                <p className="text-xs mt-1 text-[#6B778C]">Upload and commit Invoice, Packing List, and B/L to generate draft.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(draft ?? {}).filter(([k]) => !['items','hs_codes','pos_tarif_list'].includes(k)).map(([key, value]) => (
                    <div key={key} className="rounded border border-[#DFE1E6] bg-[#F4F5F7] px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B778C]">{key.replace(/_/g,' ')}</p>
                      <p className="text-sm font-medium text-[#1B2A4A] mt-0.5">{String(value) || '—'}</p>
                    </div>
                  ))}
                </div>
                {draft?.items && (
                  <div>
                    <p className="section-title mb-2">Items</p>
                    <table className="table-enterprise">
                      <thead><tr><th>Deskripsi</th><th>HS Code</th><th>Qty</th><th>CIF (USD)</th></tr></thead>
                      <tbody>
                        {(Array.isArray(draft.items) ? draft.items : []).map((item: any, i: number) => (
                          <tr key={i}>
                            <td>{item.description ?? item.uraian ?? '—'}</td>
                            <td className="font-mono">{item.hs_code ?? item.pos_tarif ?? '—'}</td>
                            <td>{item.qty ?? item.jumlah ?? '—'}</td>
                            <td>{item.cif_value ?? item.nilai_cif ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── CEISA SUBMIT ── */}
        {tab === 'ceisa' && (
          <div className="p-4">
            {(!readiness?.overallStatus || readiness?.overallStatus === 'NOT_READY' || readiness?.overallStatus === 'NEEDS_ATTENTION') && (
              <div className="checkpoint-fail mb-4">
                <XCircle size={16} className="text-[#FF5630] flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-[#FF5630]">Not ready to submit to CEISA</p>
                  <p className="text-xs text-[#6B778C] mt-0.5">
                    {readiness?.summary?.fail ?? 0} checkpoint gagal · {readiness?.summary?.warn ?? 0} perlu perhatian.
                    Selesaikan di tab Checkpoint.
                  </p>
                  {(readiness?.checkpoints ?? []).filter((c:any) => c.status === 'FAIL').map((c:any, i:number) => (
                    <p key={i} className="text-[11px] text-[#FF5630] mt-0.5">• {c.name}: {c.detail}</p>
                  ))}
                </div>
              </div>
            )}

            {(readiness?.score ?? 0) >= 70 && !ceisaResult && (
              <div className="checkpoint-pass mb-4">
                <CheckCircle size={16} className="text-[#36B37E] flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-[#36B37E]">Siap submit ke CEISA</p>
                  <p className="text-xs text-[#6B778C] mt-0.5">{readiness.reasoning.summary}</p>
                </div>
              </div>
            )}

            {ceisaResult && (
              <div className={`rounded border p-4 mb-4 ${ceisaResult.success ? 'border-[#36B37E] bg-[#E3FCEF]' : 'border-[#FF5630] bg-[#FFEBE6]'}`}>
                <div className="flex items-center gap-2 mb-3">
                  {ceisaResult.success
                    ? <CheckCircle size={20} className="text-[#36B37E]" />
                    : <XCircle size={20} className="text-[#FF5630]" />}
                  <p className="font-semibold text-sm">{ceisaResult.success ? 'Berhasil Dikirim ke CEISA' : 'Pengiriman Gagal'}</p>
                </div>
                {ceisaResult.success && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ['Nomor Permohonan', ceisaResult.nomor_permohonan],
                      ['Nomor BC', ceisaResult.nomor_bc],
                      ['Tanggal BC', ceisaResult.tanggal_bc],
                      ['Status CEISA', ceisaResult.status],
                    ].map(([l, v]) => (
                      <div key={l}>
                        <span className="text-[#6B778C]">{l}: </span>
                        <span className="font-mono font-semibold text-[#1B2A4A]">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-[#6B778C] mt-2">{ceisaResult.message}</p>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <div className="flex-1">
                <p className="text-xs text-[#6B778C]">
                  Submit ke CEISA adalah keputusan manusia. AI hanya memvalidasi kesiapan dokumen.
                </p>
                <p className="text-[11px] text-[#6B778C] mt-0.5">
                  Mode aktif: <span className="badge-ai badge">Mock CEISA</span> — switch ke Live di Admin Panel → CEISA Config
                </p>
              </div>
              <button
                onClick={handleSubmitCeisa}
                disabled={!readiness?.is_ready || submitting || !!ceisaResult?.success}
                className="btn-ai gap-1.5 px-5 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                {submitting ? 'Mengirim...' : 'Kirim ke CEISA'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

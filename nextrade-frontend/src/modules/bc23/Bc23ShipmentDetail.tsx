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
  score: number; is_ready: boolean; pass: number; warn: number; fail: number;
  checkpoints: Checkpoint[]; reasoning: { summary: string; recommendation: string; failed_items: string[]; warned_items: string[] };
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
  { id: 'documents',  label: 'Dokumen',      icon: FileText   },
  { id: 'fields',     label: 'Fields & AI',  icon: Sparkles   },
  { id: 'checkpoint', label: 'Checkpoint',   icon: Shield     },
  { id: 'draft',      label: 'Draft CEISA',  icon: FileText   },
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
  const [submitting, setSubmitting]   = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentTenant || !shipmentId) return;
    try {
      const [sRes, dRes, fRes, rRes] = await Promise.all([
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipmentId}`),
        apiClient.get(`/tenants/${currentTenant.id}/documents?shipment_id=${shipmentId}`),
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipmentId}/fields`).catch(() => ({ data: [] })),
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipmentId}/ceisa-readiness`).catch(() => ({ data: null })),
      ]);
      setShipment(sRes.data);
      setDocs(dRes.data);
      setFields(fRes.data);
      setReadiness(rRes.data);
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
    <div className="flex h-64 items-center justify-center text-sm text-[#6B778C]">Memuat...</div>
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
              {docs.length} dokumen · {fields.length} field terekstrak
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
                <span className="text-[10px] text-[#36B37E]">✅ {readiness.pass} pass</span>
                <span className="text-[10px] text-[#FFAB00]">⚠️ {readiness.warn} warn</span>
                <span className="text-[10px] text-[#FF5630]">❌ {readiness.fail} fail</span>
              </>}
            </div>
          </div>

          {/* Upload more */}
          <button onClick={() => navigate('/upload')} className="btn-secondary gap-1">
            <Upload size={13} /> + Tambah Dokumen
          </button>
        </div>

        {/* AI summary bar */}
        {readiness?.reasoning?.summary && (
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
              <div className="py-16 text-center text-sm text-[#6B778C]">Pipeline belum selesai mengekstrak fields.</div>
            ) : (
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Nilai</th>
                    <th style={{ width: '160px' }}>Confidence AI</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map(f => (
                    <tr key={f.id}>
                      <td><span className="font-mono text-[11px]">{f.field_key}</span></td>
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
                Menghitung checkpoint...
              </div>
            ) : (
              <>
                {/* AI Recommendation */}
                <div className="ai-panel mb-4">
                  <div className="flex items-start gap-2">
                    <Sparkles size={14} className="text-[#0EA5A4] flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-[#0EA5A4] mb-1">Analisis AI — 9 Checkpoint DJBC</p>
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
                <p className="section-title">Preview Draft BC 2.3</p>
                <p className="text-xs text-[#6B778C] mt-0.5">Preview payload sebelum submit. Submit hanya dari tab CEISA.</p>
              </div>
              <button className="btn-secondary gap-1"><Download size={13} /> Export PDF</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                ['Nomor AJU', fields.find(f => f.field_key === 'nomor_aju')?.resolved_value ?? '— (generate di tab CEISA)'],
                ['Jenis PIB', fields.find(f => f.field_key === 'jenis_pib')?.resolved_value ?? 'PIB Biasa'],
                ['Kantor Pabean', fields.find(f => f.field_key === 'kantor_pabean')?.resolved_value ?? '—'],
                ['NPWP Importir', fields.find(f => f.field_key === 'npwp_importir')?.resolved_value ?? '—'],
                ['Nama Importir', fields.find(f => f.field_key === 'consignee_name')?.resolved_value ?? '—'],
                ['Nama Eksportir', fields.find(f => f.field_key === 'supplier_name')?.resolved_value ?? '—'],
                ['No. Invoice', fields.find(f => f.field_key === 'invoice_number')?.resolved_value ?? '—'],
                ['No. B/L', fields.find(f => f.field_key === 'bl_number')?.resolved_value ?? '—'],
                ['Valuta', fields.find(f => f.field_key === 'currency')?.resolved_value ?? 'USD'],
                ['Total FOB', fields.find(f => f.field_key === 'fob_value')?.resolved_value ?? '—'],
                ['Freight', fields.find(f => f.field_key === 'freight')?.resolved_value ?? '—'],
                ['Total CIF', fields.find(f => f.field_key === 'cif_value')?.resolved_value ?? '—'],
                ['Berat Kotor', fields.find(f => f.field_key === 'gross_weight')?.resolved_value ?? '—'],
                ['Berat Bersih', fields.find(f => f.field_key === 'net_weight')?.resolved_value ?? '—'],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-[#DFE1E6] bg-[#F4F5F7] px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B778C]">{label}</p>
                  <p className="text-sm font-medium text-[#1B2A4A] mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── CEISA SUBMIT ── */}
        {tab === 'ceisa' && (
          <div className="p-4">
            {!readiness?.is_ready && (
              <div className="checkpoint-fail mb-4">
                <XCircle size={16} className="text-[#FF5630] flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-[#FF5630]">Belum siap submit ke CEISA</p>
                  <p className="text-xs text-[#6B778C] mt-0.5">
                    {readiness?.fail ?? 0} checkpoint gagal · {readiness?.warn ?? 0} perlu perhatian.
                    Selesaikan di tab Checkpoint.
                  </p>
                  {readiness?.reasoning?.failed_items?.map((item, i) => (
                    <p key={i} className="text-[11px] text-[#FF5630] mt-0.5">• {item}</p>
                  ))}
                </div>
              </div>
            )}

            {readiness?.is_ready && !ceisaResult && (
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

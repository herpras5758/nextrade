import { useState, useEffect, useCallback } from 'react';
import { Network, RefreshCw, Check, Loader2, ChevronRight, FileText, BarChart3, MessageSquare, Send } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useTenant } from '../../store/tenantContext';

function fmtDate(s: string) {
  return new Date(s).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(status: string) {
  const map: Record<string, [string,string]> = {
    candidate: ['badge badge-gray','Kandidat'], partial: ['badge badge-yellow','Parsial'],
    matched: ['badge badge-blue','Cocok'], verified: ['badge badge-green','Terverifikasi'],
  };
  const [cls, label] = map[status] ?? ['badge badge-gray', status];
  return <span className={cls}>{label}</span>;
}

function docTypeBadge(type: string) {
  const colors: Record<string, string> = {
    COMMERCIAL_INVOICE: '#3D7EFF', PACKING_LIST: '#22C55E', PURCHASE_ORDER: '#F59E0B',
    BILL_OF_LADING: '#A855F7', BC_1_1: '#EC4899', BC_2_3: '#EF4444', SURAT_JALAN: '#14B8A6',
  };
  const short: Record<string, string> = {
    COMMERCIAL_INVOICE: 'CI', PACKING_LIST: 'PL', PURCHASE_ORDER: 'PO',
    BILL_OF_LADING: 'B/L', BC_1_1: 'BC1.1', BC_2_3: 'BC2.3', SURAT_JALAN: 'SJ',
  };
  const color = colors[type] ?? '#6B7280';
  return (
    <span key={type} style={{ background: `${color}22`, color, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, marginRight: 4 }}>
      {short[type] ?? type}
    </span>
  );
}

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? '#22C55E' : pct >= 70 ? '#F59E0B' : '#EF4444';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#F4F5F7] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono text-[#6B778C] w-8 text-right">{pct}%</span>
    </div>
  );
}

type Tab = 'documents' | 'fields' | 'evidence';

export function ResolutionsPage() {
  const { currentTenant } = useTenant();
  const [resolutions, setResolutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('documents');
  const [approving, setApproving] = useState(false);
  const [evidenceType, setEvidenceType] = useState('FIELD_VALUE_INCORRECT');
  const [evidencePayload, setEvidencePayload] = useState('{}');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    if (!currentTenant) return;
    setLoading(true);
    apiClient.get(`/tenants/${currentTenant.id}/resolutions?limit=50`)
      .then(r => setResolutions(r.data.resolutions ?? []))
      .finally(() => setLoading(false));
  }, [currentTenant]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (id: string) => {
    if (!currentTenant) return;
    setDetailLoading(true);
    try {
      const { data } = await apiClient.get(`/tenants/${currentTenant.id}/resolutions/${id}`);
      setSelected(data);
      setTab('documents');
    } finally { setDetailLoading(false); }
  };

  const approve = async () => {
    if (!selected || !currentTenant) return;
    setApproving(true);
    try {
      await apiClient.patch(`/tenants/${currentTenant.id}/resolutions/${selected.resolution.id}/approve`);
      await loadDetail(selected.resolution.id);
      load();
    } finally { setApproving(false); }
  };

  const submitEvidence = async () => {
    if (!selected || !currentTenant) return;
    setSubmitting(true);
    try {
      let payload: any = {};
      try { payload = JSON.parse(evidencePayload); } catch {}
      await apiClient.post(`/tenants/${currentTenant.id}/resolutions/${selected.resolution.id}/evidence`, {
        evidence_type: evidenceType, payload,
      });
      setEvidencePayload('{}');
      await loadDetail(selected.resolution.id);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Resolusi Shipment</h1>
        <p className="page-subtitle">Kandidat shipment yang dihitung otomatis dari knowledge graph</p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-200px)]">
        {/* Left: list */}
        <div className="card w-80 flex-shrink-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-[#DFE1E6]">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-[#0EA5A4]" />
              <span className="font-semibold text-sm text-[#1B2A4A]">Resolusi</span>
              <span className="badge badge-gray">{resolutions.length}</span>
            </div>
            <button className="btn btn-ghost p-1.5" onClick={load}><RefreshCw size={12} /></button>
          </div>
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 size={16} className="animate-spin text-[#0EA5A4]" /></div>
            ) : resolutions.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-[#97A0AF]">
                <Network size={24} className="mb-2" />
                <p className="text-sm">Belum ada resolusi</p>
              </div>
            ) : resolutions.map(r => (
              <div
                key={r.id}
                className={`p-3 border-b border-[#F4F5F7] cursor-pointer hover:bg-[#F4F5F7] transition-colors ${selected?.resolution?.id === r.id ? 'bg-[#E6FCFF]' : ''}`}
                onClick={() => loadDetail(r.id)}
              >
                <div className="flex justify-between items-center mb-1.5">
                  {statusBadge(r.status)}
                  <span className="text-[11px] font-mono text-[#97A0AF]">{Math.round((r.confidence_score ?? 0) * 100)}%</span>
                </div>
                <div className="text-xs font-semibold text-[#1B2A4A] mb-1 truncate">
                  {r.invoice_numbers?.[0] ?? r.bl_numbers?.[0] ?? `Resolusi ${r.id.slice(0, 8)}`}
                </div>
                <div className="flex flex-wrap gap-0.5 mb-1">
                  {r.found_doc_types?.map((t: string) => docTypeBadge(t))}
                </div>
                {r.missing_doc_types?.length > 0 && (
                  <div className="text-[10px] text-yellow-600">Kurang: {r.missing_doc_types.join(', ')}</div>
                )}
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-[#97A0AF]">{r.document_count} dok</span>
                  {r.shipment_number && <span className="text-[10px] text-green-600 font-mono">{r.shipment_number}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          {detailLoading && (
            <div className="card flex-1 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-[#0EA5A4]" />
            </div>
          )}
          {!detailLoading && !selected && (
            <div className="card flex-1 flex flex-col items-center justify-center text-[#97A0AF]">
              <Network size={32} className="mb-3" />
              <p className="font-medium text-[#6B778C]">Pilih resolusi di kiri</p>
              <p className="text-sm mt-1">Klik resolusi untuk melihat detail</p>
            </div>
          )}
          {!detailLoading && selected && (
            <>
              {/* Header */}
              <div className="card p-4 flex-shrink-0">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      {statusBadge(selected.resolution.status)}
                      {selected.resolution.shipment_number && (
                        <span className="badge badge-green font-mono">{selected.resolution.shipment_number}</span>
                      )}
                      <span className="text-xs font-mono text-[#97A0AF]">{Math.round((selected.resolution.confidence_score ?? 0) * 100)}% konfiden</span>
                    </div>
                    <div className="text-base font-semibold text-[#1B2A4A] mb-1">
                      {selected.resolution.invoice_numbers?.[0] ?? selected.resolution.bl_numbers?.[0] ?? 'Resolusi'}
                    </div>
                    <div className="flex gap-3 text-xs text-[#6B778C]">
                      <span><strong>{selected.documents.length}</strong> dokumen</span>
                      <span><strong>{selected.fields.length}</strong> field terekstrak</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost text-xs" onClick={() => loadDetail(selected.resolution.id)}>
                      <RefreshCw size={12} /> Refresh
                    </button>
                    {selected.resolution.status === 'matched' && !selected.resolution.shipment_id && (
                      <button className="btn btn-primary text-xs" onClick={approve} disabled={approving}>
                        {approving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Approve → Shipment
                      </button>
                    )}
                  </div>
                </div>

                {/* Shared entities */}
                {selected.sharedEntities?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#DFE1E6]">
                    <div className="text-[10px] text-[#97A0AF] uppercase tracking-wider mb-2">Entitas Bersama (mengapa dokumen ini dikelompokkan)</div>
                    <div className="flex flex-wrap gap-2">
                      {selected.sharedEntities.map((e: any) => (
                        <div key={e.entity_type + e.canonical_value} className="bg-[#F4F5F7] border border-[#DFE1E6] rounded px-2 py-1 text-[11px]">
                          <span className="text-[#97A0AF]">{e.entity_type}: </span>
                          <span className="font-mono font-medium text-[#1B2A4A]">{e.display_value}</span>
                          <span className="text-[#97A0AF] ml-1">×{e.doc_count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.resolution.missing_doc_types?.length > 0 && (
                  <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 text-xs text-yellow-700">
                    <strong>Dokumen kurang:</strong> {selected.resolution.missing_doc_types.join(' · ')}
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="card flex-1 flex flex-col overflow-hidden">
                <div className="flex border-b border-[#DFE1E6] flex-shrink-0">
                  {([
                    { id: 'documents', label: 'Dokumen', icon: <FileText size={13} /> },
                    { id: 'fields', label: 'Fields Terekstrak', icon: <BarChart3 size={13} /> },
                    { id: 'evidence', label: 'Human Evidence', icon: <MessageSquare size={13} /> },
                  ] as const).map(t => (
                    <button
                      key={t.id}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === t.id ? 'border-[#0EA5A4] text-[#0EA5A4]' : 'border-transparent text-[#6B778C] hover:text-[#1B2A4A]'}`}
                      onClick={() => setTab(t.id)}
                    >
                      {t.icon}{t.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-auto">
                  {tab === 'documents' && (
                    <table className="data-table">
                      <thead><tr><th>Tipe</th><th>Nama File</th><th>Status</th><th>Peran</th><th>Halaman</th></tr></thead>
                      <tbody>
                        {selected.documents.map((doc: any) => (
                          <tr key={doc.id}>
                            <td>{doc.doc_type ? docTypeBadge(doc.doc_type) : '—'}</td>
                            <td>
                              <div className="font-medium text-xs max-w-xs truncate">{doc.file_name}</div>
                              <div className="text-[10px] text-[#97A0AF]">{doc.added_reason}</div>
                            </td>
                            <td>{(() => {
                              const map: Record<string, [string,string]> = {
                                linked: ['badge badge-green','Terhubung'], error: ['badge badge-red','Error'],
                                normalized: ['badge badge-blue','Diproses'],
                              };
                              const [cls, label] = map[doc.status] ?? ['badge badge-gray', doc.status];
                              return <span className={cls}>{label}</span>;
                            })()}</td>
                            <td className="text-xs text-[#6B778C]">{doc.doc_role?.replace(/_/g,' ') ?? '—'}</td>
                            <td className="text-xs text-[#97A0AF]">{doc.is_split_child ? `p.${doc.page_range_start + 1}–${doc.page_range_end + 1}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {tab === 'fields' && (
                    <table className="data-table">
                      <thead><tr><th>Field</th><th>Sumber</th><th>Nilai</th><th>Konfiden</th><th>Status</th></tr></thead>
                      <tbody>
                        {selected.fields.map((f: any, i: number) => {
                          let display = f.corrected_value ?? f.raw_value ?? '';
                          if (['items','hs_codes'].includes(f.field_key)) {
                            try { const a = JSON.parse(display); if (Array.isArray(a)) display = `${a.length} item`; } catch {}
                          }
                          return (
                            <tr key={i}>
                              <td>
                                <div className="text-xs font-medium">{f.display_name ?? f.field_key}</div>
                                <div className="text-[10px] font-mono text-[#97A0AF]">{f.field_key}</div>
                              </td>
                              <td>{f.doc_type ? docTypeBadge(f.doc_type) : '—'}</td>
                              <td className="max-w-[200px]">
                                <div className="text-xs truncate">{display || '—'}</div>
                                {f.corrected_value && <div className="text-[10px] text-yellow-500">Dikoreksi</div>}
                              </td>
                              <td className="w-28">
                                {f.confidence ? (
                                  <div className="flex items-center gap-1">
                                    <div className="flex-1 h-1 bg-[#F4F5F7] rounded-full overflow-hidden">
                                      <div className="h-full rounded-full" style={{
                                        width: `${Math.round(parseFloat(f.confidence)*100)}%`,
                                        background: parseFloat(f.confidence) >= 0.85 ? '#22C55E' : '#F59E0B',
                                      }} />
                                    </div>
                                    <span className="text-[10px] font-mono text-[#97A0AF]">{Math.round(parseFloat(f.confidence)*100)}%</span>
                                  </div>
                                ) : '—'}
                              </td>
                              <td>
                                {(() => {
                                  const map: Record<string, [string,string]> = {
                                    auto_approved: ['badge badge-green','Auto'], review_required: ['badge badge-yellow','Review'],
                                    user_verified: ['badge badge-blue','Verified'],
                                  };
                                  const [cls, label] = map[f.status] ?? ['badge badge-gray', f.status];
                                  return <span className={cls}>{label}</span>;
                                })()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {tab === 'evidence' && (
                    <div className="p-4 space-y-4">
                      <div className="bg-[#F4F5F7] rounded-lg p-4 text-xs text-[#6B778C]">
                        <strong className="text-[#1B2A4A]">ADR-009:</strong> Anda tidak mengedit graph secara langsung. 
                        Kirim fakta sebagai evidence — Resolution Engine yang akan menghitung ulang otomatis.
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-[#6B778C] uppercase tracking-wider block mb-2">Tipe Evidence</label>
                        <select className="input w-full" value={evidenceType} onChange={e => setEvidenceType(e.target.value)}>
                          <option value="DOCUMENT_BELONGS_HERE">Dokumen ini memang ada di resolusi ini</option>
                          <option value="DOCUMENT_DOES_NOT_BELONG">Dokumen ini salah masuk</option>
                          <option value="FIELD_VALUE_INCORRECT">Nilai field salah diekstrak</option>
                          <option value="DOCUMENTS_ARE_RELATED">Dokumen-dokumen ini saling terkait</option>
                          <option value="DOCUMENTS_ARE_NOT_RELATED">Dokumen-dokumen ini tidak terkait</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-[#6B778C] uppercase tracking-wider block mb-2">Payload (JSON)</label>
                        <textarea
                          className="input font-mono text-xs h-32 resize-none"
                          value={evidencePayload}
                          onChange={e => setEvidencePayload(e.target.value)}
                          placeholder='{"document_id": "...", "field_key": "...", "correct_value": "..."}'
                        />
                      </div>
                      <button className="btn btn-primary" onClick={submitEvidence} disabled={submitting}>
                        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Kirim Evidence
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

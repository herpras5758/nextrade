import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Eye, FileText, Loader2, Inbox, Search, X } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useTenant } from '../../store/tenantContext';

function fmtDate(s: string) {
  return new Date(s).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(status: string) {
  const map: Record<string, [string,string]> = {
    uploaded: ['badge badge-gray','Uploaded'], classifying: ['badge badge-blue','Klasifikasi'],
    classified: ['badge badge-blue','Diklasifikasi'], extracting: ['badge badge-blue','Ekstraksi'],
    extracted: ['badge badge-blue','Diekstrak'], normalizing: ['badge badge-blue','Normalisasi'],
    normalized: ['badge badge-blue','Dinormalisasi'], linked: ['badge badge-green','Terhubung'],
    split: ['badge badge-gray','Dipecah'], error: ['badge badge-red','Error'],
    archived: ['badge badge-gray','Diarsip'],
  };
  const [cls, label] = map[status] ?? ['badge badge-gray', status];
  return <span className={cls}>{label}</span>;
}

function docTypeBadge(type: string) {
  const colors: Record<string, string> = {
    COMMERCIAL_INVOICE: '#3D7EFF', PACKING_LIST: '#22C55E', PURCHASE_ORDER: '#F59E0B',
    BILL_OF_LADING: '#A855F7', BC_1_1: '#EC4899', BC_2_3: '#EF4444',
    SURAT_JALAN: '#14B8A6', MULTI_DOCUMENT: '#6B7280',
  };
  const short: Record<string, string> = {
    COMMERCIAL_INVOICE: 'CI', PACKING_LIST: 'PL', PURCHASE_ORDER: 'PO',
    BILL_OF_LADING: 'B/L', BC_1_1: 'BC1.1', BC_2_3: 'BC2.3', SURAT_JALAN: 'SJ', MULTI_DOCUMENT: 'MULTI',
  };
  const color = colors[type] ?? '#6B7280';
  return (
    <span style={{ background: `${color}22`, color, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
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
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono text-[#6B778C] w-8 text-right">{pct}%</span>
    </div>
  );
}

export function DocumentsPage() {
  const { currentTenant } = useTenant();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [docFields, setDocFields] = useState<any[]>([]);

  const load = useCallback(() => {
    if (!currentTenant) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('doc_type', typeFilter);
    apiClient.get(`/tenants/${currentTenant.id}/documents?${params}`)
      .then(r => setDocs(r.data.documents ?? []))
      .finally(() => setLoading(false));
  }, [currentTenant, statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (doc: any) => {
    setSelectedDoc(doc);
    if (!currentTenant) return;
    const { data } = await apiClient.get(`/tenants/${currentTenant.id}/documents/${doc.id}/fields`);
    setDocFields(data.fields ?? []);
  };

  const filtered = docs.filter(d => !search || d.file_name.toLowerCase().includes(search.toLowerCase()));
  const docTypes = [...new Set(docs.map(d => d.doc_type).filter(Boolean))];

  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Document Registry</h1>
        <p className="page-subtitle">Semua dokumen — sumber kebenaran tunggal</p>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#97A0AF]" />
          <input className="input pl-8 w-56" placeholder="Cari nama file..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          {['uploaded','classifying','extracted','normalized','linked','split','error'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input w-48" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Semua Tipe Dok</option>
          {docTypes.map(t => <option key={t} value={t}>{(t as string).replace(/_/g,' ')}</option>)}
        </select>
        <button className="btn btn-ghost" onClick={load}><RefreshCw size={13} /></button>
        <span className="ml-auto text-xs text-[#97A0AF] self-center">{filtered.length} dokumen</span>
      </div>
      <div className="flex gap-4">
        <div className="card flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center p-12"><Loader2 size={20} className="animate-spin text-[#0EA5A4]" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-[#97A0AF]">
              <Inbox size={32} className="mb-3" />
              <p className="font-medium text-[#6B778C]">Belum ada dokumen</p>
            </div>
          ) : (
            <table className="data-table">
              <thead><tr><th>Tipe</th><th>Nama File</th><th>Status</th><th>Resolusi</th><th>Konfiden</th><th>Upload</th><th></th></tr></thead>
              <tbody>
                {filtered.map(doc => (
                  <tr key={doc.id} className={selectedDoc?.id === doc.id ? 'bg-[#E6FCFF]' : ''}>
                    <td>{doc.doc_type ? docTypeBadge(doc.doc_type) : <span className="text-[#97A0AF]">—</span>}</td>
                    <td>
                      <div className="max-w-xs">
                        <div className="font-medium text-xs truncate text-[#1B2A4A]">{doc.file_name}</div>
                        {doc.is_split_child && <div className="text-[10px] text-[#97A0AF]">Hlm {doc.page_range_start + 1}–{doc.page_range_end + 1}</div>}
                        {doc.child_count > 0 && <div className="text-[10px] text-[#0EA5A4]">{doc.child_count} segmen</div>}
                      </div>
                    </td>
                    <td>{statusBadge(doc.status)}</td>
                    <td>{doc.resolution_id ? <span className="badge badge-blue">{doc.resolution_status}</span> : <span className="text-[#97A0AF] text-xs">—</span>}</td>
                    <td className="w-32">{doc.doc_type_confidence ? <ConfBar value={parseFloat(doc.doc_type_confidence)} /> : <span className="text-[#97A0AF] text-xs">—</span>}</td>
                    <td className="text-xs text-[#97A0AF] whitespace-nowrap">{fmtDate(doc.uploaded_at)}</td>
                    <td><button className="btn btn-ghost p-1.5" onClick={() => openDetail(doc)}><Eye size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {selectedDoc && (
          <div className="w-80 flex-shrink-0 space-y-3">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2"><FileText size={14} className="text-[#0EA5A4]" /><span className="font-semibold text-sm">Detail Dokumen</span></div>
                <button onClick={() => setSelectedDoc(null)}><X size={14} className="text-[#97A0AF]" /></button>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-[#6B778C]">Nama file</span><span className="font-medium text-right max-w-[180px] truncate">{selectedDoc.file_name}</span></div>
                <div className="flex justify-between"><span className="text-[#6B778C]">Tipe</span><span>{selectedDoc.doc_type ? docTypeBadge(selectedDoc.doc_type) : '—'}</span></div>
                <div className="flex justify-between"><span className="text-[#6B778C]">Status</span><span>{statusBadge(selectedDoc.status)}</span></div>
                {selectedDoc.error_message && <div className="bg-red-50 border border-red-200 rounded p-2 text-red-600 text-[10px]">{selectedDoc.error_message}</div>}
              </div>
            </div>
            {docFields.length > 0 && (
              <div className="card overflow-auto max-h-[calc(100vh-360px)]">
                <div className="p-3 border-b border-[#DFE1E6]"><span className="font-semibold text-xs">Fields ({docFields.length})</span></div>
                <div className="divide-y divide-[#F4F5F7]">
                  {docFields.map(f => {
                    let display = f.corrected_value ?? f.raw_value ?? '';
                    if (['items','hs_codes'].includes(f.field_key)) {
                      try { const a = JSON.parse(display); if (Array.isArray(a)) display = `${a.length} item`; } catch {}
                    }
                    return (
                      <div key={f.field_key} className="p-2.5">
                        <div className="flex justify-between mb-0.5">
                          <span className="text-[10px] font-semibold text-[#6B778C] uppercase">{f.display_name ?? f.field_key}</span>
                          {f.is_mandatory_ceisa && <span className="badge badge-red text-[9px]">CEISA</span>}
                        </div>
                        <div className="text-xs text-[#1B2A4A] truncate mb-1">{display || <span className="text-[#97A0AF]">—</span>}</div>
                        <ConfBar value={parseFloat(f.confidence ?? 0)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

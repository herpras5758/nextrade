import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, Loader2, Eye, Inbox, FileCheck } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useTenant } from '../../store/tenantContext';

function fmtDate(s: string) {
  return new Date(s).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(status: string) {
  const map: Record<string, [string,string]> = {
    verified: ['badge badge-green','Terverifikasi'],
    ready_ceisa: ['badge badge-blue','Siap CEISA'],
    submitted: ['badge badge-blue','Dikirim'],
    sppb: ['badge badge-green','SPPB'],
    closed: ['badge badge-gray','Selesai'],
  };
  const [cls, label] = map[status] ?? ['badge badge-gray', status];
  return <span className={cls}>{label}</span>;
}

function docTypeBadge(type: string) {
  const colors: Record<string, string> = {
    COMMERCIAL_INVOICE: '#3D7EFF', PACKING_LIST: '#22C55E', PURCHASE_ORDER: '#F59E0B',
    BILL_OF_LADING: '#A855F7', BC_1_1: '#EC4899',
  };
  const color = colors[type] ?? '#6B7280';
  const short = type.replace('COMMERCIAL_INVOICE','CI').replace('PACKING_LIST','PL')
    .replace('PURCHASE_ORDER','PO').replace('BILL_OF_LADING','B/L');
  return <span key={type} style={{ background: `${color}22`, color, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, marginRight: 3 }}>{short}</span>;
}

export function ShipmentsPage() {
  const { currentTenant } = useTenant();
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [readiness, setReadiness] = useState<any>(null);
  const [tab, setTab] = useState<'overview'|'fields'|'ceisa'>('overview');

  const load = useCallback(() => {
    if (!currentTenant) return;
    setLoading(true);
    apiClient.get(`/tenants/${currentTenant.id}/shipments?limit=50`)
      .then(r => setShipments(r.data.shipments ?? []))
      .finally(() => setLoading(false));
  }, [currentTenant]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (shipId: string) => {
    if (!currentTenant) return;
    setDetailLoading(true);
    try {
      const [detail, ready] = await Promise.all([
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipId}`),
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${shipId}/ceisa-readiness`),
      ]);
      setSelected(detail.data);
      setReadiness(ready.data);
      setTab('overview');
    } finally { setDetailLoading(false); }
  };

  const checkIcon = (status: string) => {
    if (status === 'PASS') return <span className="text-green-500 font-bold">✓</span>;
    if (status === 'WARN') return <span className="text-yellow-500 font-bold">⚠</span>;
    return <span className="text-red-400 font-bold">✗</span>;
  };

  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Shipments</h1>
        <p className="page-subtitle">Shipment yang sudah diverifikasi dan siap ke CEISA</p>
      </div>

      <div className="flex gap-4 h-[calc(100vh-200px)]">
        {/* List */}
        <div className="card w-72 flex-shrink-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-[#DFE1E6]">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-[#0EA5A4]" />
              <span className="font-semibold text-sm">Shipments</span>
              <span className="badge badge-gray">{shipments.length}</span>
            </div>
            <button className="btn btn-ghost p-1.5" onClick={load}><RefreshCw size={12} /></button>
          </div>
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 size={16} className="animate-spin text-[#0EA5A4]" /></div>
            ) : shipments.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-[#97A0AF]">
                <Inbox size={24} className="mb-2" />
                <p className="text-sm">Belum ada shipment</p>
                <p className="text-xs mt-1">Approve resolusi untuk membuat shipment</p>
              </div>
            ) : shipments.map(s => (
              <div
                key={s.id}
                className={`p-3 border-b border-[#F4F5F7] cursor-pointer hover:bg-[#F4F5F7] ${selected?.shipment?.id === s.id ? 'bg-[#E6FCFF]' : ''}`}
                onClick={() => loadDetail(s.id)}
              >
                <div className="flex justify-between mb-1">
                  {statusBadge(s.status)}
                  <span className="text-[10px] font-mono text-[#97A0AF]">{Math.round((s.confidence_score ?? 0)*100)}%</span>
                </div>
                <div className="text-xs font-semibold text-[#1B2A4A] font-mono mb-1">{s.shipment_number}</div>
                <div className="flex flex-wrap">{s.found_doc_types?.slice(0,4).map(docTypeBadge)}</div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-[#97A0AF]">{s.document_count} dok</span>
                  <span className="text-[10px] text-[#97A0AF]">{fmtDate(s.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          {detailLoading && <div className="card flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-[#0EA5A4]" /></div>}
          {!detailLoading && !selected && (
            <div className="card flex-1 flex flex-col items-center justify-center text-[#97A0AF]">
              <Package size={32} className="mb-3" />
              <p className="font-medium text-[#6B778C]">Pilih shipment di kiri</p>
            </div>
          )}
          {!detailLoading && selected && (
            <>
              <div className="card p-4 flex-shrink-0">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      {statusBadge(selected.shipment.status)}
                      <span className="text-sm font-bold font-mono text-[#1B2A4A]">{selected.shipment.shipment_number}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-[#6B778C]">
                      <span><strong>{selected.documents?.length ?? 0}</strong> dokumen</span>
                      <span><strong>{readiness?.score ?? 0}%</strong> CEISA readiness</span>
                      <span className="font-medium" style={{ color: readiness?.overall === 'READY' ? '#22C55E' : readiness?.overall === 'NEARLY_READY' ? '#F59E0B' : '#EF4444' }}>
                        {readiness?.overall?.replace(/_/g,' ')}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost text-xs" onClick={() => loadDetail(selected.shipment.id)}><RefreshCw size={12} /></button>
                    {selected.shipment.status === 'verified' && (
                      <button className="btn btn-primary text-xs" onClick={async () => {
                        if (!currentTenant) return;
                        await apiClient.patch(`/tenants/${currentTenant.id}/shipments/${selected.shipment.id}/status`, { status: 'ready_ceisa' });
                        await loadDetail(selected.shipment.id); load();
                      }}>
                        <FileCheck size={12} /> Siap CEISA
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="card flex-1 flex flex-col overflow-hidden">
                <div className="flex border-b border-[#DFE1E6] flex-shrink-0">
                  {[
                    { id: 'overview', label: 'Readiness' },
                    { id: 'fields', label: 'Fields' },
                    { id: 'ceisa', label: 'Draft BC 2.3' },
                  ].map(t => (
                    <button key={t.id}
                      className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === t.id as any ? 'border-[#0EA5A4] text-[#0EA5A4]' : 'border-transparent text-[#6B778C] hover:text-[#1B2A4A]'}`}
                      onClick={() => setTab(t.id as any)}
                    >{t.label}</button>
                  ))}
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {tab === 'overview' && readiness && (
                    <div className="space-y-2">
                      {readiness.checkpoints?.map((cp: any) => (
                        <div key={cp.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
                          cp.status === 'PASS' ? 'bg-green-50 border-green-200' :
                          cp.status === 'WARN' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'
                        }`}>
                          <div className="text-lg flex-shrink-0">{checkIcon(cp.status)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[#1B2A4A]">{cp.name}</div>
                            <div className="text-xs text-[#6B778C] mt-0.5">{cp.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === 'fields' && (
                    <table className="data-table">
                      <thead><tr><th>Field</th><th>Nilai Efektif</th><th>Sumber</th><th>Konfiden</th></tr></thead>
                      <tbody>
                        {selected.fields?.map((f: any, i: number) => (
                          <tr key={i}>
                            <td>
                              <div className="text-xs font-medium">{f.display_name ?? f.field_key}</div>
                              {f.is_mandatory_ceisa && <span className="badge badge-red text-[9px]">CEISA</span>}
                            </td>
                            <td className="text-xs max-w-[180px] truncate">{f.effective_value || '—'}</td>
                            <td className="text-[10px] text-[#97A0AF]">{f.doc_type?.replace(/_/g,' ')}</td>
                            <td>{f.confidence ? `${Math.round(parseFloat(f.confidence)*100)}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {tab === 'ceisa' && (
                    <CeisaDraft tenantId={currentTenant?.id!} shipId={selected.shipment.id} />
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

function CeisaDraft({ tenantId, shipId }: { tenantId: string; shipId: string }) {
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/tenants/${tenantId}/shipments/${shipId}/ceisa-draft`);
      setDraft(data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [shipId]);

  if (loading) return <div className="flex items-center justify-center p-12"><Loader2 size={16} className="animate-spin text-[#0EA5A4]" /></div>;
  if (!draft) return null;

  const { bc23, missingFields } = draft;

  return (
    <div>
      {missingFields?.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-xs text-yellow-700">
          <strong>Field belum terisi:</strong> {missingFields.join(', ')}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(bc23 ?? {}).filter(([k]) => !k.startsWith('_')).map(([key, val]) => (
          <div key={key} className="bg-[#F4F5F7] rounded p-2.5">
            <div className="text-[10px] text-[#97A0AF] uppercase tracking-wider mb-0.5">{key.replace(/_/g,' ')}</div>
            <div className={`text-xs font-medium ${val ? 'text-[#1B2A4A]' : 'text-[#DFE1E6]'}`}>
              {(val as string) || '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

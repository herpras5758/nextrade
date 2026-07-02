import { useState, useEffect } from 'react';
import { FileText, Network, Package, Upload, RefreshCw, Loader2, TrendingUp, AlertCircle } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useTenant } from '../../store/tenantContext';
import { useNavigate } from 'react-router-dom';

export function DashboardPage() {
  const { currentTenant } = useTenant();
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    if (!currentTenant) return;
    setLoading(true);
    apiClient.get(`/tenants/${currentTenant.id}/admin/summary`)
      .then(r => setSummary(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [currentTenant?.id]);

  if (!currentTenant) {
    return (
      <div className="page-container">
        <div className="card p-8 flex items-center gap-3 text-[#6B778C]">
          <AlertCircle size={18} />
          <span>Pilih Business Unit dari topbar untuk memulai</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 size={20} className="animate-spin text-[#0EA5A4]" /></div>;
  }

  const d = summary?.documents ?? {};
  const r = summary?.resolutions ?? {};
  const s = summary?.shipments ?? {};

  const stats = [
    { label: 'Total Dokumen', value: d.total ?? 0, sub: `${d.processing ?? 0} diproses`, icon: <FileText size={18} />, color: '#3D7EFF', action: () => navigate('/documents') },
    { label: 'Resolusi Aktif', value: (r.byStatus?.candidate ?? 0) + (r.byStatus?.partial ?? 0) + (r.byStatus?.matched ?? 0), sub: `${r.byStatus?.matched ?? 0} siap approve`, icon: <Network size={18} />, color: '#F59E0B', action: () => navigate('/resolutions') },
    { label: 'Shipments', value: s.total ?? 0, sub: `${s.byStatus?.ready_ceisa ?? 0} siap CEISA`, icon: <Package size={18} />, color: '#22C55E', action: () => navigate('/shipments') },
    { label: 'Upload Sekarang', value: '+', sub: 'Drag & drop dokumen', icon: <Upload size={18} />, color: '#0EA5A4', action: () => navigate('/upload') },
  ];

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{currentTenant.name} — Ship-X Intelligence Platform</p>
        </div>
        <button className="btn btn-ghost" onClick={load}><RefreshCw size={14} /></button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="card p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4"
            style={{ borderLeftColor: stat.color }}
            onClick={stat.action}
          >
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: stat.color }}>{stat.icon}</span>
              <TrendingUp size={12} className="text-[#97A0AF]" />
            </div>
            <div className="text-2xl font-bold text-[#1B2A4A] font-mono mb-0.5">{stat.value}</div>
            <div className="text-xs font-semibold text-[#1B2A4A]">{stat.label}</div>
            <div className="text-[11px] text-[#97A0AF] mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Doc status */}
        <div className="card">
          <div className="flex items-center gap-2 p-4 border-b border-[#DFE1E6]">
            <FileText size={14} className="text-[#0EA5A4]" />
            <span className="font-semibold text-sm text-[#1B2A4A]">Status Dokumen</span>
          </div>
          <div className="p-4 space-y-2">
            {Object.entries(d.byStatus ?? {}).map(([status, count]: any) => {
              const labels: Record<string, string> = {
                uploaded: 'Uploaded', classifying: 'Diklasifikasi', extracted: 'Diekstrak',
                normalized: 'Dinormalisasi', linked: 'Terhubung', error: 'Error', split: 'Dipecah',
              };
              const colors: Record<string, string> = {
                linked: '#22C55E', error: '#EF4444', extracted: '#3D7EFF',
                classifying: '#F59E0B', normalized: '#A855F7',
              };
              return (
                <div key={status} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colors[status] ?? '#97A0AF' }} />
                  <span className="text-xs text-[#6B778C] flex-1">{labels[status] ?? status}</span>
                  <span className="text-xs font-mono font-semibold text-[#1B2A4A]">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent docs */}
        <div className="card">
          <div className="flex items-center gap-2 p-4 border-b border-[#DFE1E6]">
            <Network size={14} className="text-[#0EA5A4]" />
            <span className="font-semibold text-sm text-[#1B2A4A]">Dokumen Terbaru</span>
          </div>
          <div className="divide-y divide-[#F4F5F7]">
            {summary?.recentDocuments?.slice(0, 8).map((doc: any) => {
              const colors: Record<string, string> = {
                COMMERCIAL_INVOICE: '#3D7EFF', PACKING_LIST: '#22C55E', BILL_OF_LADING: '#A855F7',
                PURCHASE_ORDER: '#F59E0B', BC_1_1: '#EC4899',
              };
              const short: Record<string, string> = {
                COMMERCIAL_INVOICE: 'CI', PACKING_LIST: 'PL', BILL_OF_LADING: 'B/L',
                PURCHASE_ORDER: 'PO', BC_1_1: 'BC1.1', BC_2_3: 'BC2.3',
              };
              const color = colors[doc.doc_type] ?? '#97A0AF';
              return (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div style={{ background: `${color}22`, color }} className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">
                    {short[doc.doc_type] ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate text-[#1B2A4A]">{doc.file_name}</div>
                  </div>
                  <div className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    doc.status === 'linked' ? 'bg-green-100 text-green-700' :
                    doc.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                  }`}>{doc.status}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { FileText, Sparkles, Download, BarChart2, RefreshCw } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";

export function ReportBuilderPage() {
  const { currentTenant } = useTenant();
  const [tab, setTab]           = useState<'standard' | 'ai'>('standard');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');
  const [allBu, setAllBu]       = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<any>(null);
  const [narrative, setNarrative] = useState('');

  async function generateStandard() {
    if (!currentTenant) return;
    setLoading(true); setResult(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (allBu) params.set('all_bu', 'true');
      const { data } = await apiClient.get(`/tenants/${currentTenant.id}/reports/summary?${params}`);
      setResult(data);
    } finally { setLoading(false); }
  }

  async function generateAI() {
    if (!currentTenant || !aiPrompt) return;
    setLoading(true); setNarrative('');
    try {
      const { data } = await apiClient.post(`/tenants/${currentTenant.id}/reports/ai-narrative`, {
        prompt: aiPrompt, from, to, all_bu: allBu,
      });
      setNarrative(data.narrative);
    } finally { setLoading(false); }
  }

  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Report Builder</h1>
        <p className="page-subtitle">Standard reports and AI narrative based on actual system data</p>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-header"><span className="section-title">Report Parameters</span></div>
        <div className="p-4">
          <div className="grid grid-cols-4 gap-4 items-end">
            <div>
              <label className="input-label">From Date</label>
              <input type="date" className="input text-xs" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="input-label">To Date</label>
              <input type="date" className="input text-xs" value={to} onChange={e => setTo(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <input type="checkbox" id="all-bu" checked={allBu} onChange={e => setAllBu(e.target.checked)} />
              <label htmlFor="all-bu" className="text-xs text-[#1B2A4A]">All Business Units</label>
            </div>
            <div></div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar rounded-t border border-[#DFE1E6] -mb-px">
        <button onClick={() => setTab('standard')}
          className={`tab-item flex items-center gap-1.5 ${tab === 'standard' ? 'tab-item-active' : 'tab-item-inactive'}`}>
          <BarChart2 size={13} /> Standard Report
        </button>
        <button onClick={() => setTab('ai')}
          className={`tab-item flex items-center gap-1.5 ${tab === 'ai' ? 'tab-item-active' : 'tab-item-inactive'}`}>
          <Sparkles size={13} /> AI Narrative
        </button>
      </div>

      <div className="card rounded-t-none p-4">
        {tab === 'standard' && (
          <>
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-[#6B778C]">Operational summary: total shipments, documents, extraction quality, status breakdown.</p>
              <div className="flex gap-2">
                <button onClick={generateStandard} disabled={loading} className="btn-primary gap-1 disabled:opacity-50">
                  {loading ? <RefreshCw size={13} className="animate-spin" /> : <BarChart2 size={13} />}
                  Generate
                </button>
                {result && <button className="btn-secondary gap-1"><Download size={13} /> Export Excel</button>}
              </div>
            </div>

            {result && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total Shipments', value: result.shipments.total },
                    { label: 'Submitted', value: result.shipments.submitted },
                    { label: 'Ready for CEISA', value: result.shipments.ready_for_ceisa },
                    { label: 'Avg Readiness', value: `${result.shipments.avg_readiness}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded border border-[#DFE1E6] bg-[#F4F5F7] p-3">
                      <p className="kpi-label">{label}</p>
                      <p className="font-mono text-xl font-bold text-[#1B2A4A] mt-1">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="section-title mb-2">Shipment per Status</p>
                    <table className="table-enterprise">
                      <thead><tr><th>Status</th><th>Jumlah</th></tr></thead>
                      <tbody>
                        {Object.entries(result.shipments.by_status).map(([s, c]) => (
                          <tr key={s}><td>{s}</td><td className="font-mono">{c as number}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <p className="section-title mb-2">Document Type</p>
                    <table className="table-enterprise">
                      <thead><tr><th>Tipe</th><th>Jumlah</th></tr></thead>
                      <tbody>
                        {Object.entries(result.documents.by_type).map(([t, c]) => (
                          <tr key={t}><td>{t || 'Unknown'}</td><td className="font-mono">{c as number}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'ai' && (
          <>
            <div className="mb-4">
              <label className="input-label">Deskripsikan laporan yang Anda butuhkan</label>
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="Contoh: Buatkan laporan Q2 2026 untuk semua shipment Wilson Garment, termasuk analisis risiko dan rekomendasi untuk shipment yang berpotensi ditolak CEISA."
                className="input text-xs h-24 resize-none"
              />
              <p className="text-[11px] text-[#6B778C] mt-1">AI akan generate narasi profesional berdasarkan data aktual sistem.</p>
            </div>

            <div className="flex justify-end mb-4">
              <button onClick={generateAI} disabled={loading || !aiPrompt} className="btn-ai gap-1 disabled:opacity-50">
                {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Generate AI Report
              </button>
            </div>

            {narrative && (
              <div className="rounded border border-[#DFE1E6] bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={13} className="text-[#0EA5A4]" />
                    <span className="text-xs font-semibold text-[#0EA5A4]">AI Generated Report</span>
                  </div>
                  <button className="btn-secondary gap-1 text-xs"><Download size={12} /> Export PDF</button>
                </div>
                <div className="text-sm text-[#1B2A4A] leading-relaxed whitespace-pre-wrap font-sans">
                  {narrative}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

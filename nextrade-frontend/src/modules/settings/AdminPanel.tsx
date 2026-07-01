import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTenant } from "../../store/tenantContext";
import { useAuth } from "../../lib/AuthContext";
import { apiClient } from "../../lib/apiClient";
import {
  Cpu, Scale, FileCheck, Plug, BookOpen, Users, ChevronRight,
  Save, RotateCcw, Check, AlertTriangle, Info
} from "lucide-react";

// Sections
type Section = "ai" | "signals" | "validation" | "erp" | "learning" | "bc-access" | "ceisa";

const NAV_ITEMS: { id: Section; label: string; icon: typeof Cpu; description: string }[] = [
  { id: "ai",         label: "AI Engine",            icon: Cpu,       description: "Model, threshold confidence, mode CEISA" },
  { id: "ceisa",      label: "CEISA Config",          icon: FileCheck, description: "Mode mock/live, endpoint, API key" },
  { id: "signals",    label: "Identity Signals",      icon: Scale,     description: "Bobot sinyal, confidence tier, normalizer" },
  { id: "validation", label: "Validation Rules",      icon: FileCheck, description: "Aturan bisnis per field, per BC type" },
  { id: "erp",        label: "ERP Integration",       icon: Plug,      description: "SAP/Oracle/Dynamics field mapping" },
  { id: "learning",   label: "Learning Engine",       icon: BookOpen,  description: "Review koreksi operator" },
  { id: "bc-access",  label: "BC Type Access",        icon: Users,     description: "Aktifkan/nonaktifkan tipe BC per tenant" },
];

const BC_TYPES = [
  { code: "BC_2_0",   label: "BC 2.0 — PIB (Impor Umum)" },
  { code: "BC_2_3",   label: "BC 2.3 — Impor ke TPB" },
  { code: "BC_2_5",   label: "BC 2.5 — Keluar dari TPB" },
  { code: "BC_2_6_1", label: "BC 2.6.1 — Subcontract OUT" },
  { code: "BC_2_6_2", label: "BC 2.6.2 — Subcontract IN" },
  { code: "BC_3_0",   label: "BC 3.0 / PEB — Ekspor" },
  { code: "BC_4_0",   label: "BC 4.0 — TLDDP ke TPB" },
  { code: "BC_4_1",   label: "BC 4.1 — TPB ke TLDDP" },
];

const SIGNAL_TYPES = [
  "PO_NUMBER", "BL_NUMBER", "INVOICE_NUMBER", "CONTAINER_NUMBER",
  "SUPPLIER_NAME", "CONSIGNEE_NAME", "VALUE_RANGE", "HS_CODE", "ETA",
];

function SaveBar({ onSave, saving, saved }: { onSave: () => void; saving: boolean; saved: boolean }) {
  return (
    <div className="sticky bottom-0 flex items-center gap-3 border-t border-surface-border bg-white px-4 py-3 shadow-card">
      <span className="text-xs text-surface-muted flex-1">
        {saved ? "Perubahan tersimpan" : "Ada perubahan yang belum disimpan"}
      </span>
      <button onClick={onSave} disabled={saving || saved} className="btn-primary gap-1 disabled:opacity-50">
        {saving ? <RotateCcw size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
        {saving ? "Menyimpan..." : saved ? "Tersimpan" : "Simpan Perubahan"}
      </button>
    </div>
  );
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="card mb-4">
      <div className="card-header">
        <div>
          <p className="section-title">{title}</p>
          {description && <p className="text-2xs text-surface-muted mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function AdminPanel() {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const { claims } = useAuth();
  const [section, setSection] = useState<Section>("ai");
  const isAdmin = claims?.["cognito:groups"]?.includes("admin");

  if (!isAdmin) {
    return (
      <div className="page-container flex flex-col items-center justify-center py-20">
        <AlertTriangle size={32} className="text-warning-600 mb-3" />
        <p className="section-title mb-1">Akses dibatasi</p>
        <p className="text-sm text-surface-muted">Halaman ini hanya untuk Admin.</p>
      </div>
    );
  }

  return (
    <div className="page-container max-w-none">
      <div className="mb-5">
        <h1 className="page-title">Pengaturan & Konfigurasi</h1>
        <p className="page-subtitle">Semua business rule, threshold, dan integrasi — tanpa redeploy</p>
      </div>

      <div className="flex gap-5">
        {/* Sidebar nav */}
        <aside className="w-56 flex-shrink-0">
          <div className="card overflow-hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => setSection(item.id)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left border-b border-surface-border last:border-0 transition-colors ${
                    section === item.id ? "bg-intel-50 text-intel-500" : "hover:bg-surface-page text-surface-text"
                  }`}>
                  <Icon size={14} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.label}</p>
                    <p className="text-2xs text-surface-muted truncate">{item.description}</p>
                  </div>
                  {section === item.id && <ChevronRight size={12} className="text-intel-500 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {section === "ai"         && <AiSection tenantId={currentTenant?.id ?? ""} />}
          {section === "ceisa"      && <CeisaSection tenantId={currentTenant?.id ?? ""} />}
          {section === "signals"    && <SignalWeightsSection tenantId={currentTenant?.id ?? ""} />}
          {section === "validation" && <ValidationRulesSection tenantId={currentTenant?.id ?? ""} />}
          {section === "erp"        && <ErpSection tenantId={currentTenant?.id ?? ""} />}
          {section === "learning"   && <LearningSection tenantId={currentTenant?.id ?? ""} />}
          {section === "bc-access"  && <BcAccessSection tenantId={currentTenant?.id ?? ""} />}
        </div>
      </div>
    </div>
  );
}

// ─── AI Section ────────────────────────────────────────────────────────────────
function AiSection({ tenantId }: { tenantId: string }) {
  const [cfg, setCfg] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    apiClient.get(`/tenants/${tenantId}/admin/ai-config`).then(r => setCfg(r.data));
  }, [tenantId]);

  async function save() {
    setSaving(true);
    try {
      await apiClient.put(`/tenants/${tenantId}/admin/ai-config`, cfg);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  if (!cfg) return <p className="text-sm text-surface-muted">Memuat...</p>;

  return (
    <>
      <SectionCard title="Bedrock AI Model" description="Model yang digunakan untuk klasifikasi dan ekstraksi dokumen">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="input-label">Model ID</label>
            <select className="input text-xs" value={cfg.bedrock_model_id}
              onChange={e => { setCfg({ ...cfg, bedrock_model_id: e.target.value }); setSaved(false); }}>
              <option value="anthropic.claude-3-5-sonnet-20241022-v2:0">Claude 3.5 Sonnet v2 (Recommended)</option>
              <option value="anthropic.claude-3-5-haiku-20241022-v1:0">Claude 3.5 Haiku (Faster, cheaper)</option>
              <option value="anthropic.claude-3-opus-20240229-v1:0">Claude 3 Opus (Most capable)</option>
            </select>
          </div>
          <div>
            <label className="input-label">Max Tokens</label>
            <input type="number" className="input text-xs" value={cfg.max_tokens}
              onChange={e => { setCfg({ ...cfg, max_tokens: parseInt(e.target.value) }); setSaved(false); }} />
          </div>
          <div>
            <label className="input-label">Temperature</label>
            <input type="number" step="0.1" min="0" max="1" className="input text-xs" value={cfg.temperature}
              onChange={e => { setCfg({ ...cfg, temperature: parseFloat(e.target.value) }); setSaved(false); }} />
            <p className="text-2xs text-surface-muted mt-0.5">0 = deterministic, 1 = creative. Recommended: 0.1</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Confidence Thresholds" description="Addendum E — threshold yang menentukan apakah field auto-approved atau perlu review">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="input-label">Auto Approved (≥)</label>
            <input type="number" step="0.01" min="0" max="1" className="input text-xs"
              value={cfg.threshold_auto_approved}
              onChange={e => { setCfg({ ...cfg, threshold_auto_approved: parseFloat(e.target.value) }); setSaved(false); }} />
            <p className="text-2xs text-success-600 mt-0.5">Field dengan confidence ≥ nilai ini langsung disetujui</p>
          </div>
          <div>
            <label className="input-label">Recommended (≥)</label>
            <input type="number" step="0.01" min="0" max="1" className="input text-xs"
              value={cfg.threshold_recommended}
              onChange={e => { setCfg({ ...cfg, threshold_recommended: parseFloat(e.target.value) }); setSaved(false); }} />
            <p className="text-2xs text-warning-600 mt-0.5">Di antara recommended dan auto = perlu review ringan</p>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded border border-surface-border bg-surface-page p-3">
          <Info size={13} className="text-surface-muted flex-shrink-0 mt-0.5" />
          <p className="text-2xs text-surface-muted">
            Di bawah Recommended → REVIEW_REQUIRED. Ini memengaruhi CEISA Readiness Score dan Review Queue.
          </p>
        </div>
      </SectionCard>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </>
  );
}

// ─── CEISA Section ─────────────────────────────────────────────────────────────
function CeisaSection({ tenantId }: { tenantId: string }) {
  const [cfg, setCfg] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    apiClient.get(`/tenants/${tenantId}/admin/ai-config`).then(r => setCfg(r.data));
  }, [tenantId]);

  async function save() {
    setSaving(true);
    try {
      await apiClient.put(`/tenants/${tenantId}/admin/ai-config`, cfg);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  if (!cfg) return <p className="text-sm text-surface-muted">Memuat...</p>;

  return (
    <>
      <SectionCard title="Mode CEISA" description="Switch mock → live tanpa redeploy. Live membutuhkan API key dari DJBC.">
        <div className="grid grid-cols-2 gap-4 mb-4">
          {["mock", "live"].map(mode => (
            <button key={mode} onClick={() => { setCfg({ ...cfg, ceisa_mode: mode }); setSaved(false); }}
              className={`rounded-md border-2 p-4 text-left transition-all ${
                cfg.ceisa_mode === mode ? "border-intel-500 bg-intel-50" : "border-surface-border hover:border-surface-muted"
              }`}>
              <p className="text-sm font-semibold capitalize">{mode}</p>
              <p className="text-2xs text-surface-muted mt-1">
                {mode === "mock"
                  ? "Simulasi response DJBC. Aman untuk development dan testing."
                  : "Koneksi ke CEISA DJBC production. Membutuhkan API key resmi."}
              </p>
              {mode === "mock" && (
                <span className="badge-intel badge text-2xs mt-2">Mode sekarang</span>
              )}
            </button>
          ))}
        </div>

        {cfg.ceisa_mode === "live" && (
          <div className="space-y-3 border-t border-surface-border pt-4">
            <div>
              <label className="input-label">CEISA Endpoint URL</label>
              <input type="url" className="input text-xs" placeholder="https://www.beacukai.go.id/api/ceisa/..."
                value={cfg.ceisa_endpoint ?? ""}
                onChange={e => { setCfg({ ...cfg, ceisa_endpoint: e.target.value }); setSaved(false); }} />
            </div>
            <div>
              <label className="input-label">API Key (disimpan terenkripsi)</label>
              <input type="password" className="input text-xs" placeholder="••••••••••••••••"
                value={cfg.ceisa_api_key ?? ""}
                onChange={e => { setCfg({ ...cfg, ceisa_api_key: e.target.value }); setSaved(false); }} />
            </div>
            <div className="flex items-start gap-2 rounded border border-warning-600 bg-warning-100 p-3">
              <AlertTriangle size={13} className="text-warning-600 flex-shrink-0 mt-0.5" />
              <p className="text-2xs text-warning-600">
                Mode Live akan mengirim dokumen ke CEISA DJBC secara nyata. Pastikan semua dokumen valid sebelum mengaktifkan.
              </p>
            </div>
          </div>
        )}
      </SectionCard>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </>
  );
}

// ─── Signal Weights Section ────────────────────────────────────────────────────
function SignalWeightsSection({ tenantId }: { tenantId: string }) {
  const [weights, setWeights] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const DEFAULT_WEIGHTS: Record<string, any> = {
    PO_NUMBER:        { weight: 0.35, normalizer: "strip_prefix",    match_strategy: "exact_after_normalize", min_confidence_to_include: 0.70 },
    BL_NUMBER:        { weight: 0.30, normalizer: "strip_whitespace", match_strategy: "exact_after_normalize", min_confidence_to_include: 0.75 },
    INVOICE_NUMBER:   { weight: 0.20, normalizer: "strip_prefix",    match_strategy: "exact_after_normalize", min_confidence_to_include: 0.70 },
    CONTAINER_NUMBER: { weight: 0.25, normalizer: "iso6346",         match_strategy: "exact_after_normalize", min_confidence_to_include: 0.80 },
    SUPPLIER_NAME:    { weight: 0.10, normalizer: "company_name",    match_strategy: "fuzzy",                min_confidence_to_include: 0.60 },
    CONSIGNEE_NAME:   { weight: 0.10, normalizer: "company_name",    match_strategy: "fuzzy",                min_confidence_to_include: 0.60 },
    VALUE_RANGE:      { weight: 0.15, normalizer: "currency_convert", match_strategy: "range_overlap",       min_confidence_to_include: 0.65 },
    HS_CODE:          { weight: 0.10, normalizer: "strip_dots",      match_strategy: "prefix_match",         min_confidence_to_include: 0.85 },
    ETA:              { weight: 0.05, normalizer: "date_normalize",  match_strategy: "range_overlap",        min_confidence_to_include: 0.60 },
  };

  useEffect(() => {
    if (!tenantId) return;
    apiClient.get(`/tenants/${tenantId}/admin/signal-weights`).then(r => {
      if (r.data.length > 0) {
        setWeights(r.data);
      } else {
        // Load from defaults if not configured
        setWeights(SIGNAL_TYPES.map(st => ({ signal_type: st, ...DEFAULT_WEIGHTS[st] })));
      }
    });
  }, [tenantId]);

  async function save() {
    setSaving(true);
    try {
      await apiClient.put(`/tenants/${tenantId}/admin/signal-weights`, { weights });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  function updateWeight(idx: number, field: string, value: any) {
    setWeights(prev => prev.map((w, i) => i === idx ? { ...w, [field]: value } : w));
    setSaved(false);
  }

  return (
    <>
      <SectionCard title="Identity Signal Weights" description="Bobot setiap sinyal dalam pencocokan shipment. Total tidak harus = 1.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-border bg-surface-page">
                {["Signal Type", "Weight", "Normalizer", "Min Confidence", "Match Strategy"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-surface-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {weights.map((w, idx) => (
                <tr key={w.signal_type} className="hover:bg-surface-page">
                  <td className="px-3 py-2 font-mono text-2xs font-medium text-surface-text">{w.signal_type}</td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.01" min="0" max="1" className="input text-xs py-1 w-20"
                      value={w.weight} onChange={e => updateWeight(idx, "weight", parseFloat(e.target.value))} />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input text-xs py-1" value={w.normalizer}
                      onChange={e => updateWeight(idx, "normalizer", e.target.value)}>
                      {["strip_prefix","strip_whitespace","iso6346","company_name","currency_convert","strip_dots","date_normalize","none"].map(n =>
                        <option key={n} value={n}>{n}</option>
                      )}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" step="0.01" min="0" max="1" className="input text-xs py-1 w-20"
                      value={w.min_confidence_to_include}
                      onChange={e => updateWeight(idx, "min_confidence_to_include", parseFloat(e.target.value))} />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input text-xs py-1" value={w.match_strategy}
                      onChange={e => updateWeight(idx, "match_strategy", e.target.value)}>
                      {["exact_after_normalize","fuzzy","range_overlap","prefix_match"].map(s =>
                        <option key={s} value={s}>{s}</option>
                      )}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </>
  );
}

// ─── Validation Rules Section ──────────────────────────────────────────────────
function ValidationRulesSection({ tenantId }: { tenantId: string }) {
  const [rules, setRules] = useState<any[]>([]);
  const [newRule, setNewRule] = useState({ rule_code: "", rule_type: "FORMAT", field_key: "", description: "", config: "{}", severity: "ERROR" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    apiClient.get(`/tenants/${tenantId}/admin/validation-rules`).then(r => setRules(r.data));
  }, [tenantId]);

  async function addRule() {
    setSaving(true);
    try {
      const { data } = await apiClient.post(`/tenants/${tenantId}/admin/validation-rules`, {
        ...newRule, config: JSON.parse(newRule.config),
      });
      setRules(prev => [...prev, data]);
      setNewRule({ rule_code: "", rule_type: "FORMAT", field_key: "", description: "", config: "{}", severity: "ERROR" });
    } catch (e) {
      alert("Config JSON tidak valid");
    } finally { setSaving(false); }
  }

  async function deleteRule(id: string) {
    await apiClient.delete(`/tenants/${tenantId}/admin/validation-rules/${id}`);
    setRules(prev => prev.filter(r => r.id !== id));
  }

  return (
    <>
      <SectionCard title="Validation Rules" description="Aturan bisnis per field — FORMAT, RANGE, REQUIRED. Dijalankan oleh AI Validate stage.">
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-border bg-surface-page">
                {["Rule Code", "Type", "Field", "Severity", "Description", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-surface-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rules.map(r => (
                <tr key={r.id} className="hover:bg-surface-page">
                  <td className="px-3 py-2 font-mono text-2xs">{r.rule_code}</td>
                  <td className="px-3 py-2"><span className="badge-neutral badge">{r.rule_type}</span></td>
                  <td className="px-3 py-2 text-surface-muted">{r.field_key || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={r.severity === "ERROR" ? "badge-danger badge" : "badge-warning badge"}>{r.severity}</span>
                  </td>
                  <td className="px-3 py-2 text-surface-muted truncate max-w-[180px]">{r.description}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => deleteRule(r.id)} className="text-danger-600 hover:text-danger-800 text-2xs">Hapus</button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-surface-muted text-sm">Belum ada rule.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-surface-border pt-4">
          <p className="text-xs font-semibold text-surface-text mb-3">Tambah Rule Baru</p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="input-label">Rule Code</label>
              <input className="input text-xs" placeholder="HS_CODE_FORMAT" value={newRule.rule_code}
                onChange={e => setNewRule(p => ({ ...p, rule_code: e.target.value }))} /></div>
            <div><label className="input-label">Type</label>
              <select className="input text-xs" value={newRule.rule_type} onChange={e => setNewRule(p => ({ ...p, rule_type: e.target.value }))}>
                {["FORMAT","RANGE","REQUIRED","CROSS_DOC"].map(t => <option key={t}>{t}</option>)}
              </select></div>
            <div><label className="input-label">Field Key</label>
              <input className="input text-xs" placeholder="hs_code" value={newRule.field_key}
                onChange={e => setNewRule(p => ({ ...p, field_key: e.target.value }))} /></div>
            <div><label className="input-label">Severity</label>
              <select className="input text-xs" value={newRule.severity} onChange={e => setNewRule(p => ({ ...p, severity: e.target.value }))}>
                <option>ERROR</option><option>WARNING</option>
              </select></div>
            <div className="col-span-2"><label className="input-label">Deskripsi</label>
              <input className="input text-xs" placeholder="HS Code harus 8 digit angka" value={newRule.description}
                onChange={e => setNewRule(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="col-span-3"><label className="input-label">Config (JSON)</label>
              <textarea className="input text-xs h-16 font-mono resize-none" value={newRule.config}
                onChange={e => setNewRule(p => ({ ...p, config: e.target.value }))} /></div>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={addRule} disabled={saving || !newRule.rule_code} className="btn-primary text-xs gap-1 disabled:opacity-50">
              <Check size={12} /> Tambah Rule
            </button>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

// ─── ERP Section ───────────────────────────────────────────────────────────────
function ErpSection({ tenantId }: { tenantId: string }) {
  const [cfg, setCfg] = useState<any>({ erp_type: "SAP", endpoint_url: "", auth_type: "basic", is_active: false, field_mappings: {} });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    apiClient.get(`/tenants/${tenantId}/admin/erp-config`).then(r => { if (r.data) setCfg(r.data); });
  }, [tenantId]);

  async function save() {
    setSaving(true);
    try {
      await apiClient.put(`/tenants/${tenantId}/admin/erp-config`, cfg);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  return (
    <>
      <SectionCard title="ERP Integration" description="Rule #10 — semua ERP diakses lewat adapter standar">
        <div className="grid grid-cols-2 gap-4">
          <div><label className="input-label">ERP Type</label>
            <select className="input text-xs" value={cfg.erp_type} onChange={e => { setCfg({ ...cfg, erp_type: e.target.value }); setSaved(false); }}>
              {["SAP","ORACLE","DYNAMICS","CUSTOM"].map(t => <option key={t}>{t}</option>)}
            </select></div>
          <div><label className="input-label">Auth Type</label>
            <select className="input text-xs" value={cfg.auth_type} onChange={e => { setCfg({ ...cfg, auth_type: e.target.value }); setSaved(false); }}>
              {["basic","oauth2","api_key"].map(t => <option key={t}>{t}</option>)}
            </select></div>
          <div className="col-span-2"><label className="input-label">Endpoint URL</label>
            <input className="input text-xs" value={cfg.endpoint_url ?? ""} placeholder="https://erp.company.com/api/"
              onChange={e => { setCfg({ ...cfg, endpoint_url: e.target.value }); setSaved(false); }} /></div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="erp-active" checked={cfg.is_active}
              onChange={e => { setCfg({ ...cfg, is_active: e.target.checked }); setSaved(false); }} />
            <label htmlFor="erp-active" className="text-xs text-surface-text">Aktifkan ERP sync</label>
          </div>
        </div>
      </SectionCard>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </>
  );
}

// ─── Learning Section ──────────────────────────────────────────────────────────
function LearningSection({ tenantId }: { tenantId: string }) {
  const [corrections, setCorrections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    apiClient.get(`/tenants/${tenantId}/admin/learning-corrections`)
      .then(r => setCorrections(r.data))
      .finally(() => setLoading(false));
  }, [tenantId]);

  async function review(correctionId: string, action: "APPROVE" | "REJECT") {
    await apiClient.post(`/tenants/${tenantId}/admin/learning-corrections/${correctionId}/review`, { action });
    setCorrections(prev => prev.map(c => c.id === correctionId ? { ...c, review_status: action } : c));
  }

  return (
    <SectionCard title="Learning Engine — Review Koreksi" description="Rule #9 — koreksi operator yang menunggu persetujuan sebelum masuk ke training">
      {loading ? <p className="text-sm text-surface-muted">Memuat...</p> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-surface-border bg-surface-page">
              {["Tipe Dok.", "Field", "Nilai Salah", "Koreksi", "Status", ""].map(h => (
                <th key={h} className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-surface-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {corrections.map(c => (
              <tr key={c.id} className="hover:bg-surface-page">
                <td className="px-3 py-2 text-2xs">{c.document_type || "—"}</td>
                <td className="px-3 py-2 font-mono text-2xs">{c.field_key}</td>
                <td className="px-3 py-2 text-danger-600 text-2xs">{c.wrong_value}</td>
                <td className="px-3 py-2 text-success-600 text-2xs">{c.correct_value}</td>
                <td className="px-3 py-2">
                  <span className={c.review_status === "APPROVED" ? "badge-success badge" : c.review_status === "REJECTED" ? "badge-danger badge" : "badge-warning badge"}>
                    {c.review_status ?? "PENDING"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {(!c.review_status || c.review_status === "PENDING") && (
                    <div className="flex gap-1">
                      <button onClick={() => review(c.id, "APPROVE")} className="btn-secondary text-2xs py-0.5 text-success-600 border-success-600">Setuju</button>
                      <button onClick={() => review(c.id, "REJECT")} className="btn-secondary text-2xs py-0.5 text-danger-600 border-danger-600">Tolak</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {corrections.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-surface-muted text-sm">Belum ada koreksi.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

// ─── BC Access Section ─────────────────────────────────────────────────────────
function BcAccessSection({ tenantId }: { tenantId: string }) {
  const [access, setAccess] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    apiClient.get(`/tenants/${tenantId}/admin/bc-access`).then(r => setAccess(r.data));
  }, [tenantId]);

  async function toggle(bcType: string, enabled: boolean) {
    setSaving(true);
    try {
      await apiClient.put(`/tenants/${tenantId}/admin/bc-access`, { bc_type: bcType, is_enabled: enabled });
      setAccess(prev => prev.map(a => a.bc_type === bcType ? { ...a, is_enabled: enabled } : a));
    } finally { setSaving(false); }
  }

  return (
    <SectionCard title="BC Type Access" description="Addendum B — aktifkan BC type yang didukung untuk tenant ini">
      <div className="space-y-2">
        {BC_TYPES.map(bt => {
          const current = access.find(a => a.bc_type === bt.code);
          const enabled = current?.is_enabled ?? false;
          return (
            <div key={bt.code} className="flex items-center justify-between rounded-md border border-surface-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-surface-text">{bt.label}</p>
                <p className="text-2xs text-surface-muted font-mono">{bt.code}</p>
              </div>
              <button onClick={() => toggle(bt.code, !enabled)} disabled={saving}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? "bg-intel-500" : "bg-surface-border"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

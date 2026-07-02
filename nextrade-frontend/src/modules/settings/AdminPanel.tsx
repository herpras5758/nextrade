import { useState, useEffect, useRef } from 'react';
import {
  Settings, Users, Building2, FileText, Network, Zap,
  Save, Plus, Trash2, Edit2, Loader2, Check, X,
  Upload, Download, RefreshCw, AlertCircle, Eye, EyeOff,
  Shield, Globe, ChevronRight, ChevronDown, Info,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useTenant } from '../../store/tenantContext';
import { useAuth } from '../../lib/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'tenant' | 'users' | 'ai' | 'doctypes' | 'matching' | 'ceisa';

// ── Helpers ───────────────────────────────────────────────────────────────────
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card mb-4">
      <div className="px-5 py-4 border-b border-[#DFE1E6]">
        <h3 className="font-semibold text-sm text-[#1B2A4A]">{title}</h3>
        {sub && <p className="text-xs text-[#6B778C] mt-0.5">{sub}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-[#6B778C] uppercase tracking-wider mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[#97A0AF] mt-1">{hint}</p>}
    </div>
  );
}

function SaveBtn({ loading, saved, onClick }: { loading: boolean; saved: boolean; onClick: () => void }) {
  return (
    <button className="btn btn-primary" onClick={onClick} disabled={loading}>
      {loading ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
      {saved ? 'Tersimpan' : 'Simpan'}
    </button>
  );
}

// ── Tab: Tenant Config ─────────────────────────────────────────────────────────
function TenantTab() {
  const { currentTenant } = useTenant();
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient.get(`/tenants/${currentTenant.id}`).then(r => setForm(r.data ?? {}));
  }, [currentTenant?.id]);

  const save = async () => {
    if (!currentTenant) return;
    setLoading(true);
    try {
      await apiClient.put(`/tenants/${currentTenant.id}`, form);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setLoading(false); }
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const cfg = form.config ?? {};
  const setCfg = (k: string, v: any) => set('config', { ...cfg, [k]: v });

  return (
    <div className="max-w-2xl">
      <Section title="Identitas Perusahaan" sub="Data perusahaan yang digunakan di semua dokumen BC">
        <Field label="Nama Perusahaan">
          <input className="input" value={form.name ?? ''} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Kode" hint="Kode unik singkat (maks 10 karakter)">
          <input className="input w-40" value={form.code ?? ''} onChange={e => set('code', e.target.value)} />
        </Field>
        <Field label="NPWP Importir" hint="Digunakan otomatis di BC 2.3 field importir">
          <input className="input" value={cfg.npwp ?? ''} onChange={e => setCfg('npwp', e.target.value)} placeholder="00.000.000.0-000.000" />
        </Field>
        <Field label="Alamat">
          <textarea className="input h-20 resize-none" value={cfg.address ?? ''} onChange={e => setCfg('address', e.target.value)} />
        </Field>
      </Section>

      <Section title="Kantor Pabean (KPBC)" sub="ADR-012: KPBC configurable per entitas — tidak hardcode">
        <Field label="Kode KPBC" hint="Contoh: 050200 (Semarang), 090100 (Tanjung Perak), 040100 (Tanjung Priok)">
          <input className="input w-48" value={cfg.kpbc_code ?? ''} onChange={e => setCfg('kpbc_code', e.target.value)} placeholder="050200" />
        </Field>
        <Field label="Nama Kantor Pabean">
          <input className="input" value={cfg.kpbc_name ?? ''} onChange={e => setCfg('kpbc_name', e.target.value)} placeholder="KPBC Semarang" />
        </Field>
        <Field label="Kawasan Berikat / KITE Number">
          <input className="input" value={cfg.bonded_zone ?? ''} onChange={e => setCfg('bonded_zone', e.target.value)} placeholder="KB-XXXX / KITE-XXXX" />
        </Field>
        <Field label="Jenis Kawasan">
          <select className="input w-64" value={cfg.zone_type ?? ''} onChange={e => setCfg('zone_type', e.target.value)}>
            <option value="">Pilih Jenis</option>
            <option value="KB">KB — Kawasan Berikat</option>
            <option value="KITE">KITE — Kemudahan Impor Tujuan Ekspor</option>
            <option value="PLB">PLB — Pusat Logistik Berikat</option>
            <option value="KEK">KEK — Kawasan Ekonomi Khusus</option>
          </select>
        </Field>
      </Section>

      <Section title="Pengaturan Bahasa & Regional">
        <Field label="Bahasa Default">
          <select className="input w-40" value={form.default_language ?? 'id'} onChange={e => set('default_language', e.target.value)}>
            <option value="id">Indonesia</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label="Zona Waktu">
          <select className="input w-64" value={cfg.timezone ?? 'Asia/Jakarta'} onChange={e => setCfg('timezone', e.target.value)}>
            <option value="Asia/Jakarta">WIB — Asia/Jakarta (UTC+7)</option>
            <option value="Asia/Makassar">WITA — Asia/Makassar (UTC+8)</option>
            <option value="Asia/Jayapura">WIT — Asia/Jayapura (UTC+9)</option>
          </select>
        </Field>
      </Section>

      <div className="flex justify-end">
        <SaveBtn loading={loading} saved={saved} onClick={save} />
      </div>
    </div>
  );
}

// ── Tab: Users & Roles ─────────────────────────────────────────────────────────
function UsersTab() {
  const { currentTenant } = useTenant();
  const { claims } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ email: '', given_name: '', role: 'operator' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    if (!currentTenant) return;
    setLoading(true);
    apiClient.get(`/tenants/${currentTenant.id}/admin/users`)
      .then(r => setUsers(r.data.users ?? []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [currentTenant?.id]);

  const invite = async () => {
    if (!currentTenant || !form.email) return;
    setSaving(true);
    try {
      await apiClient.post(`/tenants/${currentTenant.id}/admin/users`, form);
      setMsg('Undangan terkirim'); setForm({ email: '', given_name: '', role: 'operator' });
      setInviting(false); load();
    } catch (e: any) {
      setMsg(e.response?.data?.error ?? 'Gagal');
    } finally { setSaving(false); setTimeout(() => setMsg(''), 3000); }
  };

  const roles: Record<string, [string, string]> = {
    admin:    ['badge badge-red', 'Admin'],
    manager:  ['badge badge-blue', 'Manager'],
    customs:  ['badge badge-yellow', 'Customs Staff'],
    operator: ['badge badge-gray', 'Operator'],
    viewer:   ['badge badge-gray', 'Viewer'],
  };

  const roleDesc: Record<string, string> = {
    admin: 'Akses penuh semua tenant — konfigurasi sistem',
    manager: 'Approve BC draft, lihat semua data, laporan',
    customs: 'Entry data, submit ke CEISA, kelola shipment',
    operator: 'Upload dokumen, review field ekstraksi',
    viewer: 'Read-only — tidak bisa edit apapun',
  };

  return (
    <div className="max-w-3xl">
      <Section title="Users" sub={`ADR-012: Role hierarchy — admin > manager > customs > operator > viewer`}>
        <div className="mb-4 p-3 bg-[#F4F5F7] rounded-lg">
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(roles).map(([role, [cls, label]]) => (
              <div key={role} className="text-center">
                <span className={cls}>{label}</span>
                <p className="text-[10px] text-[#97A0AF] mt-1">{roleDesc[role]}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center mb-3">
          <span className="text-xs text-[#6B778C]">{users.length} user</span>
          <button className="btn btn-primary text-xs" onClick={() => setInviting(!inviting)}>
            <Plus size={12} /> Undang User
          </button>
        </div>

        {inviting && (
          <div className="border border-[#0EA5A4] rounded-lg p-4 mb-4 bg-[#E6FCFF]">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-[#6B778C] uppercase tracking-wider block mb-1">Email</label>
                <input className="input text-xs" placeholder="email@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] text-[#6B778C] uppercase tracking-wider block mb-1">Nama</label>
                <input className="input text-xs" placeholder="Nama Lengkap" value={form.given_name} onChange={e => setForm(f => ({ ...f, given_name: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] text-[#6B778C] uppercase tracking-wider block mb-1">Role</label>
                <select className="input text-xs" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {Object.keys(roles).filter(r => r !== 'admin').map(r => (
                    <option key={r} value={r}>{roles[r][1]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <button className="btn btn-primary text-xs" onClick={invite} disabled={saving}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Kirim Undangan
              </button>
              <button className="btn btn-ghost text-xs" onClick={() => setInviting(false)}><X size={12} /> Batal</button>
              {msg && <span className="text-xs text-[#0EA5A4]">{msg}</span>}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-8"><Loader2 size={16} className="animate-spin text-[#0EA5A4]" /></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-[#97A0AF] py-8">Belum ada user</td></tr>
              ) : users.map((u: any) => {
                const [cls, label] = roles[u.role] ?? ['badge badge-gray', u.role];
                return (
                  <tr key={u.id}>
                    <td className="font-medium text-xs">{u.given_name ?? u.name ?? '—'}</td>
                    <td className="text-xs text-[#6B778C]">{u.email}</td>
                    <td><span className={cls}>{label}</span></td>
                    <td><span className={u.enabled ? 'badge badge-green' : 'badge badge-gray'}>{u.enabled ? 'Aktif' : 'Nonaktif'}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost p-1"><Edit2 size={12} /></button>
                        {u.email !== claims?.email && (
                          <button className="btn btn-ghost p-1 text-red-400"><Trash2 size={12} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

// ── Tab: AI Engine ─────────────────────────────────────────────────────────────
function AiTab() {
  const { currentTenant } = useTenant();
  const [cfg, setCfgState] = useState<any>({});
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient.get(`/tenants/${currentTenant.id}/admin/ai-config`)
      .then(r => { setCfgState(r.data ?? {}); setForm(r.data ?? {}); });
  }, [currentTenant?.id]);

  const save = async () => {
    if (!currentTenant) return;
    setLoading(true);
    try {
      await apiClient.put(`/tenants/${currentTenant.id}/admin/ai-config`, form);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setLoading(false); }
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="max-w-2xl">
      <Section title="AI Provider" sub="Konfigurasi model AI untuk klasifikasi dan ekstraksi dokumen">
        <Field label="Provider">
          <div className="flex gap-3">
            {[['anthropic','Anthropic (Claude)'],['openai','OpenAI (GPT-4)']].map(([v,l]) => (
              <label key={v} className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer flex-1 ${form.ai_provider === v ? 'border-[#0EA5A4] bg-[#E6FCFF]' : 'border-[#DFE1E6]'}`}>
                <input type="radio" name="provider" value={v} checked={form.ai_provider === v} onChange={() => set('ai_provider', v)} className="accent-[#0EA5A4]" />
                <span className="text-sm font-medium">{l}</span>
              </label>
            ))}
          </div>
        </Field>

        {(form.ai_provider === 'anthropic' || !form.ai_provider) && (
          <Field label="Anthropic API Key">
            <div className="flex gap-2">
              <input className="input flex-1" type={showKey ? 'text' : 'password'}
                placeholder={cfg.has_anthropic_key ? '••••••••••••••••' : 'sk-ant-api03-...'}
                onChange={e => set('anthropic_api_key', e.target.value)} />
              <button className="btn btn-ghost p-2" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {cfg.has_anthropic_key && <p className="text-[11px] text-green-600 mt-1">✓ API Key terkonfigurasi</p>}
          </Field>
        )}

        {form.ai_provider === 'openai' && (
          <Field label="OpenAI API Key">
            <div className="flex gap-2">
              <input className="input flex-1" type={showKey ? 'text' : 'password'}
                placeholder={cfg.has_openai_key ? '••••••••••••••••' : 'sk-...'}
                onChange={e => set('openai_api_key', e.target.value)} />
              <button className="btn btn-ghost p-2" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {cfg.has_openai_key && <p className="text-[11px] text-green-600 mt-1">✓ API Key terkonfigurasi</p>}
          </Field>
        )}
      </Section>

      <Section title="Model & Parameter">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Model Ekstraksi">
            <input className="input" value={form.extraction_model_id ?? 'claude-sonnet-4-6'} onChange={e => set('extraction_model_id', e.target.value)} />
          </Field>
          <Field label="Model Klasifikasi">
            <input className="input" value={form.classification_model_id ?? 'claude-sonnet-4-6'} onChange={e => set('classification_model_id', e.target.value)} />
          </Field>
          <Field label="Max Tokens Ekstraksi">
            <input className="input" type="number" value={form.extraction_max_tokens ?? 4096} onChange={e => set('extraction_max_tokens', parseInt(e.target.value))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Threshold Auto-Approve" hint="Field dengan confidence ≥ nilai ini otomatis approved">
            <div className="flex items-center gap-2">
              <input className="input w-24" type="number" step="0.05" min="0" max="1" value={form.threshold_auto_approved ?? 0.85} onChange={e => set('threshold_auto_approved', parseFloat(e.target.value))} />
              <span className="text-sm font-mono text-[#0EA5A4]">{Math.round((form.threshold_auto_approved ?? 0.85) * 100)}%</span>
            </div>
          </Field>
          <Field label="Threshold Review" hint="Field di bawah nilai ini masuk antrian review">
            <div className="flex items-center gap-2">
              <input className="input w-24" type="number" step="0.05" min="0" max="1" value={form.threshold_review_required ?? 0.70} onChange={e => set('threshold_review_required', parseFloat(e.target.value))} />
              <span className="text-sm font-mono text-[#F59E0B]">{Math.round((form.threshold_review_required ?? 0.70) * 100)}%</span>
            </div>
          </Field>
        </div>
      </Section>

      <div className="flex justify-end"><SaveBtn loading={loading} saved={saved} onClick={save} /></div>
    </div>
  );
}

// ── Tab: Doc Types & Fields ────────────────────────────────────────────────────
function DocTypesTab() {
  const { currentTenant } = useTenant();
  const [docTypes, setDocTypes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!currentTenant) return;
    setLoading(true);
    apiClient.get(`/tenants/${currentTenant.id}/admin/doc-types`)
      .then(r => setDocTypes(r.data.docTypes ?? []))
      .finally(() => setLoading(false));
  }, [currentTenant?.id]);

  const loadFields = async (code: string) => {
    if (!currentTenant) return;
    const { data } = await apiClient.get(`/tenants/${currentTenant.id}/admin/doc-types/${code}/fields`);
    setFields(data.fields ?? []);
    setSelected(code);
    setExpanded(code);
  };

  const saveField = async (code: string, fieldKey: string, patch: any) => {
    if (!currentTenant) return;
    setSaving(fieldKey);
    try {
      await apiClient.put(`/tenants/${currentTenant.id}/admin/doc-types/${code}/fields/${fieldKey}`, patch);
      setFields(prev => prev.map(f => f.field_key === fieldKey ? { ...f, ...patch } : f));
    } finally { setSaving(null); }
  };

  const catColors: Record<string, string> = {
    COMMERCIAL: '#3D7EFF', TRANSPORT: '#A855F7', CUSTOMS: '#EF4444', SUPPORTING: '#6B7280',
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Info size={14} className="text-[#0EA5A4]" />
        <span className="text-xs text-[#6B778C]">
          Field dengan <strong>is_graph_signal=true</strong> akan masuk Knowledge Graph untuk resolusi shipment.
          Field dengan <strong>is_mandatory_ceisa=true</strong> wajib ada untuk generate BC 2.3.
        </span>
      </div>
      {loading ? (
        <div className="flex justify-center p-12"><Loader2 size={16} className="animate-spin text-[#0EA5A4]" /></div>
      ) : (
        <div className="space-y-2">
          {docTypes.map(dt => (
            <div key={dt.doc_type_code} className="card overflow-hidden">
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[#F4F5F7]"
                onClick={() => expanded === dt.doc_type_code ? setExpanded(null) : loadFields(dt.doc_type_code)}
              >
                <div style={{ background: `${catColors[dt.category] ?? '#6B7280'}22`, color: catColors[dt.category] ?? '#6B7280' }}
                  className="text-[10px] font-bold px-2 py-0.5 rounded">{dt.category}</div>
                <span className="font-semibold text-sm text-[#1B2A4A] flex-1">{dt.display_name}</span>
                <span className="text-xs text-[#97A0AF] font-mono">{dt.field_count} fields · {dt.graph_signal_count} signals</span>
                <label className="flex items-center gap-1.5 text-xs" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={dt.is_enabled} className="accent-[#0EA5A4]"
                    onChange={async e => {
                      if (!currentTenant) return;
                      await apiClient.put(`/tenants/${currentTenant.id}/admin/doc-types/${dt.doc_type_code}`, { is_enabled: e.target.checked });
                      setDocTypes(prev => prev.map(d => d.doc_type_code === dt.doc_type_code ? { ...d, is_enabled: e.target.checked } : d));
                    }} />
                  Aktif
                </label>
                {expanded === dt.doc_type_code ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>

              {expanded === dt.doc_type_code && selected === dt.doc_type_code && (
                <div className="border-t border-[#DFE1E6]">
                  <table className="data-table text-xs">
                    <thead>
                      <tr>
                        <th>Field Key</th>
                        <th>Label</th>
                        <th className="text-center">Wajib</th>
                        <th className="text-center">CEISA</th>
                        <th className="text-center">Graph Signal</th>
                        <th>Entity Type</th>
                        <th>Threshold</th>
                        <th className="text-center">Aktif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map(f => (
                        <tr key={f.field_key}>
                          <td className="font-mono text-[10px] text-[#6B778C]">{f.field_key}</td>
                          <td className="font-medium">{f.display_name}</td>
                          <td className="text-center">
                            <input type="checkbox" checked={f.is_mandatory} className="accent-[#0EA5A4]"
                              onChange={e => saveField(dt.doc_type_code, f.field_key, { is_mandatory: e.target.checked })} />
                          </td>
                          <td className="text-center">
                            <input type="checkbox" checked={f.is_mandatory_ceisa} className="accent-[#EF4444]"
                              onChange={e => saveField(dt.doc_type_code, f.field_key, { is_mandatory_ceisa: e.target.checked })} />
                          </td>
                          <td className="text-center">
                            <input type="checkbox" checked={f.is_graph_signal} className="accent-[#A855F7]"
                              onChange={e => saveField(dt.doc_type_code, f.field_key, { is_graph_signal: e.target.checked })} />
                          </td>
                          <td>
                            {f.is_graph_signal && (
                              <span className="text-[10px] font-mono bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{f.graph_entity_type ?? '—'}</span>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <input type="number" className="input w-16 text-xs py-0.5 px-1.5" step="0.05" min="0" max="1"
                                defaultValue={parseFloat(f.confidence_threshold ?? 0.70).toFixed(2)}
                                onBlur={e => saveField(dt.doc_type_code, f.field_key, { confidence_threshold: parseFloat(e.target.value) })} />
                              {saving === f.field_key && <Loader2 size={10} className="animate-spin text-[#0EA5A4]" />}
                            </div>
                          </td>
                          <td className="text-center">
                            <input type="checkbox" checked={f.is_enabled} className="accent-[#0EA5A4]"
                              onChange={e => saveField(dt.doc_type_code, f.field_key, { is_enabled: e.target.checked })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Matching Rules ────────────────────────────────────────────────────────
function MatchingTab() {
  const { currentTenant } = useTenant();
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!currentTenant) return;
    setLoading(true);
    apiClient.get(`/tenants/${currentTenant.id}/admin/matching-rules`)
      .then(r => setRules(r.data.rules ?? []))
      .finally(() => setLoading(false));
  }, [currentTenant?.id]);

  const save = async (entityType: string, patch: any) => {
    if (!currentTenant) return;
    setSaving(entityType);
    try {
      await apiClient.put(`/tenants/${currentTenant.id}/admin/matching-rules/${entityType}`, patch);
      setRules(prev => prev.map(r => r.entity_type === entityType ? { ...r, ...patch } : r));
    } finally { setSaving(null); }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-4 p-3 bg-[#F4F5F7] rounded-lg text-xs text-[#6B778C]">
        <strong className="text-[#1B2A4A]">ADR-010:</strong> Bobot digunakan Resolution Engine untuk menghitung confidence.
        Dokumen yang berbagi entitas dengan bobot tinggi (Invoice, B/L) akan dikelompokkan dengan confidence tinggi.
        Entitas dengan bobot rendah (Supplier, Vessel) hanya sebagai sinyal pendukung.
      </div>
      {loading ? (
        <div className="flex justify-center p-8"><Loader2 size={16} className="animate-spin text-[#0EA5A4]" /></div>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Entity Type</th>
                <th>Deskripsi</th>
                <th>Bobot (0–1)</th>
                <th className="text-center">Wajib Match</th>
                <th className="text-center">Aktif</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.entity_type}>
                  <td>
                    <span className="font-mono text-xs bg-[#F4F5F7] px-2 py-0.5 rounded">{r.entity_type}</span>
                  </td>
                  <td className="text-xs text-[#6B778C] max-w-[200px]">{r.description}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <input type="range" min="0" max="1" step="0.05"
                        defaultValue={parseFloat(r.weight ?? 0.5)}
                        onMouseUp={e => save(r.entity_type, { weight: parseFloat((e.target as HTMLInputElement).value) })}
                        className="w-24 accent-[#0EA5A4]" />
                      <span className="text-xs font-mono font-semibold text-[#1B2A4A] w-8">{Math.round(parseFloat(r.weight ?? 0.5) * 100)}%</span>
                      {saving === r.entity_type && <Loader2 size={10} className="animate-spin text-[#0EA5A4]" />}
                    </div>
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={r.is_required} className="accent-[#EF4444]"
                      onChange={e => save(r.entity_type, { is_required: e.target.checked })} />
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={r.is_enabled} className="accent-[#0EA5A4]"
                      onChange={e => save(r.entity_type, { is_enabled: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab: CEISA Gateway ─────────────────────────────────────────────────────────
function CeisaTab() {
  const { currentTenant } = useTenant();
  const [form, setForm] = useState<any>({ ceisa_mode: 'mock', integration_mode: 'H2H' });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient.get(`/tenants/${currentTenant.id}/admin/ai-config`)
      .then(r => setForm((f: any) => ({ ...f, ...r.data })));
  }, [currentTenant?.id]);

  const save = async () => {
    if (!currentTenant) return;
    setLoading(true);
    try {
      await apiClient.put(`/tenants/${currentTenant.id}/admin/ai-config`, form);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setLoading(false); }
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="max-w-2xl">
      <Section title="Mode Integrasi CEISA" sub="ADR-013: Integration mode configurable per tenant — tidak mengubah code">
        <Field label="Mode Integrasi">
          <div className="space-y-2">
            {[
              { value: 'H2H', label: 'Host to Host (H2H)', sub: 'Langsung ke API CEISA 4.0 — recommended untuk perusahaan dengan akses API' },
              { value: 'PPJK', label: 'PPJK', sub: 'Generate XML/PDF → kirim ke PPJK → PPJK submit ke CEISA → tracking manual/import' },
              { value: 'MANUAL', label: 'Manual Upload', sub: 'Generate PDF BC 2.3 → user upload langsung ke portal CEISA' },
            ].map(({ value, label, sub }) => (
              <label key={value} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer ${form.integration_mode === value ? 'border-[#0EA5A4] bg-[#E6FCFF]' : 'border-[#DFE1E6]'}`}>
                <input type="radio" name="integration" value={value} checked={form.integration_mode === value}
                  onChange={() => set('integration_mode', value)} className="mt-0.5 accent-[#0EA5A4]" />
                <div>
                  <div className="text-sm font-semibold text-[#1B2A4A]">{label}</div>
                  <div className="text-xs text-[#6B778C] mt-0.5">{sub}</div>
                </div>
              </label>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="CEISA API Configuration" sub="Hanya diperlukan untuk mode H2H">
        <Field label="Environment">
          <div className="flex gap-3">
            {[['mock','Simulasi (Mock)'],['staging','Staging'],['live','Production (Live)']].map(([v,l]) => (
              <label key={v} className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer ${form.ceisa_mode === v ? 'border-[#0EA5A4] bg-[#E6FCFF]' : 'border-[#DFE1E6]'}`}>
                <input type="radio" name="ceisa_mode" value={v} checked={form.ceisa_mode === v}
                  onChange={() => set('ceisa_mode', v)} className="accent-[#0EA5A4]" />
                <span className="text-xs font-medium">{l}</span>
              </label>
            ))}
          </div>
        </Field>
        {form.ceisa_mode !== 'mock' && (
          <>
            <Field label="CEISA API Endpoint">
              <input className="input" value={form.ceisa_endpoint ?? ''}
                onChange={e => set('ceisa_endpoint', e.target.value)}
                placeholder="https://api.ceisa.go.id/v4/..." />
            </Field>
            <Field label="API Key / Token">
              <input className="input" type="password" value={form.ceisa_api_key ?? ''}
                onChange={e => set('ceisa_api_key', e.target.value)}
                placeholder="••••••••••••••••" />
            </Field>
          </>
        )}
      </Section>

      {form.ceisa_mode === 'mock' && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg mb-4 text-xs text-yellow-700">
          <AlertCircle size={14} />
          Mode simulasi aktif — submit BC tidak akan dikirim ke CEISA, Nomor Aju dibuat dummy
        </div>
      )}

      <div className="flex justify-end"><SaveBtn loading={loading} saved={saved} onClick={save} /></div>
    </div>
  );
}

// ── Main AdminPanel ────────────────────────────────────────────────────────────
export function AdminPanel() {
  const [tab, setTab] = useState<Tab>('ai');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'ai',       label: 'AI Engine',       icon: <Zap size={14} /> },
    { id: 'doctypes', label: 'Doc Types & Fields', icon: <FileText size={14} /> },
    { id: 'matching', label: 'Matching Rules',   icon: <Network size={14} /> },
    { id: 'ceisa',    label: 'CEISA Gateway',    icon: <Globe size={14} /> },
    { id: 'tenant',   label: 'Tenant Config',    icon: <Building2 size={14} /> },
    { id: 'users',    label: 'Users & Roles',    icon: <Users size={14} /> },
  ];

  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Konfigurasi platform — semua configurable, tidak ada yang hardcode</p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-[#DFE1E6] overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id ? 'border-[#0EA5A4] text-[#0EA5A4]' : 'border-transparent text-[#6B778C] hover:text-[#1B2A4A]'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="animate-fade-in">
        {tab === 'ai'       && <AiTab />}
        {tab === 'doctypes' && <DocTypesTab />}
        {tab === 'matching' && <MatchingTab />}
        {tab === 'ceisa'    && <CeisaTab />}
        {tab === 'tenant'   && <TenantTab />}
        {tab === 'users'    && <UsersTab />}
      </div>
    </div>
  );
}

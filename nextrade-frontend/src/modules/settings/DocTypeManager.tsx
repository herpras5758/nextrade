import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Save, RefreshCw, Sparkles } from "lucide-react";
import { apiClient } from "../../lib/apiClient";

interface DocType {
  id: string; doc_type_code: string; display_name: string;
  category: string; is_enabled: boolean; classification_hints: string[];
  extraction_prompt_override?: string;
}
interface FieldConfig {
  id: string; field_key: string; display_name: string;
  is_enabled: boolean; is_mandatory: boolean; is_mandatory_ceisa: boolean;
  ceisa_field_ref?: string; confidence_threshold?: number; sort_order: number;
}

const CATEGORY_BADGE: Record<string, string> = {
  COMMERCIAL: 'badge-blue', TRANSPORT: 'badge-warning',
  CUSTOMS: 'badge-ai', SUPPORTING: 'badge-neutral',
};

export function DocTypeManager({ tenantId }: { tenantId: string }) {
  const [docTypes, setDocTypes]     = useState<DocType[]>([]);
  const [fields, setFields]         = useState<Record<string, FieldConfig[]>>({});
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [saving, setSaving]         = useState<string | null>(null);
  const [isLoading, setIsLoading]   = useState(true);

  useEffect(() => {
    load();
  }, [tenantId]);

  async function load() {
    setIsLoading(true);
    try {
      const [dtRes, fRes] = await Promise.all([
        apiClient.get(`/tenants/${tenantId}/admin/doc-types`),
        apiClient.get(`/tenants/${tenantId}/admin/doc-fields`),
      ]);
      setDocTypes(dtRes.data ?? []);

      // Group fields by doc_type_code
      const grouped: Record<string, FieldConfig[]> = {};
      for (const f of (fRes.data ?? [])) {
        if (!grouped[f.doc_type_code]) grouped[f.doc_type_code] = [];
        grouped[f.doc_type_code].push(f);
      }
      setFields(grouped);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveDocType(dt: DocType) {
    setSaving(dt.doc_type_code);
    try {
      await apiClient.put(`/tenants/${tenantId}/admin/doc-types/${dt.doc_type_code}`, dt);
    } finally { setSaving(null); }
  }

  async function saveField(docTypeCode: string, field: FieldConfig) {
    setSaving(`${docTypeCode}.${field.field_key}`);
    try {
      await apiClient.put(`/tenants/${tenantId}/admin/doc-fields/${docTypeCode}/${field.field_key}`, field);
    } finally { setSaving(null); }
  }

  function updateField(docTypeCode: string, fieldKey: string, changes: Partial<FieldConfig>) {
    setFields(prev => ({
      ...prev,
      [docTypeCode]: (prev[docTypeCode] ?? []).map(f =>
        f.field_key === fieldKey ? { ...f, ...changes } : f
      ),
    }));
  }

  function updateDocType(code: string, changes: Partial<DocType>) {
    setDocTypes(prev => prev.map(dt => dt.doc_type_code === code ? { ...dt, ...changes } : dt));
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-[#6B778C]">Memuat konfigurasi...</div>;

  return (
    <div className="space-y-2">
      {docTypes.map(dt => {
        const dtFields = fields[dt.doc_type_code] ?? [];
        const mandatoryCount = dtFields.filter(f => f.is_mandatory_ceisa).length;
        const isExpanded = expanded === dt.doc_type_code;

        return (
          <div key={dt.doc_type_code} className="rounded border border-[#DFE1E6] overflow-hidden">
            {/* Doc type header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-white">
              <button onClick={() => setExpanded(isExpanded ? null : dt.doc_type_code)}
                className="text-[#6B778C] hover:text-[#1B2A4A]">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>

              {/* Toggle enabled */}
              <button onClick={() => {
                const updated = { ...dt, is_enabled: !dt.is_enabled };
                updateDocType(dt.doc_type_code, { is_enabled: !dt.is_enabled });
                saveDocType(updated);
              }}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors flex-shrink-0 ${dt.is_enabled ? 'bg-[#0EA5A4]' : 'bg-[#DFE1E6]'}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${dt.is_enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#1B2A4A]">{dt.display_name}</span>
                  <span className={`badge text-[9px] ${CATEGORY_BADGE[dt.category] ?? 'badge-neutral'}`}>{dt.category}</span>
                  <span className="font-mono text-[9px] text-[#6B778C] bg-[#F4F5F7] px-1.5 py-0.5 rounded">{dt.doc_type_code}</span>
                </div>
                <p className="text-[10px] text-[#6B778C] mt-0.5">
                  {dtFields.length} field · {mandatoryCount} wajib CEISA
                  {dt.extraction_prompt_override && <span className="ml-2 badge-ai badge text-[9px]">Custom Prompt</span>}
                </p>
              </div>

              {saving === dt.doc_type_code && <RefreshCw size={12} className="text-[#0EA5A4] animate-spin" />}
            </div>

            {/* Expanded: fields table + prompt override */}
            {isExpanded && (
              <div className="border-t border-[#DFE1E6] bg-[#FAFBFC]">
                {/* Classification hints */}
                <div className="px-4 py-3 border-b border-[#DFE1E6]">
                  <label className="input-label mb-1 block">Classification Hints (kata kunci untuk deteksi otomatis)</label>
                  <input
                    className="input text-xs"
                    value={(dt.classification_hints ?? []).join(', ')}
                    onChange={e => updateDocType(dt.doc_type_code, {
                      classification_hints: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    })}
                    onBlur={() => saveDocType(dt)}
                    placeholder="COMMERCIAL INVOICE, INVOICE NO, FAKTUR KOMERSIAL"
                  />
                </div>

                {/* Prompt override */}
                <div className="px-4 py-3 border-b border-[#DFE1E6]">
                  <div className="flex items-center gap-2 mb-1">
                    <label className="input-label">Extraction Prompt Override</label>
                    <span className="badge-neutral badge text-[9px]">Kosong = auto-generate dari field list</span>
                  </div>
                  <textarea
                    className="input text-xs h-16 resize-none font-mono"
                    value={dt.extraction_prompt_override ?? ''}
                    onChange={e => updateDocType(dt.doc_type_code, { extraction_prompt_override: e.target.value || undefined })}
                    onBlur={() => saveDocType(dt)}
                    placeholder="Biarkan kosong untuk menggunakan prompt yang di-generate otomatis dari daftar field di bawah..."
                  />
                </div>

                {/* Fields table */}
                <div className="overflow-x-auto">
                  <table className="table-enterprise">
                    <thead>
                      <tr>
                        <th>Aktif</th>
                        <th>Field Key</th>
                        <th>Nama Tampilan</th>
                        <th className="text-center">Wajib Ekstrak</th>
                        <th className="text-center">Wajib CEISA</th>
                        <th>Ref BC</th>
                        <th>Conf Override</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dtFields.map(field => (
                        <tr key={field.field_key} className={!field.is_enabled ? 'opacity-40' : ''}>
                          <td>
                            <button onClick={() => {
                              const updated = { ...field, is_enabled: !field.is_enabled };
                              updateField(dt.doc_type_code, field.field_key, { is_enabled: !field.is_enabled });
                              saveField(dt.doc_type_code, updated);
                            }}
                              className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${field.is_enabled ? 'bg-[#0EA5A4]' : 'bg-[#DFE1E6]'}`}>
                              <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${field.is_enabled ? 'translate-x-2.5' : 'translate-x-0.5'}`} />
                            </button>
                          </td>
                          <td><span className="font-mono text-[10px]">{field.field_key}</span></td>
                          <td>
                            <input className="input text-[11px] py-0.5 px-2 h-6 min-w-[140px]"
                              value={field.display_name}
                              onChange={e => updateField(dt.doc_type_code, field.field_key, { display_name: e.target.value })}
                              onBlur={() => saveField(dt.doc_type_code, field)}
                            />
                          </td>
                          <td className="text-center">
                            <input type="checkbox" checked={field.is_mandatory}
                              onChange={e => {
                                const updated = { ...field, is_mandatory: e.target.checked };
                                updateField(dt.doc_type_code, field.field_key, { is_mandatory: e.target.checked });
                                saveField(dt.doc_type_code, updated);
                              }}
                              className="accent-[#1B2A4A]" />
                          </td>
                          <td className="text-center">
                            <input type="checkbox" checked={field.is_mandatory_ceisa}
                              onChange={e => {
                                const updated = { ...field, is_mandatory_ceisa: e.target.checked };
                                updateField(dt.doc_type_code, field.field_key, { is_mandatory_ceisa: e.target.checked });
                                saveField(dt.doc_type_code, updated);
                              }}
                              className="accent-[#0EA5A4]" />
                          </td>
                          <td>
                            <input className="input text-[10px] py-0.5 px-2 h-6 w-20 font-mono"
                              value={field.ceisa_field_ref ?? ''}
                              onChange={e => updateField(dt.doc_type_code, field.field_key, { ceisa_field_ref: e.target.value || undefined })}
                              onBlur={() => saveField(dt.doc_type_code, field)}
                              placeholder="field_16"
                            />
                          </td>
                          <td>
                            <input type="number" min={0} max={1} step={0.01}
                              className="input text-[10px] py-0.5 px-2 h-6 w-16"
                              value={field.confidence_threshold ?? ''}
                              onChange={e => updateField(dt.doc_type_code, field.field_key, {
                                confidence_threshold: e.target.value ? parseFloat(e.target.value) : undefined
                              })}
                              onBlur={() => saveField(dt.doc_type_code, field)}
                              placeholder="0.85"
                            />
                          </td>
                          <td>
                            {saving === `${dt.doc_type_code}.${field.field_key}` && (
                              <RefreshCw size={11} className="text-[#0EA5A4] animate-spin" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-4 py-2 bg-teal-50 border-t border-teal-100 flex items-center gap-1.5">
                  <Sparkles size={11} className="text-[#0EA5A4]" />
                  <p className="text-[10px] text-[#0EA5A4]">
                    Perubahan field langsung dipakai pipeline ekstraksi berikutnya — tidak perlu redeploy.
                    Field bertanda CEISA menentukan checkpoint readiness.
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

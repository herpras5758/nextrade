import { PoolClient } from 'pg';
import { BC23Payload, BC23DetailBarang } from '../../../../lambda/shared/ceisa/types.js';

// Maps CTDM fields → BC 2.3 CEISA payload.
// All values come from ctdm_fields (the canonical read model).
// If a mandatory field is missing, we include a placeholder so the
// CEISA Readiness Score downstream can flag it.

export async function mapBC23Payload(
  client: PoolClient,
  shipmentId: string,
  tenantId: string
): Promise<BC23Payload> {

  // Load all resolved CTDM fields for this shipment
  const { rows: fields } = await client.query(
    `SELECT field_key, resolved_value
     FROM ctdm_fields
     WHERE shipment_id = $1 AND tenant_id = $2`,
    [shipmentId, tenantId]
  );
  const f = new Map(fields.map((r: any) => [r.field_key as string, r.resolved_value as string]));
  const get = (key: string, fallback = '') => f.get(key) ?? fallback;

  // Load items (from item_match stage)
  const { rows: items } = await client.query(
    `SELECT field_key, resolved_value
     FROM ctdm_fields
     WHERE shipment_id = $1 AND tenant_id = $2 AND field_key LIKE 'item_%'
     ORDER BY field_key`,
    [shipmentId, tenantId]
  );

  // Build detail_barang — group by item index
  const itemMap = new Map<number, Record<string, string>>();
  for (const item of items) {
    const match = item.field_key.match(/^item_(\d+)_(.+)$/);
    if (!match) continue;
    const idx = parseInt(match[1]);
    const key = match[2];
    if (!itemMap.has(idx)) itemMap.set(idx, {});
    itemMap.get(idx)![key] = item.resolved_value;
  }

  const detailBarang: BC23DetailBarang[] = Array.from(itemMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([idx, item], i) => ({
      no_urut:       i + 1,
      hs_code:       item.hs_code       ?? '',
      uraian:        item.description   ?? '',
      satuan:        item.unit          ?? 'PCS',
      jumlah_satuan: parseFloat(item.quantity    ?? '0'),
      harga_satuan:  parseFloat(item.unit_price  ?? '0'),
      jumlah_harga:  parseFloat(item.total_price ?? '0'),
      bea_masuk_pct: parseFloat(item.bea_masuk   ?? '0'),
      ppn_pct:       parseFloat(item.ppn         ?? '11'),
    }));

  // Container numbers (can be multiple)
  const containerRaw = get('container_number');
  const containerNumbers = containerRaw
    ? containerRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const cifValue  = parseFloat(get('cif_value',  '0'));
  const fobValue  = parseFloat(get('fob_value',  '0'));
  const freight   = parseFloat(get('freight',    '0'));
  const insurance = parseFloat(get('insurance',  '0'));
  const kurs      = parseFloat(get('kurs',       '16250'));

  return {
    kd_kantor_pab:    get('kd_kantor_pabean', 'KPU TANJUNG PRIOK'),
    kd_dok_inout:     '23',
    no_bc23:          get('nomor_bc',         ''),
    tgl_bc23:         get('tanggal_bc',       new Date().toISOString().slice(0, 10)),
    jns_pib:          get('jenis_pib',        'PIB Biasa'),

    npwp_importir:    get('npwp_importir',    ''),
    nama_importir:    get('nama_importir',    get('consignee_name', '')),
    alamat_importir:  get('alamat_importir',  ''),
    kd_tps:           get('kd_tps',           ''),

    nama_eksportir:   get('nama_eksportir',   get('supplier_name', '')),
    alamat_eksportir: get('alamat_eksportir', ''),
    kd_negara_asal:   get('kd_negara_asal',   ''),

    no_bc11:          get('nomor_manifest',   get('bl_number', '')),
    tgl_bc11:         get('tanggal_manifest', ''),
    no_pos_bc11:      get('no_pos_manifest',  ''),
    no_kontainer:     containerNumbers,

    valuta:           get('currency',         'USD'),
    ndpbm:            cifValue * kurs,
    fob:              fobValue,
    freight,
    asuransi:         insurance,
    cif:              cifValue,
    kurs,

    jumlah_jenis:     detailBarang.length,
    bruto:            parseFloat(get('gross_weight', '0')),
    netto:            parseFloat(get('net_weight',   '0')),

    detail_barang:    detailBarang.length > 0 ? detailBarang : [{
      no_urut: 1, hs_code: get('hs_code', ''), uraian: '', satuan: 'PCS',
      jumlah_satuan: 0, harga_satuan: 0, jumlah_harga: cifValue,
      bea_masuk_pct: 0, ppn_pct: 11,
    }],
  };
}

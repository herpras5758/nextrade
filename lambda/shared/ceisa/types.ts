// CEISA Adapter Interface
// Rule #10: semua sumber eksternal diakses lewat adapter dengan interface standar.
// Switching mock → live = ganti implementasi, tidak ada perubahan di business logic.

export interface CeisaSubmitRequest {
  bc_type:        string;          // "BC_2_3"
  nomor_aju:      string;          // nomor pengajuan lokal
  tenant_id:      string;
  payload:        BC23Payload;
}

export interface CeisaSubmitResponse {
  success:        boolean;
  nomor_permohonan?: string;       // DJBC assigns this
  nomor_bc?:      string;
  tanggal_bc?:    string;
  status:         'DITERIMA' | 'DITOLAK' | 'PENDING' | 'ERROR';
  message:        string;
  raw_response?:  unknown;
}

export interface CeisaSPPBResponse {
  nomor_sppb:     string;
  tanggal_sppb:   string;
  status:         'ISSUED' | 'PENDING';
  keterangan?:    string;
}

// BC 2.3 Payload — mandatory fields per DJBC spec
export interface BC23Payload {
  // Header
  kd_kantor_pab:    string;   // kode kantor pabean
  kd_dok_inout:     string;   // "23" untuk BC 2.3
  no_bc23:          string;
  tgl_bc23:         string;
  jns_pib:          string;   // "PIB Biasa" dst
  
  // Importir
  npwp_importir:    string;
  nama_importir:    string;
  alamat_importir:  string;
  kd_tps:           string;   // kode tempat penimbunan sementara
  
  // Eksportir / Supplier
  nama_eksportir:   string;
  alamat_eksportir: string;
  kd_negara_asal:   string;
  
  // Dokumen pengangkutan
  no_bc11:          string;   // nomor manifest
  tgl_bc11:         string;
  no_pos_bc11:      string;
  no_kontainer:     string[];
  
  // Nilai pabean
  valuta:           string;   // "USD"
  ndpbm:            number;   // nilai dasar penghitungan bea masuk
  fob:              number;
  freight:          number;
  asuransi:         number;
  cif:              number;
  kurs:             number;
  
  // Barang
  jumlah_jenis:     number;
  bruto:            number;
  netto:            number;
  
  // Detail barang (per item)
  detail_barang:    BC23DetailBarang[];
}

export interface BC23DetailBarang {
  no_urut:          number;
  hs_code:          string;
  uraian:           string;
  satuan:           string;
  jumlah_satuan:    number;
  harga_satuan:     number;
  jumlah_harga:     number;
  bea_masuk_pct:    number;
  ppn_pct:          number;
}

// The adapter interface — all CEISA communication goes through this
export interface CeisaAdapter {
  submit(req: CeisaSubmitRequest): Promise<CeisaSubmitResponse>;
  checkStatus(nomorPermohonan: string): Promise<CeisaSubmitResponse>;
  getSPPB(nomorBc: string): Promise<CeisaSPPBResponse | null>;
  mode: 'mock' | 'live';
}

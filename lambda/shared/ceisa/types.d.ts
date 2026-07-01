export interface CeisaSubmitRequest {
    bc_type: string;
    nomor_aju: string;
    tenant_id: string;
    payload: BC23Payload;
}
export interface CeisaSubmitResponse {
    success: boolean;
    nomor_permohonan?: string;
    nomor_bc?: string;
    tanggal_bc?: string;
    status: 'DITERIMA' | 'DITOLAK' | 'PENDING' | 'ERROR';
    message: string;
    raw_response?: unknown;
}
export interface CeisaSPPBResponse {
    nomor_sppb: string;
    tanggal_sppb: string;
    status: 'ISSUED' | 'PENDING';
    keterangan?: string;
}
export interface BC23Payload {
    kd_kantor_pab: string;
    kd_dok_inout: string;
    no_bc23: string;
    tgl_bc23: string;
    jns_pib: string;
    npwp_importir: string;
    nama_importir: string;
    alamat_importir: string;
    kd_tps: string;
    nama_eksportir: string;
    alamat_eksportir: string;
    kd_negara_asal: string;
    no_bc11: string;
    tgl_bc11: string;
    no_pos_bc11: string;
    no_kontainer: string[];
    valuta: string;
    ndpbm: number;
    fob: number;
    freight: number;
    asuransi: number;
    cif: number;
    kurs: number;
    jumlah_jenis: number;
    bruto: number;
    netto: number;
    detail_barang: BC23DetailBarang[];
}
export interface BC23DetailBarang {
    no_urut: number;
    hs_code: string;
    uraian: string;
    satuan: string;
    jumlah_satuan: number;
    harga_satuan: number;
    jumlah_harga: number;
    bea_masuk_pct: number;
    ppn_pct: number;
}
export interface CeisaAdapter {
    submit(req: CeisaSubmitRequest): Promise<CeisaSubmitResponse>;
    checkStatus(nomorPermohonan: string): Promise<CeisaSubmitResponse>;
    getSPPB(nomorBc: string): Promise<CeisaSPPBResponse | null>;
    mode: 'mock' | 'live';
}

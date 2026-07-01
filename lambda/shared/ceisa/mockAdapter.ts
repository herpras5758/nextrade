import { CeisaAdapter, CeisaSubmitRequest, CeisaSubmitResponse, CeisaSPPBResponse } from './types.js';

// Mock CEISA Adapter
// Returns realistic DJBC response format.
// Switch to LiveCeisaAdapter when real API key is available —
// zero changes to any business logic, only this file changes.

export class MockCeisaAdapter implements CeisaAdapter {
  readonly mode = 'mock' as const;

  async submit(req: CeisaSubmitRequest): Promise<CeisaSubmitResponse> {
    // Simulate network delay
    await delay(800 + Math.random() * 400);

    // Simulate occasional rejection (for testing error flows)
    if (req.payload.npwp_importir === 'TEST_REJECT') {
      return {
        success: false,
        status: 'DITOLAK',
        message: 'NPWP tidak terdaftar di sistem CEISA',
        raw_response: { kode_error: 'ERR_NPWP_001' },
      };
    }

    const nomorPermohonan = generateNomorPermohonan();
    const nomorBc = generateNomorBC(req.bc_type);
    const tanggalBc = new Date().toISOString().slice(0, 10);

    return {
      success: true,
      nomor_permohonan: nomorPermohonan,
      nomor_bc: nomorBc,
      tanggal_bc: tanggalBc,
      status: 'DITERIMA',
      message: `[MOCK] BC 2.3 berhasil diterima. Nomor: ${nomorBc}`,
      raw_response: {
        // Simulates actual DJBC XML/JSON response structure
        response_code: '00',
        response_message: 'SUKSES',
        data: {
          nomor_permohonan: nomorPermohonan,
          nomor_bc: nomorBc,
          tanggal_bc: tanggalBc,
          kd_kantor: req.payload.kd_kantor_pab,
          status_respon: 'DITERIMA',
        },
      },
    };
  }

  async checkStatus(nomorPermohonan: string): Promise<CeisaSubmitResponse> {
    await delay(300);
    return {
      success: true,
      nomor_permohonan: nomorPermohonan,
      status: 'DITERIMA',
      message: '[MOCK] Status: Dokumen sedang diproses DJBC',
    };
  }

  async getSPPB(nomorBc: string): Promise<CeisaSPPBResponse | null> {
    await delay(500);
    // Mock: SPPB issued 2 days after BC date
    return {
      nomor_sppb: `SPPB-${Date.now().toString(36).toUpperCase()}`,
      tanggal_sppb: new Date().toISOString().slice(0, 10),
      status: 'ISSUED',
      keterangan: `[MOCK] SPPB untuk ${nomorBc} telah diterbitkan`,
    };
  }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function generateNomorPermohonan(): string {
  const date = new Date();
  const yy = date.getFullYear().toString().slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  return `${yy}${mm}${dd}${seq}`;
}

function generateNomorBC(bcType: string): string {
  const codes: Record<string, string> = {
    BC_2_3: '230000', BC_2_0: '200000', BC_3_0: '300000',
  };
  const prefix = codes[bcType] ?? '230000';
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
  return `${prefix}-${year}-${seq}`;
}

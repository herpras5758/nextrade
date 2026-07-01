import { CeisaAdapter, CeisaSubmitRequest, CeisaSubmitResponse, CeisaSPPBResponse } from './types.js';

// Live CEISA Adapter — NOT active until API key is provisioned.
// Interface identical to MockCeisaAdapter.
// When switching: set CEISA_MODE=live in tenant_ai_config, inject real endpoint + key.

export class LiveCeisaAdapter implements CeisaAdapter {
  readonly mode = 'live' as const;

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string
  ) {}

  async submit(req: CeisaSubmitRequest): Promise<CeisaSubmitResponse> {
    // TODO: implement when DJBC API key is available
    // Expected: POST to CEISA intranet endpoint with XML/JSON payload
    // Authentication: client certificate + API key per DJBC spec
    throw new Error('Live CEISA adapter not yet implemented. Set CEISA_MODE=mock in tenant config.');
  }

  async checkStatus(nomorPermohonan: string): Promise<CeisaSubmitResponse> {
    throw new Error('Live CEISA adapter not yet implemented.');
  }

  async getSPPB(nomorBc: string): Promise<CeisaSPPBResponse | null> {
    throw new Error('Live CEISA adapter not yet implemented.');
  }
}

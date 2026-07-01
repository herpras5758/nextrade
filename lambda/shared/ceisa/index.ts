import { CeisaAdapter } from './types.js';
import { MockCeisaAdapter } from './mockAdapter.js';
import { LiveCeisaAdapter } from './liveAdapter.js';

export { MockCeisaAdapter } from './mockAdapter.js';
export { LiveCeisaAdapter } from './liveAdapter.js';
export type { CeisaAdapter, CeisaSubmitRequest, CeisaSubmitResponse, BC23Payload, BC23DetailBarang } from './types.js';

// Factory — reads mode from config.
// Business logic never instantiates adapters directly, always goes through this.
export function createCeisaAdapter(
  mode: 'mock' | 'live',
  endpoint?: string,
  apiKey?: string
): CeisaAdapter {
  if (mode === 'live') {
    if (!endpoint || !apiKey) throw new Error('Live CEISA adapter requires endpoint and apiKey');
    return new LiveCeisaAdapter(endpoint, apiKey);
  }
  return new MockCeisaAdapter();
}

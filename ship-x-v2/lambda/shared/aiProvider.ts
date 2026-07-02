// Universal AI provider: Anthropic direct | OpenAI | Bedrock
// Loaded from tenant_ai_config — fully configurable

export interface AiConfig {
  ai_provider: string;
  anthropic_api_key?: string | null;
  openai_api_key?: string | null;
  extraction_model_id: string;
  classification_model_id: string;
  extraction_max_tokens: number;
}

export type ContentBlock =
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string };

export async function callAI(
  config: AiConfig,
  contentBlocks: ContentBlock[],
  textPrompt: string,
  maxTokens: number
): Promise<string> {
  const model = config.extraction_model_id ?? 'claude-sonnet-4-6';
  const isOpenAI = model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
  const useAnthropic = !isOpenAI && !!config.anthropic_api_key;

  if (useAnthropic) {
    return callAnthropic(config.anthropic_api_key!, model, contentBlocks, textPrompt, maxTokens);
  }
  if (isOpenAI && config.openai_api_key) {
    return callOpenAI(config.openai_api_key, model, contentBlocks, textPrompt, maxTokens);
  }
  throw new Error(`No AI provider configured. Set anthropic_api_key or openai_api_key in tenant_ai_config.`);
}

async function callAnthropic(
  apiKey: string,
  model: string,
  contentBlocks: ContentBlock[],
  textPrompt: string,
  maxTokens: number
): Promise<string> {
  const userContent: any[] = contentBlocks.map(b => b);
  userContent.push({ type: 'text', text: textPrompt });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model.startsWith('gpt-') ? 'claude-sonnet-4-6' : model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(
  apiKey: string,
  model: string,
  contentBlocks: ContentBlock[],
  textPrompt: string,
  maxTokens: number
): Promise<string> {
  const userContent: any[] = contentBlocks.map(b => {
    if (b.type === 'document') {
      return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${b.source.data}` } };
    }
    if (b.type === 'image') {
      return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}`, detail: 'high' } };
    }
    return b;
  });
  userContent.push({ type: 'text', text: textPrompt });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: userContent }] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content ?? '';
}

export function parseJsonResponse(text: string): Record<string, any> {
  try {
    let s = text.replace(/```json|```/g, '').trim();
    const last = s.lastIndexOf('}');
    if (last > 0) s = s.substring(0, last + 1);
    return JSON.parse(s);
  } catch {
    // Fallback: extract key-value pairs with regex
    const result: Record<string, any> = {};
    for (const [, k, v] of text.matchAll(/"([^"]+)":\s*"([^"]*?)"/g)) {
      if (v) result[k] = v;
    }
    return result;
  }
}

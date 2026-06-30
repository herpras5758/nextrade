// AI Engine Adapter — Rule #10 (Adapter Pattern) + the "AI engine harus
// bisa di-configure" decision locked earlier in this project.
//
// This Lambda is the ONLY place in the system that knows how to talk to
// an AI provider. Every other Lambda (classifier, reconciliation,
// readiness scorer) calls THIS function, never Bedrock/OpenAI/Anthropic
// directly. Swapping providers — or routing different tenants to
// different providers — means changing the config object below, not
// redeploying every consumer.

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export type AIProvider = "BEDROCK" | "ANTHROPIC_API" | "OPENAI";

export interface AIEngineConfig {
  provider: AIProvider;
  region: string; // can differ from the stack's home region (e.g. Jakarta
                   // core infra calling Bedrock in Singapore)
  model: string;
  endpoint?: string; // required for non-AWS providers
}

// Default config — Jakarta core infra, Bedrock cross-region to Singapore,
// per the region decision locked with the user (Bedrock not yet GA in
// ap-southeast-3 at time of writing; re-verify at deploy time).
export const DEFAULT_AI_ENGINE_CONFIG: AIEngineConfig = {
  provider: "BEDROCK",
  region: "ap-southeast-1",
  model: "anthropic.claude-sonnet-4-6-v1:0",
};

interface AIRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

interface AIResponse {
  text: string;
  provider: AIProvider;
  model: string;
}

export async function invokeAIEngine(
  request: AIRequest,
  config: AIEngineConfig = DEFAULT_AI_ENGINE_CONFIG
): Promise<AIResponse> {
  switch (config.provider) {
    case "BEDROCK":
      return invokeBedrock(request, config);
    case "ANTHROPIC_API":
      return invokeAnthropicApi(request, config);
    case "OPENAI":
      throw new Error("OPENAI provider adapter not yet implemented — add here when needed, no other code changes required");
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

async function invokeBedrock(request: AIRequest, config: AIEngineConfig): Promise<AIResponse> {
  const client = new BedrockRuntimeClient({ region: config.region });

  const command = new InvokeModelCommand({
    modelId: config.model,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: request.maxTokens ?? 1024,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
    }),
  });

  const response = await client.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));

  return {
    text: body.content?.[0]?.text ?? "",
    provider: "BEDROCK",
    model: config.model,
  };
}

async function invokeAnthropicApi(request: AIRequest, config: AIEngineConfig): Promise<AIResponse> {
  // Direct Anthropic API fallback — used if/when a tenant or deployment
  // needs to bypass Bedrock entirely (e.g. region without Bedrock access
  // and no cross-region call desired). API key is read from Secrets
  // Manager at call time, never hardcoded or logged.
  if (!config.endpoint) {
    throw new Error("ANTHROPIC_API provider requires config.endpoint");
  }
  throw new Error("ANTHROPIC_API adapter: wire up Secrets Manager key retrieval before enabling in production");
}

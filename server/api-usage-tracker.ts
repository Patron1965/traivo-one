import { db } from "./db";
import { apiUsageLogs } from "@shared/schema";

const PRICING = {
  openai: {
    "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
    "gpt-4o": { input: 0.0025, output: 0.01 },
    "dall-e-3": { perImage: 0.04 },
  },
  resend: { perEmail: 0.001 },
  twilio: { perSms: 0.0079 },
  openrouteservice: { perRequest: 0 },
  "open-meteo": { perRequest: 0 },
  nominatim: { perRequest: 0 },
  "google-geocoding": { perRequest: 0.005 },
};

function estimateOpenAICost(model: string, inputTokens: number, outputTokens: number): number {
  const modelKey = model.includes("gpt-4o-mini") ? "gpt-4o-mini" : model.includes("gpt-4o") ? "gpt-4o" : "gpt-4o-mini";
  const pricing = PRICING.openai[modelKey as keyof typeof PRICING.openai];
  if (!pricing || "perImage" in pricing) return 0;
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

export async function trackApiUsage(params: {
  tenantId?: string;
  service: string;
  endpoint?: string;
  method?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  units?: number;
  model?: string;
  statusCode?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    let estimatedCostUsd = 0;

    if (params.service === "openai" && params.model) {
      if (params.method === "images.generate") {
        estimatedCostUsd = (params.units || 1) * PRICING.openai["dall-e-3"].perImage;
      } else {
        estimatedCostUsd = estimateOpenAICost(params.model, params.inputTokens || 0, params.outputTokens || 0);
      }
    } else if (params.service === "resend") {
      estimatedCostUsd = (params.units || 1) * PRICING.resend.perEmail;
    } else if (params.service === "twilio") {
      estimatedCostUsd = (params.units || 1) * PRICING.twilio.perSms;
    } else if (params.service === "google-geocoding") {
      estimatedCostUsd = (params.units || 1) * PRICING["google-geocoding"].perRequest;
    }

    await db.insert(apiUsageLogs).values({
      tenantId: params.tenantId || null,
      service: params.service,
      endpoint: params.endpoint || null,
      method: params.method || null,
      inputTokens: params.inputTokens || null,
      outputTokens: params.outputTokens || null,
      totalTokens: params.totalTokens || null,
      units: params.units || 1,
      estimatedCostUsd,
      model: params.model || null,
      statusCode: params.statusCode || 200,
      durationMs: params.durationMs || null,
      metadata: params.metadata || {},
    });
  } catch (error) {
    console.error("[api-usage-tracker] Failed to log API usage:", error);
  }
}

export async function trackOpenAIResponse(
  response: any,
  tenantId?: string,
  method: string = "chat.completions"
): Promise<void> {
  if (!response) return;
  const usage = response.usage;
  const model = response.model || "gpt-4o-mini";
  trackApiUsage({
    tenantId,
    service: "openai",
    method,
    endpoint: "/v1/chat/completions",
    model,
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
  });
}

export { PRICING };

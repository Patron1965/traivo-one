// Capabilities of the OpenAI chat models this app uses.
//
// The app standardizes on gpt-5-mini (see DEFAULT_AI_MODEL / resolveAIModel) and
// only upgrades premium planning/analysis to gpt-4o. The gpt-5 family and the
// o-series are *reasoning* models: they reject the legacy `max_tokens` parameter
// (use `max_completion_tokens`) and only allow the default `temperature` (1) —
// passing a custom `temperature` returns a 400. gpt-4o still accepts a custom
// temperature, so we must strip it conditionally rather than unconditionally.

export function isReasoningModel(model: string | undefined | null): boolean {
  return /^(gpt-5|o\d)/i.test((model ?? "").trim());
}

// Removes sampling parameters that reasoning models reject, based on params.model.
// Safe to call for every chat.completions request; it is a no-op for gpt-4o etc.
export function sanitizeChatParams<T extends { model: string }>(params: T): T {
  if (!isReasoningModel(params.model)) return params;
  const { temperature, top_p, frequency_penalty, presence_penalty, ...rest } =
    params as T & {
      temperature?: number;
      top_p?: number;
      frequency_penalty?: number;
      presence_penalty?: number;
    };
  return rest as T;
}

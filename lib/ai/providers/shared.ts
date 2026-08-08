export interface ProviderCallParams {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

export interface ProviderCallResult {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** True when the provider stopped generating because it hit `maxTokens`, not because it
   * naturally finished — `text` is very likely a truncated, unparseable partial JSON
   * document in that case. Lets callers surface a clear "cut off" error (and retry with a
   * bigger budget) instead of a confusing JSON.parse failure. */
  truncated?: boolean;
}

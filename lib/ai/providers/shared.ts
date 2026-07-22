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
}

// Server only: asks one tiny, platform-paid model call what kind of business a description is about and what feel suits it
// (the allowed words and the reply reader live in understandWords.ts, which is safe in the browser). Never throws.
import { MIN_ABOUT, buildUnderstandPrompt, parseUnderstood, type Understood } from "@/lib/onboarding/understandWords";

export type { Understood };
export { MIN_ABOUT };

/** Server only. Returns null when the model is unavailable or answers badly. */
export async function understandDescription(about: string, goal: string | undefined): Promise<Understood | null> {
  const text = about.trim();
  if (text.length < MIN_ABOUT) return null;
  try {
    const { generate } = await import("@/lib/ai/providers/bedrockClaude");
    const { resolveModel } = await import("@/lib/ai/modelRegistry");
    const result = await generate({
      model: resolveModel("bedrock_claude", "BASIC"),
      apiKey: "",
      systemPrompt: "You classify a website idea. Reply with ONLY the JSON asked for.",
      userPrompt: buildUnderstandPrompt(text, goal),
      maxTokens: 60,
    });
    return parseUnderstood(result.text ?? "");
  } catch (err) {
    console.error("understandDescription: model call failed, using the keyword reading:", err);
    return null;
  }
}

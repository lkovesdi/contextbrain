import { createAnthropic } from "@ai-sdk/anthropic";
import { resolveKey } from "@/lib/settings";

// Central place for default model IDs so a flagship bump is a one-line change.
// Bumped to the current flagship (claude-opus-4-8) as part of BYOK wiring; the
// Sonnet tier is unchanged. Per-task model *selection* is a later phase.
export const MODEL = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
} as const;

// An Anthropic model bound to the user's own key when they've supplied one,
// otherwise the platform key (resolveKey handles the fallback and never throws).
export async function anthropicModel(userId: string, modelId: string) {
  const { apiKey } = await resolveKey(userId, "anthropic");
  return createAnthropic({ apiKey })(modelId);
}

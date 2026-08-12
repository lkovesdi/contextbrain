import { createAnthropic } from "@ai-sdk/anthropic";
import { wrapLanguageModel } from "ai";
import { resolveKey } from "@/lib/settings";
import { assertCredits, meteringMiddleware } from "@/lib/credits";

// Central place for default model IDs so a flagship bump is a one-line change.
// Bumped to the current flagship (claude-opus-4-8) as part of BYOK wiring; the
// Sonnet tier is unchanged. Per-task model *selection* is a later phase.
export const MODEL = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
} as const;

// An Anthropic model bound to the user's own key when they've supplied one,
// otherwise the platform key (resolveKey handles the fallback and never throws).
// Platform-key calls are credit-gated: throws InsufficientCreditsError (→ 402
// via creditErrorResponse) when the balance is spent, and the returned model is
// wrapped so actual token usage is debited from the ledger after each call.
export async function anthropicModel(userId: string, modelId: string) {
  const { apiKey, usingUserKey } = await resolveKey(userId, "anthropic");
  const model = createAnthropic({ apiKey })(modelId);
  if (usingUserKey) return model;
  await assertCredits(userId);
  return wrapLanguageModel({ model, middleware: meteringMiddleware(userId, modelId) });
}

import { createAnthropic } from "@ai-sdk/anthropic";
import {
  generateObject,
  wrapLanguageModel,
  NoObjectGeneratedError,
  type LanguageModel,
} from "ai";
import type { z } from "zod";
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

// `claude-opus-4-8` isn't in @ai-sdk/anthropic's capability table yet, so the
// provider falls back to tool-call mode for structured output instead of the
// model's native one. A tool call that misses the schema — one string past a
// bound, a field the model decided to skip — makes generateObject throw
// NoObjectGeneratedError, and the whole run is lost. That's the intermittent
// "response did not match schema" summary failure. Resampling once clears it
// almost every time, so do that here rather than making every caller handle it.
export async function generateObjectRetrying<S extends z.ZodType>(args: {
  model: LanguageModel;
  schema: S;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  label?: string;
}): Promise<z.infer<S>> {
  const { label = "object", ...call } = args;
  try {
    const { object } = await generateObject(call);
    return object as z.infer<S>;
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    console.warn(`[llm] ${label} missed the schema — resampling once`);
    const { object } = await generateObject({
      ...call,
      system: call.system ? `${call.system}\n\n${SCHEMA_NUDGE}` : SCHEMA_NUDGE,
    });
    return object as z.infer<S>;
  }
}

const SCHEMA_NUDGE = `Output rules (a previous attempt was rejected)
- Return the object through the provided tool call, nothing else — no prose before or after it.
- Every required field must be present. Lists that have no items are [], never omitted and never null.
- Respect the stated length limits on each field; trim rather than overflow.`;

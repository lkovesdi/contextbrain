import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { LanguageModelMiddleware } from "ai";

// Prepaid credits: users without a BYOK key draw down a micro-USD balance
// (1_000_000 = $1.00) when their calls run on the platform keys. The ledger
// lives in credit_ledger (0020_credits.sql); this module owns pricing and the
// metering middleware. BYOK calls never touch any of this.

// Retail = provider cost × margin. Credits are denominated in dollars, so a
// price cut from a provider automatically widens the margin.
export const CREDIT_MARGIN = 1.5;

// Provider cost in micro-USD per token (== dollars per million tokens).
const LLM_COST: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};
// Unknown model IDs bill at the most expensive known rate rather than free.
const LLM_COST_FALLBACK = { input: 5, output: 25 };

// Deepgram nova-2 streaming: $0.0059/min provider cost.
const TRANSCRIPTION_COST_MICROS_PER_SECOND = 5900 / 60;

// Transcription is billed in two parts because the browser streams to Deepgram
// directly and the server never sees the audio: a floor debited when the
// ephemeral key is minted (so a client that "forgets" to report still pays
// something), and a client-reported top-up for time beyond the floor. Proper
// reconciliation against Deepgram's usage API (keys are tagged cb:<userId>) is
// a follow-up.
export const TRANSCRIPTION_FLOOR_SECONDS = 600;

const PACKS = {
  small: { usd: 10, label: "$10" },
  medium: { usd: 25, label: "$25" },
  large: { usd: 100, label: "$100" },
} as const;
export type PackId = keyof typeof PACKS;
export const CREDIT_PACKS = PACKS;

export class InsufficientCreditsError extends Error {
  readonly status = 402;
  constructor() {
    super("Out of credits. Buy more in Settings, or add your own API key.");
    this.name = "InsufficientCreditsError";
  }
}

// Service-role client — the only writer to credit_ledger (RLS has no insert
// policy). Null when the secret key isn't configured (e.g. a stripped-down
// local env); metering then degrades to no-op rather than breaking AI routes.
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) return null;
  return createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Balance lookup. Returns null on any failure — callers treat null as "can't
// tell", and metering fails open so a DB blip never takes down an AI route.
export async function getBalanceUsdMicros(userId: string): Promise<number | null> {
  const admin = adminClient();
  if (!admin) return null;
  try {
    const { data, error } = await admin.rpc("credit_balance_usd_micros", {
      p_user_id: userId,
    });
    if (error) throw error;
    return typeof data === "number" ? data : Number(data);
  } catch (e) {
    console.error("[credits] balance lookup failed (failing open):", e);
    return null;
  }
}

// Preflight gate for platform-key calls. TEMPORARILY DISABLED: the top-up
// flow isn't finished, so blocking at zero would dead-end users. Usage is
// still metered and the balance may go negative; restore the check below to
// re-enable the gate.
export async function assertCredits(_userId: string): Promise<void> {
  // const balance = await getBalanceUsdMicros(_userId);
  // if (balance !== null && balance <= 0) throw new InsufficientCreditsError();
}

type LedgerReason = "llm_usage" | "transcription_usage" | "purchase" | "adjustment";

async function insertDebit(
  userId: string,
  micros: number,
  reason: LedgerReason,
  meta: Record<string, unknown>
): Promise<void> {
  if (micros <= 0) return;
  const admin = adminClient();
  if (!admin) return;
  const { error } = await admin.from("credit_ledger").insert({
    user_id: userId,
    delta_usd_micros: -Math.round(micros),
    reason,
    meta,
  });
  if (error) console.error(`[credits] ${reason} debit failed:`, error);
}

// AI SDK v3-spec usage shape (subset we bill on).
type LlmUsage = {
  inputTokens: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens: { total?: number };
};

export function llmRetailCostUsdMicros(modelId: string, usage: LlmUsage): number {
  const cost = LLM_COST[modelId] ?? LLM_COST_FALLBACK;
  const cacheRead = usage.inputTokens.cacheRead ?? 0;
  const cacheWrite = usage.inputTokens.cacheWrite ?? 0;
  const baseInput =
    usage.inputTokens.noCache ??
    Math.max(0, (usage.inputTokens.total ?? 0) - cacheRead - cacheWrite);
  const output = usage.outputTokens.total ?? 0;
  const raw =
    baseInput * cost.input +
    cacheRead * cost.input * 0.1 +
    cacheWrite * cost.input * 1.25 +
    output * cost.output;
  return raw * CREDIT_MARGIN;
}

async function debitLlmUsage(userId: string, modelId: string, usage: LlmUsage) {
  const micros = llmRetailCostUsdMicros(modelId, usage);
  await insertDebit(userId, micros, "llm_usage", {
    model: modelId,
    input_tokens: usage.inputTokens.total ?? null,
    cache_read_tokens: usage.inputTokens.cacheRead ?? null,
    output_tokens: usage.outputTokens.total ?? null,
  });
}

export function transcriptionRetailCostUsdMicros(seconds: number): number {
  return seconds * TRANSCRIPTION_COST_MICROS_PER_SECOND * CREDIT_MARGIN;
}

// Debit a finished recording session, clamped so a buggy/malicious client
// can't report an absurd duration (sessions are minted with a 1h TTL).
export async function debitTranscription(
  userId: string,
  seconds: number,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const clamped = Math.min(Math.max(0, Math.floor(seconds)), 2 * 3600);
  await insertDebit(userId, transcriptionRetailCostUsdMicros(clamped), "transcription_usage", {
    ...meta,
    seconds: clamped,
  });
}

// Wraps a platform-key model so actual token usage is debited after each call.
// Debits are best-effort: a ledger failure logs and never breaks the response.
export function meteringMiddleware(userId: string, modelId: string): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      try {
        await debitLlmUsage(userId, modelId, result.usage);
      } catch (e) {
        console.error("[credits] llm debit failed:", e);
      }
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream();
      let usage: LlmUsage | null = null;
      const metered = stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === "finish") usage = part.usage;
            controller.enqueue(part);
          },
          async flush() {
            if (!usage) return;
            try {
              await debitLlmUsage(userId, modelId, usage);
            } catch (e) {
              console.error("[credits] llm stream debit failed:", e);
            }
          },
        })
      );
      return { stream: metered, ...rest };
    },
  };
}

// Route helper: map an InsufficientCreditsError to a 402, else null.
export function creditErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof InsufficientCreditsError) {
    return NextResponse.json(
      { error: e.message, code: "insufficient_credits" },
      { status: 402 }
    );
  }
  return null;
}

// Credit a completed Stripe checkout. Idempotent via the unique partial index
// on meta->>'stripe_session_id' — a duplicate webhook delivery is a no-op.
// payment_intent is stored so refunds/chargebacks can find whose ledger to
// claw back without another Stripe API round-trip.
export async function creditPurchase(
  userId: string,
  usd: number,
  stripeSessionId: string,
  paymentIntentId: string | null
): Promise<void> {
  const admin = adminClient();
  if (!admin) throw new Error("Service role client not configured");
  const { error } = await admin.from("credit_ledger").insert({
    user_id: userId,
    delta_usd_micros: Math.round(usd * 1_000_000),
    reason: "purchase",
    meta: { stripe_session_id: stripeSessionId, payment_intent: paymentIntentId, usd },
  });
  // 23505 = unique_violation: same checkout session already credited.
  if (error && error.code !== "23505") throw error;
}

// How much has already been clawed back for a payment intent (micro-USD,
// positive number). Lets the webhook debit only the delta when Stripe reports
// a growing cumulative amount_refunded across partial refunds.
export async function refundedUsdMicrosForPaymentIntent(
  paymentIntentId: string
): Promise<number> {
  const admin = adminClient();
  if (!admin) throw new Error("Service role client not configured");
  const { data, error } = await admin
    .from("credit_ledger")
    .select("delta_usd_micros")
    .eq("reason", "refund")
    .eq("meta->>payment_intent", paymentIntentId);
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + Math.abs(Number(r.delta_usd_micros)), 0);
}

// Claw back credits after a Stripe refund or dispute. Finds the purchaser via
// the stored payment_intent; idempotent per refundKey (unique partial index in
// 0021). The balance is allowed to go negative — that's the point: a refunded
// user shouldn't keep spendable credits.
export async function applyStripeClawback(
  paymentIntentId: string,
  usdMicros: number,
  refundKey: string,
  kind: "refund" | "dispute"
): Promise<void> {
  if (usdMicros <= 0) return;
  const admin = adminClient();
  if (!admin) throw new Error("Service role client not configured");
  const { data: purchase, error: findError } = await admin
    .from("credit_ledger")
    .select("user_id")
    .eq("reason", "purchase")
    .eq("meta->>payment_intent", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (!purchase) {
    console.error(`[credits] ${kind} for unknown payment_intent ${paymentIntentId}`);
    return;
  }
  const { error } = await admin.from("credit_ledger").insert({
    user_id: purchase.user_id,
    delta_usd_micros: -Math.round(usdMicros),
    reason: "refund",
    meta: { refund_key: refundKey, payment_intent: paymentIntentId, kind },
  });
  if (error && error.code !== "23505") throw error;
}

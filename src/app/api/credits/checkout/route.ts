import { createClient } from "@/lib/supabase/server";
import { getAuthUserVerified } from "@/lib/supabase/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CREDIT_PACKS } from "@/lib/credits";
import { getStripe } from "@/lib/stripe";

const Body = z.object({
  pack: z.enum(["small", "medium", "large"]),
});

// Start a hosted Stripe Checkout for a credit pack. The ledger is credited by
// the webhook (src/app/api/stripe/webhook) once payment completes — never here.
export async function POST(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUserVerified(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing/invalid pack" }, { status: 400 });
  }
  const { pack } = parsed.data;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Payments aren't configured yet." }, { status: 503 });
  }

  const { usd } = CREDIT_PACKS[pack];
  const origin = new URL(req.url).origin;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Instant-settlement methods only — delayed methods (ACH etc.) complete
      // with payment_status 'unpaid' and would hold credits in limbo.
      payment_method_types: ["card", "link"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: usd * 100,
            product_data: { name: `ContextBrain credits — $${usd} pack` },
          },
        },
      ],
      // The webhook reads these to know whose ledger to credit; the payment
      // intent copy makes refunds/chargebacks traceable to the purchaser.
      metadata: { user_id: user.id, pack },
      payment_intent_data: { metadata: { user_id: user.id, pack } },
      success_url: `${origin}/settings?purchase=success`,
      cancel_url: `${origin}/settings`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[credits/checkout] session create failed:", e);
    return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
  }
}

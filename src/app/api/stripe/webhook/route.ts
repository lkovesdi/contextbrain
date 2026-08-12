import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  applyStripeClawback,
  creditPurchase,
  refundedUsdMicrosForPaymentIntent,
} from "@/lib/credits";
import { getStripe } from "@/lib/stripe";

// Stripe calls this endpoint directly — no Supabase auth; trust comes from the
// signature check against STRIPE_WEBHOOK_SECRET. All ledger writes here are
// idempotent (unique partial indexes on stripe_session_id / refund_key), so
// Stripe's duplicate/retried deliveries are safe.

// Credit only when the money actually settled. Card/Link sessions arrive as
// checkout.session.completed with payment_status 'paid'; delayed methods
// complete as 'unpaid' and settle later via async_payment_succeeded.
function paidUsd(session: Stripe.Checkout.Session): number {
  if (session.payment_status !== "paid") return 0;
  return (session.amount_total ?? 0) / 100;
}

async function creditSession(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id;
  const usd = paidUsd(session);
  if (!userId || usd <= 0) return;
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  await creditPurchase(userId, usd, session.id, paymentIntent);
}

export async function POST(req: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Payments aren't configured yet." }, { status: 503 });
  }

  // Signature verification needs the exact raw bytes — no JSON parsing first.
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", webhookSecret);
  } catch (e) {
    console.error("[stripe/webhook] signature verification failed:", e);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await creditSession(event.data.object);
        break;

      case "checkout.session.async_payment_failed":
        // Nothing was credited (payment_status was never 'paid') — just log.
        console.error(
          `[stripe/webhook] async payment failed for session ${event.data.object.id}`
        );
        break;

      case "charge.refunded": {
        // amount_refunded is cumulative across partial refunds — debit only
        // what we haven't clawed back yet, keyed on the cumulative amount so
        // redeliveries of the same state are no-ops.
        const charge = event.data.object;
        const paymentIntent =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        if (!paymentIntent) break;
        const cumulativeMicros = charge.amount_refunded * 10_000; // cents → micros
        const alreadyMicros = await refundedUsdMicrosForPaymentIntent(paymentIntent);
        await applyStripeClawback(
          paymentIntent,
          cumulativeMicros - alreadyMicros,
          `${charge.id}:${charge.amount_refunded}`,
          "refund"
        );
        break;
      }

      case "charge.dispute.funds_withdrawn": {
        const dispute = event.data.object;
        const paymentIntent =
          typeof dispute.payment_intent === "string"
            ? dispute.payment_intent
            : dispute.payment_intent?.id ?? null;
        if (!paymentIntent) break;
        await applyStripeClawback(
          paymentIntent,
          dispute.amount * 10_000, // cents → micros
          dispute.id,
          "dispute"
        );
        break;
      }
    }
  } catch (e) {
    // Non-2xx makes Stripe retry the delivery; every write above is idempotent,
    // so an eventual duplicate can't double-apply.
    console.error(`[stripe/webhook] handling ${event.type} failed:`, e);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

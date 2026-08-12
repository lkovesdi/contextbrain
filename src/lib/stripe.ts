import Stripe from "stripe";

// Lazy singleton — the Vercel Stripe integration injects STRIPE_SECRET_KEY at
// deploy time, and local envs usually don't have it. Callers must treat null
// as "payments not configured" and degrade gracefully rather than crash.
let client: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

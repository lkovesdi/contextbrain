-- 0021 — Refund/chargeback idempotency.
--
-- Stripe delivers refund and dispute webhooks at-least-once; the clawback
-- writer (applyStripeClawback in src/lib/credits.ts) keys each ledger row on a
-- refund_key so duplicate deliveries can't double-debit.

create unique index if not exists credit_ledger_refund_key_idx
  on credit_ledger ((meta->>'refund_key'))
  where reason = 'refund' and meta ? 'refund_key';

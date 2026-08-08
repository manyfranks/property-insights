/**
 * lib/billing.ts
 *
 * Pro subscription tier — Stripe integration + entitlement check.
 *
 * Everything here is env-var-gated: with STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, and STRIPE_PRICE_ID_PRO all unset, the site
 * behaves exactly as before (stripeConfigured() is false, isPro() fails
 * soft to false, the Stripe client is never instantiated).
 */

import Stripe from "stripe";
import { getSubscription } from "@/lib/db/subscriptions";

/** True when all three Stripe env vars needed for checkout + webhooks are set. */
export function stripeConfigured(): boolean {
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.STRIPE_PRICE_ID_PRO
  );
}

let _stripe: Stripe | null = null;

/**
 * Lazy Stripe client. Callers must check stripeConfigured() first —
 * this throws if STRIPE_SECRET_KEY isn't set, so it's never instantiated
 * at module load in an unconfigured environment.
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  _stripe = new Stripe(key);
  return _stripe;
}

/** Grace window after current_period_end during which a lapsed Pro user still counts as pro. */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Whether a user is currently entitled to Pro. True when plan === 'pro'
 * AND (no current_period_end recorded yet, or it's within a 24h grace
 * window past current_period_end — covers webhook delivery lag before a
 * renewal event lands). Fails soft to false on any DB error, so a billing
 * hiccup degrades a user to the free tier rather than breaking requests.
 */
export async function isPro(userId: string): Promise<boolean> {
  try {
    const sub = await getSubscription(userId);
    if (!sub || sub.plan !== "pro") return false;
    if (!sub.currentPeriodEnd) return true;
    const periodEnd = new Date(sub.currentPeriodEnd).getTime();
    return Date.now() < periodEnd + GRACE_PERIOD_MS;
  } catch (err) {
    console.error("isPro check failed:", err);
    return false;
  }
}

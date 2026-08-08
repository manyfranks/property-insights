/**
 * db/subscriptions.ts
 *
 * Pro subscription entitlement storage, backed by Neon Postgres.
 * Separate table from user_profiles (which tracks behavioral/intent
 * signals) — this is strictly billing state, sourced from Stripe webhooks.
 *
 * TABLE SCHEMA: subscriptions (see src/lib/db/schema.sql)
 */

import { sql, dbAvailable } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type SubscriptionPlan = "free" | "pro";

export interface Subscription {
  userId: string;
  plan: SubscriptionPlan;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToSubscription(row: Row): Subscription {
  return {
    userId: row.user_id,
    plan: row.plan,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch a user's subscription row. Fails soft to null (treated as free
 * tier by callers) if the DB is unavailable or the query errors — billing
 * state should never take down an unrelated request.
 */
export async function getSubscription(userId: string): Promise<Subscription | null> {
  if (!dbAvailable()) return null;

  try {
    const db = sql();
    const rows = (await db`
      SELECT * FROM subscriptions WHERE user_id = ${userId}
    `) as Row[];
    if (rows.length === 0) return null;
    return rowToSubscription(rows[0]);
  } catch (err) {
    console.error("getSubscription failed:", err);
    return null;
  }
}

/**
 * Look up a subscription by Stripe customer id — used by webhook handlers
 * for events (subscription.updated/deleted) that don't carry our userId
 * directly, only the Stripe customer.
 */
export async function getSubscriptionByCustomerId(
  stripeCustomerId: string
): Promise<Subscription | null> {
  if (!dbAvailable()) return null;

  try {
    const db = sql();
    const rows = (await db`
      SELECT * FROM subscriptions WHERE stripe_customer_id = ${stripeCustomerId}
    `) as Row[];
    if (rows.length === 0) return null;
    return rowToSubscription(rows[0]);
  } catch (err) {
    console.error("getSubscriptionByCustomerId failed:", err);
    return null;
  }
}

export interface UpsertSubscriptionInput {
  userId: string;
  plan: SubscriptionPlan;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status?: string | null;
  currentPeriodEnd?: string | null;
}

/**
 * Insert or update a user's subscription row. Idempotent — safe to call
 * repeatedly with the same values (e.g. Stripe webhook retries).
 *
 * Returns false on failure instead of throwing so the webhook can decide
 * to 500 (making Stripe retry) — a dropped write here means a paying user
 * without pro access, the one failure that must not be silent.
 */
export async function upsertSubscription(input: UpsertSubscriptionInput): Promise<boolean> {
  if (!dbAvailable()) return false;

  try {
    const db = sql();
    await db`
      INSERT INTO subscriptions (
        user_id, plan, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at
      ) VALUES (
        ${input.userId}, ${input.plan}, ${input.stripeCustomerId ?? null},
        ${input.stripeSubscriptionId ?? null}, ${input.status ?? null},
        ${input.currentPeriodEnd ?? null}, NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        plan = EXCLUDED.plan,
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW()
    `;
    return true;
  } catch (err) {
    console.error("upsertSubscription failed:", err);
    return false;
  }
}

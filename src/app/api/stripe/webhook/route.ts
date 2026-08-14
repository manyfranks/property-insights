/**
 * POST /api/stripe/webhook
 *
 * Stripe webhook receiver — keeps the `subscriptions` table in sync with
 * checkout + subscription lifecycle events. Verifies the signature against
 * the raw request body before trusting anything in the payload.
 *
 * Configure this URL (https://<domain>/api/stripe/webhook) in the Stripe
 * dashboard, subscribed to: checkout.session.completed,
 * customer.subscription.updated, customer.subscription.deleted.
 *
 * 503 if billing isn't configured. Not in proxy.ts's auth-protected list —
 * Stripe calls this unauthenticated, verified only by signature.
 */

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, stripeConfigured } from "@/lib/billing";
import {
  getSubscriptionByCustomerId,
  upsertSubscription,
} from "@/lib/db/subscriptions";
import { getPostHogClient } from "@/lib/posthog-server";

/** Statuses that should drop the user back to the free plan. */
const DOWNGRADE_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

function periodEndFromSubscription(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  const seconds = item?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

function planForStatus(status: string): "free" | "pro" {
  return DOWNGRADE_STATUSES.has(status) ? "free" : "pro";
}

export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err) {
    console.error("stripe webhook: signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const userId =
          session.client_reference_id || (session.metadata?.userId as string | undefined);
        if (!userId) {
          console.error("stripe webhook: checkout.session.completed missing userId");
          break;
        }

        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        let status: string | null = null;
        let currentPeriodEnd: string | null = null;

        if (subscriptionId) {
          const stripe = getStripe();
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          status = sub.status;
          currentPeriodEnd = periodEndFromSubscription(sub);
        }

        const ok = await upsertSubscription({
          userId,
          plan: "pro",
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          status,
          currentPeriodEnd,
        });
        // A dropped write here = a paying user without pro access. 500 so
        // Stripe retries the event instead of marking it delivered.
        if (!ok) {
          return NextResponse.json({ error: "Entitlement write failed" }, { status: 500 });
        }

        // Track subscription activation in PostHog
        try {
          const posthog = getPostHogClient();
          posthog.capture({
            distinctId: userId,
            event: "subscription_activated",
            properties: {
              plan: "pro",
              stripe_customer_id: customerId,
              subscription_status: status,
            },
          });
          await posthog.flush();
        } catch (phErr) {
          console.error("stripe webhook: posthog capture failed:", phErr);
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

        let userId = (sub.metadata?.userId as string | undefined) || null;
        if (!userId && customerId) {
          const existing = await getSubscriptionByCustomerId(customerId);
          userId = existing?.userId ?? null;
        }
        if (!userId) {
          console.error(`stripe webhook: ${event.type} — could not resolve userId`);
          break;
        }

        const plan =
          event.type === "customer.subscription.deleted" ? "free" : planForStatus(sub.status);

        const ok = await upsertSubscription({
          userId,
          plan,
          stripeCustomerId: customerId ?? null,
          stripeSubscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: periodEndFromSubscription(sub),
        });
        if (!ok) {
          return NextResponse.json({ error: "Entitlement write failed" }, { status: 500 });
        }

        // Track subscription cancellation / downgrade in PostHog
        if (event.type === "customer.subscription.deleted" || plan === "free") {
          try {
            const posthog = getPostHogClient();
            posthog.capture({
              distinctId: userId,
              event: "subscription_canceled",
              properties: {
                plan_before: "pro",
                plan_after: plan,
                subscription_status: sub.status,
              },
            });
            await posthog.flush();
          } catch (phErr) {
            console.error("stripe webhook: posthog capture failed:", phErr);
          }
        }
        break;
      }

      default:
        // Unhandled event types are fine — return 200 so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    console.error(`stripe webhook: handler error for ${event.type}:`, err);
    // Still 200 — an upsert failure here shouldn't cause Stripe to hammer
    // retries indefinitely; upsertSubscription itself already fails soft
    // and logs, so this only guards unexpected throws above it.
  }

  return NextResponse.json({ received: true });
}

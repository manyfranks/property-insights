/**
 * POST /api/stripe/portal
 *
 * Creates a Stripe Billing Portal session so a Pro user can manage or
 * cancel their subscription, and returns its URL.
 *
 * 503 if billing isn't configured, 401 if signed out, 400 if this user
 * has no Stripe customer on file yet (never checked out).
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getStripe, stripeConfigured } from "@/lib/billing";
import { getSubscription } from "@/lib/db/subscriptions";
import { BASE_URL } from "@/lib/seo";
import {
  authenticatedUserId,
  ownedBillingCustomerId,
} from "@/lib/security/authorization";

export async function POST() {
  const { userId: authUserId } = await auth();
  const userId = authenticatedUserId(authUserId);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  // Authenticate before exposing billing configuration or loading account
  // state. The row is checked again below before its Stripe customer is used.
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const sub = await getSubscription(userId);
  const stripeCustomerId = ownedBillingCustomerId(userId, sub);
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${BASE_URL}/pricing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("billing portal session creation failed:", err);
    return NextResponse.json({ error: "Failed to open billing portal" }, { status: 502 });
  }
}

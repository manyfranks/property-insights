/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session (subscription mode) for the Pro tier
 * and returns its URL for the client to redirect to.
 *
 * 503 if billing isn't configured (missing env vars), 401 if signed out.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getStripe, stripeConfigured } from "@/lib/billing";
import { BASE_URL } from "@/lib/seo";

export async function POST() {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let email: string | undefined;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    email = user.emailAddresses?.[0]?.emailAddress;
  } catch (err) {
    console.error("checkout: failed to load user email:", err);
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID_PRO as string, quantity: 1 }],
      client_reference_id: userId,
      customer_email: email,
      metadata: { userId },
      subscription_data: { metadata: { userId } },
      success_url: `${BASE_URL}/pricing?upgraded=1`,
      cancel_url: `${BASE_URL}/pricing`,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("checkout session creation failed:", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 502 });
  }
}

/**
 * POST /api/signal/stitch
 *
 * Backfills user_id onto a visitor's own recent anonymous analytics_events
 * rows once they sign in, so pre-signup activity captured under their
 * anon_id (the whole reason this spine exists — see the doc comment on
 * src/app/api/signal/route.ts) isn't permanently orphaned from the account
 * after signup/sign-in.
 *
 * Requires a live Clerk session: this is inherently "attach *my*
 * signed-in identity to *my* recent anonymous history," which only makes
 * sense once signed in, and accepting it unauthenticated would let anyone
 * attribute an arbitrary anon_id's history to any user_id they name.
 * Rate-limited via the shared authApiLimiter (per-user, 30/min) applied by
 * the middleware's isAuthApi matcher (src/proxy.ts) — this route doesn't
 * duplicate that check inline.
 *
 * The actual backfill (30-day lookback, only rows with no user_id yet) is
 * implemented in stitchUserId (src/lib/db/analytics-events.ts) — this route
 * is just the auth/opt-out/cookie gate in front of it.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isOptedOutRequest } from "@/lib/privacy";
import { stitchUserId } from "@/lib/db/analytics-events";
import { ANON_ID_COOKIE, isPlausibleUuid, readCookie } from "@/lib/analytics-ids";

export async function POST(req: Request) {
  // Do Not Sell/Share: same short-circuit position as /api/track and
  // /api/signal — never touch analytics_events for an opted-out browser,
  // signed in or not.
  if (isOptedOutRequest(req)) {
    return NextResponse.json({ ok: true, stitched: false });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const anonId = readCookie(req, ANON_ID_COOKIE);
  if (!anonId || !isPlausibleUuid(anonId)) {
    return NextResponse.json({ ok: true, stitched: false });
  }

  await stitchUserId(anonId, userId);
  return NextResponse.json({ ok: true, stitched: true });
}

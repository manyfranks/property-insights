/**
 * POST /api/signal
 *
 * Anonymous-capable ingest for the first-party behavioral event spine
 * (analytics_events — see src/app/api/db/migrate/route.ts for the schema
 * and full rationale, src/lib/db/analytics-events.ts for persistence).
 *
 * Unlike /api/track (src/app/api/track/route.ts), this endpoint does NOT
 * require a signed-in Clerk session or per-user analytics consent: it
 * exists specifically because /api/track 401s for signed-out visitors,
 * making all anonymous traffic invisible today. This route is additive —
 * user_events, user_profiles, /api/track, and trackEvent() are untouched.
 *
 * Identity comes entirely from two httpOnly cookies minted by the
 * middleware (src/proxy.ts — only for non-opted-out page requests, never
 * from this route). If either pi_aid or pi_sid is missing — a cookieless
 * client, a direct API call that skipped a page load, or an opted-out
 * visitor whose cookies were never minted — the event is simply not
 * recorded. This route never mints those cookies itself: a Set-Cookie on
 * this response would be invisible to the page that queued the event via
 * sendBeacon, so there's nothing useful minting-on-ingest would achieve
 * beyond making the "identity" silently inconsistent across requests.
 *
 * Batches of 1-20 events per request let the client (src/lib/signal.ts)
 * coalesce a burst of interactions into one network round trip. Each event
 * is validated independently — an unknown `type` or malformed `data` drops
 * that one event rather than failing the whole batch — and the response
 * reports `accepted`/`rejected` counts so a caller can see partial drops.
 *
 * sendBeacon cannot set a request Content-Type (it always sends a string
 * body as `text/plain;charset=UTF-8`), so this route accepts text/plain as
 * an alternate encoding of the same JSON body alongside application/json.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isOptedOutRequest } from "@/lib/privacy";
import { validateGenericEventData } from "@/lib/tracking-validation";
import { insertAnalyticsEvents, type AnalyticsEventInput } from "@/lib/db/analytics-events";
import { ANON_ID_COOKIE, SESSION_ID_COOKIE, isPlausibleUuid, readCookie } from "@/lib/analytics-ids";
import { signalLimiter } from "@/lib/rate-limit";

/**
 * Allowlist of event types this spine accepts. Deliberately a small, named
 * set of specific UI moments (rather than a free-text `type` field) so a
 * typo or a rogue/compromised client can't create unbounded event_type
 * cardinality in analytics_events. Any event whose type isn't in this list
 * is dropped, not treated as a whole-batch error — see the route doc
 * comment above.
 */
export const SIGNAL_EVENT_TYPES = [
  "page_view",
  "insurance_landing_viewed",
  "insurance_address_entered",
  "insurance_waitlist_submitted",
  "coverage_wizard_started",
  "coverage_wizard_step_completed",
  "coverage_wizard_abandoned",
  "coverage_profile_submitted",
  "assess_address_entered",
  "assess_completed",
  "assess_failed",
  "partner_cta_impression",
  "guide_viewed",
  "guide_to_tool_click",
] as const;

export type SignalEventType = (typeof SIGNAL_EVENT_TYPES)[number];

/** Matches src/lib/signal.ts's MAX_BATCH_SIZE (10) with headroom for a
 *  client that queues faster than it flushes; still small enough that a
 *  rejected/oversized batch is cheap to detect before doing any work. */
const MAX_EVENTS_PER_BATCH = 20;

/** Matches the `path` cap used elsewhere for tracked string fields
 *  (src/app/api/partner-connect/route.ts's propertySlug/city). A page path
 *  + query string has no legitimate reason to run longer than this. */
const MAX_PATH_LENGTH = 512;

interface RawSignalEvent {
  type?: unknown;
  data?: unknown;
  path?: unknown;
}

function isSignalEventType(value: unknown): value is SignalEventType {
  return typeof value === "string" && (SIGNAL_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Pulls utm_source/utm_medium/utm_campaign out of a single event's own
 * `path` — not the /api/signal request URL itself, which never carries
 * UTMs. `path` is a relative path+query string (e.g.
 * "/insurance?utm_source=reddit"), so URL() needs a throwaway base purely
 * to parse it; only searchParams is ever read off the result.
 */
function extractUtm(path: string | null): {
  source: string | null;
  medium: string | null;
  campaign: string | null;
} {
  if (!path) return { source: null, medium: null, campaign: null };
  try {
    const url = new URL(path, "https://signal.invalid");
    return {
      source: url.searchParams.get("utm_source"),
      medium: url.searchParams.get("utm_medium"),
      campaign: url.searchParams.get("utm_campaign"),
    };
  } catch {
    return { source: null, medium: null, campaign: null };
  }
}

export async function POST(req: Request) {
  // Do Not Sell/Share: identical short-circuit position to /api/track —
  // runs before any cookie read, rate-limit check, auth lookup, or body
  // parse, so an opted-out browser is never recorded regardless of what
  // else the request carries.
  if (isOptedOutRequest(req)) {
    return NextResponse.json({ ok: true, tracked: false });
  }

  // Per-IP rate limit, checked before body parsing — this is a public,
  // unauthenticated endpoint reachable directly (not just via
  // src/lib/signal.ts), same reasoning as /api/partner-connect's
  // partnerConnectLimiter check.
  const limiter = signalLimiter();
  if (limiter) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const result = await limiter.limit(ip);
    if (!result.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)) } }
      );
    }
  }

  // Identity comes only from cookies the middleware already minted for
  // this browser (src/proxy.ts) — never minted here. Missing or
  // malformed-looking cookies mean there's no anonymous identity to
  // attach events to, so the batch is a no-op rather than a partial write
  // against a fabricated id.
  const anonId = readCookie(req, ANON_ID_COOKIE);
  const sessionId = readCookie(req, SESSION_ID_COOKIE);
  if (!anonId || !sessionId || !isPlausibleUuid(anonId) || !isPlausibleUuid(sessionId)) {
    return NextResponse.json({ ok: true, tracked: false });
  }

  // Optional auth: a signed-in visitor gets user_id stamped onto their
  // rows (same optional-auth shape as /api/partner-connect), but a session
  // is never required — the entire point of this spine is capturing
  // signed-out traffic /api/track cannot see.
  const { userId } = await auth();

  let body: unknown;
  try {
    const contentType = req.headers.get("content-type") || "";
    // sendBeacon can't set Content-Type, so a beacon-sent body arrives as
    // text/plain — parse it as text and JSON.parse manually rather than
    // calling req.json(), which only accepts application/json.
    body = contentType.includes("application/json")
      ? await req.json()
      : JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS_PER_BATCH) {
    return NextResponse.json(
      { error: `events must be an array of 1-${MAX_EVENTS_PER_BATCH} items` },
      { status: 400 }
    );
  }

  // Shared across the whole batch: both come from this single request's
  // own headers, not from anything client-supplied.
  const referrerHost = (() => {
    const referer = req.headers.get("referer");
    if (!referer) return null;
    try {
      return new URL(referer).host;
    } catch {
      return null;
    }
  })();
  const country = req.headers.get("x-vercel-ip-country");

  const rows: AnalyticsEventInput[] = [];
  let rejected = 0;

  for (const raw of events as RawSignalEvent[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !isSignalEventType(raw.type)) {
      rejected++;
      continue;
    }

    const data = validateGenericEventData(raw.data);
    if (data === null) {
      rejected++;
      continue;
    }

    const path =
      typeof raw.path === "string" && raw.path.length <= MAX_PATH_LENGTH ? raw.path : null;
    const utm = extractUtm(path);

    rows.push({
      anonId,
      sessionId,
      userId: userId ?? null,
      eventType: raw.type,
      data,
      path,
      referrerHost,
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmCampaign: utm.campaign,
      country,
    });
  }

  // Fail-soft-but-logged on the DB side (see insertAnalyticsEvents's doc
  // comment) — a persistence failure here degrades to "nothing was
  // written" without turning a client's fire-and-forget beacon into an
  // error the client has no way to react to anyway.
  await insertAnalyticsEvents(rows);

  return NextResponse.json({
    ok: true,
    tracked: rows.length > 0,
    accepted: rows.length,
    rejected,
  });
}

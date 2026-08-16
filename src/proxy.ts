import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { apiLimiter, authApiLimiter } from "@/lib/rate-limit";
import { isOptedOutRequest } from "@/lib/privacy";
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  SESSION_ID_COOKIE,
  SESSION_ID_MAX_AGE_SECONDS,
} from "@/lib/analytics-ids";
import { isSensitiveInsuranceCapabilityPath } from "@/lib/insurance/privacy/sensitive-routes";

const isProtectedRoute = createRouteMatcher(["/api/subscribe(.*)"]);

// Public API routes that get per-IP rate limiting
const isPublicApi = createRouteMatcher([
  "/api/autocomplete(.*)",
  "/api/search(.*)",
  "/api/discover(.*)",
  // partner-connect now accepts anonymous clicks too — needs the per-IP
  // limit since it can no longer rely solely on the per-user one below.
  "/api/partner-connect(.*)",
]);

// Authenticated API routes that get per-user rate limiting (applied in
// addition to the per-IP limit above when the caller is signed in)
const isAuthApi = createRouteMatcher([
  "/api/track(.*)",
  "/api/consent(.*)",
  "/api/subscribe(.*)",
  "/api/request-city(.*)",
  "/api/partner-connect(.*)",
  "/api/analyze(.*)",
  // Requires a live Clerk session by definition (it stamps *my* signed-in
  // identity onto *my* recent anonymous rows) — see
  // src/app/api/signal/stitch/route.ts. /api/signal itself (anonymous
  // ingest) deliberately is NOT here: it has its own dedicated per-IP
  // signalLimiter (src/lib/rate-limit.ts), checked inside the route, since
  // most of its traffic has no Clerk session to key a per-user limit on.
  "/api/signal/stitch(.*)",
]);

// /api/assess is rate-limited inside the route handler so failed Zoocasa
// lookups don't consume slots from the user's daily cap.

function rateLimitResponse(resetMs: number) {
  const retryAfter = Math.ceil(resetMs / 1000);
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    }
  );
}

/**
 * Mint (or refresh) the two first-party analytics identifiers used by the
 * anonymous event spine (analytics_events — see
 * src/app/api/db/migrate/route.ts, src/lib/db/analytics-events.ts,
 * src/lib/analytics-ids.ts for the shared cookie names/lifetimes):
 *
 *  - pi_aid — a stable per-browser anonymous id, minted once and reused
 *    for a full year so anonymous visits can be tied together (and, later,
 *    stitched to a signed-in user_id — src/app/api/signal/stitch/route.ts).
 *  - pi_sid — a per-session id with a 30-minute *sliding* expiry: every
 *    qualifying request re-stamps the cookie's expiry another 30 minutes
 *    out (reusing the existing value, never minting a new one on an
 *    unexpired cookie), so an actively-browsing visitor never sees a
 *    session boundary mid-visit, while ~30 minutes idle starts a fresh one.
 *
 * Both are httpOnly (page JS never reads them directly — src/lib/signal.ts
 * only ever talks to /api/signal, which reads them server-side) and are
 * only minted on page-route responses, never on /api/* responses, to keep
 * the hot API path's middleware overhead minimal and API response shapes
 * completely unaffected by this addition.
 *
 * Caller MUST have already confirmed the request is not opted out
 * (Sec-GPC header / pi_dns cookie — isOptedOutRequest) before calling this:
 * minting a tracking cookie for an opted-out visitor would itself be the
 * privacy violation the opt-out exists to prevent.
 */
function mintAnalyticsCookies(req: NextRequest, res: NextResponse): void {
  const secure = process.env.NODE_ENV === "production";

  if (!req.cookies.get(ANON_ID_COOKIE)) {
    res.cookies.set(ANON_ID_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      path: "/",
    });
  }

  // Sliding expiry: re-set on every qualifying request regardless of
  // whether the cookie already existed, reusing its value when present so
  // one continuous visit keeps a single session id instead of fragmenting
  // into a new one on every request.
  const existingSessionId = req.cookies.get(SESSION_ID_COOKIE)?.value;
  res.cookies.set(SESSION_ID_COOKIE, existingSessionId || crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: SESSION_ID_MAX_AGE_SECONDS,
    path: "/",
  });
}

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }

  // --- Rate limiting for public API routes (per-IP) ---
  if (isPublicApi(req)) {
    const limiter = apiLimiter();
    if (limiter) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const result = await limiter.limit(ip);
      if (!result.success) {
        return rateLimitResponse(result.reset - Date.now());
      }
    }
  }

  // --- Rate limiting for authenticated API routes (per-user) ---
  if (isAuthApi(req)) {
    const { userId } = await auth();
    if (userId) {
      const limiter = authApiLimiter();
      if (limiter) {
        const result = await limiter.limit(userId);
        if (!result.success) {
          return rateLimitResponse(result.reset - Date.now());
        }
      }
    }
  }

  // --- Anonymous analytics cookie minting (W1-SPINE) ---
  // Page routes only: config.matcher below also covers /api and /trpc, so
  // this is guarded explicitly rather than relying on the matcher to
  // exclude them. Opted-out requests are skipped entirely and BEFORE any
  // response/cookie object is even built — see mintAnalyticsCookies's doc
  // comment on why that ordering is non-negotiable.
  const { pathname } = req.nextUrl;
  if (
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/trpc") &&
    !isSensitiveInsuranceCapabilityPath(pathname) &&
    !isOptedOutRequest(req)
  ) {
    const response = NextResponse.next();
    mintAnalyticsCookies(req, response);
    return response;
  }
});

export const config = {
  matcher: [
    "/((?!_next|sitemap\\.xml|robots\\.txt|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api(?!/sitemap)|trpc)(.*)",
  ],
};

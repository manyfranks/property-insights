import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { apiLimiter, authApiLimiter, assessLimiter } from "@/lib/rate-limit";

const isProtectedRoute = createRouteMatcher(["/api/subscribe(.*)"]);

// Public API routes that get per-IP rate limiting
const isPublicApi = createRouteMatcher([
  "/api/autocomplete(.*)",
  "/api/search(.*)",
  "/api/discover(.*)",
]);

// Authenticated API routes that get per-user rate limiting
const isAuthApi = createRouteMatcher([
  "/api/track(.*)",
  "/api/consent(.*)",
  "/api/subscribe(.*)",
  "/api/request-city(.*)",
  "/api/partner-connect(.*)",
  "/api/analyze(.*)",
]);

// Assess endpoint gets its own daily cap
const isAssessRoute = createRouteMatcher(["/api/assess(.*)"]);

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

  // --- Daily cap for /api/assess (15/day per user) ---
  if (isAssessRoute(req)) {
    const { userId } = await auth();
    if (userId) {
      const limiter = assessLimiter();
      if (limiter) {
        const result = await limiter.limit(userId);
        if (!result.success) {
          return NextResponse.json(
            {
              error: "Daily assessment limit reached (15/day). Resets in 24 hours.",
              code: "RATE_LIMIT",
            },
            {
              status: 429,
              headers: { "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)) },
            }
          );
        }
      }
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

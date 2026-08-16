/**
 * Rate limiting configuration using @upstash/ratelimit.
 *
 * Uses the same Upstash Redis instance as our KV storage.
 * Keys are prefixed with "rl:" to avoid collisions with listing/event data.
 *
 * Nine limiters:
 *   1. apiLimiter               — general per-IP limit for public endpoints (60 req/min)
 *   2. authApiLimiter           — per-user limit for authenticated endpoints (30 req/min)
 *   3. assessLimiter            — per-user daily cap for /api/assess (15/day)
 *   4. insuranceLookupLimiter   — per-IP limit for /api/insurance/address-lookup (30 req/min)
 *   5. insuranceProfileLimiter  — per-IP limit for /api/coverage-profile (5 req/min)
 *   6. insuranceWaitlistLimiter — per-IP limit for /api/insurance/waitlist (5 req/min)
 *   7. partnerConnectLimiter    — per-IP limit for /api/partner-connect (20 req/min)
 *   8. signalLimiter            — per-IP limit for /api/signal (60 req/min)
 *   9. insuranceCaseAccessLimiter — capability+IP case reads (10 req/min)
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Module-level flag so the "disabled" warning fires once per warm instance,
// not once per request (RUNBOOK.md §8 gap #5 — this used to fail silently:
// every route just checks `if (limiter && ...)` and skips the check with no
// log line anywhere, so a production Upstash misconfiguration silently
// removed abuse protection).
let loggedDisabled = false;

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production" && !loggedDisabled) {
      loggedDisabled = true;
      console.error("[rate-limit] DISABLED — Upstash env missing");
    }
    return null;
  }
  return new Redis({ url, token });
}

// Lazy singletons — created once per warm instance
let _apiLimiter: Ratelimit | null = null;
let _authApiLimiter: Ratelimit | null = null;
let _assessLimiter: Ratelimit | null = null;
let _insuranceLookupLimiter: Ratelimit | null = null;
let _insuranceProfileLimiter: Ratelimit | null = null;
let _insuranceWaitlistLimiter: Ratelimit | null = null;
let _partnerConnectLimiter: Ratelimit | null = null;
let _signalLimiter: Ratelimit | null = null;
let _insuranceCaseAccessLimiter: Ratelimit | null = null;

/** 60 requests per 60 seconds, per IP — for public endpoints */
export function apiLimiter(): Ratelimit | null {
  if (_apiLimiter) return _apiLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _apiLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "60 s"),
    prefix: "rl:api",
  });
  return _apiLimiter;
}

/** 30 requests per 60 seconds, per user — for authenticated endpoints */
export function authApiLimiter(): Ratelimit | null {
  if (_authApiLimiter) return _authApiLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _authApiLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "60 s"),
    prefix: "rl:auth",
  });
  return _authApiLimiter;
}

/** 15 requests per 24 hours, per user — for /api/assess */
export function assessLimiter(): Ratelimit | null {
  if (_assessLimiter) return _assessLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _assessLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(15, "24 h"),
    prefix: "rl:assess",
  });
  return _assessLimiter;
}

/**
 * 30 requests per 60 seconds, per IP — for /api/insurance/address-lookup.
 * The typeahead is debounced 250ms client-side, so 30/min comfortably
 * covers real typing while throttling brute-force enumeration of the
 * tracked-listing address set (unauthenticated, 6 results per query).
 */
export function insuranceLookupLimiter(): Ratelimit | null {
  if (_insuranceLookupLimiter) return _insuranceLookupLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _insuranceLookupLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "60 s"),
    prefix: "rl:ins-lookup",
  });
  return _insuranceLookupLimiter;
}

/**
 * 5 requests per 60 seconds, per IP — for /api/coverage-profile. Profile
 * submission is a one-shot action (the wizard posts once at the end), so a
 * tight cap here mainly deters scripted/anonymous PII-row spam.
 */
export function insuranceProfileLimiter(): Ratelimit | null {
  if (_insuranceProfileLimiter) return _insuranceProfileLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _insuranceProfileLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "60 s"),
    prefix: "rl:ins-profile",
  });
  return _insuranceProfileLimiter;
}

/**
 * 5 requests per 60 seconds, per IP — for /api/insurance/waitlist. Same
 * one-shot-submission reasoning as insuranceProfileLimiter: a visitor joins
 * a waitlist once, so a tight cap mainly deters scripted email-collection
 * spam rather than throttling real usage.
 */
export function insuranceWaitlistLimiter(): Ratelimit | null {
  if (_insuranceWaitlistLimiter) return _insuranceWaitlistLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _insuranceWaitlistLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "60 s"),
    prefix: "rl:ins-waitlist",
  });
  return _insuranceWaitlistLimiter;
}

/**
 * 20 requests per 60 seconds, per IP — for /api/partner-connect. Looser than
 * the one-shot-submission limiters above since a single page view can fire
 * several partner-connect clicks (multiple CTA cards render per surface),
 * but still tight enough to deter scripted click/attribution spam against an
 * endpoint that (unlike the others) writes an append-only row per request
 * with no per-visitor cap of its own.
 */
export function partnerConnectLimiter(): Ratelimit | null {
  if (_partnerConnectLimiter) return _partnerConnectLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _partnerConnectLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "rl:partner-connect",
  });
  return _partnerConnectLimiter;
}

/**
 * 60 requests per 60 seconds, per IP — for /api/signal, the anonymous
 * event-spine ingest route. Given its own prefix (rather than reusing
 * apiLimiter) so a burst of anonymous behavioral-event batches never
 * competes with, or is throttled by, unrelated public endpoints
 * (autocomplete/search/discover) sharing the generic bucket. The limit
 * itself is generous: a single visitor's client-side queue
 * (src/lib/signal.ts) batches up to 10 events per request and flushes at
 * most every 5s or on tab-hide, so legitimate traffic sits well under this
 * even with several tabs open; it exists to deter scripted event-flood
 * abuse of an endpoint that (like partner_clicks) accepts anonymous,
 * unauthenticated writes.
 */
export function signalLimiter(): Ratelimit | null {
  if (_signalLimiter) return _signalLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _signalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "60 s"),
    prefix: "rl:signal",
  });
  return _signalLimiter;
}

/** 10 reads per 60 seconds for one IP + hashed capability token. */
export function insuranceCaseAccessLimiter(): Ratelimit | null {
  if (_insuranceCaseAccessLimiter) return _insuranceCaseAccessLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _insuranceCaseAccessLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    prefix: "rl:ins-case-access",
  });
  return _insuranceCaseAccessLimiter;
}

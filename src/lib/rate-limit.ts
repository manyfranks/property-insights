/**
 * Rate limiting configuration using @upstash/ratelimit.
 *
 * Uses the same Upstash Redis instance as our KV storage.
 * Keys are prefixed with "rl:" to avoid collisions with listing/event data.
 *
 * Three limiters:
 *   1. apiLimiter     — general per-IP limit for public endpoints (60 req/min)
 *   2. authApiLimiter — per-user limit for authenticated endpoints (30 req/min)
 *   3. assessLimiter  — per-user daily cap for /api/assess (15/day)
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Lazy singletons — created once per warm instance
let _apiLimiter: Ratelimit | null = null;
let _authApiLimiter: Ratelimit | null = null;
let _assessLimiter: Ratelimit | null = null;

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

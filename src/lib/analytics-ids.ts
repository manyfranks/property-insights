/**
 * analytics-ids.ts
 *
 * Shared cookie identifiers for the anonymous-capable analytics event
 * spine (analytics_events — see src/app/api/db/migrate/route.ts for the
 * schema and the full rationale). Three pieces need to agree on exact
 * cookie names, lifetimes, and parsing so they never drift apart:
 *   - src/proxy.ts        — mints/refreshes both cookies (page routes only)
 *   - src/app/api/signal/route.ts        — reads them to attach events
 *   - src/app/api/signal/stitch/route.ts — reads pi_aid to backfill user_id
 *
 * Both cookies are httpOnly UUIDv4 strings. Neither is ever minted for an
 * opted-out visitor (Sec-GPC / pi_dns — src/lib/privacy.ts) and neither is
 * read or written by client-side JS: src/lib/signal.ts talks to
 * /api/signal, which reads them server-side, rather than the client
 * attaching them itself.
 */

/**
 * Long-lived per-browser anonymous id. ~1 year keeps it stable across
 * return visits (long enough to be useful for stitching a multi-session
 * anonymous journey to an eventual signup) without being effectively
 * permanent.
 */
export const ANON_ID_COOKIE = "pi_aid";
export const ANON_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Per-visit session id with a 30-minute *sliding* expiry: src/proxy.ts
 * re-stamps this cookie's expiry (reusing the existing value, not minting a
 * new one) on every non-opted-out page request, so an actively-browsing
 * visitor never sees their session roll over mid-visit, but ~30 minutes of
 * inactivity starts a fresh session id on the next page load.
 */
export const SESSION_ID_COOKIE = "pi_sid";
export const SESSION_ID_MAX_AGE_SECONDS = 60 * 30;

/**
 * Reads a single cookie's raw value from a standard `Request`'s Cookie
 * header. Deliberately hand-rolled rather than using NextRequest's parsed
 * `.cookies` jar: route handlers in this codebase are typed as the plain
 * `Request` (see src/app/api/track/route.ts, src/lib/privacy.ts's
 * isOptedOutRequest), so this mirrors that same manual-parsing approach for
 * consistency rather than introducing a second cookie-reading convention.
 */
export function readCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie") ?? req.headers.get("Cookie");
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Loose UUID shape check (version/variant bits not enforced) — enough to
 * reject an obviously-garbage or hand-edited cookie value before it's used
 * in a query against a UUID column, without pulling in a validation
 * library for four regex-able hex groups.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlausibleUuid(value: string): boolean {
  return UUID_RE.test(value);
}

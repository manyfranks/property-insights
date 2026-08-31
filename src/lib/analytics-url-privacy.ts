/**
 * analytics-url-privacy.ts
 *
 * Redacts sensitive query-parameter VALUES from the URL properties PostHog
 * captures. This covers ordinary events and session-recording start URLs,
 * because posthog-js derives a recording's URLs from the `$current_url` it
 * attaches to `$snapshot` events.
 *
 * The address-search flow routes to `/assess?address=<raw street address>`,
 * and property/assessment pages carry identifier params (`placeId`,
 * `assessmentId`, `verify`). A street address identifies a home; the
 * identifiers can too, so treat them all as sensitive. The redaction keeps
 * the route and the parameter KEY — so funnels and path analysis still work —
 * but replaces the VALUE with a fixed placeholder.
 *
 * Complements src/lib/insurance/privacy/sensitive-routes.ts, which DROPS whole
 * events for capability routes. Here the route itself is safe to capture; only
 * the parameter values are not.
 */

/** Query parameters whose value can identify a home or a person. */
export const SENSITIVE_QUERY_PARAMS = ["address", "placeId", "assessmentId", "verify"];

/** Case-insensitive lookup set derived from SENSITIVE_QUERY_PARAMS. */
const SENSITIVE_KEYS = new Set(SENSITIVE_QUERY_PARAMS.map((key) => key.toLowerCase()));

/** Placeholder written in place of a redacted value. */
const REDACTED = "redacted";

/** Dummy base so root-relative paths ("/assess?...") parse with URL. */
const PLACEHOLDER_BASE = "http://redacted.local";

/** Matches a leading scheme + "//", i.e. an absolute URL. */
const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Properties that can carry a query string, across the event bag and the
 * `$set` / `$set_once` person-property bags. Applying the whole list to every
 * bag is harmless: a key absent from a bag is simply skipped.
 */
const URL_PROPERTY_KEYS = [
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
];

/**
 * Replace the value of every sensitive query parameter in `url` with a fixed
 * placeholder. Accepts absolute URLs and root-relative paths, and preserves
 * that shape. Returns the input unchanged when it has no query string or
 * cannot be parsed.
 */
export function redactSensitiveUrlParams(url: string): string {
  if (typeof url !== "string" || !url.includes("?")) return url;

  let parsed: URL;
  try {
    parsed = new URL(url, PLACEHOLDER_BASE);
  } catch {
    return url;
  }

  let changed = false;
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      parsed.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  if (!changed) return url;

  return ABSOLUTE_URL_RE.test(url)
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Redact the URL-bearing keys of a single loosely-typed properties bag. */
function redactUrlKeys(props: Record<string, unknown>): void {
  for (const key of URL_PROPERTY_KEYS) {
    const value = props[key];
    if (typeof value === "string") props[key] = redactSensitiveUrlParams(value);
  }
}

/**
 * PostHog `before_send` step: redact sensitive query-parameter values from the
 * event's URL properties, including the `$set` / `$set_once` person-property
 * bags (which carry `$initial_current_url` / `$initial_referrer`). Mutates and
 * returns the same event.
 */
export function redactAnalyticsUrlProperties<
  E extends { properties?: Record<string, unknown> } | null | undefined
>(event: E): E {
  const props = event?.properties;
  if (!props) return event;

  // The event bag plus the $set / $set_once person-property bags, which carry
  // $initial_current_url / $initial_referrer.
  for (const bag of [props, props.$set, props.$set_once]) {
    if (bag && typeof bag === "object") redactUrlKeys(bag as Record<string, unknown>);
  }
  return event;
}

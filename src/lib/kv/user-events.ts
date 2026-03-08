/**
 * kv/user-events.ts
 *
 * Track user behavior events in KV for analytics and lead scoring.
 * Events are stored per-user as append-only lists with automatic trimming.
 *
 * KEY SCHEMA:
 *   user:{userId}:events   → JSON array of UserEvent objects (most recent 200)
 *   user:{userId}:profile   → JSON UserProfile (aggregated intent signals)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType =
  | "property_view"
  | "assessment_request"
  | "search"
  | "city_subscribe"
  | "partner_click";

export interface UserEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, string | number | boolean>;
}

export interface UserProfile {
  /** Cities the user has shown interest in (from views, searches, subscriptions) */
  cities: string[];
  /** Price range observed from viewed properties [min, max] */
  priceRange: [number, number] | null;
  /** Total property views */
  viewCount: number;
  /** Total assessment requests (strongest intent signal) */
  assessmentCount: number;
  /** Total searches */
  searchCount: number;
  /** Most recent activity */
  lastActiveAt: string;
  /** First activity */
  firstSeenAt: string;
}

// ---------------------------------------------------------------------------
// KV helpers (reuse same pattern as listings.ts)
// ---------------------------------------------------------------------------

function kvUrl(): string | null {
  return process.env.KV_REST_API_URL || null;
}

function kvToken(): string | null {
  return process.env.KV_REST_API_TOKEN || null;
}

function kvAvailable(): boolean {
  return !!(kvUrl() && kvToken());
}

function kvHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${kvToken()}`,
    "Content-Type": "application/json",
  };
}

async function kvGet(key: string): Promise<unknown> {
  const url = kvUrl();
  if (!url) return null;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: kvHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.result;
}

async function kvSet(key: string, value: unknown): Promise<boolean> {
  const url = kvUrl();
  if (!url) return false;
  const args = ["set", key, JSON.stringify(value)];
  const path = args.map((a) => encodeURIComponent(a)).join("/");
  const res = await fetch(`${url}/${path}`, {
    method: "GET",
    headers: kvHeaders(),
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Pipeline helper (atomic multi-command execution)
// ---------------------------------------------------------------------------

async function kvPipeline(commands: unknown[][]): Promise<unknown[] | null> {
  const url = kvUrl();
  if (!url) return null;
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: kvHeaders(),
    body: JSON.stringify(commands),
  });
  if (!res.ok) return null;
  return res.json();
}

async function kvLRange(key: string, start: number, stop: number): Promise<unknown[]> {
  const url = kvUrl();
  if (!url) return [];
  const res = await fetch(
    `${url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`,
    { method: "GET", headers: kvHeaders(), cache: "no-store" }
  );
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body.result) ? body.result : [];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 200;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a user event. Uses atomic RPUSH + LTRIM to avoid race conditions.
 */
export async function trackEvent(
  userId: string,
  type: EventType,
  data: Record<string, string | number | boolean>
): Promise<void> {
  if (!kvAvailable()) return;

  const event: UserEvent = {
    type,
    timestamp: new Date().toISOString(),
    data,
  };

  const eventsKey = `user:${userId}:events`;

  // Atomic append + trim — no read-modify-write race
  await kvPipeline([
    ["rpush", eventsKey, JSON.stringify(event)],
    ["ltrim", eventsKey, `-${MAX_EVENTS}`, "-1"],
  ]);

  // Profile aggregation: read the full list and recompute
  // (profile is a derived view, minor staleness is acceptable)
  try {
    const rawEvents = await kvLRange(eventsKey, 0, -1);
    const events: UserEvent[] = rawEvents.map((r) =>
      typeof r === "string" ? JSON.parse(r) : r
    ) as UserEvent[];
    await updateProfile(userId, event, events);
  } catch {
    // Profile update is best-effort
  }
}

/**
 * Get a user's aggregated profile for lead scoring.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (!kvAvailable()) return null;
  try {
    const raw = await kvGet(`user:${userId}:profile`);
    if (raw && typeof raw === "string") return JSON.parse(raw);
    if (raw && typeof raw === "object") return raw as UserProfile;
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Get a user's raw event history.
 */
export async function getUserEvents(userId: string): Promise<UserEvent[]> {
  if (!kvAvailable()) return [];
  try {
    const rawEvents = await kvLRange(`user:${userId}:events`, 0, -1);
    return rawEvents.map((r) =>
      typeof r === "string" ? JSON.parse(r) : r
    ) as UserEvent[];
  } catch {
    // Fall through
  }
  return [];
}

// ---------------------------------------------------------------------------
// Internal: profile aggregation
// ---------------------------------------------------------------------------

async function updateProfile(
  userId: string,
  latestEvent: UserEvent,
  allEvents: UserEvent[]
): Promise<void> {
  const profileKey = `user:${userId}:profile`;

  // Aggregate from all events
  const cities = new Set<string>();
  let minPrice = Infinity;
  let maxPrice = 0;
  let viewCount = 0;
  let assessmentCount = 0;
  let searchCount = 0;
  let firstSeenAt = latestEvent.timestamp;

  for (const e of allEvents) {
    if (e.timestamp < firstSeenAt) firstSeenAt = e.timestamp;

    if (e.data.city && typeof e.data.city === "string") {
      cities.add(e.data.city);
    }

    if (e.data.price && typeof e.data.price === "number") {
      if (e.data.price < minPrice) minPrice = e.data.price;
      if (e.data.price > maxPrice) maxPrice = e.data.price;
    }

    switch (e.type) {
      case "property_view":
        viewCount++;
        break;
      case "assessment_request":
        assessmentCount++;
        break;
      case "search":
        searchCount++;
        break;
    }
  }

  const profile: UserProfile = {
    cities: [...cities],
    priceRange: maxPrice > 0 ? [minPrice, maxPrice] : null,
    viewCount,
    assessmentCount,
    searchCount,
    lastActiveAt: latestEvent.timestamp,
    firstSeenAt,
  };

  await kvSet(profileKey, profile);
}

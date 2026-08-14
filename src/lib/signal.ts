"use client";

/**
 * signal.ts
 *
 * Tiny client-side batching queue for the anonymous-capable analytics
 * event spine (/api/signal — see that route's doc comment for the full
 * architecture: httpOnly pi_aid/pi_sid cookies minted server-side by
 * src/proxy.ts carry identity, so this module carries none itself).
 *
 * Deliberately dumb: no session/user state lives here, just batching.
 * signal() pushes an event into a module-level queue; the queue flushes to
 * /api/signal when it reaches MAX_BATCH_SIZE, when the tab is hidden, or
 * FLUSH_DEBOUNCE_MS after the first still-unflushed event — whichever
 * comes first — so a page firing several signal() calls in quick
 * succession costs one network request, not several.
 *
 * NOT wired into any page or component by this work package (W1-SPINE) —
 * importing this module has no effect on any existing page until something
 * calls signal(...). See the W1-SPINE final report for the proposed
 * layout.tsx mount point, which is out of scope here because layout.tsx is
 * currently being touched by a concurrent PostHog install.
 */

import { isOptedOutClient } from "@/lib/privacy";

export type SignalPayload = Record<string, string | number | boolean>;

interface QueuedSignalEvent {
  type: string;
  data?: SignalPayload;
  path: string;
}

/** Flush once the queue reaches this size, without waiting for the debounce timer. */
const MAX_BATCH_SIZE = 10;

/** Flush this long after the first event lands in an empty queue. */
const FLUSH_DEBOUNCE_MS = 5000;

const ENDPOINT = "/api/signal";

let queue: QueuedSignalEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleListenersAttached = false;

/**
 * Sends the current queue and clears it. Prefers `navigator.sendBeacon` —
 * it survives the page unloading mid-request, which a normal fetch does
 * not — and falls back to `fetch(..., { keepalive: true })` when
 * sendBeacon is unavailable or refuses the payload (e.g. over its small
 * per-origin queue quota; unlikely at 10 events, but not assumed).
 *
 * sendBeacon cannot set a Content-Type header: a string body is always
 * sent as `text/plain;charset=UTF-8`, which is exactly why
 * src/app/api/signal/route.ts also accepts text/plain bodies as JSON.
 */
function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;

  const events = queue;
  queue = [];
  const body = JSON.stringify({ events });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(ENDPOINT, body)) return;
    // Beacon was rejected outright — fall through to fetch rather than
    // silently dropping the batch.
  }

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch((err) => {
    // Fail loud per the house error philosophy: a dropped anonymous-event
    // batch is low-stakes, but it must never disappear without a trace —
    // surface it in the console rather than swallowing the rejection.
    console.warn("[signal] flush failed:", err);
  });
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

/** Attached lazily (on first signal() call, not at module load) and only
 *  once per page, since this module has no teardown hook to remove it. */
function attachLifecycleListeners(): void {
  if (lifecycleListenersAttached || typeof document === "undefined") return;
  lifecycleListenersAttached = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/**
 * Queue an anonymous analytics event for /api/signal.
 *
 * No-ops — without building a payload at all — when the visitor is opted
 * out (Sec-GPC / pi_dns, via isOptedOutClient()) so an opted-out browser
 * never even constructs an event object, and when called outside a browser
 * (SSR) since there is no queue/timer/beacon to use there.
 */
export function signal(type: string, data?: SignalPayload): void {
  if (typeof window === "undefined") return;
  if (isOptedOutClient()) return;

  attachLifecycleListeners();

  queue.push({
    type,
    ...(data ? { data } : {}),
    path: `${window.location.pathname}${window.location.search}`,
  });

  if (queue.length >= MAX_BATCH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

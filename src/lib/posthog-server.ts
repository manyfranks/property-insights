/**
 * Server-side PostHog client (posthog-node).
 *
 * Usage: call getPostHogClient() in any server-side context (API routes,
 * server actions, webhooks). Each short-lived handler should call
 * await client.flush() before returning so batched events are sent before
 * the function exits.
 *
 * posthog-js is browser-only — this module is the server-side equivalent.
 */

import { PostHog } from "posthog-node";
import type { EventMessage } from "posthog-node";

/**
 * The subset of the PostHog interface this codebase actually calls
 * (grep confirms only .capture and .flush are used across api/assess,
 * api/subscribe, and api/stripe/webhook). A real `PostHog` instance
 * satisfies this structurally.
 */
export interface PostHogServerClient {
  capture(props: EventMessage): void;
  flush(): Promise<void>;
}

/** No-op stub used when the token is missing in production — see below. */
const noopClient: PostHogServerClient = {
  capture() {
    // Deliberately silent per-call: the missing-token condition is already
    // reported once (loudly) at the point getPostHogClient() first returns
    // this stub. Logging on every capture() call here would spam.
  },
  async flush() {
    // No-op — nothing was ever queued.
  },
};

let posthogClient: PostHog | null = null;
let warnedMissingToken = false;

export function getPostHogClient(): PostHogServerClient {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, " +
          "this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured"
      );
    }
    // Production with a missing token: fail loud once, then hand back a
    // real no-op rather than `new PostHog("__missing__", ...)`, which would
    // happily POST garbage events to PostHog's ingestion endpoint under a
    // bogus project token on every single call.
    if (!warnedMissingToken) {
      console.error(
        "[posthog-server] disabled: NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN missing — server events dropped"
      );
      warnedMissingToken = true;
    }
    return noopClient;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(token, {
      host,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return posthogClient;
}

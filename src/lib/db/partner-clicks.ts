/**
 * db/partner-clicks.ts
 *
 * Append-only partner click log — records every affiliate CTA click,
 * signed-in or anonymous. Separate table from user_events (which requires a
 * Clerk user_id) so signed-out top-of-funnel clicks aren't dropped.
 * No PI is stored for anonymous rows: no IP, no user agent.
 */

import { sql, dbAvailable } from "@/lib/db";

export interface PartnerClickInput {
  vendor: string;
  vertical?: string;
  state?: string;
  source?: string;
  affiliate?: boolean;
  propertySlug?: string;
  city?: string;
  userId?: string | null;
}

export async function trackPartnerClick(input: PartnerClickInput): Promise<void> {
  if (!dbAvailable()) return;

  // Fail soft: a click log must never break the endpoint (e.g. during the
  // window between deploy and running /api/db/migrate for this table).
  try {
    const db = sql();
    await db`
      INSERT INTO partner_clicks (
        vendor, vertical, state, source, affiliate, property_slug, city, user_id
      ) VALUES (
        ${input.vendor}, ${input.vertical ?? null}, ${input.state ?? null},
        ${input.source ?? null}, ${input.affiliate ?? null}, ${input.propertySlug ?? null},
        ${input.city ?? null}, ${input.userId ?? null}
      )
    `;
  } catch (err) {
    console.error("partner_clicks insert failed:", err);
  }
}

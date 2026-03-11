/**
 * email.ts
 *
 * Send assessment result emails via Resend.
 * Sender: Property Insights <insights@mail.propertyinsights.xyz>
 */

import { Resend } from "resend";
import { Listing } from "./types";
import { fmt, pct, slugify } from "./utils";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "Property Insights <insights@mail.propertyinsights.xyz>";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://propertyinsights.xyz";

interface AssessmentEmailData {
  listing: Listing;
  tier: string;
  score: number;
  narrative: string;
  finalOffer?: number;
  savings?: number;
  percentOfList?: number;
}

function formatNarrative(narrative: string): string {
  // Split long narrative into paragraphs every 2-3 sentences for readability.
  const sentences = narrative.match(/[^.!?]+[.!?]+/g) || [narrative];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    paragraphs.push(sentences.slice(i, i + 3).join("").trim());
  }
  return paragraphs
    .map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151">${p}</p>`)
    .join("");
}

function buildAssessmentHtml(data: AssessmentEmailData): string {
  const { listing, tier, score, narrative, finalOffer, savings, percentOfList } = data;
  const propertyUrl = `${BASE_URL}/property/${slugify(listing.address)}`;
  const squareOneUrl = process.env.NEXT_PUBLIC_SQUAREONE_URL || "";

  const offerSection = finalOffer
    ? `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:8px">Recommended Offer</div>
        <div style="font-size:36px;font-weight:700;font-family:monospace;color:#111">${fmt(finalOffer)}</div>
        <div style="font-size:14px;color:#16a34a;margin-top:4px">
          Save ${fmt(savings || 0)} &middot; ${pct(percentOfList || 0)} of list
        </div>
      </div>`
    : "";

  const tierColors: Record<string, string> = {
    HOT: "#fef2f2;color:#b91c1c",
    WARM: "#fffbeb;color:#b45309",
    WATCH: "#eff6ff;color:#2563eb",
  };
  const tierLabels: Record<string, string> = { HOT: "Hot", WARM: "Warm", WATCH: "Cool" };
  const tierStyle = tierColors[tier] || tierColors.WATCH;
  const tierLabel = tierLabels[tier] || "Cool";

  const preheader = finalOffer
    ? `${tierLabel} signal — Offer ${fmt(finalOffer)} on ${listing.address}`
    : `${tierLabel} signal — ${listing.address}, ${listing.city}`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <!-- Preheader text (visible in inbox preview, hidden in email body) -->
  <div style="display:none;max-height:0;overflow:hidden">${preheader}</div>

  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px">
      <table role="presentation" style="margin:0 auto"><tr>
        <td style="vertical-align:middle;padding-right:10px">
          <img src="${BASE_URL}/logo.png" width="30" height="30" alt="Property Insights" style="display:block;border:0" />
        </td>
        <td style="vertical-align:middle">
          <span style="font-size:16px;font-weight:600;color:#111;letter-spacing:-0.3px">Property Insights</span>
        </td>
      </tr></table>
    </div>

    <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:32px;margin-bottom:24px">
      <div style="margin-bottom:24px">
        <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#111">${listing.address}</h1>
        <p style="margin:0;font-size:14px;color:#6b7280">${listing.city}, ${listing.province}</p>
      </div>

      <div style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;background:${tierStyle};margin-bottom:16px">
        ${tierLabel} &middot; ${score}/100
      </div>

      ${offerSection}

      <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:16px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:8px">The Signal</div>
        ${formatNarrative(narrative)}
      </div>

      <!-- Metrics (table-based for email client compatibility) -->
      <table role="presentation" width="100%" style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;border-collapse:collapse">
        <tr>
          <td width="33%" style="padding:0 8px 0 0;vertical-align:top">
            <div style="font-size:11px;color:#6b7280;margin-bottom:2px">List Price</div>
            <div style="font-size:14px;font-weight:500;font-family:monospace;color:#111">${fmt(listing.price)}</div>
          </td>
          <td width="33%" style="padding:0 8px;vertical-align:top">
            <div style="font-size:11px;color:#6b7280;margin-bottom:2px">Beds/Baths</div>
            <div style="font-size:14px;font-weight:500;color:#111">${listing.beds}/${listing.baths}</div>
          </td>
          <td width="34%" style="padding:0 0 0 8px;vertical-align:top">
            <div style="font-size:11px;color:#6b7280;margin-bottom:2px">DOM</div>
            <div style="font-size:14px;font-weight:500;color:#111">${listing.dom}d</div>
          </td>
        </tr>
      </table>
    </div>

    <div style="text-align:center;margin-bottom:24px">
      <a href="${propertyUrl}" style="display:inline-block;padding:10px 24px;background:#111;color:white;text-decoration:none;border-radius:999px;font-size:14px;font-weight:500">
        View full analysis
      </a>
    </div>

    ${squareOneUrl ? `
    <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:6px">Next Step</div>
      <a href="${squareOneUrl}" target="_blank" rel="noopener noreferrer" style="font-size:14px;font-weight:500;color:#111;text-decoration:none">
        Get a home insurance quote
      </a>
      <p style="margin:4px 0 0;font-size:12px;color:#6b7280">$20 credit applied automatically &middot; Square One</p>
    </div>` : ""}

    <div style="text-align:center;font-size:12px;color:#9ca3af">
      <p style="margin:0">Property Insights &middot; propertyinsights.xyz</p>
      <p style="margin:4px 0 0">Data-driven acquisition intelligence</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendAssessmentEmail(
  to: string,
  data: AssessmentEmailData
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to,
      subject: `Assessment: ${data.listing.address}, ${data.listing.city}`,
      html: buildAssessmentHtml(data),
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, id: result.data?.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

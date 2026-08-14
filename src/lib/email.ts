/**
 * email.ts
 *
 * Send assessment result emails via Resend.
 * Sender: Property Insights <insights@mail.propertyinsights.xyz>
 */

import { Resend } from "resend";
import { Listing } from "./types";
import { fmt, pct, slugify } from "./utils";
import { AFFILIATE_VENDORS, getAffiliateUrl } from "@/config/affiliate-vendors";
import type { Country, InsuranceLine } from "@/config/affiliate-vendors";
import type { CoverageProfileProperty, CoverageProfileAnswers } from "./db/coverage-profiles";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "Property Insights <insights@mail.propertyinsights.xyz>";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.propertyinsights.xyz";

// Same sentence as src/components/partner-cta.tsx's cluster disclosure.
const FTC_DISCLOSURE =
  "We may earn a commission if you sign up or get a quote through these links. This doesn't affect our analysis.";

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
  const squareOneVendor = AFFILIATE_VENDORS.find((v) => v.id === "squareone");
  const squareOne = getAffiliateUrl("squareone", "email");

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

    ${squareOneVendor ? `
    <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:6px">Next Step</div>
      <a href="${squareOne.url}" target="_blank" rel="noopener noreferrer sponsored" style="font-size:14px;font-weight:500;color:#111;text-decoration:none">
        ${squareOneVendor.ctaLabel ?? squareOneVendor.name}
      </a>
      <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${squareOneVendor.offerText ?? squareOneVendor.description ?? squareOneVendor.name} &middot; ${squareOneVendor.name}</p>
      ${squareOne.isAffiliate ? `<p style="margin:8px 0 0;font-size:11px;color:#9ca3af;line-height:1.4">${FTC_DISCLOSURE}</p>` : ""}
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

/**
 * Operator-internal notification for a new coverage profile (insurance
 * path, Stage 2 — see src/app/api/coverage-profile/route.ts). This is
 * distinct from sendAssessmentEmail: it never goes to the end user, it goes
 * to whoever is operating the handoff pipeline, so it is not governed by
 * Do Not Sell/Share (Sec-GPC / pi_dns) — the profile subject already gave
 * explicit affirmative consent to share this exact data with a licensed
 * partner (consentText, carried below), and this email is simply that
 * consented handoff reaching the operator's inbox. No listing enrichment
 * or LLM narrative — just the raw submitted profile.
 */
interface CoverageProfileNotificationData {
  id: string;
  createdAt: string;
  country: Country;
  region: string;
  address: string;
  line: InsuranceLine;
  property: CoverageProfileProperty;
  answers: CoverageProfileAnswers;
  consentText: string;
}

const COVERAGE_LINE_LABELS: Record<InsuranceLine, string> = {
  homeowner: "Homeowner",
  landlord: "Landlord",
  tenant: "Tenant",
  strata: "Strata",
  commercial: "Commercial",
};

const COVERAGE_OCCUPANCY_LABELS: Record<CoverageProfileAnswers["occupancy"], string> = {
  owner: "Owner-occupied",
  long_term_rental: "Long-term rental",
  short_term_rental: "Short-term rental",
  vacant: "Vacant",
  strata_corp: "Strata corporation",
};

function notifNum(value: number | null, suffix = ""): string {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}

function notifSourceTag(source: "known" | "modeled"): string {
  const style =
    source === "known"
      ? "background:#f0fdf4;color:#16a34a"
      : "background:#fffbeb;color:#b45309";
  const label = source === "known" ? "known" : "modeled";
  return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;${style}">${label}</span>`;
}

function notifRow(label: string, value: string): string {
  return `
      <tr>
        <td style="padding:4px 12px 4px 0;font-size:12px;color:#6b7280;vertical-align:top;white-space:nowrap">${label}</td>
        <td style="padding:4px 0;font-size:13px;color:#111;vertical-align:top">${value}</td>
      </tr>`;
}

function notifSection(title: string, rowsHtml: string): string {
  return `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:8px">${title}</div>
      <table role="presentation" width="100%" style="border-collapse:collapse">${rowsHtml}
      </table>
    </div>`;
}

function buildCoverageProfileNotificationHtml(profile: CoverageProfileNotificationData): string {
  const { id, createdAt, country, region, address, line, property, answers, consentText } = profile;
  const lineLabel = COVERAGE_LINE_LABELS[line] ?? line;
  const createdLabel = new Date(createdAt).toUTCString();

  const overviewRows =
    notifRow("Profile ID", `<span style="font-family:monospace">${id}</span>`) +
    notifRow("Created", createdLabel) +
    notifRow("Country / Region", `${country} / ${region}`) +
    notifRow("Line", lineLabel) +
    notifRow("Address", address || "no address");

  const propertyRows =
    notifRow("Type", `${property.identity.type} ${notifSourceTag(property.identity.source)}`) +
    notifRow("Year built", notifNum(property.identity.yearBuilt)) +
    notifRow("Beds / Baths", `${notifNum(property.identity.beds)} / ${notifNum(property.identity.baths)}`) +
    notifRow("Sqft", notifNum(property.identity.sqft)) +
    notifRow(
      "Estimated value",
      `${property.value.estimatedValue !== null ? fmt(property.value.estimatedValue) : "—"} ${notifSourceTag(property.value.source)}`
    ) +
    notifRow("Estimated rent", property.value.estimatedRent !== null ? fmt(property.value.estimatedRent) : "—") +
    notifRow(
      "Hazards (flood / wildfire / wind)",
      `${notifNum(property.hazards.flood)} / ${notifNum(property.hazards.wildfire)} / ${notifNum(property.hazards.wind)} ${notifSourceTag(property.hazards.source)}`
    );

  const answersRows =
    notifRow("Occupancy", COVERAGE_OCCUPANCY_LABELS[answers.occupancy] ?? answers.occupancy) +
    notifRow("Unit count", String(answers.unitCount)) +
    notifRow("Claims (5yr)", String(answers.claims5yr)) +
    notifRow("Roof age", notifNum(answers.roofAge, " yrs")) +
    notifRow("Current coverage expiry", answers.coverageExpiry ?? "—");

  const contactRows =
    notifRow("Name", answers.contact.name) +
    notifRow("Email", answers.contact.email ?? "—") +
    notifRow("Phone", answers.contact.phone ?? "—") +
    notifRow("Preferred contact", answers.contact.preference);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-size:16px;font-weight:600;color:#111;letter-spacing:-0.3px">Property Insights &middot; New coverage profile</span>
    </div>

    <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:32px;margin-bottom:24px">
      <div style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;background:#eff6ff;color:#2563eb;margin-bottom:20px">
        ${lineLabel} handoff intake
      </div>

      ${notifSection("Profile", overviewRows)}
      ${notifSection("Property", propertyRows)}
      ${notifSection("Answers", answersRows)}
      ${notifSection("Contact", contactRows)}

      <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:4px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6b7280;margin-bottom:8px">Handoff intent (consent text shown to user)</div>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#374151;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px">${consentText}</p>
      </div>
    </div>

    <div style="text-align:center;font-size:12px;color:#9ca3af">
      <p style="margin:0">Property Insights &middot; propertyinsights.xyz</p>
      <p style="margin:4px 0 0">Operator-internal notification &mdash; not sent to the profile submitter.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Notify the operator inbox of a new coverage profile submission. Same
 * soft-fail contract as sendAssessmentEmail ({success:false} on any
 * failure, never throws) — callers that need fail-loud behavior (e.g.
 * POST /api/coverage-profile) are responsible for surfacing a failed
 * `success` visibly (console.error + a response field), since this
 * function's job is only to attempt the send, not to decide how the
 * caller reports it.
 */
export async function sendCoverageProfileNotification(
  profile: CoverageProfileNotificationData
): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const to = process.env.OPERATOR_NOTIFY_EMAIL ?? "insights@mail.propertyinsights.xyz";
  const lineLabel = COVERAGE_LINE_LABELS[profile.line] ?? profile.line;
  const addressLabel = profile.address || "no address";

  try {
    const result = await resend.emails.send({
      from: FROM,
      to,
      subject: `New coverage profile — ${lineLabel} · ${profile.region} · ${addressLabel}`,
      html: buildCoverageProfileNotificationHtml(profile),
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, id: result.data?.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

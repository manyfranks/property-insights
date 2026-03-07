import { notFound } from "next/navigation";
import Link from "next/link";
import { getListingBySlug } from "@/lib/kv/listings";
import { analyzeListingAsync } from "@/lib/analyze";
import { OfferResult } from "@/lib/types";
import { cityToSlug, fmt, pct } from "@/lib/utils";
import TierBadge from "@/components/tier-badge";
import ExpandableSection from "@/components/expandable-section";

function ScoreBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1.5">
      {entries.map(([label, pts]) => (
        <div key={label} className="flex items-center justify-between text-sm">
          <span className="text-muted">{label}</span>
          <span className="font-mono font-medium">+{pts}</span>
        </div>
      ))}
    </div>
  );
}

function OfferCascade({ offer }: { offer: OfferResult }) {
  const isLanguage = offer.anchorType === "language";
  const steps = [
    {
      num: 1,
      title: isLanguage ? "Language Anchor" : "Assessment Anchor",
      value: fmt(offer.anchor),
      detail: offer.anchorTag,
      sub: isLanguage ? "Based on listing signals and market duration" : `List/Assessed: ${offer.listToAssessedRatio.toFixed(2)}x`,
      color: isLanguage ? "border-indigo-200 bg-indigo-50" : "border-blue-200 bg-blue-50",
    },
    {
      num: 2,
      title: "DOM Adjustment",
      value: fmt(offer.domAdjusted),
      detail: offer.domTag,
      sub: `Multiplier: ${offer.domMultiplier}x`,
      color: "border-amber-200 bg-amber-50",
    },
    {
      num: 3,
      title: "Signal Stack",
      value: fmt(offer.signalAdjusted),
      detail: offer.signalTags.length > 0 ? offer.signalTags.join(", ") : "No signals",
      sub: "",
      color: "border-purple-200 bg-purple-50",
    },
    {
      num: 4,
      title: "Final Offer",
      value: fmt(offer.finalOffer),
      detail: `${pct(offer.percentOfList)} of list`,
      sub: `Save ${fmt(offer.savings)}`,
      color: "border-green-200 bg-green-50",
    },
  ];

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div key={step.num} className={`border rounded-xl p-4 ${step.color}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted font-medium mb-0.5">Step {step.num}</div>
              <div className="text-sm font-semibold">{step.title}</div>
              <div className="text-xs text-muted mt-1">{step.detail}</div>
              {step.sub && <div className="text-xs text-muted">{step.sub}</div>}
            </div>
            <div className="font-mono text-lg font-semibold">{step.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function realtorSearchUrl(mlsNumber?: string, address?: string, city?: string): string {
  const query = mlsNumber || `${address} ${city}`;
  return `https://www.realtor.ca/map#view=list&Sort=6-D&Keywords=${encodeURIComponent(query)}`;
}

function domColor(dom: number): string {
  if (dom >= 90) return "bg-red-500";
  if (dom >= 45) return "bg-amber-500";
  return "bg-green-500";
}

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const analysis = await analyzeListingAsync(listing);
  const { assessment, score, offer, signals, llmSignals, llmConfidence, narrative } = analysis;
  const listingHistory = analysis.history;

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      {/* A. Back link */}
      <Link
        href={`/discover/${cityToSlug(listing.city)}`}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        &larr; {listing.city}
      </Link>

      {/* B. Header */}
      <div className="mt-6 mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <a
              href={realtorSearchUrl(listing.mlsNumber, listing.address, listing.city)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {listing.address}
            </a>
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {listing.city}, {listing.province}
          </p>
        </div>
        <TierBadge tier={score.tier} />
      </div>

      {/* C. Hero Card — Recommended Offer */}
      <div className="border border-border rounded-xl p-8 mb-6 text-center bg-white">
        {offer ? (
          <>
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              {offer.anchorType === "language" ? "Estimated Offer" : "Recommended Offer"}
            </div>
            <div className="text-4xl sm:text-5xl font-mono font-bold mb-2">
              {fmt(offer.finalOffer)}
            </div>
            <div className="text-sm text-green-600 mb-4">
              Save {fmt(offer.savings)} &middot; {pct(offer.percentOfList)} of list
            </div>
            {offer.anchorType === "language" && (
              <p className="text-xs text-muted mb-4 max-w-sm mx-auto">
                Based on listing language and market duration. No government assessment available.
              </p>
            )}
            <div className="border-t border-border pt-4 flex justify-center gap-8 text-center">
              <div>
                <div className="text-xs text-muted">List Price</div>
                <div className="font-mono font-medium">{fmt(listing.price)}</div>
              </div>
              {offer.anchorType === "assessment" && (
                <>
                  <div>
                    <div className="text-xs text-muted">Assessed</div>
                    <div className="font-mono font-medium">
                      {assessment ? fmt(assessment.totalValue) : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Ratio</div>
                    <div className="font-mono font-medium">
                      {offer.listToAssessedRatio.toFixed(2)}x
                    </div>
                  </div>
                </>
              )}
              {offer.anchorType === "language" && (
                <>
                  <div>
                    <div className="text-xs text-muted">Signals</div>
                    <div className="font-mono font-medium">
                      {offer.signalTags.length || "0"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">DOM</div>
                    <div className="font-mono font-medium">{listing.dom}d</div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="py-4">
            <div className="text-xs uppercase tracking-widest text-muted mb-2">
              List Price
            </div>
            <div className="font-mono text-4xl sm:text-5xl font-bold mb-3">
              {fmt(listing.price)}
            </div>
          </div>
        )}
      </div>

      {/* D. The Signal — LLM narrative */}
      <div className="bg-gray-50/50 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-widest text-muted">The Signal</div>
          {llmConfidence != null && llmConfidence > 0 && (
            <span className="text-xs text-muted font-mono">
              {Math.round(llmConfidence * 100)}% confidence
            </span>
          )}
        </div>
        {narrative ? (
          <p className="text-sm text-foreground leading-relaxed">{narrative}</p>
        ) : (
          <p className="text-sm text-foreground leading-relaxed">
            {offer
              ? "Generating analysis — check back shortly."
              : `This ${listing.beds}-bed property in ${listing.city} has been on market for ${listing.dom} days${signals.length > 0 || (llmSignals && llmSignals.length > 0) ? ` with ${(signals.length + (llmSignals?.length ?? 0))} motivation signal${(signals.length + (llmSignals?.length ?? 0)) > 1 ? "s" : ""} detected` : ""}.${score.tier === "HOT" ? " It scores in the HOT tier — worth a closer look." : score.tier === "WARM" ? " It scores in the WARM tier." : " It\u2019s currently in the WATCH tier."}`}
          </p>
        )}
      </div>

      {/* E. Bento Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Assessment */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Assessment</div>
          {assessment ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Total Value</span>
                <span className="font-mono font-medium">{fmt(assessment.totalValue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Land</span>
                <span className="font-mono">{fmt(assessment.landValue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Building</span>
                <span className="font-mono">{fmt(assessment.buildingValue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Year</span>
                <span>{assessment.assessmentYear}</span>
              </div>
              {offer && (
                <div className="flex justify-between pt-1 border-t border-border">
                  <span className="text-muted">List/Assessed</span>
                  <span className="font-mono font-medium">{offer.listToAssessedRatio.toFixed(2)}x</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Assessment not yet cached for this address.</p>
          )}
        </div>

        {/* Market Activity */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Market Activity</div>
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-2.5 h-2.5 rounded-full ${domColor(listing.dom)}`} />
            <span className="font-mono text-2xl font-bold">{listing.dom}</span>
            <span className="text-sm text-muted">days on market</span>
          </div>
          {offer && (
            <div className="text-xs text-muted mb-2">{offer.domTag}</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {listing.priceReduced && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                Price reduced
              </span>
            )}
            {listing.estateKeywords && (
              <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                Estate sale
              </span>
            )}
            {listing.hasSuite && (
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                Suite potential
              </span>
            )}
          </div>
        </div>

        {/* Motivation Signals */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Motivation Signals</div>
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-2xl font-bold">{score.total}</span>
            <span className="text-sm text-muted">/100</span>
            <TierBadge tier={score.tier} />
          </div>
          {(signals.length > 0 || (llmSignals && llmSignals.length > 0)) && (
            <div className="flex flex-wrap gap-1.5">
              {signals.map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                  {s}
                </span>
              ))}
              {llmSignals?.map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Property Details */}
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Property</div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted text-xs">Beds</span>
              <div className="font-medium">{listing.beds}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Baths</span>
              <div className="font-medium">{listing.baths}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Sqft</span>
              <div className="font-medium">{listing.sqft || "N/A"}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Built</span>
              <div className="font-medium">{listing.yearBuilt || "N/A"}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Lot</span>
              <div className="font-medium">{listing.lotSize || "N/A"}</div>
            </div>
            <div>
              <span className="text-muted text-xs">Taxes</span>
              <div className="font-medium">{listing.taxes || "N/A"}</div>
            </div>
          </div>
          {listing.mlsNumber && (
            <div className="text-xs text-muted mt-3 pt-2 border-t border-border">
              MLS# {listing.mlsNumber}
            </div>
          )}
        </div>
      </div>

      {/* F. Expandable: Offer Cascade */}
      {offer && (
        <div className="mb-4">
          <ExpandableSection title="How we calculated this" defaultOpen={false}>
            <OfferCascade offer={offer} />
          </ExpandableSection>
        </div>
      )}

      {/* G. Expandable: Score Breakdown */}
      <div className="mb-4">
        <ExpandableSection title="Score breakdown" defaultOpen={false}>
          <ScoreBreakdown breakdown={score.breakdown} />
        </ExpandableSection>
      </div>

      {/* H. Description */}
      {listing.description && (
        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest text-muted mb-2">Listing Description</div>
          <p className="text-sm text-muted leading-relaxed">{listing.description}</p>
        </div>
      )}

      {/* I. Footer links */}
      <div className="pt-6 border-t border-border flex justify-center gap-6">
        <a
          href={realtorSearchUrl(listing.mlsNumber, listing.address, listing.city)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          View on Realtor.ca &rarr;
        </a>
        {listing.url && (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            View on Zoocasa &rarr;
          </a>
        )}
      </div>
    </main>
  );
}

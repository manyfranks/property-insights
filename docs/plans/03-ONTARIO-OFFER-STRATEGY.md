# Phase 3: Ontario Offer Strategy

**Priority:** HIGH
**Effort:** 1 day
**Dependencies:** Phase 1 (property page must gracefully handle different offer types)
**Status:** NOT STARTED

## Problem

Ontario (MPAC) assessment values are frozen at January 1, 2016. A property assessed at $650K in 2016 may be fairly listed at $1.1M today. The current offer model's assessment-anchored ratio is meaningless for Ontario:

```
ratio = listPrice / assessed  →  $1,100,000 / $650,000 = 1.69x
anchorTag = "MASSIVE OVERREACH (+40%+)"  ← WRONG, it's just a stale assessment
```

This would tell the buyer to lowball at ~$670K on a property that's actually fairly priced, which is dangerous advice.

## Strategy: DOM + Language Offer Model for Ontario

Instead of assessment-anchored offers, Ontario listings get a **DOM-weighted percentage-of-list model** that uses language signals as the primary leverage indicator.

### The Algorithm

```
Step 1: Base discount (from language signals)
  - No signals:        2% below list (98% of list)
  - Tier 3 signals:    4% below list (96%)
  - Tier 2 signals:    6% below list (94%)
  - Tier 1 signals:    10% below list (90%)
  - Multiple Tier 1:   12% below list (88%)

Step 2: DOM multiplier (same as current model)
  - < 45 days:   1.0x (no additional discount)
  - 45-59 days:  0.99x
  - 60-89 days:  0.98x
  - 90-119 days: 0.96x
  - 120-149 days: 0.94x
  - 150+ days:   0.92x

Step 3: Floor / Ceiling
  - Floor: 85% of list (never recommend below this without assessment)
  - Ceiling: 98% of list
  - Round to nearest $1,000

Step 4: Anchor tag
  - Instead of "ABOVE ASSESSED", use language like:
    "LANGUAGE-BASED: 3 motivation signals + 95 DOM"
```

### Why This Works

- It never gives dangerous advice anchored on stale assessments
- Language signals are genuinely reliable — "must sell", "estate sale", "price reduced" mean the same thing in Ontario as BC
- DOM pressure is universal
- The floor is higher (85% vs 78%) because we have less certainty without a current assessment
- It's honest: the UI labels this as "language-based estimate" not "assessment-anchored offer"

## Files to Change

### `src/lib/offer-model.ts`
- Add `offerModelLanguageBased(listing: Listing): OfferResult` — the new model
- The return type is the same `OfferResult` interface but `anchorTag` uses language-based labels and `listToAssessedRatio` is set to 0 (not applicable)

### `src/lib/analyze.ts`
- In `analyzeListing()` and `analyzeListingAsync()`, when `province === "ON"` and no assessment, use `offerModelLanguageBased()` instead of returning `null`
- Later: extend to any province where assessment is unavailable (fallback chain)

### `src/app/property/[slug]/page.tsx`
- The `OfferCascade` component needs to handle the language-based anchor tag
- Step 1 label changes from "Assessment Anchor" to "Language Anchor" when ratio is 0
- Add a subtle disclaimer: "Based on listing language and market duration, not government assessment"

### `src/lib/types.ts`
- Add `anchorType?: "assessment" | "language"` to `OfferResult` interface
- This lets the frontend know which UI variant to render

## Future Enhancement: HouseSigma Estimated Values

HouseSigma publishes an "estimated value" for every listing that's usually within 5% of actual sale price. If/when HouseSigma integration moves beyond stub, their estimated value becomes a much better anchor for Ontario than MPAC:

```
ratio = listPrice / houseSigmaEstimate  →  much more useful
```

This would let Ontario listings use the assessment-anchored model with HouseSigma as the "assessment" source. But this requires solving the HouseSigma scraping problem (React SPA behind login).

## Verification

1. Pick an Ontario listing (e.g., `20 TARMOLA PARK COURT`)
2. Verify the offer model produces a language-based offer instead of null
3. Verify the property page renders the offer with language-based labels
4. Verify the cascade shows "Language Anchor" instead of "Assessment Anchor"
5. Verify BC listings still use the assessment-anchored model (no regression)

## Definition of Done

- [ ] `offerModelLanguageBased()` implemented and tested
- [ ] Ontario listings always produce an offer (never null)
- [ ] Property page correctly renders language-based vs assessment-based offers
- [ ] BC/AB listings are unchanged (regression check)
- [ ] Build passes

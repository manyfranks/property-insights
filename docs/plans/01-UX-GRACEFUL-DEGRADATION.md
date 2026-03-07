# Phase 1: UX Graceful Degradation

**Priority:** CRITICAL
**Effort:** 1-2 hours
**Dependencies:** None
**Status:** NOT STARTED

## Problem

131/176 property pages show this as the hero card:

```
Offer Unavailable
No assessment data available. The offer model requires a government
assessment value to anchor pricing.
```

This is a data gap being presented as a product failure. Users land on a property page and the first thing they see is an error banner.

## Goal

Every property page should feel complete and useful regardless of assessment data availability. The offer section is a *bonus* when we have the data, not the entire page.

## Files to Change

### `src/app/property/[slug]/page.tsx`

#### Hero Card (lines 129-174)
Currently: offer exists = big green number, no offer = big red error.

**New behavior:**
- **With offer:** Same as today (recommended offer, savings, ratio) — no changes needed
- **Without offer:** Show list price prominently + a subtle note that assessment data will unlock the offer model. Don't use "Unavailable" language. Frame it as "coming soon" or "assessment pending."

Replace lines 160-173:
```tsx
// Instead of "Offer Unavailable" as headline:
<div className="py-4">
  <div className="text-xs uppercase tracking-widest text-muted mb-2">
    List Price
  </div>
  <div className="font-mono text-4xl sm:text-5xl font-bold mb-3">
    {fmt(listing.price)}
  </div>
  <p className="text-xs text-muted max-w-sm mx-auto">
    Offer modeling requires a government assessment value.
    The score and signals below are fully available.
  </p>
</div>
```

#### Narrative Section (lines 176-195)
Currently: when no offer, shows "No assessment data available to generate an analysis."

**New behavior:** If `preNarrative` exists, show it even without an offer. If no narrative at all, show a brief summary built from the score/signals instead of an error message.

```tsx
// Fallback when no narrative and no offer:
<p className="text-sm text-foreground leading-relaxed">
  This {listing.beds}-bed property in {listing.city} has been on market
  for {listing.dom} days{signals.length > 0 ? ` with ${signals.length} motivation signal${signals.length > 1 ? 's' : ''} detected` : ''}.
  {score.tier === "HOT" ? " It scores in the HOT tier — worth a closer look." :
   score.tier === "WARM" ? " It scores in the WARM tier." :
   " It's currently in the WATCH tier."}
</p>
```

#### Assessment Card (lines 200-230)
Currently: shows "No assessment data available" in the assessment bento card.

**New behavior:** Same, but soften the language:
```
Assessment data not yet cached for this address.
```

### Summary of all changes in `page.tsx`

| Section | Current (no offer) | New (no offer) |
|---------|-------------------|----------------|
| Hero card headline | "Offer Unavailable" | "List Price" |
| Hero card body | Error explanation | Clean price display + subtle note |
| Narrative | "No assessment data..." | Auto-generated summary from score/signals |
| Assessment card | "No assessment data available" | "Assessment not yet cached" |

## Verification

1. Pick a listing with preOffer (e.g., any from original Victoria batch) — should render identically to today
2. Pick a listing WITHOUT preOffer (e.g., `6542 OAK STREET`) — should show list price cleanly, no error language
3. Pick a listing with preNarrative but no preOffer — narrative should still display
4. Mobile responsive check on the hero card

## Definition of Done

- [ ] No property page shows "Offer Unavailable" or "No assessment data" as a headline
- [ ] List price is always prominently displayed
- [ ] Score, signals, and narrative are the primary content regardless of offer status
- [ ] Offer cascade section only appears when offer data exists (already gated, no change)
- [ ] Build passes (`npm run build`)

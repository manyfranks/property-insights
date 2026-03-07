# Phase 4: Pipeline & Cron

**Priority:** CRITICAL — this is the next step
**Effort:** 2 days
**Dependencies:** None (all prereqs completed)
**Status:** NOT STARTED

## Problem

Listings are seeded manually via `scripts/seed-zoocasa.ts`. There's no automated refresh. New listings aren't discovered, delisted ones linger (freshness cron removes them weekly but doesn't replace them), and every HOT/WARM property page triggers an LLM call + potential Browserless scrape on every visit.

## Goal

A semi-daily cron job that:
1. Refreshes listings from Zoocasa for each city
2. Batch-scrapes BC assessments for new addresses
3. Pre-computes scores, offers, and narratives for all listings
4. Writes enriched data to KV so property pages serve instantly

## Sub-tasks

### 4A: Listing Refresh (semi-daily)

Fetch fresh listings from Zoocasa, compare against KV, add new ones, flag delisted.

```
Vercel Cron (7am + 4pm PT)
    |
    v
/api/pipeline/refresh
    |
    ├── For each city (10 cities):
    |   ├── searchListings(city, province, filters)  (~2s)
    |   ├── Compare MLS numbers against KV listings
    |   ├── For new MLS: fetchDetail() for full data  (~1.5s each)
    |   └── Remove delisted (not in search results for 2+ runs)
    |
    ├── Write updated listings to KV
    └── Return summary { added, removed, unchanged }
```

### 4B: BC Assessment Batch (runs after 4A if new BC listings)

Batch-scrape BC Assessment for new BC addresses not in cache.

```
For each new BC listing without cached assessment:
    ├── lookupBC(address)  →  Puppeteer/Browserless (~8-12s)
    ├── On success: add to assessment cache
    └── Throttle: 1 lookup per 15s (Browserless rate limit)
```

**Scope:** Only new BC addresses. Cached addresses skip. AB uses SODA API inline (fast, no batch needed). ON skips (no live source).

**Cost:** ~$0.12/lookup × ~5 new BC listings/run = ~$0.60/run. Drops to near-zero once cache is warm.

### 4C: Narrative Pre-computation (runs after 4A + 4B)

For every listing in KV, compute and store enriched fields.

```
For each listing:
    ├── lookupAssessmentSync(address, province)  →  cache hit or null
    ├── scoreV2(listing)  →  { total, tier, breakdown }
    ├── offerModel or offerModelLanguage  →  OfferResult
    ├── IF tier is HOT or WARM:
    |   └── analyzeAndNarrate(listing, assessment, offer, signals)  →  LLM call (~2-4s)
    ├── IF tier is WATCH:
    |   └── deterministicNarrative(listing, assessment, offer, signals)  →  instant
    └── Write preScore, preTier, preSignals, preNarrative, preOffer to listing
```

After enrichment, `writeAllListings()` persists everything to KV. Property pages hit the `hasPre` fast path — zero external calls.

## Architecture

```
Vercel Cron
    |
    v
/api/pipeline/refresh (GET, maxDuration=300)
    |
    ├── Step 1: Listing refresh (4A)
    |   └── ~30s for 10 cities (searches parallel, details sequential with 1.5s delay)
    |
    ├── Step 2: BC assessment batch (4B)
    |   └── ~60s for ~5 new BC listings (sequential, 12s each)
    |
    ├── Step 3: Narrative pre-computation (4C)
    |   └── ~60s for ~50 listings (~15 need LLM at ~3s each, rest instant)
    |
    ├── Step 4: Write to KV
    |   └── writeAllListings(enrichedListings) + metadata update
    |
    └── Return summary JSON
```

**Total estimated time:** ~150s. Fits within Vercel Pro 300s timeout.

## Time Budget

| Stage | Per Run | Notes |
|-------|---------|-------|
| Zoocasa search (10 cities, parallel) | ~5s | 2 searches per city |
| Detail fetch (new listings only, ~10) | ~20s | 1.5s delay between |
| BC assessment batch (~5 new) | ~60s | 12s each, sequential |
| Score + offer model (50 listings) | ~1s | All synchronous |
| LLM narratives (~15 HOT/WARM) | ~45s | 3s each via MiniMax |
| KV write | ~10s | 50 listings + slug indexes |
| **Total** | **~140s** | Well within 300s limit |

## Cost Budget

| Resource | Per Run | 2x Daily | Monthly |
|----------|---------|----------|---------|
| Zoocasa | Free | Free | Free |
| Browserless (new BC only) | ~$0.60 | ~$1.20 | ~$36 |
| OpenRouter MiniMax M2.5 | ~$0.05 | ~$0.10 | ~$3 |
| Vercel KV | — | — | ~$5 |
| **Total** | **~$0.65** | **~$1.30** | **~$44** |

Once BC assessment cache is warm (after first few runs), Browserless cost drops to near-zero for existing listings. New listings trickle in at ~1-3 per city per week.

## Files to Create

### `src/app/api/pipeline/refresh/route.ts`

Main cron handler combining all three sub-tasks.

```typescript
export const maxDuration = 300;

export async function GET(request: Request) {
  // Verify CRON_SECRET
  // Step 1: Listing refresh per city
  // Step 2: BC assessment batch for new addresses
  // Step 3: Pre-compute score/offer/narrative for all listings
  // Step 4: Write enriched listings to KV
  // Return summary
}
```

### `src/lib/pipeline/enrich.ts`

Enrichment function: takes a listing, returns it with preScore/preTier/preOffer/preNarrative/preSignals populated.

```typescript
export async function enrichListing(listing: Listing): Promise<Listing> {
  const assessment = lookupAssessmentSync(listing.address, listing.province);
  const score = scoreV2(listing);
  const offer = assessment ? offerModel(listing, assessment) : offerModelLanguage(listing);
  const signals = getSignals(listing);

  if (score.tier === "WATCH") {
    const narrative = deterministicNarrative({ listing, assessment, offer, signals });
    return { ...listing, preScore: score.total, preTier: score.tier, preSignals: signals, preNarrative: narrative, preOffer: toPreOffer(offer) };
  }

  const llm = await analyzeAndNarrate({ listing, assessment, offer, signals });
  return { ...listing, preScore: score.total, preTier: score.tier, preSignals: [...signals, ...llm.signals], preNarrative: llm.narrative, preOffer: toPreOffer(offer) };
}
```

## Files to Modify

### `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/pipeline/freshness",
      "schedule": "0 15 * * 1"
    },
    {
      "path": "/api/pipeline/refresh",
      "schedule": "0 14,23 * * *"
    }
  ]
}
```

`0 14 UTC` = 7am PT, `0 23 UTC` = 4pm PT. Semi-daily.

### `src/lib/data/assessments.ts`

New BC assessments from batch scrape should be appended to the cache so subsequent runs don't re-scrape.

## Data Flow

```
                    Zoocasa Search
                         |
                         v
              ┌─── New Listings ───┐
              |                    |
        BC Assessment         Score + Offer
         (Browserless)             |
              |              ┌─────┴──────┐
              v              v            v
         Assessment     HOT/WARM       WATCH
          Cache         LLM Call     Deterministic
              |              |         Template
              └──────┬───────┘            |
                     v                    |
              Pre-computed Fields ◄───────┘
                     |
                     v
                 KV Write
                     |
              ┌──────┴───────┐
              v              v
        listings:all    listings:by-slug:*
              |
              v
        Property Pages
        (instant, no external calls)
```

## Verification

1. Manual trigger: `curl /api/pipeline/refresh` with auth header
2. Check KV listings for `preScore`, `preTier`, `preNarrative`, `preOffer` fields
3. Load property page — should render instantly with no loading state for narrative
4. Run again — KV dedup should prevent duplicate listings
5. Check Vercel function logs for timing breakdown
6. Build passes

## Definition of Done

- [ ] Cron handler runs on schedule (semi-daily) without errors
- [ ] New Zoocasa listings are discovered and added to KV
- [ ] Delisted listings are removed after missing from 2+ consecutive runs
- [ ] BC assessments are batch-scraped and cached for new addresses
- [ ] All listings have preScore, preTier, preOffer, preNarrative, preSignals
- [ ] Property pages serve from pre-computed data (zero external calls)
- [ ] Total execution time under 300s
- [ ] Build passes and deploys to Vercel

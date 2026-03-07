# Phase 4: Pipeline & Cron

**Priority:** HIGH
**Effort:** 2-3 days
**Dependencies:** Phase 2 (data must be clean before automating)
**Status:** NOT STARTED

## Problem

The pipeline exists (`runCityPipeline` in `src/lib/pipeline/city-run.ts`) but there's no cron handler to run it automatically. Today, everything is manual — listings are hardcoded in `listings.ts`, analysis is computed on page load.

## Goal

A daily cron job that:
1. Fetches fresh listings from realtor.ca for each subscribed city
2. Filters, deduplicates, and scores them
3. Enriches the top picks (assessment lookup + LLM analysis)
4. Stores results to a database
5. Triggers email delivery (Phase 5)

## Architecture

```
Vercel Cron (8am PT daily)
    |
    v
/api/pipeline/cron (route handler)
    |
    ├── Pull subscribed cities from Clerk user metadata
    ├── Deduplicate city list (fetch each city once)
    |
    ├── For each city:
    |   ├── runCityPipeline(city, province, { limit: 10 })
    |   |   ├── Fetch from realtor.ca (2 API calls, ~6s)
    |   |   ├── Filter exclusions
    |   |   ├── Dedup against KV seen store
    |   |   ├── Score with scoreV3
    |   |   └── Return top 10 picks
    |   |
    |   └── For each pick (top 5):
    |       ├── lookupAssessment (cache or Browserless, ~8-12s)
    |       ├── analyzeDescription (Haiku, ~1-2s)
    |       ├── offerModel (instant, if assessment found)
    |       └── generateOfferNarrative (Sonnet, ~2-3s)
    |
    ├── Store enriched picks to Vercel Postgres
    └── Trigger email digest (Phase 5)
```

### Time Budget

| Stage | Per City | 20 Cities |
|-------|----------|-----------|
| Fetch + filter + score | ~6s | ~30s (4 parallel) |
| Enrich top 5 (assessment + LLM) | ~30s | ~150s (sequential per city, cities parallel) |
| Store to Postgres | ~1s | ~5s |
| **Total** | ~37s | **~185s** |

Vercel Pro function timeout: 300s. This fits with room to spare.

### Cost Budget

| Resource | Per City/Day | 20 Cities/Day | Monthly |
|----------|-------------|---------------|---------|
| ScraperAPI | $0.002 | $0.04 | $1.20 |
| Browserless | $0.05 | $1.00 | $30 |
| OpenRouter (Haiku) | $0.005 | $0.10 | $3 |
| OpenRouter (Sonnet) | $0.05 | $1.00 | $30 |
| Vercel Postgres | - | - | ~$5 |
| **Total** | **$0.10** | **$2.14** | **~$70** |

## Files to Create

### `src/app/api/pipeline/cron/route.ts`
The main cron handler. Vercel invokes this on schedule.

```typescript
// Pseudocode structure:
export async function GET(request: Request) {
  // Verify cron secret (Vercel sets CRON_SECRET)
  // Pull subscribed cities from Clerk
  // Group users by city
  // For each city: runCityPipeline -> enrich top picks
  // Store to Postgres
  // Return summary
}
```

### `src/lib/pipeline/enrich.ts`
Enrichment function that takes a raw pick and adds assessment + LLM data.

### `src/lib/db/schema.sql`
Vercel Postgres schema:
```sql
CREATE TABLE picks (
  id SERIAL PRIMARY KEY,
  run_date DATE NOT NULL,
  city TEXT NOT NULL,
  province TEXT NOT NULL,
  mls_number TEXT,
  address TEXT NOT NULL,
  price INTEGER NOT NULL,
  dom INTEGER,
  score INTEGER,
  tier TEXT,
  signals TEXT[],
  narrative TEXT,
  offer_amount INTEGER,
  assessment_total INTEGER,
  listing_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mls_number, run_date)
);

CREATE INDEX idx_picks_city_date ON picks(city, run_date);
```

### `src/lib/db/index.ts`
Database client and query helpers.

## Files to Modify

### `vercel.json`
Add cron schedule:
```json
{
  "crons": [
    {
      "path": "/api/pipeline/cron",
      "schedule": "0 15 * * *"
    }
  ]
}
```
(0 15 UTC = 8am PT)

### `src/lib/data/city-bounds.ts`
Add any new cities users have subscribed to.

## Monitoring

### `/api/pipeline/admin` (optional but recommended)
A simple admin endpoint that returns:
- Last run timestamp and duration
- Per-city stats (fetched, filtered, enriched, stored)
- Error log for failed enrichments
- KV seen store stats (total seen, per city)

## Verification

1. Manual trigger: `curl /api/pipeline/cron` with correct auth header
2. Check Postgres for new picks
3. Verify KV seen store was updated (subsequent run shouldn't return same picks)
4. Check Vercel function logs for timing and errors
5. Dry run mode: `runCityPipeline(..., { dryRun: true })` previews without side effects

## Definition of Done

- [ ] Cron handler runs on schedule without errors
- [ ] Top 5-10 picks per city are enriched and stored to Postgres
- [ ] KV dedup prevents repeat picks across runs
- [ ] Admin endpoint shows run status
- [ ] Total execution time under 300s for all subscribed cities
- [ ] Dry run mode works for testing
- [ ] Build passes and deploys to Vercel

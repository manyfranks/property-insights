# Phase 2: Data Backfill

**Priority:** CRITICAL
**Effort:** 1-2 days
**Dependencies:** None (can run in parallel with Phase 1)
**Status:** NOT STARTED

## Problem

176 listings, 0 fully complete. The missing data breaks across three categories:

### Category A: Assessment Data (gates offers)
131 listings have no `preOffer`. The offer model returns null when there's no assessment in the cache AND no preOffer on the listing. Many of these addresses *do* exist in the assessment cache but the lookup is failing due to address format mismatches.

### Category B: Property Details (scraped incompletely)
- **lotSize:** 118/176 missing (67%)
- **taxes:** 87/176 missing (49%)
- **yearBuilt:** 76/176 missing (43%)

These are available from realtor.ca listing detail pages but weren't captured in the initial scrape.

### Category C: Pipeline Enrichment (never ran)
- **description:** 45/176 missing — can't run LLM signals without it
- **preSignals:** 62/176 missing
- **preScore/preTier/preNarrative:** 24/176 missing (zero enrichment)

---

## Task 2A: Fix Assessment Cache Mismatches

**Why 131 listings miss offers when many have cached assessments:**

The BC assessment cache has entries like `"838 Princess Ave"` but the listing address might be `"838 Princess Ave, Victoria, BC"`. The sync lookup does an exact match: `BC_ASSESSMENT_CACHE[address]`. If the listing's `address` field includes city/province or differs in casing/formatting, it won't match.

### Action Items

- [ ] **2A.1** Write a diagnostic script that compares listing addresses to assessment cache keys. Identify which of the 131 "no offer" listings actually DO have a cached assessment that isn't matching.
- [ ] **2A.2** Normalize the address matching in `lookupBCSync` / `lookupABSync` / `lookupONSync` — strip city/province suffixes, normalize casing, handle unit number formats (e.g., `"104 3133 Tillicum Rd"` vs `"3133 Tillicum Rd #104"`).
- [ ] **2A.3** For listings that genuinely have no cached assessment, batch-scrape using the existing Browserless scraper. Throttle to 1 lookup every 15 seconds. Write results back to `assessments.ts`.

**Expected impact:** Many of the 131 may already have cached data that isn't matching. The address normalization alone could fix a large chunk.

---

## Task 2B: Backfill Property Details

These fields are available from the realtor.ca listing detail API endpoint.

### Action Items

- [ ] **2B.1** Write a backfill script that hits the realtor.ca property detail endpoint (via ScraperAPI) for each listing missing `taxes`, `yearBuilt`, or `lotSize`. Parse from `Property.Tax`, `Building.ConstructedDate`, `Land.SizeTotal`.
- [ ] **2B.2** Update listings.ts with the backfilled values.
- [ ] **2B.3** Re-run the audit script to verify counts drop.

### Missing field breakdown by province

**BC (148 listings):**
- lotSize: 98 missing
- taxes: 55 missing
- yearBuilt: 47 missing

**AB (20 listings):**
- lotSize: 20 missing (ALL)
- taxes: 16 missing

**ON (11 listings):**
- lotSize: 11 missing (ALL)
- yearBuilt: 11 missing (ALL)

---

## Task 2C: Backfill Descriptions

45 listings have no `description`. These are concentrated in:
- Vancouver: 19 listings (mostly new construction Oak St batch + scattered)
- Burnaby: 7 listings
- Surrey: 6 listings
- Richmond: 4 listings
- Coquitlam: 2 listings
- Other Metro Van: 7 listings

### Action Items

- [ ] **2C.1** Same backfill script as 2B — the description is `PublicRemarks` from the realtor.ca detail endpoint. Can be fetched in the same pass.
- [ ] **2C.2** After descriptions are populated, re-run LLM signal detection (Haiku) on the 45 listings to generate `preSignals`.

---

## Task 2D: Re-run Pipeline Enrichment

24 listings have zero pipeline enrichment (no preScore, preTier, preSignals, preNarrative). These need the full LLM pipeline run.

### Action Items

- [ ] **2D.1** After 2A-2C are complete, write a one-shot enrichment script:
  1. For each of the 24 listings:
     - Run `scoreV3()` -> `preScore`, `preTier`
     - Run `analyzeDescription()` (Haiku) -> `preSignals`
     - Look up assessment (should now be cached from 2A)
     - Run `offerModel()` -> `preOffer`
     - Run `generateOfferNarrative()` (Sonnet) -> `preNarrative`
  2. Write results back to `listings.ts`
- [ ] **2D.2** Extend the enrichment to the remaining 38 listings that have partial data (have score but no signals, etc.)

**Cost estimate:** 62 Haiku calls (~$0.06) + 62 Sonnet calls (~$0.62) = ~$0.68 total.

---

## Order of Operations

```
2A (fix assessment matching)  ──┐
2B (backfill property details) ─┼──> 2D (re-run pipeline enrichment)
2C (backfill descriptions)    ──┘
```

2A, 2B, and 2C are independent and can run in parallel.
2D must wait for all three to finish.

---

## Verification

After all tasks complete, re-run the audit script. Target:

| Field | Before | After Target |
|-------|--------|-------------|
| preOffer | 131 missing | 0 missing* |
| lotSize | 118 missing | < 10 |
| taxes | 87 missing | < 10 |
| yearBuilt | 76 missing | < 10 |
| description | 45 missing | 0 |
| preSignals | 62 missing | 0 |
| preScore | 24 missing | 0 |
| preTier | 24 missing | 0 |
| preNarrative | 24 missing | 0 |

*Some listings may genuinely not have assessment data available (e.g., brand new construction not yet assessed). For these, Phase 3's fallback offer strategy applies.

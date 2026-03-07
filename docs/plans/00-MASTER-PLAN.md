# Orio Property Insights — Master Plan

## Current State (March 2026)

176 preloaded listings across BC (13 cities), AB (2 cities), ON (1 city).
**Zero listings are fully complete.** 131/176 (74%) show "Offer Unavailable" on their property page.

### What Works
- realtor.ca fetch via ScraperAPI (server-side, no browser)
- Offer model algorithm (assessment anchor -> DOM multiplier -> signal stack -> floor/ceiling)
- LLM signal detection (Haiku via OpenRouter, ~$0.001/listing)
- LLM narrative generation (Sonnet via OpenRouter, ~$0.01/listing)
- scoreV2 (legacy, DOM-primary) + scoreV3 (new, language-first)
- Pipeline orchestrator (`runCityPipeline`) with fetch/filter/dedup/score/rank stages
- BC Assessment live scraper (Puppeteer via Browserless, 8-12s/lookup, fragile)
- User subscriptions via Clerk

### What's Broken/Missing
- 131 listings have no offer (missing assessment data or preOffer)
- 45 listings have no description (LLM can't analyze them)
- 118 missing lotSize, 87 missing taxes, 76 missing yearBuilt
- HouseSigma integration is stubbed (returns Google search URL only)
- Email delivery is stubbed
- Cron scheduling is not wired
- Ontario assessment strategy is wrong (frozen 2016 MPAC values)

---

## Phases

| Phase | Name | Priority | Effort | Dependency |
|-------|------|----------|--------|------------|
| **1** | [UX Graceful Degradation](./01-UX-GRACEFUL-DEGRADATION.md) | CRITICAL | 1-2 hours | None |
| **2** | [Data Backfill](./02-DATA-BACKFILL.md) | CRITICAL | 1-2 days | None |
| **3** | [Ontario Offer Strategy](./03-ONTARIO-OFFER-STRATEGY.md) | HIGH | 1 day | Phase 1 |
| **4** | [Pipeline & Cron](./04-PIPELINE-CRON.md) | HIGH | 2-3 days | Phase 2 |
| **5** | [Email Delivery](./05-EMAIL-DELIVERY.md) | MEDIUM | 1 day | Phase 4 |

### Phase Dependency Graph

```
Phase 1 (UX fix) ─────────────────> Phase 3 (ON offer strategy)
                                          |
Phase 2 (Data backfill) ──────────> Phase 4 (Pipeline & Cron) ──> Phase 5 (Email)
```

Phases 1 and 2 can run in parallel. Phase 3 depends on Phase 1 (same property page).
Phase 4 depends on Phase 2 (data must be clean before automating).
Phase 5 depends on Phase 4 (need the cron pipeline to generate picks to email).

---

## Key Architecture Decisions

### Assessment-anchored offers are BC/AB only
Ontario's MPAC values are frozen at 2016. The offer model's ratio-based anchor is meaningless when assessments are 10 years stale. Ontario needs a different strategy — see Phase 3.

### Language-first scoring (scoreV3) is the future
scoreV2 is DOM-primary, which breaks on relisted properties (DOM resets to 0). scoreV3 treats DOM as a multiplier on language signals. All new work should use scoreV3.

### Pre-computed vs live analysis
Preloaded listings use `preOffer`/`preScore`/`preNarrative` fields baked into `listings.ts`. The live pipeline (`analyzeListingAsync`) can compute these on the fly if assessment data exists. The long-term architecture is: cron pipeline generates picks -> enriches them (assessment + LLM) -> stores pre-computed results.

### Cost model
- ScraperAPI: ~$0.001/call (2 calls per city fetch)
- Browserless (BC Assessment): ~$0.01/lookup
- OpenRouter Haiku (signal detection): ~$0.001/listing
- OpenRouter Sonnet (narrative): ~$0.01/listing
- **Per city per day: ~$0.10**
- **20 cities daily: ~$2/day = ~$60/month**

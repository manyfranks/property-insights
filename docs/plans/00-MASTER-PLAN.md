# Orio Property Insights — Master Plan

## Current State (March 2026)

50 listings across BC (25), AB (10), ON (15) — fresh-seeded from Zoocasa.
All listings have descriptions, MLS numbers, and Zoocasa URLs.
Property pages compute analysis on-the-fly (assessment + offer model + LLM for HOT/WARM, deterministic for WATCH).

### What Works
- Zoocasa fetch (search + detail pages, `__NEXT_DATA__` extraction, no browser needed)
- Two offer models: assessment-anchored (BC/AB) + language-based fallback (ON, uncached)
- Combined LLM call (MiniMax M2.5 via OpenRouter): signal detection + Fulton-style narrative in one call
- Deterministic WATCH-tier templates (no LLM cost for low-signal listings)
- scoreV2 (DOM-primary, production) + scoreV3 (language-first, pipeline)
- BC Assessment: cache + Puppeteer/Browserless live scrape
- AB Assessment: Calgary + Edmonton SODA API (free, no auth)
- Freshness cron: weekly Zoocasa 404 check, auto-removes delisted
- KV (Upstash Redis): listings, slug indexes, dedup sets, metadata
- User subscriptions via Clerk

### What Needs Work
- No automated listing refresh (manual seed script only)
- 23/25 BC listings uncached in assessment store (trigger Puppeteer on page view)
- ON: no sqft, yearBuilt, or assessment data (Zoocasa + MPAC limitations)
- AB: no taxes data (Zoocasa limitation)
- No pre-computed narratives (LLM runs on every HOT/WARM page view)
- Email delivery is stubbed
- No user-submitted property assessment flow

---

## Phases

### Completed

| Phase | Name | Status |
|-------|------|--------|
| 1 | UX Graceful Degradation | **Done** — No "Offer Unavailable" anywhere |
| 2A | BC Assessment Batch Scrape | **Done** — +73 entries (but needs refresh for new listings) |
| 2 AB | Alberta SODA API | **Done** — Live lookups for Calgary + Edmonton |
| 2B/2C | Description + Detail Backfill | **Superseded** — Zoocasa detail fetch provides all data at seed time |
| 3 | Ontario Offer Strategy | **Done** — `offerModelLanguage()` with 85% floor |
| — | Zoocasa Migration | **Done** — Replaced realtor.ca + HouseSigma entirely |
| — | Flush & Re-seed | **Done** — 50 fresh listings, stale KV purged |

### Active Roadmap

| Phase | Name | Priority | Effort | Dependency |
|-------|------|----------|--------|------------|
| **4** | [Pipeline & Cron](./04-PIPELINE-CRON.md) | CRITICAL | 2 days | None |
| **5** | [Email Delivery](./05-EMAIL-DELIVERY.md) | HIGH | 1 day | Phase 4 |
| **6** | User Inquiry (on-demand assessment) | MEDIUM | 1-2 days | Phase 5 |

### Dependency Graph

```
Phase 4 (Pipeline & Cron)
    ├── 4A: Semi-daily listing refresh (Zoocasa → KV)
    ├── 4B: BC assessment batch scrape (Browserless)
    └── 4C: Narrative pre-computation (score → offer → LLM → write preOffer/preNarrative to KV)
           |
           v
Phase 5 (Email Delivery)
    └── Daily digest via Resend after pipeline generates picks
           |
           v
Phase 6 (User Inquiry)
    └── On-demand: user submits address/URL → assess → email result
```

Phase 4 is the foundation. Everything else depends on it.

---

## Key Architecture Decisions

### Zoocasa is the sole listing source
No scraping protection, no API keys needed. Server-rendered Next.js pages with `__NEXT_DATA__` JSON. Free and reliable.

### Assessment strategy varies by province
- **BC:** Cache + Puppeteer live scrape (land/building split available)
- **AB:** SODA API live (total value only, no land/building split)
- **ON:** Language-based fallback (no live assessment API, frozen MPAC values)

### LLM architecture: tiered by signal strength
- **WATCH tier:** Deterministic template — zero API cost, instant
- **HOT/WARM tier:** Single LLM call (signal detection + Fulton-style narrative)
- Pre-computation in Phase 4 eliminates per-pageview LLM calls entirely

### KV is the primary data store
No Postgres needed. Vercel KV (Upstash Redis) handles listings, slug indexes, dedup sets, and metadata. Static `listings.ts` is the fallback for local dev.

### Cost model (post-Phase 4)

| Resource | Per Run (10 cities) | 2x Daily | Monthly |
|----------|-------------------|----------|---------|
| Zoocasa fetch | Free | Free | Free |
| Browserless (BC assessment, ~25 listings) | $3.00 | $6.00 | ~$180 |
| OpenRouter MiniMax M2.5 (~15 HOT/WARM) | $0.05 | $0.10 | ~$3 |
| Vercel KV | — | — | ~$5 |
| **Total** | **~$3.05** | **~$6.10** | **~$188** |

Browserless is the dominant cost. Once BC assessments are cached, it drops to near-zero for repeat listings. First-run cost is front-loaded.

---

## Superseded Documents

| Doc | Status | Notes |
|-----|--------|-------|
| `01-UX-GRACEFUL-DEGRADATION.md` | Completed | No action needed |
| `02-DATA-BACKFILL.md` | Superseded by Zoocasa migration | Assessment batch (2A) still relevant for new BC listings; handled in Phase 4B |
| `03-ONTARIO-OFFER-STRATEGY.md` | Completed | `offerModelLanguage()` in production |
| `06-ZOLO-VS-HOUSESIGMA-RESEARCH.md` | Superseded | Zoocasa solved the data source problem |

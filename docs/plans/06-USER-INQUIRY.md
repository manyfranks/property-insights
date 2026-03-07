# Phase 6: User Inquiry — On-Demand Property Assessment

**Priority:** MEDIUM
**Effort:** 1-2 days
**Dependencies:** Phase 5 (email delivery infrastructure)
**Status:** NOT STARTED

## Problem

Users can only view pre-loaded listings. They can't submit a property they found on realtor.ca or ask for homes in a specific city. There's no inbound path — we push listings, but users can't pull.

## Goal

Users can submit a property (by address, realtor.ca URL, or Zoocasa URL) and receive a full assessment via email. They can also subscribe to city-level alerts.

## Input Modes

### 1. Address Text
User types: `2179 Spirit Ridge Dr`

- Fuzzy-match against Zoocasa via `searchListings()` with address as keyword
- Pick best match by address similarity
- `fetchDetail()` for full data

### 2. Realtor.ca URL
User pastes: `https://www.realtor.ca/real-estate/29349975/2179-spirit-ridge-dr-langford-bear-mountain`

- Extract address from URL slug: `2179-spirit-ridge-dr` → `2179 Spirit Ridge Dr`
- Extract city from slug: `langford`
- Search Zoocasa for the address to get full listing data
- `fetchDetail()` on best match

### 3. Zoocasa URL
User pastes: `https://www.zoocasa.com/langford-bc-real-estate/2179-spirit-ridge-dr`

- Extract slug directly
- `fetchDetail()` using the slug

### 4. City Subscription
User says: `Send me homes in Victoria, BC`

- Map to existing pipeline city
- Add user to subscription list (Clerk metadata or KV)
- Phase 5 email delivery handles the rest

## Assessment Flow

```
User submits input + email
    |
    v
POST /api/assess
    |
    ├── Parse input (detect mode: address / realtor URL / zoocasa URL)
    ├── Search Zoocasa for the property
    ├── fetchDetail() on best match
    ├── lookupAssessment(address, province)
    ├── scoreV2(listing) → tier
    ├── offerModel or offerModelLanguage → offer
    ├── IF HOT/WARM: analyzeAndNarrate() → LLM narrative
    |   ELSE: deterministicNarrative()
    ├── upsertListing(enrichedListing) to KV
    └── Send assessment email via Resend
```

## API

### `POST /api/assess`

```typescript
{
  input: string;    // address, realtor.ca URL, or zoocasa URL
  email: string;    // where to send the assessment
}
```

Response:
```typescript
{
  success: boolean;
  address: string;
  city: string;
  tier: string;
  offerAmount: number;
  message: string;  // "Assessment sent to user@example.com"
}
```

## Email Template

Single-property assessment email (distinct from daily digest):

- Property address + city
- List price + recommended offer + savings
- Tier badge + score
- Assessment gap analysis (if available)
- Narrative (Fulton-style for HOT/WARM, deterministic for WATCH)
- Link to property page on propertyinsights.xyz
- Links to Realtor.ca + Zoocasa

## Files to Create

- `src/app/api/assess/route.ts` — Main handler
- `src/lib/email/assessment-template.tsx` — React Email template for single-property assessment
- `src/lib/input-parser.ts` — Parse address/URL input, extract address + city

## Files to Modify

- `src/app/page.tsx` or new component — Input form on homepage or dedicated page

## Verification

1. Submit a realtor.ca URL → receive email with full assessment
2. Submit a plain address → correct Zoocasa match + assessment
3. Submit a property already in KV → uses existing data, doesn't duplicate
4. Submit a nonexistent address → graceful error message
5. Build passes

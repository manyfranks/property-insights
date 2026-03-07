# RE:Intel — Property Assessment Algorithm Specification

> **Purpose:** This document is a self-contained, LLM-friendly specification of the
> full motivated-seller scoring, offer modeling, and narrative generation pipeline.
> It contains every rule, every constant, every prompt, and every edge case.
> Another model should be able to reproduce identical outputs from the same inputs.

---

## Table of Contents

1. [Data Types](#1-data-types)
2. [Stage 1: Fetch Candidates](#2-stage-1-fetch-candidates)
3. [Stage 2: Hard Exclusion Filter](#3-stage-2-hard-exclusion-filter)
4. [Stage 3: Language-First Scoring (scoreV3)](#4-stage-3-language-first-scoring-scorev3)
5. [Stage 4: Assessment-Based Offer Model](#5-stage-4-assessment-based-offer-model)
6. [Stage 5: Language-Based Offer Model (No Assessment)](#6-stage-5-language-based-offer-model-no-assessment)
7. [Stage 6: LLM Signal Detection](#7-stage-6-llm-signal-detection)
8. [Stage 7: LLM Narrative Generation](#8-stage-7-llm-narrative-generation)
9. [Stage 8: Full Assessment Assembly](#9-stage-8-full-assessment-assembly)
10. [Stage 9: Dedup & Daily Picks](#10-stage-9-dedup--daily-picks)
11. [Worked Example: 3354 Fulton Rd](#11-worked-example-3354-fulton-rd)
12. [Data Availability by Market](#12-data-availability-by-market)
13. [Validation Checklist](#13-validation-checklist)

---

## 1. Data Types

### Listing (input to all stages)

```typescript
{
  address: string;          // "3354 Fulton Rd"
  city: string;             // "Colwood"
  province: string;         // "BC"
  dom: number;              // Days on market (0+ integer)
  price: number;            // List price in dollars (e.g. 799900)
  beds: string;             // "3"
  baths: string;            // "1"
  sqft: string;             // "1189" or "" if unknown
  yearBuilt: string;        // "1988" or "" if unknown
  taxes: string;            // "3575" or ""
  lotSize: string;          // "7693 sqft" or ""
  priceReduced: boolean;    // true if description contains price reduction language
  hasSuite: boolean;        // true if description mentions suite/in-law
  estateKeywords: boolean;  // true if description mentions estate/executor/probate/deceased/must sell
  description: string;      // Full MLS PublicRemarks text
  notes: string;            // Optional supplementary notes
  url: string;              // Full listing URL
  mlsNumber?: string;       // MLS number for dedup
}
```

### Assessment (from BC Assessment, MPAC, or municipal lookup)

```typescript
{
  totalValue: number;       // e.g. 752000
  landValue: number;        // e.g. 500000
  buildingValue: number;    // e.g. 252000
  assessmentYear: string;   // e.g. "2026"
  found: boolean;           // true if lookup succeeded
}
```

### ListingHistory (from Zoocasa detail page)

```typescript
{
  found: boolean;
  source: "zoocasa" | "housesigma" | "link_only";
  relistCount?: number;          // How many times delisted and relisted
  cumulativeDom?: number;        // Total days across all listing periods
  priceChanges?: {
    date: string;
    oldPrice: number;
    newPrice: number;
    changePercent: number;
  }[];
  originalListPrice?: number;    // First-ever list price
  currentListPrice?: number;     // Current list price
  totalPriceReduction?: number;  // originalListPrice - currentListPrice
  totalReductionPercent?: number;
}
```

---

## 2. Stage 1: Fetch Candidates

### Source: Zoocasa (primary)

Zoocasa is a Next.js app. All listing data is embedded in a `<script id="__NEXT_DATA__">` tag as JSON. No headless browser needed — plain HTTP fetch + JSON parse.

**Two parallel searches per city:**

```
Call 1: Default sort (relevance/featured)
  URL: https://www.zoocasa.com/{city}-{province}-real-estate?saleOrRent=sale&type=house&minPrice={min}&maxPrice={max}

Call 2: Oldest first (staleness)
  URL: same + &sortBy=days-desc
```

**Extraction path:**
```
HTML → <script id="__NEXT_DATA__"> → JSON.parse →
  .props.pageProps.props.listings[] → array of search results
```

**Search result → Listing mapping:**
- `address`: first comma-delimited segment of `result.address`
- `price`: `result.price` (integer, already in dollars)
- `dom`: `(Date.now() - Date.parse(result.created_at)) / 86400000`
- `beds`: `result.bedrooms`
- `baths`: `result.bathrooms`
- `sqft`: `result.square_footage.gte || result.square_footage.lt`
- `mlsNumber`: `result.mls`
- `url`: `https://www.zoocasa.com` + `result.listing_url_absolute_path`

**Note:** Search results do NOT include description text. The `description`, `priceReduced`, `hasSuite`, and `estateKeywords` fields are only populated from detail page fetches.

### Detail page enrichment (per listing, optional)

For top candidates after scoring, fetch the detail page to get full description + history:

```
URL: https://www.zoocasa.com/{city}-{province}-real-estate/{address-slug}
```

**Extraction path:**
```
HTML → __NEXT_DATA__ → .props.pageProps.props.activeListing.listing
```

This gives: full `description` (from `localeData.en.description`), `history[]` (relist/price change records), `taxes`, `yearBuilt` (from `misc.approxAge`), lot dimensions.

### Merge & internal dedup

Combine both search result arrays. Deduplicate by `mlsNumber` (or `address` if no MLS). First occurrence wins (default sort takes priority).

---

## 3. Stage 2: Hard Exclusion Filter

Before scoring, remove listings that cannot serve the buyer's intent. Two exclusion sets:

### Always-exclude patterns (all profiles)

These regex patterns are tested against `(description + notes + address).toLowerCase()`:

```
/leasehold/i
/prepaid lease/i
/strata lot/i
/condo fee/i
/monthly fee.*strata/i
/must be (sold|purchased) (together|with)/i
/buy.{0,10}(together|adjacent|with lot)/i
/package (deal|purchase)/i
/adjacent (lot|parcel|property)/i
/court order sale/i
/ordered by the court/i
/by order of/i
```

### SFH-buyer exclusions (SFH_BUYER profile only)

```
/tear.?down/i
/demo(lish|lition)? (permit|ready|potential)/i
/scraper/i
/value (is |in )?land/i
/land value only/i
/sold as.?is.{0,20}land/i
/land assembly/i
/development (site|land|parcel|potential|opportunity)/i
/rezoning (potential|application|opportunity)/i
/assembly (site|potential|opportunity)/i
/subdivision (potential|opportunity)/i
/ssmuh/i
/two title/i
/3 lots/i
/multiple (lots|titles|parcels)/i
/commercial zoning/i
/c-2|c2 zone/i
```

### Price & bedroom filter

```
IF profile.priceMin AND listing.price < profile.priceMin → EXCLUDE
IF profile.priceMax AND listing.price > profile.priceMax → EXCLUDE
```

### Profiles

| Profile | priceMin | priceMax | minBeds | SFH exclusions | buildingTypes |
|---------|----------|----------|---------|----------------|---------------|
| SFH_BUYER | $900K | $1.25M | 3 | Yes | House |
| INVESTOR_DEV | $700K | $2.5M | null | No | House + Duplex |
| ALL | null | null | null | No | House + Duplex + Townhouse |

---

## 4. Stage 3: Language-First Scoring (scoreV3)

### Design principle

DOM (Days on Market) is NOT the primary score driver. It is a multiplier applied AFTER the language score. A relisted property has DOM=0 on the listing site but keeps whatever motivation signals are in its description. Language is the only reliable signal that survives DOM resets.

### Step 1: Language score (0–100 raw pts)

Test each regex pattern against `(listing.description + " " + listing.notes).toLowerCase()`. Each signal can only match once (first pattern hit counts).

#### Tier 1 — Explicit desperation (20 pts each)

| Signal label | Patterns |
|---|---|
| Must Sell | `/must sell/i`, `/need(s)? to sell/i`, `/seller must sell/i` |
| Motivated Seller | `/motivated sell/i`, `/seller is motivated/i`, `/highly motivated/i` |
| Bring All Offers | `/bring (all\|any\|your) offer/i`, `/all offers (considered\|welcome\|reviewed)/i`, `/open to (all )?offer/i` |
| Priced to Sell | `/priced (to sell\|for quick\|below)/i`, `/priced? for (action\|offers)/i` |
| Relocation | `/relocation sale/i`, `/job (transfer\|relocation)/i`, `/relocating (out\|from\|due)/i`, `/transferred (out\|away)/i` |
| Estate Sale | `/estate sale/i`, `/selling (on behalf of )?(the )?estate/i`, `/executor (sale\|is selling)/i`, `/probate sale/i` |
| Power of Sale | `/power of sale/i`, `/sale by mortgagee/i`, `/mortgagee sale/i` |
| Divorce / Separation | `/divorce sale/i`, `/separation sale/i`, `/selling due to (divorce\|separation)/i` |

#### Tier 2 — Implied pressure (10 pts each)

| Signal label | Patterns |
|---|---|
| Price Reduced | `/price (has been )?reduced/i`, `/price reduction/i`, `/reduced from/i`, `/previously listed/i` |
| New Price | `/new price/i`, `/great new price/i`, `/price (improvement\|adjustment\|update)/i`, `/adjusted to/i` |
| Below Assessment | `/below (assessed\|assessment)/i`, `/under (assessed\|assessment)/i` |
| As-Is | `/as.?is (where.?is\|condition\|sale)/i`, `/sold (strictly )?as.?is/i`, `/no (representations\|warranties)/i` |
| Vacant | `/vacant (possession\|property\|home\|house)/i`, `/currently vacant/i`, `/empty (home\|house\|property)/i` |
| Quick Possession | `/quick (possession\|close\|closing)/i`, `/immediate possession/i`, `/flexible (and fast )?possession/i` |
| Back on Market | `/back on (the )?market/i`, `/re.?listed/i`, `/returned to market/i`, `/fell through/i` |
| Flexible Terms | `/seller (is )?flexible/i`, `/flexible (on )?terms/i`, `/open to (creative\|flexible) terms/i` |

#### Tier 3 — Situational signals (5 pts each)

| Signal label | Patterns |
|---|---|
| Long Held | `/first time (on\|offered\|for sale) in/i`, `/owned for (over )?(40\|50\|60) years/i`, `/original owner/i` |
| Needs TLC | `/needs? (some )?(tlc\|updating\|work\|renovation)/i`, `/handyman (special\|dream)/i`, `/sweat equity/i`, `/fixer(-\| )upper/i` |
| Tenanted | `/currently tenanted/i`, `/tenant (in place\|occupied\|month.to.month)/i` |
| Rental Income | `/rental (income\|suite\|property)/i`, `/income generating/i`, `/currently renting/i` |
| Easy to Show | `/easy (to show\|showing)/i`, `/lock(box\|box is on)/i`, `/show anytime/i` |
| Credit Incentive | `/\$[\d,]+k? (closing \|buyer \|purchase )?credit/i`, `/credit (promotion\|promo\|incentive)/i` |
| Priced Below List | `/listed well below/i`, `/significantly (below\|under)/i`, `/below (market\|similar homes)/i` |

#### Boolean flag bonuses (no double-counting)

```
IF listing.priceReduced AND "Price Reduced" not already matched → +10 pts
IF listing.estateKeywords AND "Estate Sale" not already matched → +15 pts
IF listing.hasSuite AND "Rental Income" not already matched → +3 pts
```

**languageScore = sum of all matched signal points**

### Step 2: DOM multiplier

```
DOM >= 300  →  multiplier = 1.50
DOM >= 210  →  multiplier = 1.40
DOM >= 150  →  multiplier = 1.30
DOM >= 90   →  multiplier = 1.20
DOM >= 60   →  multiplier = 1.10
DOM >= 30   →  multiplier = 1.05
DOM < 30    →  multiplier = 1.00
```

```
boostedScore = languageScore × multiplier
```

### Step 3: Assessment gap adjustment

Requires `assessedValue` on the listing object (populated from BC Assessment lookup or cache).

```
ratio = listing.price / assessedValue

IF ratio < 0.92     →  assessPts = +15, signal "Below Assessed"
IF ratio < 1.00     →  assessPts = +8
IF ratio <= 1.20    →  assessPts = 0  (normal range)
IF ratio > 1.20     →  assessPts = -5
IF no assessment    →  assessPts = -3
```

### Step 4: Final score & tier

```
total = min(round(boostedScore + assessPts), 100)

IF total >= 55  →  tier = "HOT"
IF total >= 35  →  tier = "WARM"
ELSE            →  tier = "WATCH"
```

### Output

```typescript
{
  total: number;            // 0–100
  languageScore: number;    // Raw pts before DOM multiplier
  domMultiplier: number;    // 1.0–1.5
  domTag: string;           // e.g. "90d+ — stale"
  tier: "HOT" | "WARM" | "WATCH";
  signals: string[];        // ["Must Sell", "Vacant", "Price Reduced"]
  breakdown: Record<string, number>;  // {"Must Sell": 20, "Vacant": 10, ...}
}
```

---

## 5. Stage 4: Assessment-Based Offer Model

Only runs when `assessment.found === true`. This is the primary offer model for BC and AB.

### Step 1: Assessment anchor

```
ratio = listPrice / assessment.totalValue

ratio >= 1.40  →  anchor = assessed × 1.03   tag = "MASSIVE OVERREACH (+40%+)"
ratio >= 1.25  →  anchor = assessed × 1.05   tag = "MAJOR OVERREACH (+25-40%)"
ratio >= 1.15  →  anchor = assessed × 1.08   tag = "OVERPRICED (+15-25%)"
ratio >= 1.05  →  anchor = assessed × 1.10   tag = "ABOVE ASSESSED (+5-15%)"
ratio >= 0.96  →  anchor = assessed × 0.97   tag = "FAIRLY PRICED (+/-5%)"
ratio >= 0.88  →  anchor = list × 0.95       tag = "BELOW ASSESSED (-4-12%)"
ratio < 0.88   →  anchor = list × 0.92       tag = "SELLER CAPITULATING (-12%+)"
```

### Step 2: DOM desperation multiplier (on anchor)

```
DOM >= 150  →  0.90   tag = "DESPERATE"
DOM >= 120  →  0.92   tag = "VERY STALE"
DOM >= 100  →  0.94   tag = "STALE"
DOM >= 90   →  0.95   tag = "AGING"
DOM >= 75   →  0.96   tag = "SITTING"
DOM >= 60   →  0.97   tag = "MATURING"
DOM >= 45   →  0.98   tag = "NORMAL"
DOM < 45    →  0.99   tag = "FRESH"

domAdjusted = anchor × domMultiplier
```

### Step 3: Signal stack (cumulative discounts)

Each matched signal multiplies the running total:

```
estateKeywords present            →  ×0.97  (-3%)
priceReduced present              →  ×0.98  (-2%)
"must sell" or "priced to sell"   →  ×0.97  (-3%)
"motivated seller" or "bring offers" →  ×0.97  (-3%)
"first time on market"            →  ×0.98  (-2%)
"bear mountain" cluster           →  ×0.97  (-3%)
"below assessed"                  →  ×0.97  (-3%)

signalAdjusted = domAdjusted × (stack product)
```

Maximum cumulative stack if ALL signals present:
`0.97 × 0.98 × 0.97 × 0.97 × 0.98 × 0.97 × 0.97 = 0.818` (18.2% discount from anchor)

### Step 4: Floor & ceiling

```
floor   = listPrice × 0.78    // Never insult more than 22% below ask
ceiling = listPrice × 0.97    // Never offer within 3% of ask

finalOffer = clamp(signalAdjusted, floor, ceiling)
finalOffer = round(finalOffer / 1000) × 1000   // Round to nearest $1K
```

### Output

```typescript
{
  anchor: number;
  anchorTag: string;
  anchorType: "assessment";
  listToAssessedRatio: number;
  domAdjusted: number;
  domMultiplier: number;
  domTag: string;
  signalAdjusted: number;
  signalTags: string[];         // ["Estate -3%", "MustSell -3%"]
  finalOffer: number;
  percentOfList: number;        // finalOffer / listPrice
  savings: number;              // listPrice - finalOffer
  inTargetRange: boolean;       // finalOffer between $900K–$1.25M
}
```

---

## 6. Stage 5: Language-Based Offer Model (No Assessment)

Used when no assessment data is available (Ontario with frozen MPAC values, new construction, failed lookups). Anchors on listing language instead of government valuation.

### Step 1: Language anchor

```
tier1Keywords = ["must sell", "priced to sell", "estate sale", "motivated seller",
                 "bring your offer", "bring all offers", "power of sale", "relocation"]
tier2Keywords = ["price reduced", "new price", "price adjustment", "back on market",
                 "as is", "as-is", "vacant", "quick possession", "flexible"]

tier1Count = count of tier1Keywords matched + (1 if estateKeywords flag)
hasTier1 = tier1Count > 0
hasTier2 = any tier2Keyword matched OR priceReduced flag

tier1Count >= 2  →  baseDiscount = 0.88   tag = "STRONG LANGUAGE SIGNALS"
hasTier1         →  baseDiscount = 0.90   tag = "TIER-1 LANGUAGE SIGNAL"
hasTier2         →  baseDiscount = 0.94   tag = "TIER-2 LANGUAGE SIGNAL"
any signals      →  baseDiscount = 0.96   tag = "MINOR SIGNALS"
no signals       →  baseDiscount = 0.98   tag = "NO SIGNALS"

anchor = listPrice × baseDiscount
```

### Steps 2–3: Same as assessment model

DOM multiplier and signal stack are identical to Stage 4.

### Step 4: Floor & ceiling (higher floor)

```
floor   = listPrice × 0.85    // Higher floor (less certainty without assessment)
ceiling = listPrice × 0.98    // Slightly tighter ceiling

finalOffer = clamp(signalAdjusted, floor, ceiling)
finalOffer = round(finalOffer / 1000) × 1000
```

---

## 7. Stage 6: LLM Signal Detection

An LLM call to catch motivation signals that regex patterns miss (relocation context, health/age reasons, builder inventory pressure, financial distress implied by narrative tone).

### When to call

- ONLY for listings that pass exclusion filters
- ONLY when description has 50+ characters (skip empty/minimal descriptions)
- OPTIONAL — system works without this; it adds supplementary signals

### API call

```
Provider: OpenRouter (https://openrouter.ai/api/v1)
Model: anthropic/claude-haiku
Max tokens: 200
```

### System prompt (exact text)

```
You are a real estate acquisition analyst. Analyze the MLS listing description for seller motivation signals that suggest negotiation leverage. Return ONLY a JSON object with this shape: {"signals": string[], "confidence": number}

Look for signals like:
- Relocation / moving away
- Health/age/life change reasons
- Financial pressure (foreclosure, liens, divorce)
- Property condition issues (as-is, needs work, deferred maintenance)
- Vacant property / unoccupied
- Builder/developer trying to move inventory
- Unusual urgency language not covered by standard keywords

Do NOT include signals that are obvious from keywords like "estate sale", "price reduced", "motivated seller", "must sell" — those are already detected separately. Only flag signals that require reading comprehension.

Confidence: 0.0 to 1.0 based on how clearly the description signals motivation.
If the description is generic marketing copy with no motivation signals, return {"signals": [], "confidence": 0}.
```

### User prompt

```
{listing.description}
```

### Response parsing

```
Extract first JSON object from response: text.match(/\{[\s\S]*\}/)
Parse JSON → { signals: string[], confidence: number }
On any error → return { signals: [], confidence: 0 }
```

---

## 8. Stage 7: LLM Narrative Generation

Generates a 2–3 sentence plain-English explanation of the recommended offer.

### When to call

- ONLY when an offer model result exists (either assessment-based or language-based)
- ONLY for HOT and WARM tier listings (skip WATCH to save cost)

### API call

```
Provider: OpenRouter
Model: anthropic/claude-sonnet-4-20250514
Max tokens: 250
```

### System prompt (exact text)

```
You are a real estate acquisition advisor writing for an investor. Generate a 2-3 sentence plain-English explanation of why a specific offer price is recommended. Be direct, confident, and data-driven. Reference the key factors (assessment gap, days on market, motivation signals) without being overly technical. Write as if advising a client, not explaining a model.
```

### User prompt (template — fill variables)

```
Property: {address}
List price: ${listPrice formatted with commas}
BC Assessed value: ${assessedValue formatted with commas}
Our recommended offer: ${finalOffer formatted with commas} ({percentOfList}% of list)
Potential savings: ${savings formatted with commas}
Days on market: {dom} ({domTag})
Assessment classification: {anchorTag}
Offer adjustments applied: {signalTags joined with ", " or "none"}
Detected signals: {all signals joined with ", " or "none"}

Write 2-3 sentences explaining why this offer makes sense.
```

---

## 9. Stage 8: Full Assessment Assembly

The complete pipeline for a single listing:

```
INPUT: Listing

STEP 1: Score
  scoreResult = scoreV3(listing)
  → { total, tier, languageScore, domMultiplier, signals, breakdown }

STEP 2: Assessment lookup (parallel with Step 3)
  assessment = lookupAssessment(listing.address, listing.province)
  → Assessment | null

STEP 3: LLM signal detection (parallel with Step 2)
  llmResult = analyzeDescription(listing.description)
  → { signals: string[], confidence: number }

STEP 4: Offer model (depends on Step 2)
  IF assessment found:
    offer = offerModel(listing, assessment)          // assessment-based
  ELSE:
    offer = offerModelLanguage(listing)              // language-based fallback

STEP 5: History lookup (Zoocasa detail page)
  history = fetchDetail(listing.address, listing.city, listing.province)
  → { relistCount, cumulativeDom, priceChanges[], originalListPrice }

STEP 6: Narrative (depends on Steps 1, 2, 4)
  IF offer exists AND tier is HOT or WARM:
    narrative = generateOfferNarrative({...context from all steps})
  ELSE:
    narrative = deterministic template (see below)

STEP 7: Derived metrics
  landRatio      = assessment ? assessment.landValue / assessment.totalValue : null
  pricePerSqft   = listing.sqft ? listing.price / parseInt(listing.sqft) : null
  buildingValue  = assessment ? assessment.totalValue - assessment.landValue : null
  monthsOnMarket = Math.floor(listing.dom / 30)

OUTPUT: {
  listing,
  score: scoreResult,
  assessment,
  history,
  offer,
  signals: [...scoreResult.signals, ...llmResult.signals],
  narrative,
  derived: { landRatio, pricePerSqft, buildingValue, monthsOnMarket }
}
```

### Deterministic narrative template (WATCH tier or no LLM)

```
IF languageScore == 0:
  "{address} — no motivation signals detected. Generic marketing copy.
   The seller is in no rush. WATCH only; check back if price drops or DOM exceeds 90."

IF tier == "WATCH" AND languageScore > 0:
  "{address} — minor signals ({signals joined}) but insufficient for
   a strong offer position. Score: {total}/100. Monitor for price reductions."

IF tier == "WARM":
  "{address} — {signals joined}. {dom} DOM with {domTag} status.
   Language score {languageScore} boosted {(domMultiplier-1)*100}% by market time.
   Recommended offer: ${finalOffer} ({percentOfList}% of list)."

IF tier == "HOT":
  "{address} — strong signals: {signals joined}. {dom} DOM.
   Recommended offer: ${finalOffer} ({percentOfList}% of list),
   saving ${savings} off ask. {anchorTag}."
```

---

## 10. Stage 9: Dedup & Daily Picks

### Per-city daily run

```
1. FETCH:     fetchCandidates(city, province) → 20-40 raw listings
2. FILTER:    checkExclusion(listing, profile) → remove excluded
3. DEDUP:     filterUnseen(city, mlsNumbers) → remove previously surfaced
4. SCORE:     scoreV3(listing) for each remaining
5. RANK:      sort by score descending
6. TOP-N:     take first 5 (configurable 1-10)
7. MARK SEEN: markSeen(city, pickedMlsNumbers) → persist to KV store
```

### Seen store

- **Primary:** Vercel KV (Redis) — `SADD seen:{city-slug} {mlsNumber}`
- **Fallback:** In-memory Map (resets on cold start)
- **Check:** `SISMEMBER seen:{city-slug} {mlsNumber}` → 1 = skip, 0 = new
- **Clear:** `DEL seen:{city-slug}` for full city refresh

Once an MLS number enters the seen set, it never returns — even if relisted with DOM=0.

---

## 11. Worked Example: 3354 Fulton Rd

### Input

```json
{
  "address": "3354 Fulton Rd",
  "city": "Colwood",
  "province": "BC",
  "dom": 37,
  "price": 799900,
  "beds": "3",
  "baths": "1",
  "sqft": "1189",
  "yearBuilt": "1988",
  "taxes": "3575",
  "lotSize": "7693 sqft",
  "priceReduced": false,
  "hasSuite": false,
  "estateKeywords": false,
  "description": "Lovely one-level home on a nicely sized, flat lot in beautiful Colwood! Great layout, all on one floor with three nicely sized bedrooms.",
  "assessedValue": 752000
}
```

### Stage 2: Exclusion check (SFH_BUYER profile)

- Price $799,900: below $900K min → **EXCLUDED by price floor**
- (If using ALL profile: no exclusion patterns matched → passes)

### Stage 3: scoreV3

```
Tier 1 signals: NONE matched (0 pts)
Tier 2 signals: NONE matched (0 pts)
Tier 3 signals: NONE matched (0 pts)
Boolean flags: priceReduced=false, estateKeywords=false, hasSuite=false (0 pts)

languageScore = 0

DOM multiplier: 37 days → 1.05×
boostedScore = 0 × 1.05 = 0

Assessment gap: ratio = 799900 / 752000 = 1.064
  1.064 is in range (1.00, 1.20] → assessPts = 0

total = min(round(0 + 0), 100) = 0
tier = "WATCH"
signals = []
```

### Stage 4: Offer model (assessment-based)

```
Step 1: ratio 1.064 → "ABOVE ASSESSED (+5-15%)" → anchor = 752000 × 1.10 = $827,200
Step 2: DOM 37 → 0.99× → domAdjusted = 827200 × 0.99 = $818,928
Step 3: No signals → stack = 1.0 → signalAdjusted = $818,928
Step 4: ceiling = 799900 × 0.97 = $775,903
         818928 > 775903 → capped to ceiling
         finalOffer = round(775903 / 1000) × 1000 = $776,000

percentOfList = 776000 / 799900 = 97.0%
savings = 799900 - 776000 = $23,900
```

### Derived metrics

```
landRatio = 500000 / 752000 = 66.5%
pricePerSqft = 799900 / 1189 = $673/sqft
buildingValue = 752000 - 500000 = $252,000
```

### Narrative (deterministic, WATCH tier)

```
"3354 Fulton Rd — no motivation signals detected. Generic marketing copy.
 The seller is in no rush. WATCH only; check back if price drops or DOM exceeds 90."
```

### Verdict

```
Score: 0/100 | Tier: WATCH | Offer: $776,000 (97% of list) | Savings: $23,900
Signals: none | Language score: 0 | DOM multiplier: 1.05×
Assessment gap: +6.4% above assessed | Land ratio: 66.5%
```

**Skip.** No leverage angle. Weak trade.

---

## 12. Data Availability by Market

The algorithm assumes all fields are available, but Zoocasa data coverage varies by province. The LLM prompt and deterministic templates adapt to what's available.

| Field | BC | AB | ON | Impact on Algorithm |
|-------|----|----|-----|---------------------|
| Assessment total | Cache + Puppeteer live | SODA API live | Cache only (sparse) | ON defaults to language-based offer model |
| Land/building split | Yes (from BCA) | No (SODA gives total only) | Cache only (sparse) | AB/ON skip land-ratio analysis in narrative |
| sqft | 23/25 available | 10/10 available | 0/15 available | ON skips price/sqft and sqft-based functional analysis |
| yearBuilt | 23/25 available | 10/10 available | 0/15 available | ON skips building age analysis |
| taxes | 23/25 available | 0/10 available | 14/15 available | AB skips tax analysis |
| description | All markets | All markets | All markets | Language scoring works everywhere |
| DOM | All markets | All markets | All markets | DOM multiplier works everywhere |

### Implications

- **BC** is the richest market: assessment-anchored offers with land/building split analysis, full property profiles
- **AB** has live assessment via SODA but no land/building breakdown — narrative analyzes total gap only
- **ON** is language-only: no live assessment API, no sqft, no year — narrative focuses on description quality, detected signals, and functional observations from the description text
- The LLM prompt acknowledges missing data per listing ("sqft unknown", "assessment not available") so the narrative adapts rather than fabricating

### Phase 6: User Inquiry (Pending)

On-demand property assessment triggered by user input:

1. **Address text** (e.g. "2179 Spirit Ridge Dr") → fuzzy match against Zoocasa search
2. **Realtor.ca URL** (e.g. `https://www.realtor.ca/real-estate/29349975/...`) → extract address from URL slug, correlate to Zoocasa
3. **City subscription** (e.g. "send me homes in Victoria, BC") → pipeline trigger + email delivery

**Flow:**
```
User submits address/URL + email
  → Parse address from input (URL slug extraction or raw text)
  → Search Zoocasa for the address (searchListings with address keyword)
  → fetchDetail() on best match
  → lookupAssessment() for the province
  → Run analyzeAndNarrate() or deterministicNarrative()
  → Append listing to KV (upsertListing)
  → Send formatted assessment email via Resend
```

**API:** `POST /api/assess` accepting `{ input: string, email: string }`

---

## 13. Validation Checklist

Use these test cases to verify a reimplementation produces correct outputs:

### Test 1: Zero-signal listing (Fulton)
- Input: languageScore=0, DOM=37, assessed=$752K, list=$799.9K
- Expected: score=0, tier=WATCH, offer=$776K, pctOfList=97%

### Test 2: Strong motivation + stale
- Input: description="MUST SELL! Motivated seller, priced to sell. Estate sale, vacant. Price reduced."
- languageScore should be: 20 (Must Sell) + 20 (Motivated) + 20 (Priced to Sell) + 20 (Estate Sale) + 10 (Price Reduced) + 10 (Vacant) = 100
- With DOM=200: boosted = 100 × 1.40 = 140, capped at 100
- tier = HOT

### Test 3: Language-only offer model (no assessment)
- Input: description="Motivated seller, bring all offers", DOM=60, listPrice=$1M
- languageScore = 20 + 20 = 40
- Language anchor: hasTier1, tier1Count=2 → baseDiscount=0.88 → anchor=$880K
- DOM multiplier: 60 → 0.97 → domAdjusted=$853,600
- Signal stack: Motivated ×0.97 → $828,000 (rounded)
- Floor: $1M × 0.85 = $850K → floor kicks in → finalOffer=$850K

### Test 4: Exclusion
- Input: description="Beautiful land assembly, buy with adjacent lot"
- SFH_BUYER profile: "land assembly" matches SFH_EXCLUDE → EXCLUDED
- INVESTOR_DEV profile: "land assembly" not excluded, but "buy with" + "adjacent lot" match ALWAYS_EXCLUDE → EXCLUDED

### Test 5: Assessment gap below 0.92
- Input: listPrice=$850K, assessed=$1M, languageScore=10, DOM=100
- ratio = 0.85 → assessPts = +15, signal "Below Assessed"
- boosted = 10 × 1.20 (DOM 100) = 12
- total = round(12 + 15) = 27 → WATCH (below 35)
- Assessment anchor: ratio 0.85 → "SELLER CAPITULATING" → anchor = $850K × 0.92 = $782K

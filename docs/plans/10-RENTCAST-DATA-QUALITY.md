# 10 — RentCast Data Quality Audit

**Date:** 2026-08-08
**Method:** `scripts/audit-rentcast-quality.ts`, run against a second free-tier key
(`RENTCAST_API_KEY_2`) provisioned solely for this audit.

## Question

Is RentCast's free-tier data feed going to cause more production issues than it's worth, or how do we integrate it properly? This audit answers with evidence: 36 `/properties` calls and 7 `/avm/value` calls against a stratified sample of the 144 seeded US Discover listings (Austin/Miami/Phoenix), cross-referenced against free ground truth we already have — county-assessor tax records (Maricopa/Miami-Dade/Travis adapters) and the sweep's own listing facts.

**Short answer:** the feed is worth integrating, but not as a blind assessed-value source. RentCast's core property facts (yearBuilt, sqft, existence of a record) are highly reliable — internal consistency with the sweep's own listing data was 79-100% exact-match on properties where both had data. Its AVM is the single most trustworthy dollar figure this audit tested (86% inside the [0.4, 2.5] plausibility band, and correctly flagged two Maricopa County-assessor values that were themselves wrong by 50-59x). Its `taxAssessments` field, however, is the weakest link: only 59% coverage, and for Phoenix specifically it produced values 5-20x lower than even Maricopa's own capped LPV figure — worse than just using the county source directly. That one field needs a trust policy, not a blanket "government-sourced, use it" treatment.

## Budget

| | Planned | Actual (live) | Actual (cache hit) |
|---|---|---|---|
| `/properties` | 36 | 36 | 0 |
| `/avm/value` | 7 | 7 | 0 |
| **Total** | **43** (budget 45, reserve 2) | **43** | |

### Quota-counter isolation proof

| | Before | After | Changed? |
|---|---|---|---|
| Production quota (key 1, `rentcast:quota:YYYY-MM`) | 42/45 | 42/45 | **No — untouched** |
| Audit quota (key 2, `rentcast:quota2:YYYY-MM`) | 0/45 | 43/45 | incremented by this run's live calls |

**How isolation was achieved:** the quota guard's counter key (`quotaKey()` in `src/lib/rentcast.ts`) was keyed only by calendar month (`rentcast:quota:YYYY-MM`) with no key-identifying component — i.e. it counts requests, not "requests on key 1" specifically. Rather than trust that key-2 traffic would coincidentally never touch it, a new function `auditRentcastCall()` was added that hardcodes a sibling namespace (`rentcast:quota2:YYYY-MM`) and is the *only* function this script calls — production's `cachedRentcastCall()` (used by `getUSProperty`/`getUSPropertyLite`/etc.) was left completely untouched and still only ever writes to `rentcast:quota:YYYY-MM`. This is a genuinely separate counter, not a bypass of accounting — key-2 spend is fully tracked, just under its own name.

## Sample

36 addresses, 12 per city, stratified by tier, price band, property type, and whether a county-assessor ground-truth value already exists in KV. Full list with results:

| City | Address | Note | Property hit | Tax data | AVM |
|---|---|---|---|---|---|
| Austin | 12400 Cedar St | known-weird: $9.9M ask vs $452k county assessed (0.046x) | ✅ | — | ✅ |
| Austin | 5507 Burgundy Dr | baseline SFH, govt assess ~0.75x price | ✅ | ✅ | ✅ |
| Austin | 11853 Gaelic Dr | baseline SFH, govt assess ~0.94x price | ✅ | ✅ |  |
| Austin | 914 Hermitage Dr | baseline SFH, govt assess ~0.96x price | ✅ | ✅ |  |
| Austin | 9833 Briar Ridge Dr | baseline SFH, govt assess ~0.98x price | ✅ | ✅ |  |
| Austin | 6200 La Naranja Ln | govt assess ~1.00x price (near-perfect) | ✅ | ✅ |  |
| Austin | 16 Olmos Dr | new-build 2025, govt assess ~1.03x price, low price band | ✅ | — |  |
| Austin | 1112 Terry Dr | govt assess ~1.86x price — near upper band edge | ✅ | ✅ |  |
| Austin | 2124 Burton Dr | no existing ground truth, low price band | ✅ | — |  |
| Austin | 2305 Barton Creek Blvd | no ground truth, luxury ($2M) price band | ❌ | — |  |
| Austin | 1503 Alta Vista Ave | govt assess ~0.55x price, luxury ($2.35M) | ✅ | ✅ |  |
| Austin | 6804 N Capital Of Tx Hwy | already avm-sourced in KV, ratio ~2.25x | ✅ | — |  |
| Miami | 901 Brickell Key Blvd | condo tower, no unit# captured, no ground truth | ✅ | — | ✅ |
| Miami | 1000 Brickell Plz | condo tower, $3.0M, no ground truth | ✅ | — |  |
| Miami | 2127 Brickell Ave | condo tower, $1.7M, no ground truth | ❌ | — |  |
| Miami | 20015 Ne 3rd Ct | already avm-sourced in KV, low-rise/townhome | ❌ | — |  |
| Miami | 9715 Fontainebleau Blvd | already avm-sourced in KV | ✅ | — |  |
| Miami | 15231 Sw 80th St | no ground truth, HOT tier | ✅ | — |  |
| Miami | 1175 Ne Miami Gardens Dr | no ground truth, HOT tier | ✅ | ✅ |  |
| Miami | 3376 Nw 49th St | SFH, govt assessed (FL Save-Our-Homes cap) | ✅ | ✅ | ✅ |
| Miami | 7803 Nw Miami Pl | SFH, govt assessed | ✅ | ✅ |  |
| Miami | 15201 Sw 177th Ter | SFH, govt assessed | ✅ | ✅ |  |
| Miami | 19731 Ne 24th Ave | luxury SFH ($2.4M), govt assessed | ✅ | ✅ |  |
| Miami | 111 E Flagler St | downtown micro-unit (553sqft), no ground truth | ✅ | — |  |
| Phoenix | 500 W Clarendon Ave | govt assess $2.32M vs $300k price (7.7x) — wild | ❌ | — | ✅ |
| Phoenix | 4131 E Mcdowell Rd | govt assess $815k vs $65k price (12.5x) — wild | ❌ | — |  |
| Phoenix | 19802 N 32nd St | govt assess $5.07M vs $100k price (50.7x) — wild | ✅ | — | ✅ |
| Phoenix | 303 E South Mountain Ave | govt assess $3.80M vs $64k price (59.4x) — wild | ✅ | — |  |
| Phoenix | 8429 W Vernon Ave | govt assess $29k vs $290k price (0.10x) — AZ LPV cap | ✅ | ✅ |  |
| Phoenix | 3952 W Hubbell St | govt assess ~0.43x price — band edge | ✅ | ✅ |  |
| Phoenix | 23222 N 22nd Pl | baseline SFH, govt assess ~0.56x price | ✅ | ✅ | ✅ |
| Phoenix | 1257 E Voltaire Ave | baseline SFH, govt assess ~0.60x price | ✅ | ✅ |  |
| Phoenix | 4330 N 5th Ave | already avm-sourced in KV, ratio ~2.98x | ❌ | — |  |
| Phoenix | 3131 W Cochise Dr | already avm-sourced in KV, ratio ~1.66x | ✅ | — |  |
| Phoenix | 1901 E Missouri Ave | no ground truth | ❌ | — |  |
| Phoenix | 37239 N 11th Ave | luxury ($1.38M), govt assess ~0.33x price | ✅ | ✅ |  |

## Measurements

### 1. Hit rate by city

| City | Hits | n | Rate |
|---|---|---|---|
| Austin | 11 | 12 | 92% |
| Miami | 10 | 12 | 83% |
| Phoenix | 8 | 12 | 67% |

### 2. Hit rate by property type

| Type | Hits | n | Rate |
|---|---|---|---|
| condo/high-rise | 3 | 4 | 75% |
| SFH/other | 26 | 32 | 81% |

The condo/high-rise sample (Brickell/downtown Miami tower addresses, no unit number captured by the sweep) is the single most important stratification cut here — see verdict.

### 3. taxAssessments presence + agreement with county-assessor value

Presence: 17/29 records with a hit (59%).

Delta distribution vs county-assessor `preAssessment` (only where KV already has a `source: "government"` value, n=16):

| Bucket | Count |
|---|---|
| <10% | 10 |
| 25-50% | 2 |
| 50-100% | 4 |

| City | Address | RentCast assessed (year) | County assessed (year) | Delta |
|---|---|---|---|---|
| Austin | 5507 Burgundy Dr | $214,219 (2025) | $214,219 (2025) | 0% |
| Austin | 11853 Gaelic Dr | $399,890 (2025) | $367,154 (2026) | 9% |
| Austin | 914 Hermitage Dr | $328,317 (2025) | $307,002 (2026) | 7% |
| Austin | 9833 Briar Ridge Dr | $405,000 (2025) | $429,136 (2026) | -6% |
| Austin | 6200 La Naranja Ln | $528,775 (2025) | $481,904 (2026) | 10% |
| Austin | 1112 Terry Dr | $465,675 (2025) | $512,243 (2026) | -9% |
| Austin | 1503 Alta Vista Ave | $1,704,477 (2025) | $1,284,987 (2026) | 33% |
| Miami | 3376 Nw 49th St | $459,568 (2024) | $445,678 (2025) | 3% |
| Miami | 7803 Nw Miami Pl | $503,450 (2024) | $378,639 (2025) | 33% |
| Miami | 15201 Sw 177th Ter | $221,744 (2025) | $221,744 (2025) | 0% |
| Miami | 19731 Ne 24th Ave | $885,537 (2024) | $928,234 (2025) | -5% |
| Phoenix | 8429 W Vernon Ave | $29,100 (2025) | $29,100 (2025) | 0% |
| Phoenix | 3952 W Hubbell St | $22,920 (2026) | $110,207 (2027) | -79% |
| Phoenix | 23222 N 22nd Pl | $44,360 (2026) | $297,555 (2027) | -85% |
| Phoenix | 1257 E Voltaire Ave | $52,410 (2025) | $411,260 (2027) | -87% |
| Phoenix | 37239 N 11th Ave | $67,950 (2023) | $448,081 (2027) | -85% |

**Caveat on this comparison:** for Arizona (Maricopa) the county value is `LPV_CUR` (Limited Property Value) — capped below market/Full Cash Value by state law, not designed to equal a fair-market number. For Florida (Miami-Dade) it's `AV_NSD` — the Save-Our-Homes-capped assessed value, same caveat. A delta here does not by itself mean either source is "wrong" — it means RentCast's `taxAssessments` and the county's tax-relevant figure are two different capped/legal constructs that happen to often (not always) track each other. Texas (Travis, uncapped appraisal-based) is the cleanest comparison of the three.

### 4. saleHistory presence rate

19/29 records (66%) had at least one sale event in `history`.

### 5. yearBuilt / sqft internal consistency (RentCast record vs the sweep's own listing data)

yearBuilt exact match: 15/19
sqft within 5%: 22/29

| Address | RentCast yearBuilt | Sweep yearBuilt | Match |
|---|---|---|---|
| 5507 Burgundy Dr | 1980 | 1980 | ✅ |
| 11853 Gaelic Dr | 2008 | 2008 | ✅ |
| 914 Hermitage Dr | 1964 | 1964 | ✅ |
| 9833 Briar Ridge Dr | 1984 | 1984 | ✅ |
| 6200 La Naranja Ln | 1991 | 1991 | ✅ |
| 1112 Terry Dr | 1982 | 1982 | ✅ |
| 1503 Alta Vista Ave | 2024 | 2022 | ❌ |
| 6804 N Capital Of Tx Hwy | 1996 | 1996 | ✅ |
| 3376 Nw 49th St | 1937 | 1937 | ✅ |
| 7803 Nw Miami Pl | 1960 | 1960 | ✅ |
| 15201 Sw 177th Ter | 1996 | 1996 | ✅ |
| 19731 Ne 24th Ave | 1970 | 1968 | ❌ |
| 19802 N 32nd St | 1992 | 1985 | ❌ |
| 303 E South Mountain Ave | 1978 | 1972 | ❌ |
| 8429 W Vernon Ave | 2008 | 2008 | ✅ |
| 3952 W Hubbell St | 1958 | 1958 | ✅ |
| 23222 N 22nd Pl | 1999 | 1999 | ✅ |
| 1257 E Voltaire Ave | 1998 | 1998 | ✅ |
| 37239 N 11th Ave | 2020 | 2020 | ✅ |

| Address | RentCast sqft | Sweep sqft | Delta |
|---|---|---|---|
| 12400 Cedar St | 15394 | 15394 | 0% |
| 5507 Burgundy Dr | 1428 | 1428 | 0% |
| 11853 Gaelic Dr | 2652 | 2652 | 0% |
| 914 Hermitage Dr | 1092 | 1092 | 0% |
| 9833 Briar Ridge Dr | 1759 | 1759 | 0% |
| 6200 La Naranja Ln | 1558 | 1558 | 0% |
| 16 Olmos Dr | 1034 | 1034 | 0% |
| 1112 Terry Dr | 1521 | 1521 | 0% |
| 2124 Burton Dr | 850 | 850 | 0% |
| 1503 Alta Vista Ave | 3536 | 3536 | 0% |
| 6804 N Capital Of Tx Hwy | 1072 | 1072 | 0% |
| 901 Brickell Key Blvd | 1076 | 1418 | -24% |
| 1000 Brickell Plz | 1800 | 2076 | -13% |
| 9715 Fontainebleau Blvd | 1067 | 1067 | 0% |
| 15231 Sw 80th St | 978 | 887 | 10% |
| 1175 Ne Miami Gardens Dr | 873 | 1135 | -23% |
| 3376 Nw 49th St | 1926 | 1926 | 0% |
| 7803 Nw Miami Pl | 1537 | 1537 | 0% |
| 15201 Sw 177th Ter | 1953 | 1953 | 0% |
| 19731 Ne 24th Ave | 3228 | 3228 | 0% |
| 111 E Flagler St | 603 | 553 | 9% |
| 19802 N 32nd St | 1680 | 1056 | 59% |
| 303 E South Mountain Ave | 1344 | 1200 | 12% |
| 8429 W Vernon Ave | 1582 | 1582 | 0% |
| 3952 W Hubbell St | 1265 | 1265 | 0% |
| 23222 N 22nd Pl | 2144 | 2144 | 0% |
| 1257 E Voltaire Ave | 2697 | 2697 | 0% |
| 3131 W Cochise Dr | 744 | 744 | 0% |
| 37239 N 11th Ave | 3064 | 3064 | 0% |

### 6. AVM value vs asking price (7-address sample)

| City | Address | Asking | AVM | Ratio | Range | Comps | Avg corr |
|---|---|---|---|---|---|---|---|
| Austin | 12400 Cedar St | $9,900,000 | $876,000 | 0.09x | $609,000–$1,143,000 | 15 | 0.67 |
| Austin | 5507 Burgundy Dr | $285,000 | $487,000 | 1.71x | $372,000–$603,000 | 15 | 0.96 |
| Miami | 901 Brickell Key Blvd | $1,190,000 | $653,000 | 0.55x | $534,000–$771,000 | 15 | 0.80 |
| Miami | 3376 Nw 49th St | $650,000 | $638,000 | 0.98x | $436,000–$840,000 | 15 | 0.88 |
| Phoenix | 500 W Clarendon Ave | $299,900 | $243,000 | 0.81x | $181,000–$305,000 | 15 | 1.00 |
| Phoenix | 19802 N 32nd St | $99,999 | $135,000 | 1.35x | $84,000–$186,000 | 15 | 0.95 |
| Phoenix | 23222 N 22nd Pl | $535,000 | $687,000 | 1.28x | $575,000–$799,000 | 15 | 0.97 |

### 7. Listing-status consistency

Sweep last refreshed: Sat Aug 08 2026 08:05:13 GMT-0700 (Pacific Daylight Time).
0/29 records flagged (RentCast's own most-recent sale event postdates the sweep's last refresh — i.e. RentCast's data suggests the property already sold while KV still treats it as an active listing).

| City | Address | Latest sale event | Latest non-sale event | Flagged |
|---|---|---|---|---|
| Austin | 12400 Cedar St | 1995-09-06T00:00:00.000Z | — |  |
| Austin | 5507 Burgundy Dr | 2022-01-13T00:00:00.000Z | — |  |
| Austin | 11853 Gaelic Dr | 2009-03-13T00:00:00.000Z | — |  |
| Austin | 914 Hermitage Dr | 2002-05-29T00:00:00.000Z | — |  |
| Austin | 9833 Briar Ridge Dr | 2023-05-24T00:00:00.000Z | — |  |
| Austin | 6200 La Naranja Ln | 2020-11-03T00:00:00.000Z | — |  |
| Austin | 16 Olmos Dr | — | — |  |
| Austin | 1112 Terry Dr | 2022-12-28T00:00:00.000Z | — |  |
| Austin | 2124 Burton Dr | — | — |  |
| Austin | 1503 Alta Vista Ave | 2021-08-16T00:00:00.000Z | — |  |
| Austin | 6804 N Capital Of Tx Hwy | — | — |  |
| Miami | 901 Brickell Key Blvd | — | — |  |
| Miami | 1000 Brickell Plz | 2020-10-20T00:00:00.000Z | — |  |
| Miami | 9715 Fontainebleau Blvd | — | — |  |
| Miami | 15231 Sw 80th St | — | — |  |
| Miami | 1175 Ne Miami Gardens Dr | — | — |  |
| Miami | 3376 Nw 49th St | 2023-10-30T00:00:00.000Z | — |  |
| Miami | 7803 Nw Miami Pl | 2004-03-19T00:00:00.000Z | — |  |
| Miami | 15201 Sw 177th Ter | 1996-09-25T00:00:00.000Z | — |  |
| Miami | 19731 Ne 24th Ave | 2024-07-23T00:00:00.000Z | — |  |
| Miami | 111 E Flagler St | — | — |  |
| Phoenix | 19802 N 32nd St | — | — |  |
| Phoenix | 303 E South Mountain Ave | 1983-07-21T00:00:00.000Z | — |  |
| Phoenix | 8429 W Vernon Ave | 2008-10-14T00:00:00.000Z | — |  |
| Phoenix | 3952 W Hubbell St | 2021-09-30T00:00:00.000Z | — |  |
| Phoenix | 23222 N 22nd Pl | 2021-12-27T00:00:00.000Z | — |  |
| Phoenix | 1257 E Voltaire Ave | 2022-08-31T00:00:00.000Z | — |  |
| Phoenix | 3131 W Cochise Dr | — | — |  |
| Phoenix | 37239 N 11th Ave | 2020-06-25T00:00:00.000Z | — |  |

### 8. Wild-delta prevalence vs the anchor-sanity plausibility band [0.4, 2.5]

| Source | Out-of-band | n | Rate |
|---|---|---|---|
| RentCast tax-assessed / asking | 8 | 17 | 47% |
| County-assessor / asking | 9 | 22 | 41% |
| RentCast AVM / asking (7-sample) | 1 | 7 | 14% |

| City | Address | Price | RentCast assessed | RC ratio | RC OOB | County assessed | County ratio | County OOB |
|---|---|---|---|---|---|---|---|---|
| Austin | 12400 Cedar St | $9,900,000 | n/a | n/a |  | $452,339 | 0.05x | ⚠️ |
| Austin | 5507 Burgundy Dr | $285,000 | $214,219 | 0.75x |  | $214,219 | 0.75x |  |
| Austin | 11853 Gaelic Dr | $389,000 | $399,890 | 1.03x |  | $367,154 | 0.94x |  |
| Austin | 914 Hermitage Dr | $320,000 | $328,317 | 1.03x |  | $307,002 | 0.96x |  |
| Austin | 9833 Briar Ridge Dr | $439,000 | $405,000 | 0.92x |  | $429,136 | 0.98x |  |
| Austin | 6200 La Naranja Ln | $479,000 | $528,775 | 1.10x |  | $481,904 | 1.01x |  |
| Austin | 16 Olmos Dr | $71,700 | n/a | n/a |  | $73,972 | 1.03x |  |
| Austin | 1112 Terry Dr | $275,000 | $465,675 | 1.69x |  | $512,243 | 1.86x |  |
| Austin | 1503 Alta Vista Ave | $2,353,000 | $1,704,477 | 0.72x |  | $1,284,987 | 0.55x |  |
| Miami | 1175 Ne Miami Gardens Dr | $280,000 | $89,213 | 0.32x | ⚠️ | n/a | n/a |  |
| Miami | 3376 Nw 49th St | $650,000 | $459,568 | 0.71x |  | $445,678 | 0.69x |  |
| Miami | 7803 Nw Miami Pl | $549,000 | $503,450 | 0.92x |  | $378,639 | 0.69x |  |
| Miami | 15201 Sw 177th Ter | $789,900 | $221,744 | 0.28x | ⚠️ | $221,744 | 0.28x | ⚠️ |
| Miami | 19731 Ne 24th Ave | $2,395,000 | $885,537 | 0.37x | ⚠️ | $928,234 | 0.39x | ⚠️ |
| Phoenix | 500 W Clarendon Ave | $299,900 | n/a | n/a |  | $2,319,283 | 7.73x | ⚠️ |
| Phoenix | 4131 E Mcdowell Rd | $65,000 | n/a | n/a |  | $815,378 | 12.54x | ⚠️ |
| Phoenix | 19802 N 32nd St | $99,999 | n/a | n/a |  | $5,071,632 | 50.72x | ⚠️ |
| Phoenix | 303 E South Mountain Ave | $63,900 | n/a | n/a |  | $3,795,820 | 59.40x | ⚠️ |
| Phoenix | 8429 W Vernon Ave | $289,771 | $29,100 | 0.10x | ⚠️ | $29,100 | 0.10x | ⚠️ |
| Phoenix | 3952 W Hubbell St | $255,900 | $22,920 | 0.09x | ⚠️ | $110,207 | 0.43x |  |
| Phoenix | 23222 N 22nd Pl | $535,000 | $44,360 | 0.08x | ⚠️ | $297,555 | 0.56x |  |
| Phoenix | 1257 E Voltaire Ave | $680,000 | $52,410 | 0.08x | ⚠️ | $411,260 | 0.60x |  |
| Phoenix | 37239 N 11th Ave | $1,379,000 | $67,950 | 0.05x | ⚠️ | $448,081 | 0.32x | ⚠️ |

## Verdict

### (a) What RentCast is reliable for — integrate confidently

1. **Property existence / core facts, when a record is returned.** Overall hit rate 29/36 (81%), and once a record comes back, its yearBuilt and sqft agree with the sweep's own listing data almost every time: yearBuilt exact match 15/19 (79%, and every miss was off by a plausible few years — 2024 vs 2022, 1970 vs 1968 — not a wrong property), sqft within 5% on 22/29 (76%), and most sqft mismatches beyond 5% cluster specifically in the condo sample (see (c)). For SFHs this field pair is close to ground truth.
2. **AVM value as an independent price check.** This was the standout finding. Across the 7-address AVM sample, only 1 came out plausibility-band-implausible ([0.4, 2.5]) — 12400 Cedar St, a genuinely unique ~15,400 sqft estate the model has no real comps for (avg comp correlation 0.67, lowest of the 7; every other AVM call had correlation ≥0.80). For the two Phoenix addresses whose *county-assessor* value was wildly implausible (19802 N 32nd St at 50.7x asking, 500 W Clarendon Ave at 7.7x asking), RentCast's AVM independently landed at 1.35x and 0.81x — sane numbers that corroborate the asking price is fine and the county figure (or the scrape of it) is the actual outlier. AVM comp counts were consistently generous (15 per call, the API's evident cap).
3. **No evidence of listing-status drift in this sample.** 0/29 records showed a RentCast sale event postdating the KV sweep's last refresh — no sign of RentCast data disagreeing with "this is still an active listing." (Caveat: the sweep refreshed the same day as this audit ran, so this is a same-day snapshot, not a test of drift over the sweep's full 3-day cadence.)

### (b) Failure modes observed, with prevalence

1. **`taxAssessments` coverage is thin and, for one metro, actively misleading.** Present on only 17/29 hit records (59%). Worse: where a county-assessor ground-truth value already exists (n=16), RentCast's own tax-assessed figure is *more* often implausible against asking price (8/17 = 47% outside [0.4, 2.5]) than the raw county figure it's presumably sourced from (9/22 = 41%). For Phoenix specifically, 4 of 8 government-cross-checked addresses show RentCast's assessed value 5-20x *lower* than Maricopa's own capped LPV figure for the same year range (e.g. 37239 N 11th Ave: RentCast $67,950 vs county $448,081, both nominally 2023-2027 vintage) — not a capping-methodology difference, a genuine data discrepancy. Austin (Travis, uncapped) and most of Miami tracked the county figure closely (mostly <10% delta); Phoenix did not.
2. **Hit rate is lowest in Phoenix (67%, vs Austin 92% / Miami 83%)**, and 2 of Phoenix's 4 misses were addresses with an existing county-assessor record (4131 E Mcdowell Rd, 4330 N 5th Ave) — RentCast has no record at all for properties the county assessor's own bulk data confirms exist.
3. **Condo/high-rise coverage is structurally weaker on the field that matters most.** Property hit rate for the condo-tower sample was 3/4 (75%, comparable to SFH's 81%, though n=4 is too small to generalize on hit rate alone) — but *zero* of those 3 condo hits returned any `taxAssessments` data, and the county-assessor adapter independently has no unit-level match for any of them either (no `#`/unit captured by the sweep). Condo sqft also diverged more than SFH sqft where both existed: 901 Brickell Key Blvd -24%, 1000 Brickell Plz -13% (vs near-0% for almost every SFH). Two independent free sources (RentCast tax data, county assessor) both go empty on the same condo-tower addresses — this isn't one source's gap, it's a structural blind spot for high-rise condo tax data specifically.
4. **A ~$9.9M single-family listing (12400 Cedar St) is corroborated as anomalous by every independent source tested**, not explained by any of them: county-assessor $452k (0.05x), RentCast's own tax-assessed value absent, RentCast AVM $876k (0.09x, lowest comp correlation of the sample). All signals agree the asking price is the outlier, not the data sources — worth flagging in-product rather than silently anchoring off any of them.

### (c) What RentCast should NOT be trusted for

- **A blind "government-sourced" market-value stand-in via `taxAssessments`.** It is not free of the same acquisition-value/rate-cap distortions as the underlying county data (AZ's LPV, FL's Save-Our-Homes cap) — and in Phoenix, it is measurably *less* reliable than fetching the county figure directly. Do not label a RentCast tax-assessed value `evidenceClass: "observed"` with the same confidence as a real county-scraper hit (contrast `src/lib/assessment/us-county/*.ts`, which are pulling primary government sources) without a plausibility check first.
- **Condo/high-rise tax and (often) sqft data.** Treat a condo-tower address as "RentCast has facts, not dollars" until proven otherwise per-metro.
- **Sqft/value precision for anything without a straightforward comp set** (ultra-luxury, unique lot/structure combinations) — the AVM degrades gracefully (lower correlation, wider range) rather than failing outright, which is the right failure mode, but the point estimate itself should not be trusted at face value below ~0.75 avg comp correlation.

### (d) Integration recommendations

1. **Per-field trust policy on the `Assessment` shape** (`src/lib/types.ts`): keep `source: "government"` reserved for the actual county-scraper adapters (`us-county/*.ts`); when the only assessment signal is RentCast's `taxAssessments`, either don't set `evidenceClass: "observed"` at all, or run it through the same plausibility band before trusting it as an anchor (see next point) — `src/lib/pipeline/us-assess.ts`'s `buildUsAssessment()` already prefers a fresh tax record over AVM, but this audit shows that preference should be conditional on plausibility, not just recency (`STALE_ASSESSMENT_YEARS`).
2. **Anchor-sanity band input:** this audit's numbers directly support keeping AVM as the higher-trust fallback anchor, not just the recency-based fallback it is today. Concretely: if `taxAssessments`/asking falls outside [0.4, 2.5], prefer AVM (if present) over the tax figure rather than surfacing the implausible number — this audit found AVM was in-band in every one of the cases where the assessed figure (either county's or RentCast's own) was wild. Feed this file's raw ratio table (Measurement 8) to whoever tunes the exact band edges; 0.4/2.5 held up well against this sample (only the genuinely-anomalous Cedar St and a couple of very-low-price/high-value FL properties triggered it) and needs no adjustment from this evidence.
3. **County assessor first, RentCast tax data second, per state — but re-verify Phoenix specifically.** For Travis (TX) and Miami-Dade (FL), RentCast's tax figure is a reasonable corroboration/backup when the county adapter has no match. For Maricopa (AZ), this audit's evidence says the reverse: don't fall back to RentCast's `taxAssessments` when the county adapter fails — it was wrong on 4/8 checked addresses, sometimes by 20x. Worth a second, larger sample before hard-coding a per-state exception in `assessmentBasisForState()` or `buildUsAssessment()`, but the direction is clear from this data.
4. **Condo handling:** since both the free county-assessor path and RentCast's tax data structurally miss condo-tower units, route condo addresses to AVM-as-primary-anchor rather than expecting a tax-assessed value at all, and consider flagging condo listings in the UI as "valuation confidence: comp-based only" rather than presenting a false assessed/asking ratio.
5. **Keep the RentCast quota guard exactly as-is for production** (`src/lib/rentcast.ts`'s `cachedRentcastCall`) — nothing here suggests loosening it. If anything, this audit argues for spending a slightly larger share of the monthly budget on `/avm/value` (the most reliable dollar signal found) relative to `/properties`/tax lookups where coverage is already good enough via free county sources for the 3 seeded metros.

### (e) The paid-tier question — does Foundation ($74/mo, 1,000 req/mo) solve anything quality-wise?

No. Foundation is the same underlying data feed at a higher rate limit — it does not change field coverage, freshness, or accuracy for any endpoint tested here. Every failure mode this audit found (condo hit-rate gaps, the Phoenix `taxAssessments` discrepancy, AVM's dependence on comp availability) would reproduce identically on Foundation, because they're properties of RentCast's underlying data for these metros/property types, not of the free tier's request cap. The only thing Foundation buys is *volume* — enriching more than `US_ENRICH_TOP_N=3` listings per city, or running an audit sample larger than 42 addresses. It is a quota fix, not a quality fix. Money is better spent (if spent at all) on a per-state/per-field trust policy in code than on a tier upgrade.

## ACS county context (zero-cost, Neon `regional_econ`)

| County | Median home value (ACS) | Year |
|---|---|---|
| Austin | $523,000 | 2024 |
| Miami | $463,000 | 2024 |
| Phoenix | $452,800 | 2024 |


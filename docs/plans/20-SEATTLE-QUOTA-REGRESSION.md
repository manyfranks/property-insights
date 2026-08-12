# Seattle RentCast Regression — Quota vs. Address Resolution

_Created 2026-08-12. Production regression investigation following P4 Sprint B live testing._

## Finding

The Seattle results initially looked like the earlier Queens address-normalization failure, but the failure occurred before address resolution. Production's RentCast counter was at its intentional `50/50` hard stop, and the three inputs had no property or listing cache entries. RentCast had not been contacted for them.

The fallback UI had the machine reason `provider_quota_exhausted`, but its visible copy still sounded like a completed lookup with no listing. This conflated three different states:

- the provider was not called because the spend guard blocked it;
- the provider call failed;
- the provider completed the lookup but returned no usable record/listing.

The visible result now distinguishes all three and never says or implies “not listed” when RentCast was not checked.

## Bounded provider verification

A one-time operator cap of 62 allowed at most 12 successful calls for the three reported addresses while leaving production's standing cap unchanged at 50. Ten successful overage calls were used (`50 -> 60`), a maximum charge of $2.00 at $0.20/call.

| Input | RentCast result | Conclusion |
|---|---|---|
| 1625 Federal Avenue E, Seattle, WA | Canonicalized to `1625 Federal Ave E`; active $8.75M single-family listing returned | Canonical chain works; original fallback was quota-blocked |
| 1716 Boylston Ave, Seattle, WA | Active $5M, 28-bed/31-bath multifamily listing returned | Whole-building subject; do not substitute a unit journey |
| 1122 Broadway E, Seattle, WA | Completed property and listing queries returned no usable record/listing | Genuine clean provider miss for the address-only building input; current public listing sources also show the building off market |

`1122 Broadway E` illustrates why this must not become an unbounded fuzzy match. The address contains separately identified units, while the user supplied no unit. Attaching a nearby or historical unit listing would violate the subject-resolution invariants.

## Regression protection

- P0 copy fixtures prove quota-blocked results say the provider was not checked.
- Clean provider misses remain distinct from operational unavailability.
- The canonical-address fixture now covers both Queens civic-number/locality normalization and Seattle street-suffix/directional normalization.
- The three fetched bundles are cached; cache reads remain available even while the standing hard cap is 50.

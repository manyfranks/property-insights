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
| 1122 Broadway E, Seattle, WA | Property/listing identity queries returned no record, while AVM/rent returned address-level modeled values | Identity and scope unresolved; do not label off-market or show the modeled values as property-specific |

`1122 Broadway E` illustrates why this must not become an unbounded fuzzy match. The address contains separately identified units, while the user supplied no unit. King County's exact-address query returned one row, but that row was explicitly `UNIT_NUM=102` and its $250,000 value belonged to that unit—not the containing building. Attaching that row, a nearby unit, or a historical unit listing would violate the subject-resolution invariants.

## Regression protection

- P0 copy fixtures prove quota-blocked results say the provider was not checked.
- Clean provider misses remain distinct from operational unavailability.
- AVM/rent values without a matching property identity are withheld as `property_identity_not_found`; they cannot create a confident off-market result.
- A property record cannot produce an off-market label unless the listing lookup itself completed; quota-blocked and failed listing lookups degrade honestly.
- King County unit-tagged rows are rejected when the assessment request did not specify a unit.
- The canonical-address fixture now covers both Queens civic-number/locality normalization and Seattle street-suffix/directional normalization.
- The three fetched bundles are cached; cache reads remain available even while the standing hard cap is 50.

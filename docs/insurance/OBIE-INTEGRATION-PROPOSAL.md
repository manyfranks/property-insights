# Obie Integration — Options, Tradeoffs, Recommendation

_2026-08-21 · engineering proposal · not legal advice. Inputs: Obie partner docs Phases I–III
(fetched in full), `IMPLEMENTATION-BLUEPRINT.md`, current repo state._

**Status:** Obie affiliate application approved. $25 per lead/bound policy, all 50 US states.
Partner manager has asked us to review the API docs before scheduling a call.

---

## 1. The question, and why the architecture already answers half of it

Matt's framing: *do we use their modal, hand off with pre-filled data, or own the full journey
with our own UI wrapper?*

**Owning the full journey is already excluded**, on two independent grounds:

- **Legally.** An unlicensed party may not quote, compare, rank, advise, or bind. Owning the
  journey end-to-end is precisely the unlicensed quote engine that WA's TAA 2021-01 enforced
  against — on both the site *and* the producer who accepted its referrals.
- **Architecturally.** The blueprint's stated non-goal is *"not a public unlicensed quote engine
  and not a hard-coded partner integration,"* and `assertA1StateDoesNotClaimProviderEvidence()`
  throws at runtime if anything sets `QUOTED`/`BOUND`/`ISSUED` without provider evidence.

So the real question is narrower: **which layer does each Obie phase plug into, and when.**

## 2. What Obie actually ships

| Phase | Mechanism | PII boundary | Prereq |
|---|---|---|---|
| **I — Basic modal** | `<script src="https://static.obieinsurance.com/sdk/obie.js">` + `Obie.open({partnerId, sandbox})`. Cross-origin iframe from `app.obieinsurance.com`. Callbacks: `onClose`, `onQuoteCreated({quoteRequestId})` | **All PII stays in Obie's origin.** Our JS cannot read into the iframe | Sandbox partnerId (manual), then prod partnerId + domain allowlisting (manual) |
| **II — Pre-fill** | Same call, nested `values` object. Pure client-side; no server round-trip | Unchanged — we pass what we already hold | Phase I |
| **III — Policy sync** | `policy_created` webhook (POST) + REST pull (`GET /api/partners/policies/:id`). OAuth `authorization_code`, long-lived tokens | **Real PII lands on us**: policy number, premium, deductible, property address, COI document URL | Phase II is a hard prerequisite |

### Three findings that shape the design

**a. Attribution works, via two mechanisms.** `quoteRequestId` comes back on the frontend
`quote_created` event and reappears as `quote_request_id` in the `policy_created` webhook — that's
the join key. The webhook payload also carries a `metadata: {}` object, and Phase II accepts
metadata on the way in. That is almost certainly one of the "many optional properties" Phase I
declines to enumerate. **Confirm on the call**; if it round-trips, attribution is clean rather
than stitched.

**b. Obie's webhooks are unsigned.** No HMAC, no signing secret, no `Stripe-Signature` equivalent —
verification is never mentioned. This collides head-on with our invariant that *only an
authenticated provider response may create real provider states.*

**c. Obie's pre-fill schema has no hazard fields.** Our FEMA flood/wildfire/wind scores — pitched
as the differentiator — have **nowhere to go** in the payload. They remain useful for our own
pre-modal triage and routing, but they are not part of the handoff. (Related: `hazards` is
currently hardcoded `null` in `coverage-profile-wizard.tsx` and never wired to real county data.)

## 3. We already built the adapter, before seeing their docs

`CoverageProfileProperty` (`src/lib/db/coverage-profiles.ts`) and `buildCoveragePrefill()`
(`src/components/insurance/coverage-prefill.ts`) mirror Obie's schema nearly field-for-field.
Convergent design — the vendor note says "docs via BD, not public," so this predates the docs.

Gaps to close, none large, one dangerous:

| Gap | Fix | Risk |
|---|---|---|
| `dwellingType` enum mismatch — ours `SFH/Condo/Townhouse/Other`, theirs `SFR/CONDO/APARTMENT_BUILDING/DUPLEX/TRIPLEX/QUADPLEX/OTHER` | Explicit translation map | Low. We have no signal for duplex/triplex/quadplex — those must be asked |
| **`lossOfRent` is ANNUAL for Obie; our `estimatedRent` is MONTHLY** | `× 12` at the boundary | **Highest.** Silent 12× error, no validation would catch it. Rename the field or wrap in a typed converter |
| `person.firstName`/`lastName` vs our combined `contact.name` | Split, or capture first/last (Clerk profile has both) | Low |
| Missing entirely: `numberOfBuildings`, `percentageOfUnitsVacant`, `mortgageHolder`, `additionalParties` | Add wizard steps | Medium — more questions is more friction |
| `postalCode` absent from `Listing`; only on US RentCast records | Restrict pre-fill to US properties | Low — see below |

**Obie is US-only.** Canada stays with APOLLO and Square One. This is a US-track integration and
should be gated on `country === "US"` at the registry level, which the registry already supports.

## 4. Options and tradeoffs

| | Effort | Attribution | PII on us | Conversion | Compliance surface |
|---|---|---|---|---|---|
| **A. Link-out only** (today's affiliate pattern) | ~0 | `sub_id` only | None | Weakest — user restarts cold | Lowest |
| **B. Phase I modal** | 0.5–1 day | `quoteRequestId` | None | Better — stays on our domain | Low. Add `*.obieinsurance.com` to CSP |
| **C. Phase I + II pre-filled** | +2–4 days | `quoteRequestId` + metadata | None new | **Best** — most of the form is answered before the user sees it | Low. Pre-fill is client-side; we pass only what we already hold |
| **D. Own the journey** | Weeks | n/a | All of it | n/a | **Illegal unlicensed. Excluded.** |
| **E. + Phase III sync** | +3–5 days | Full lifecycle | **Yes — policy PII** | n/a | **Highest.** Retention policy, privacy-policy update, unsigned-webhook problem |

## 5. Recommendation

**Build C now. Defer E behind its gates. Never build D.**

1. **Ship Phase I + II as one unit** on US property surfaces. Phase I alone wastes our single
   biggest asset — the property data that makes the form short. The pre-fill *is* the product
   differentiator; shipping the bare modal would be a worse experience than the affiliate link
   it replaces, because the user still types everything.

2. **Model Obie correctly.** Its registry entry says `counterpartyRole: "AFFILIATE"`; Obie is an
   **MGA**. That field renders user-facing disclosure copy via `counterpartyRoleDescription()`,
   so calling an MGA an "insurance partner" understates the relationship. Change to `MGA`, keep
   `enabled:false` until the prod partnerId and domain allowlist land.

3. **Phase III: treat the webhook as a doorbell, not as truth.** Because Obie's webhooks are
   unsigned, an inbound POST must never write a provider-evidence state directly. On receipt,
   call `GET /api/partners/policies/:id` with the OAuth bearer token; the **authenticated pull**
   is the evidence that satisfies the carrier-truth invariant. A spoofed webhook then costs one
   wasted API call and nothing else. Do this even if Obie later ships signatures.

4. **Phase III is gated twice** — by Obie (Phase II is a hard prerequisite) and by us (A2 begins
   only after Sprint 25 *and* the P5 curated live-acceptance matrix close; Sprint 25 closed
   2026-08-21, P5 has three boxes open). Obie becomes the first real implementation of the
   `SubmissionProvider` interface that A2 already specifies. Do not shortcut this to get policy
   data sooner.

5. **Keep hazard scores on our side of the line.** They don't fit Obie's schema, so use them for
   pre-modal triage — which properties we surface insurance to, and with what framing — and wire
   `hazards` to real county FEMA data rather than the current `null` stub.

## 6. Questions for the Obie call

1. **Does `Obie.open()` accept a `metadata` object that round-trips to `quote_created` and the
   `policy_created` webhook?** Phase I says "many optional properties" without listing them;
   Phase III's payload has `metadata: {}`. This is the difference between clean and stitched
   attribution — highest-value question.
2. **Is there any webhook signature or shared-secret header available**, documented or not?
3. **Which lifecycle events actually exist?** Docs show only `policy_created` — no cancellation,
   renewal, or update, despite the "lifecycle events" framing.
4. **How is the $25 reconciled?** No commission, payout, or billing field appears anywhere. What
   is the reporting mechanism, and what is the payment cadence?
5. **Is there an `onError` callback** or defined behavior for blocked iframes/ad-blockers?
6. **Enumerate the full optional-properties list** for `Obie.open()`.
7. **Disclosure requirements** — what producer/BOR language must we display, given we are an
   unlicensed platform embedding a licensed MGA's flow?
8. **Do document URLs expire?** Determines whether we store the URL or the document.
9. **Sandbox timeline** — partnerId provisioning and prod domain allowlisting are both manual and
   are the real critical path, not engineering.

## 7. Sequencing

| Step | Blocked on | Owner |
|---|---|---|
| Request sandbox partnerId | The call | Matt |
| Ask the 9 questions above | The call | Matt |
| Enum map, rent ×12 converter, name split | Nothing | Eng |
| Wire real FEMA data into `hazards` | Nothing | Eng |
| Phase I + II behind a flag, US-only | Sandbox partnerId | Eng |
| Recodify Obie as MGA | Nothing | Eng |
| Deploy Sprint 25, run P5 matrix | Nothing — **critical path** | Eng |
| Phase III adapter | P5 close → A2 open, + Obie prod credentials | Eng |

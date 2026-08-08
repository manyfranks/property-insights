# DRAFT — NOT LEGAL ADVICE — FOR COUNSEL REVIEW

**Status update (August 7, 2026): the copy proposed in this draft has now been
implemented on the live pages** — `src/app/privacy/page.tsx` (new "United
States State Privacy Rights" section, reworded "What We Don't Do", updated
Cookies/Affiliate Links sections), `src/app/terms/page.tsx` (governing-law
consumer carve-out), and `src/app/data-usage/page.tsx` (reworded "What We Do
Not Sell", updated "Legal Framework"). This was an owner-directed decision to
publish ahead of formal counsel review, to save on hourly legal fees; counsel
is expected to review the live pages and comment/redline from there. This
document now serves as **counsel's review companion and rationale record**
for that published copy — the open questions, caveats, and "needs counsel
confirmation" notes below are still live and unresolved even though the
copy itself has shipped. The rest of this document is otherwise unchanged
from the original draft.

---

Proposed copy and structural notes for a new "US State Privacy Rights" section
of the Property Insights privacy policy, prepared as engineering input ahead
of counsel review. Nothing in this document should be published or relied on
as-is. See `docs/legal/US-EXPANSION-LEGAL-BRIEFING.md` for the underlying
research this draft implements (§2 build list; 12-state GPC requirement;
CA/CO visible-confirmation rule).

Companion mechanism (already implemented, pending this copy): `/privacy-choices`
page, footer "Do Not Sell or Share My Personal Information" link, `pi_dns`
opt-out cookie, and automatic GPC honoring. See `src/lib/privacy.ts`,
`src/app/privacy-choices/page.tsx`.

---

## 1. Categories of personal information collected

Proposed table for the new section. Category labels follow the CCPA/CPRA
taxonomy since it is the strictest superset; "purpose" columns should be
reviewed against each state's actual definitions before publication.

Per owner direction: published copy must not name platform/infrastructure
vendors or internal system names — describe sources with generic best-practice
language ("our authentication provider", "our service logs").

| Category | Examples in our system | Source | Purpose(s) |
|---|---|---|---|
| **Identifiers** | Email address, user ID, account profile | Our authentication provider (collected when you create an account) | Account creation, sign-in, delivering requested assessments, support |
| **Internet or other electronic network activity** | Pages visited, properties viewed, searches run, partner/affiliate link clicks | Our service logs (account activity is recorded only for signed-in, consented users; partner-link clicks are logged in aggregate with no direct identifiers for signed-out visitors) | Improving recommendations and scoring models; measuring which partner referrals convert (aggregate); with consent, connecting users to partner professionals |
| **Geolocation-lite** (property-level, not device GPS) | Addresses and cities searched or viewed | Search requests you submit | Returning assessment results for the address requested; aggregate city-level market interest |

Notes for counsel:
- We do not collect precise device geolocation (no GPS/lat-long from the
  browser). "Geolocation-lite" here means the property addresses a user
  chooses to search — counsel should confirm whether this still falls under
  any state's geolocation-specific disclosure or sensitive-PI rules.
- No categories in our system currently meet the common statutory definitions
  of "sensitive personal information" (no SSNs, precise geolocation, health,
  biometric, or similar data) — confirm this reading is correct given the
  finalized category table above.
- `partner_clicks` rows for anonymous (signed-out) visitors intentionally
  carry no `user_id`, IP, or user-agent — see `src/lib/db/partner-clicks.ts`.

## 2. "Sale" / "share" reframing

Proposed conservative position: we characterize affiliate link click
attribution (associating a partner-CTA click with a visitor, for referral-fee
and EPC purposes) as a "share" under CPRA-style definitions, even though no
data changes hands with the partner beyond the click itself and the user's
own subsequent interaction on the partner's site. This is the same
conservative posture recommended in the legal briefing (§ "small-company
practice") — we would rather over-disclose a borderline mechanism than
under-disclose and risk a GPC/opt-out enforcement action.

Existing product behavior this section must reconcile with:
- We do not sell bulk personal information to data brokers or advertisers.
- We do not pass user PI (email, search history, behavioral data) to
  affiliate partners — users click through and, if they choose, provide
  their own information directly to the partner's own site.
- The only thing that could plausibly be a "share" is the click-attribution
  event itself (vendor, vertical, state, source, property/city context,
  and — for signed-in users — the account it's tied to for intent scoring).

Proposed language direction (for counsel to redraft): state plainly that we
treat affiliate click attribution as a "share" for opt-out purposes, and that
opting out (via `/privacy-choices` or GPC) causes affiliate links to resolve
to untracked, non-attributed URLs — see `src/components/partner-cta.tsx`
(`resolveUrl`) and `src/app/api/partner-connect/route.ts`.

## 3. Unified US State Privacy Rights section

Per the briefing's recommendation, propose one superset "US State Privacy
Rights" section (structurally separate from the existing Canada/PIPEDA
section), covering:

- **Right to know / access** — what categories of PI we collect and why.
- **Right to deletion** — delete personal information we hold about you.
- **Right to correction** — correct inaccurate personal information.
- **Right to data portability** — receive a copy of your data in a portable
  format.
- **Right to opt out of sale/sharing** — via `/privacy-choices` or an
  automatic Global Privacy Control (GPC) signal.
- **Right to opt out of targeted advertising** — N/A today (we do not run
  targeted/behavioral advertising or third-party ad trackers), but the right
  should still be stated since several states require it regardless of
  current practice.
- **Right to opt out of profiling with legal/significant effects** — flagged
  in the briefing as a gray area for our intent-scoring system; counsel
  should confirm current scope before this right is characterized as "not
  applicable." Colorado in particular requires a documented Data Protection
  Assessment for qualifying profiling.
- **Non-discrimination** — using these rights does not affect access to the
  core product (already true in practice; assessments/search/offer analysis
  are unaffected by opt-out status).

Applicability/eligibility gating (state-by-state thresholds, exemptions,
authorized-agent provisions) is out of scope for this draft — needs counsel's
determination of which states' statutes actually apply to us today and
whether a single superset section is defensible vs. a jurisdiction-gated
approach.

## 4. GPC honoring statement + visible confirmation

Proposed statement: "We honor the Global Privacy Control (GPC) signal. If
your browser or a browser extension sends GPC, we automatically apply it as
an opt-out of sale/sharing for that browser, with no action required from
you."

Visible-confirmation requirement (CA/CO, effective Jan 1, 2026, per the
briefing): the `/privacy-choices` page implements this today via a status
panel that reads, when a GPC signal is detected: "We detected the Global
Privacy Control signal from your browser and have applied it — this browser
is opted out of sale/share." Counsel should confirm this satisfies the
current CA/CO visible-confirmation standard, including whether confirmation
needs to appear anywhere beyond the dedicated privacy-choices page (e.g.
inline at the point of an affiliate click, or a toast/banner elsewhere).

## 5. DSR process and SLA

Proposed language: "To exercise any of these rights, email
privacy@propertyinsights.xyz. We will confirm receipt and respond within 45
days of a verifiable request; if additional time is needed, we may extend
the response period by another 45 days (90 days total), and will notify you
of the extension and the reason for it within the initial 45-day period."

Notes for counsel:
- The existing Canadian section commits to a flat 30-day response window
  (see `src/app/privacy/page.tsx`, "Your Rights" section). The US section's
  45+45 day SLA should be presented as distinct from, not a replacement for,
  that existing Canadian commitment — will need copy that clearly scopes
  each SLA to its respective legal regime.
- No identity-verification procedure is described yet (how we confirm a DSR
  requester is who they claim to be, especially for deletion requests tied
  to an authenticated account vs. an anonymous `partner_clicks` row that has no
  identifier to verify against). Needs counsel + engineering design before
  publication.

## 6. Existing "What We Don't Do" sections need rewording

Both `src/app/privacy/page.tsx` ("What We Don't Do") and
`src/app/data-usage/page.tsx` contain unqualified claims — e.g. "We do not
sell your personal information in bulk to third parties" and similar — that
predate the US expansion and the "share" reframing proposed in §2 above.
These pages are explicitly **not** being rewritten as part of this change
(per current engineering instructions, pending counsel review), but this
draft flags them now so they are not overlooked:

- The claims may need qualification once affiliate-click attribution is
  characterized as a "share" under CPRA-style definitions (§2).
- Any claim of "we do not sell/share" should be reconciled with the new
  `/privacy-choices` opt-out mechanism — an opt-out link is only necessary
  because some sharing occurs by default; the current copy reads as though
  no such mechanism is needed.
- Recommend counsel review both pages' "What We Don't Do" / equivalent
  sections in the same pass as this new section, so the two don't
  contradict each other at launch.

---

**Status**: draft for counsel input only. Not published, not linked from any
live page, and not to be treated as the company's stated privacy practice
until reviewed and approved by counsel and merged into
`src/app/privacy/page.tsx`.

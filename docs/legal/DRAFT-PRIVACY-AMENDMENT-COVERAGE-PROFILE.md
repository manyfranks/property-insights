# DRAFT — Privacy Policy & Data Usage Amendments for the Coverage-Profile Flow

**DRAFT — REQUIRES COUNSEL REVIEW BEFORE THE FEATURE FLAG SHIPS ON.** Not legal advice; this is
engineering's redline proposal for what the coverage-profile flow requires the live privacy pages
to say, prepared so counsel has a concrete starting point instead of a blank page. `src/app/privacy/page.tsx`
and `src/app/data-usage/page.tsx` are counsel-prepped and **have not been edited** — everything
below is a proposed insert/redline against the live text, not a change that has shipped.

Companion docs: `PARTNER-LANDSCAPE-2026-08.md`, `INSURANCE-BROKERAGE-STRUCTURES.md`,
`../plans/18-INSURANCE-PATH-BUILD.md` (the coverage-profile flow this amendment covers is
built behind `NEXT_PUBLIC_INSURANCE_INTAKE` — as of 2026-08-14 superseded by the single
`NEXT_PUBLIC_INSURANCE_STAGE` dial reaching `"intake"`, see `src/config/insurance-stage.ts` —
and is off in production until this amendment lands).

---

## 1. What the flow collects, and why this amendment is needed

The Stage 2 coverage-profile flow (see `18-INSURANCE-PATH-BUILD.md`) collects a new category of
personal information that neither live page currently describes:

- **Property snapshot** — address, value estimate, and property facts we already hold from the
  assessment/listing pipeline, carried into the profile rather than re-entered.
- **Occupancy** — owner-occupied, tenant-occupied, or vacant.
- **Unit count** — single-family vs. multi-unit.
- **Claims history** — whether the user has filed an insurance claim in a disclosed lookback
  window.
- **Coverage expiry** — when the user's current policy (if any) expires.
- **Roof age** — an underwriting-relevant property attribute the user supplies or confirms.
- **Contact preference** — how the matched partner should reach the user.
- **A consent record** — timestamp, consent text version, and the specific partner the user agreed
  to be shared with.

None of this is covered by the current "What We Collect" section of the privacy policy, which
lists only email, property search queries, and cookieless usage data (plus, with analytics
consent, property view history, assessment requests, and interest signals). Occupancy, unit count,
claims history, coverage expiry, and roof age are new categories entirely. This is materially
different in kind from the behavioral data already disclosed — it is data the user affirmatively
supplies about their property and insurance situation, not data inferred from usage — and existing
"per-action consent" language (used today for partner-connect generally) needs a coverage-profile-specific
instance, not a re-use of the general clause.

---

## 2. Proposed redlines — `src/app/privacy/page.tsx`

### 2.1 "What We Collect" — new subsection

Insert after the existing analytics-consent bullet list (after line 71, before the "This
behavioral data is stored..." paragraph):

> **PROPOSED INSERT:**
>
> If you use the insurance coverage-profile tool, we also collect, only after you explicitly opt
> in to that specific flow:
>
> - **Property and coverage details** you provide or confirm — occupancy status, unit count,
>   claims history, current coverage expiry date, and roof age.
> - **Contact preference** for how a matched insurance partner should reach you.
> - **A record of your consent** — when you agreed, what you agreed to, and which partner you were
>   matched with.
>
> This information is collected specifically to match you with a licensed insurance partner and is
> never used for any other purpose without asking you again.

### 2.2 "Why We Collect It" — new bullet

Insert into the existing purpose list (after line 91):

> **PROPOSED INSERT:**
>
> - With your explicit, flow-specific consent, to build a coverage profile and match you with a
>   single licensed insurance partner appropriate to your property's location and the coverage
>   type you select.

### 2.3 New section — "Insurance Partner Matching" (sits alongside "Partner Connections" / "Affiliate Links")

This needs to be its own section, distinct from the existing "Affiliate Links" section (line
121–142), because the affiliate-link section is explicit that **no personal information is shared**
with affiliate partners — the coverage-profile flow is a deliberate, narrower exception to that
statement and must not be folded into language that currently says the opposite.

> **PROPOSED INSERT — new section, placed after "Affiliate Links":**
>
> ### Insurance Coverage-Profile Matching
>
> If you choose to build a coverage profile, we ask a small set of property and coverage
> questions and, **only with your explicit consent given at that step**, share your coverage
> profile with **the single licensed insurance partner you are matched with** — never with our
> full partner list, and never as a batch or resold lead. Consent is specific to that transaction:
> using the coverage-profile tool once does not carry forward to future uses, and you are shown
> which partner will receive your information before you confirm.
>
> We do not generate or communicate a specific coverage recommendation. The profile is a set of
> property facts and your own stated preferences; the matched partner determines coverage
> options.
>
> If you decline to share, your coverage profile is not sent anywhere. If you have Global Privacy
> Control enabled, or have opted out via **Your Privacy Choices**, we do not send your coverage
> profile to a partner even if you separately click through the flow — see "How GPC and Opt-Out
> Interact With Coverage Profiles" below.

### 2.4 "Data Retention" — coverage-profile-specific carve-out

The current section (line 194–200) treats "assessment requests and property analysis results" as
retained indefinitely. Coverage profiles should not inherit that default silently — insert a
carve-out:

> **PROPOSED INSERT, appended to "Data Retention":**
>
> Coverage profiles are retained only as long as needed to complete a partner match and for a
> limited period afterward to handle disputes or duplicate submissions — retention window to be
> set by counsel, proposed default 24 months from last activity. You can delete your coverage
> profile at any time; see "Deleting Your Coverage Profile" below.

### 2.5 New subsection — "How GPC and Opt-Out Interact With Coverage Profiles"

This is the piece that most needs counsel's eyes: how Do-Not-Sell/GPC opt-out interacts with a
flow that is consent-gated rather than opt-out-gated.

> **PROPOSED INSERT:**
>
> The coverage-profile tool is consent-based, not opt-out-based — we only share your profile with
> a partner if you affirmatively agree at that step, regardless of your Do-Not-Sell/Share or GPC
> status. However, GPC and Do-Not-Sell status still change how we store the profile itself:
>
> - If you have **not** opted out (no GPC signal, no Do-Not-Sell preference set), your coverage
>   profile is linked to your account so you can return to it, edit it, or reuse it for a later
>   match.
> - If you **have** opted out via GPC or Do-Not-Sell, we still let you use the coverage-profile
>   tool and still honor your explicit consent to share with a matched partner if you give it —
>   opting out of sale/sharing does not block you from using the feature — but the profile itself
>   is **stored without a link to your account or identity**, tied only to a one-time session
>   token, and is not retained for reuse after the match (or after you leave without matching, on
>   a short expiry).
>
> **Open question for counsel:** whether a profile shared with a partner under explicit,
> transaction-specific consent needs to be treated as a "sale" or "share" for GPC purposes at all,
> given it is not sold/shared in bulk and is not used for advertising. Proposed position: no,
> because it is a specific, requested transaction the user initiated and consented to individually
> — but this needs confirmation before ship, and until confirmed the opted-out storage behavior
> above (no account linkage) is the conservative default.

### 2.6 "Your Rights Under Canadian Law" / US rights section — deletion path

Both rights sections already reference a general deletion right and a contact email. Add an
explicit, flow-specific deletion pointer so users don't have to infer that a coverage profile is
covered by the general policy:

> **PROPOSED INSERT, appended to both the Canadian rights section and the US rights "Exercising
> your other rights" subsection:**
>
> If you have built an insurance coverage profile, you can delete it directly from **[coverage
> profile management surface — TBD, e.g. a "Delete my coverage profile" action in account
> settings]**, or by emailing privacy@propertyinsights.xyz and requesting deletion of your
> coverage profile specifically. Deleting your coverage profile does not withdraw consent already
> given for a match that has already been shared with a partner — contact the partner directly
> for that partner's own data handling.

---

## 3. Proposed redlines — `src/app/data-usage/page.tsx`

### 3.1 New section — "Insurance Coverage Profiles" (parallel to "User Behavioral Data")

Insert after "User Behavioral Data" (after line 100), before "What We Do Not Sell":

> **PROPOSED INSERT:**
>
> ### Insurance Coverage Profiles
>
> If you use the coverage-profile tool, we collect property details (occupancy, unit count,
> claims history, coverage expiry, roof age) and a contact preference, combined with property data
> we already hold. This is stored separately from general behavioral analytics and is used for a
> single purpose: matching you with one licensed insurance partner, with your explicit consent
> given at the point of match.
>
> We do not use coverage-profile data to personalize your experience elsewhere on the site, to
> train or improve our scoring or offer models, or to build an advertising profile. It is not
> merged with your general behavioral event history.

### 3.2 "Affiliate Links and Partner Referrals" — cross-reference, not a rewrite

The existing section (line 141–153) states we do not share personal information with affiliate
partners generally. Rather than weaken that sentence, append a pointer to the new, narrower
exception so the general claim stays accurate for every non-insurance affiliate relationship:

> **PROPOSED INSERT, appended:**
>
> The insurance coverage-profile tool is a narrow, explicit exception to this — see "Insurance
> Coverage Profiles" above and the "Insurance Coverage-Profile Matching" section of our Privacy
> Policy for what is shared, with whom, and how consent works.

### 3.3 "Data Storage and Security" — no change proposed

The existing language ("encrypted cloud databases with access restricted to application-level
operations... no local or unencrypted copies") already covers coverage-profile storage without
modification, provided the actual implementation keeps coverage-profile records in the same
encrypted-at-rest datastore as other user data. Flagging here only so this isn't silently assumed
— confirm the storage layer before ship (see `18-INSURANCE-PATH-BUILD.md` for the `coverage_profiles`
persistence design).

---

## 4. Items that specifically need counsel sign-off before ship

1. **Retention window** — 24 months is an engineering placeholder, not a legal recommendation.
2. **GPC/sale-or-share characterization** — is a single, explicitly consented partner match a
   "sale" or "share" under any applicable US state definition, given the existing policy already
   takes the conservative position that affiliate-click attribution counts as a share? The
   coverage-profile case is arguably a different fact pattern (explicit per-transaction consent,
   no attribution-only click) and may not need the same treatment — needs a decision, not an
   assumption.
3. **BC insurance-referral discipline** — per `PARTNER-LANDSCAPE-2026-08.md` §2, BC permits
   referral fees only if the referrer performs no insurance activity, including not discussing
   coverage needs. Counsel should confirm the proposed policy language ("we do not generate or
   communicate a specific coverage recommendation") is sufficient, and that the six-question
   intake itself doesn't cross into "discussing insurance needs" as currently worded.
4. **Deletion UX surface** — engineering needs a named settings location before this section can
   be finalized; currently a placeholder.
5. **Whether a separate, flow-specific consent screen (distinct from the general "Accept all /
   Analytics only" banner) is required**, given this is arguably sensitive-adjacent data (claims
   history, occupancy) even though it isn't a statutorily "sensitive" category under any state law
   reviewed in `PARTNER-LANDSCAPE-2026-08.md`.

Until items 1–5 are resolved and this document's language (or counsel's revision of it) is merged
into the live pages, `NEXT_PUBLIC_INSURANCE_INTAKE` stays off in production — see
`../plans/18-INSURANCE-PATH-BUILD.md`.

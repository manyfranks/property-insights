# Insurance Path — Security Hardening Sprint Plan

_Branch `feature/insurance-path`. Created 2026-08-14._

Companion docs: `18-INSURANCE-PATH-BUILD.md` (the Stage 2 build this plan hardens),
`../proposals/insurance-distribution-proposal.html`, `../legal/DRAFT-PRIVACY-AMENDMENT-COVERAGE-PROFILE.md`.

## Why this doc exists

A security audit of the Stage 2 insurance-referral flow (still flag-gated behind
`NEXT_PUBLIC_INSURANCE_INTAKE`, off in production) flagged two issues:

- `GET /api/insurance/address-lookup` is unauthenticated typeahead over the tracked-listing
  address set. Six results per query, 3-character minimum — a scripted client can brute-force
  its way to enumerating the full set.
- `POST /api/coverage-profile` accepts anonymous submissions and writes PII rows (property
  snapshot + underwriting answers + contact info) with no rate control at all.

Owner's decision, verbatim-ish: **ship rate limits on both endpoints now**, on this branch,
ahead of everything else the audit raised. Enumeration deterrence beyond rate-limiting and
French/diacritics support are real work but explicitly **deferred to a dedicated hardening
sprint** — not blocking this branch, not silently dropped either. This doc is that sprint's
backlog, recorded now so it doesn't get lost between the audit and the next planning pass.

## Shipped now (this branch)

`src/lib/rate-limit.ts` gains two limiters, same lazy-singleton-over-Upstash pattern as the
existing three (`apiLimiter`, `authApiLimiter`, `assessLimiter`):

- **`insuranceLookupLimiter()`** — per-IP, sliding window, 30 requests / 60 s, prefix
  `rl:ins-lookup`. The typeahead is debounced 250ms client-side, so a real user typing an
  address never gets near 30 req/min; a 3-char-at-a-time enumeration script does. This doesn't
  close the enumeration hole (see backlog below) — it raises the cost of running it from
  "instant" to "slow," which is the right first move for a low-severity issue on an
  already-public data set.
- **`insuranceProfileLimiter()`** — per-IP, sliding window, 5 requests / 60 s, prefix
  `rl:ins-profile`. Profile submission is a one-shot wizard action; 5/min has no real user
  anywhere near it and meaningfully caps scripted PII-row spam against an endpoint that accepts
  anonymous writes by design (see the route's doc comment on why anonymous is intentional —
  Do-Not-Sell/GPC visitors still get to consent and submit without an account).

Both routes apply their limiter per client IP (`x-forwarded-for`, first hop, same extraction
`src/proxy.ts` already uses for `apiLimiter`) as early as their own gating logic allows:
`address-lookup` checks it immediately after the flag gate, before touching the KV-backed
address index; `coverage-profile` checks it after the flag gate and the `dbAvailable()` check
(so a misconfigured database still fails fast as a 500 without spending a rate-limit round
trip) and before any request-body parsing. Both return a 429 with a clear JSON error body and a
`Retry-After` header on limit — never an empty 200 — matching the fail-loud discipline the rest
of the file's callers (`assess`, `proxy.ts`) already follow.

**Caveat carried over from `rate-limit.ts`'s existing header comment, worth restating here
because it applies directly to these two new limiters:** if the Upstash env vars
(`KV_REST_API_URL` / `KV_REST_API_TOKEN`) are missing in production, `getRedis()` returns
`null`, every limiter becomes a no-op, and the *only* signal is a single
`console.error("[rate-limit] DISABLED — Upstash env missing")` line per warm instance. Nothing
pages anyone. A production misconfiguration silently removes rate limiting from all five
limiters — including these two brand-new ones protecting an anonymous-write PII endpoint — and
looks, from the outside, identical to "working fine, just under light load." Follow-up: **alert
on that log line** (or better, on absence of the expected `rl:*` Redis keys) rather than relying
on someone noticing it in logs after the fact.

## Sprint backlog — abuse / enumeration

- **Address-set enumeration, full posture.** Rate limiting slows this; it doesn't stop a patient
  attacker. Severity is genuinely low, though — every address in the tracked set is already
  public via its own `/property/[slug]` page and the sitemap, so the "leak" here is at most
  "which subset of public addresses this app happens to track," not anything non-public. Options
  for the dedicated sprint, roughly cheapest-first:
  - Raise `MIN_QUERY_LENGTH` from 3 to 4 — meaningfully increases the enumeration search space
    for a typeahead UX cost most users won't notice.
  - Per-IP daily cap layered on top of the per-minute sliding window (a slow-and-steady scraper
    defeats a 60s window trivially; a 24h cap doesn't).
  - Cloudflare Turnstile (or equivalent) gating the `/insurance` landing form itself, not just
    the API — moves the cost from "solve a rate limit" to "solve a challenge," which is the
    actual deterrent scripted enumeration needs.
  - WAF rules on the endpoint (pattern: many sequential short queries from one IP/ASN).
- **Monitor 429 rates** on both new limiters once shipped — a sustained 429 rate on
  `address-lookup` post-launch is itself the signal that tells us whether the options above are
  worth prioritizing, versus theoretical risk that never materializes in practice.
- **Honeypot field on the wizard** (`coverage-profile-wizard.tsx`) — a hidden form field that
  should always be empty; a filled value is a strong scripted-submission signal, cheap to add,
  complements rather than replaces the per-IP cap.
- **Disposable-email screening** on `/api/coverage-profile` submissions — the profile carries a
  contact email; screening against a disposable-domain list before persisting is a standard,
  low-cost filter against throwaway-account spam that a bare rate limit doesn't address.

## Sprint backlog — French / diacritics (owner-confirmed future sprint)

Owner has separately confirmed this is real, planned work — not raised by the audit, but
recorded here at the same time since it touches the same surfaces:

- **Accent-insensitive address matching in `address-lookup`.** Today's match is a plain
  case-folded `startsWith`/`includes` — an address stored or queried with accents (é, à, ç, …)
  won't match its unaccented query or vice versa. Fix is NFD-normalize and strip combining marks
  (`.normalize("NFD").replace(/[̀-ͯ]/g, "")`) on **both** sides: the incoming query
  string and the indexed `address`/`city` fields built in `getIndex()`. Needs a decision on
  whether the index is pre-normalized once (cheaper per-request) or normalized per-comparison
  (simpler, no second cached field to keep in sync).
- **French-language addresses entering the listing data** generally — not just the lookup
  index. Worth a pass across the pipeline (Zoocasa ingestion, KV storage, display) once Quebec
  listings are actually in scope, rather than assuming the diacritics fix above is the only
  touchpoint.
- **Compliance layer, if Quebec activates.** If the insurance flow is ever turned on for Quebec,
  Bill 96 requires French to be at least as prominent as English on consumer-facing commercial
  communications. That means: a French pass of every insurance-surface copy string (landing
  page, wizard, handoff page) — i18n infrastructure, not just translated strings sitting
  alongside the English ones — **and** a French pass of the prohibited-terms build guard
  (`scripts/check-insurance-copy.ts`). That guard currently matches English solicitation terms
  only ("compare," "best," "top-rated," etc.); a French-copy surface with no equivalent guard
  would let exactly the solicitation-adjacent language the guard exists to catch back in,
  just in French. This is a hard gate on Quebec activation, not a nice-to-have — the guard is
  the code-level enforcement of the copy discipline `INSURANCE-BROKERAGE-STRUCTURES.md` §3
  calls structural.

## Sprint backlog — misc from the audit

- **`react-hooks/set-state-in-effect` pattern.** `src/components/insurance/insurance-landing-form.tsx`
  (its debounced address-typeahead effect, ~lines 110-145) calls `setSelected`/`setSuggestions`/
  `setDropdownOpen` synchronously inside a `useEffect` body to sync derived typeahead state —
  the same shape `src/components/province-explorer.tsx` (~lines 148-162) already has for its
  geo-detection sync, and the same shape the rule is named for. Two other files in the codebase
  (`privacy-choices-panel.tsx`, `partner-cta-shared.ts`) already work around it with a
  `setTimeout(..., 0)` deferral; the insurance landing form and province-explorer don't yet.
  Not a security issue by itself, but flagged in the same audit pass and worth fixing alongside
  the rest of this sprint rather than opening a third one-off.
- **Periodic re-verification that all insurance routes still gate on the flag.** This build's
  entire safety model rests on `NEXT_PUBLIC_INSURANCE_INTAKE` staying off until the Stage 0 and
  privacy-amendment gates clear (see `18-INSURANCE-PATH-BUILD.md`, "Feature flag"). Every new
  insurance-surface route (this one included) needs to actually check the flag, not just live
  under `/insurance` or `/coverage-profile` in the URL. Worth a small recurring check — even a
  grep for `NEXT_PUBLIC_INSURANCE_INTAKE` across `src/app/api/**` compared against the actual
  insurance-surface route list — rather than trusting that every future PR touching this area
  remembers the gate on its own.

## Decision record

- Rate limits on `address-lookup` and `coverage-profile` (this doc's "Shipped now" section):
  approved and shipped on `feature/insurance-path`, same branch as the rest of Stage 2.
- Enumeration deterrence beyond rate limiting, and French/diacritics support: **not** shipped
  now — owner-confirmed as a dedicated future hardening sprint, tracked in this doc so the
  decision to defer is explicit and dated rather than implicit.

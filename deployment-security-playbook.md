# Deployment Security & Cost Protection Playbook

A reusable guide for protecting web applications that depend on paid APIs, rate-limited services, or expensive server-side operations. Built from production experience deploying Property Insights (Next.js on Vercel behind Cloudflare) where unprotected endpoints could burn through Google Places credits, LLM tokens, headless browser sessions, and transactional email quotas.

This playbook applies to any system where the end-to-end workflow touches paid or rate-limited services — SaaS apps, AI wrappers, data aggregators, marketplace tools, and anything with a metered API in the critical path.

---

## The Threat Model

Your app isn't just serving pages. Every user action may trigger a cascade of downstream API calls that cost money. The threats aren't sophisticated attacks — they're mundane:

| Threat | Example | Impact |
|---|---|---|
| **LLM crawler abuse** | GPTBot, ClaudeBot, PerplexityBot scraping every page | Server-side rendering triggers data fetches on every crawl |
| **Autocomplete hammering** | Bots or scripts rapidly hitting your address/search proxy | Google Places API bill spikes |
| **Assessment/analysis abuse** | Users (or competitors) submitting hundreds of lookups | LLM tokens + headless browser sessions + email sends |
| **Enumeration attacks** | Scraping all listings/products by iterating slugs | KV/database read costs, potential IP blocking by upstream APIs |
| **Multi-account abuse** | Creating throwaway accounts to bypass per-user rate limits | Assessment caps become meaningless |
| **Referrer/API key leakage** | Client-side API keys exposed in network tab | Direct billing to your account |

The goal isn't to prevent all abuse — it's to make abuse expensive for the attacker and cheap for you to detect and stop.

---

## Layer 1: Cloudflare (Edge Protection)

### Why Cloudflare in Front of Vercel

Vercel provides basic DDoS protection, but it doesn't give you:
- Granular bot management (challenge suspicious traffic before it hits your origin)
- Custom WAF rules (block exploit patterns, geographic restrictions)
- Rate limiting at the edge (before Vercel function invocations are billed)
- Analytics on who's hitting your site and how

Cloudflare's free tier is sufficient for most small-to-medium apps. The key insight: **every request blocked at Cloudflare is a Vercel function invocation you don't pay for.**

### Setup (Free Tier)

1. **Add your domain to Cloudflare.** Change nameservers at your registrar.
2. **SSL mode: Full (Strict).** Cloudflare ↔ Vercel is already HTTPS. Full Strict prevents MITM.
3. **Proxy status: Proxied (orange cloud).** All DNS records should be proxied through Cloudflare, not DNS-only.
4. **Always Use HTTPS: On.** Redirects HTTP → HTTPS at the edge.
5. **Auto Minify: Off.** Vercel/Next.js already minifies. Double-minification can break things.
6. **Brotli: On.** Better compression than gzip.

### Bot Management (Free Tier)

Cloudflare's free tier includes **Bot Fight Mode** (Security → Bots):
- **Bot Fight Mode: On.** Challenges known bot traffic with JS challenges or CAPTCHAs.
- This catches most automated scrapers, headless browsers, and script-based abuse.
- Legitimate crawlers (Googlebot, Bingbot) are allowlisted by Cloudflare automatically.

For more control (Pro tier, $20/month):
- **Super Bot Fight Mode** — separate policies for "definitely automated", "likely automated", and "verified bots."
- **Firewall rules** — block or challenge by user agent, ASN, country, URI path.

### WAF Rules (Free Tier — 5 Custom Rules)

You get 5 custom firewall rules on the free tier. Use them wisely:

**Rule 1: Block AI training crawlers by user agent**
```
(http.user_agent contains "GPTBot") or
(http.user_agent contains "ClaudeBot") or
(http.user_agent contains "anthropic-ai") or
(http.user_agent contains "CCBot") or
(http.user_agent contains "Bytespider") or
(http.user_agent contains "cohere-ai") or
(http.user_agent contains "Amazonbot")
→ Action: Block
```

**Important:** Only block *training* crawlers — those that ingest your content into model weights with no attribution. Do NOT block citation/search crawlers like PerplexityBot (links back to source), Applebot (Siri/Apple Intelligence), or FacebookBot (link previews). And never block Googlebot or Bingbot — they drive both organic search AND AI answer citations (Google AI Overviews, Microsoft Copilot). See Layer 5 for the full distinction.

Why not just `robots.txt`? Because `robots.txt` is advisory — polite crawlers respect it, but scrapers ignore it. Cloudflare blocks them before they reach your origin.

**Rule 2: Rate limit API routes**
```
(http.request.uri.path contains "/api/") and
(not http.request.uri.path contains "/api/pipeline/")
→ Action: Challenge (JS challenge)
Rate limit: 60 requests per minute per IP
```

This adds a JS challenge layer on top of your application-level rate limiting. Belt and suspenders.

**Rule 3: Challenge assess/autocomplete endpoints**
```
(http.request.uri.path eq "/api/assess") or
(http.request.uri.path eq "/api/autocomplete")
→ Action: Managed Challenge
```

These are your most expensive endpoints. A managed challenge (invisible CAPTCHA) blocks most automated abuse without impacting real users.

**Rule 4: Block known bad ASNs (optional)**
```
(ip.src.asnum in {AS14061 AS16509 AS13335})
→ Action: Challenge
```

Challenge traffic from hosting providers (DigitalOcean, AWS, Cloudflare Workers) that's unlikely to be real users. Adjust based on your analytics.

**Rule 5: Geographic restriction (optional)**
```
(not ip.geoip.country in {"CA" "US"})
→ Action: Challenge
```

If your product is Canada-only, challenge non-North American traffic. Don't block — challenge. Legitimate users pass; bots fail.

### Caching Rules

Cloudflare can cache your static assets at the edge, reducing Vercel bandwidth:

- **Browser Cache TTL:** Respect existing headers (Vercel sets these correctly for Next.js static assets).
- **Cache Level:** Standard.
- **Don't cache:** `/api/*`, `/assess`, any dynamic routes. Vercel handles these.
- **Do cache:** `/_next/static/*`, `/icon.svg`, `/apple-icon.png`, font files.

### Analytics

Cloudflare's free analytics show:
- Total requests, unique visitors, bandwidth
- Threat analytics (how many requests were blocked/challenged)
- Top client IPs, countries, user agents
- Bot vs. human traffic split

Review weekly. Look for spikes in bot traffic or unusual API endpoint hits.

---

## Layer 2: Application-Level Rate Limiting

Cloudflare is the first line of defense. Application-level rate limiting is the second — it catches abuse that passes Cloudflare (legitimate-looking requests from real browsers).

### Architecture

```
Request → Cloudflare (edge) → Vercel (origin) → Rate Limiter → Handler
                                                      ↓
                                                 429 Too Many Requests
```

### Implementation Pattern (Upstash Ratelimit)

Use a Redis-backed rate limiter (Upstash Ratelimit is purpose-built for serverless):

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

// Public endpoints: per-IP, generous limit
const publicLimiter = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(60, "1m"), // 60 req/min
  prefix: "rl:public",
});

// Authenticated endpoints: per-user, tighter
const authLimiter = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(30, "1m"), // 30 req/min
  prefix: "rl:auth",
});

// Expensive endpoints: per-user, daily cap
const expensiveLimiter = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.fixedWindow(15, "24h"), // 15 per day
  prefix: "rl:expensive",
});
```

### Which Endpoints Get Which Limits

| Tier | Limit | Key | Endpoints |
|---|---|---|---|
| **Public** | 60/min per IP | `x-forwarded-for` | Search, autocomplete, public reads |
| **Authenticated** | 30/min per user | Clerk `userId` | Event tracking, preferences, subscriptions |
| **Expensive** | 15/day per user | Clerk `userId` | Assessment, analysis — anything that triggers LLM/scraper/email |

### Middleware Enforcement

Apply rate limiting in middleware (runs before the route handler):

```typescript
// middleware.ts or proxy.ts
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (path.startsWith("/api/autocomplete") || path.startsWith("/api/search")) {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const { success } = await publicLimiter.limit(ip);
    if (!success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
  }

  // ... authenticated and expensive routes similarly
}
```

### Graceful Degradation

If your rate limiter's Redis connection fails, **allow the request through** rather than blocking all traffic:

```typescript
const result = await limiter.limit(key).catch(() => ({ success: true }));
```

A dead rate limiter shouldn't become a site outage.

---

## Layer 3: Auth Gating Expensive Operations

Every operation that costs money should require authentication. No exceptions.

### What to Gate

| Operation | Why it's expensive | Gate |
|---|---|---|
| On-demand assessment/analysis | LLM tokens + scraper sessions + email | Auth + daily cap |
| Address autocomplete proxy | Google Places API billing | IP rate limit + cache |
| Headless browser scraping | Browserless per-session cost | Auth + cache-first |
| Email sends | Resend per-email pricing | Auth + tied to assessment |
| Pipeline/cron triggers | LLM + scraper + KV writes | Cron secret or admin auth |

### What Can Stay Public

| Operation | Why it's safe | Protection |
|---|---|---|
| Reading pre-computed listings | Data is already in KV, no downstream cost | IP rate limit only |
| Viewing property pages | ISR-cached, no live computation | None needed |
| Blog/static pages | Pure static content | None needed |
| Sitemap/robots.txt | Static files | None needed |

### Cron/Pipeline Protection

Internal cron endpoints should **never** be publicly triggerable:

```typescript
// Verify Vercel Cron secret
const authHeader = req.headers.get("authorization");
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Or use Vercel's built-in cron authentication (`vercel.json` cron config automatically adds the secret).

---

## Layer 4: Caching as Cost Control

Caching isn't just a performance optimization — it's a cost control mechanism. Every cache hit is an API call you didn't pay for.

### Caching Strategy by Service

| Service | Cache Strategy | TTL | Savings |
|---|---|---|---|
| **Google Places** | In-memory (per-instance) | 60 seconds | ~70% reduction in API calls during typing |
| **Assessment values** | Static cache file + KV | Permanent until refresh | Near-100% after initial scrape |
| **LLM narratives** | Stored in listing object in KV | Until next refresh | One LLM call per listing, reused on every view |
| **Zoocasa listings** | KV with daily refresh | 24 hours | 1 fetch per listing per day |
| **Property analysis** | ISR (Next.js) | 10 minutes | Server computes once, serves cached for 600s |

### Cache-First Architecture

For any expensive lookup, always check cache before making a live call:

```typescript
async function getAssessment(address: string): Promise<Assessment | null> {
  // 1. Check local cache (instant, free)
  const cached = ASSESSMENT_CACHE[normalizeAddress(address)];
  if (cached) return cached;

  // 2. Check KV cache (fast, cheap)
  const stored = await kvGet(`assessment:${address}`);
  if (stored) return stored;

  // 3. Live lookup (slow, expensive)
  const live = await scrapeBCAssessment(address);
  if (live) await kvSet(`assessment:${address}`, live);
  return live;
}
```

### LLM Cost Optimization

Not every request needs a full LLM call. Use tiered generation:

```
High confidence (HOT/WARM tier) → Full LLM narrative ($0.004)
Low confidence (WATCH tier)     → Deterministic template ($0.000)
```

This single optimization can reduce LLM costs by 70–80% depending on your score distribution.

---

## Layer 5: AI Crawler Strategy — Training vs. Citation

Not all AI crawlers are the same. Blocking them all feels safe but costs you visibility. The distinction that matters: **training crawlers** ingest your content into model weights (no attribution, no traffic back), while **citation/search crawlers** index your content so it can be referenced in AI-generated answers with links back to your site.

### The Two Types

**Training crawlers (block these):**

These scrape your site to build training datasets. Your content becomes part of the model's weights — you get no attribution, no link, no referral traffic. Each crawl triggers expensive server-side rendering for zero return.

| Crawler | Operator | What it does |
|---|---|---|
| GPTBot | OpenAI | Training data for GPT models |
| ChatGPT-User | OpenAI | ChatGPT browsing mode (uses Bing index, not this crawler, for search) |
| ClaudeBot / anthropic-ai | Anthropic | Training data for Claude models |
| CCBot | Common Crawl | Open training datasets used by many AI labs |
| Google-Extended | Google | DeepMind/Gemini training (separate from Googlebot search indexing) |
| Bytespider | ByteDance/TikTok | Training data |
| cohere-ai | Cohere | Training data |
| Amazonbot | Amazon | Alexa/training data |

**Citation/search crawlers (allow these):**

These index your content so it can appear in AI-generated answers — with links back to your site. They function like search engines. Blocking them reduces your visibility in the fastest-growing discovery channels.

| Crawler | Operator | What it does | Why allow |
|---|---|---|---|
| **Googlebot** | Google | Search index + AI Overviews + Gemini answers | Your SEO work gets you cited here. Never block. |
| **Bingbot** | Microsoft | Search index + Copilot answers | Drives Bing search AND Microsoft Copilot citations. Never block. |
| **PerplexityBot** | Perplexity | Search index for Perplexity answers | Links back to source in every answer. Functions as a search engine. |
| **Applebot** | Apple | Siri, Spotlight, Apple Intelligence | Growing channel. Low volume, links back. |
| **FacebookBot** | Meta | Link previews in Messenger, WhatsApp, Instagram | Not AI search, but essential for social sharing. |

### The Key Insight

You don't need training crawlers to index your site in order to be referenced by LLMs in conversation:

- **Google AI Overviews / Gemini** uses **Googlebot** (already allowed) + Google's search index. Your SEO work is what gets you cited.
- **Microsoft Copilot** uses **Bingbot** (already allowed) + Bing's search index.
- **ChatGPT with browsing** uses Bing's search index for real-time lookups, not GPTBot.
- **Perplexity** uses its own crawler (PerplexityBot) and cites sources with direct links.

GPTBot crawling your site goes into OpenAI's training data — it's not what makes ChatGPT reference you in conversations. That's Bing search integration. Blocking GPTBot costs you nothing in terms of ChatGPT visibility.

### Defense in Depth (Three Layers)

Apply blocking to **training crawlers only**. Allow citation crawlers through with the same access as regular search engines.

**Layer A: robots.txt (advisory)**
```
# Block AI training crawlers (no attribution, no traffic back)
User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-Web
User-agent: anthropic-ai
User-agent: CCBot
User-agent: Google-Extended
User-agent: Bytespider
User-agent: cohere-ai
User-agent: Amazonbot
Disallow: /

# Allow AI citation/search crawlers (link back to source)
User-agent: PerplexityBot
User-agent: Applebot-Extended
User-agent: FacebookBot
Allow: /
Disallow: /api/
Disallow: /assess

# Default: allow search engines (Googlebot, Bingbot, etc.)
User-agent: *
Allow: /
Disallow: /api/
Disallow: /assess
```

Polite crawlers respect this. Aggressive ones don't — that's why you need the next two layers.

**Layer B: Cloudflare WAF rule (enforcement)**

See Layer 1, Rule 1. Blocks training crawlers at the edge before any server-side code runs. Only include training crawler user agents — do NOT include PerplexityBot, Applebot, or FacebookBot.

**Layer C: Server-side user agent check (last resort)**

```typescript
// Training crawlers only — never block citation/search crawlers here
const TRAINING_CRAWLERS = /GPTBot|ChatGPT-User|ClaudeBot|anthropic-ai|CCBot|Google-Extended|Bytespider|cohere-ai|Amazonbot/i;

export function middleware(req: NextRequest) {
  const ua = req.headers.get("user-agent") || "";
  if (TRAINING_CRAWLERS.test(ua)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
}
```

### Why All Three Layers

- robots.txt alone is toothless against bad actors who ignore it
- Cloudflare alone can be bypassed by crawlers that spoof user agents
- Server-side checks alone mean the request already hit your origin (you already paid for the function invocation)

Together, they catch 99%+ of training crawler traffic while keeping your site visible in AI-powered search.

### When to Revisit

The AI crawler landscape changes fast. New crawlers emerge regularly, and some training crawlers may add citation features. Review quarterly:
- Check Cloudflare analytics for new user agents hitting your site
- Check if any blocked crawlers have launched search/citation products
- Check if any allowed crawlers have started training-only scraping
- Update all three layers (robots.txt, Cloudflare WAF, server-side) together

---

## Layer 6: Monitoring & Alerting

Protection without monitoring is guessing.

### What to Monitor

| Metric | Tool | Alert Threshold |
|---|---|---|
| **Vercel function invocations** | Vercel dashboard | >2x normal daily average |
| **OpenRouter/LLM spend** | OpenRouter dashboard | >$50/month |
| **Google Places API calls** | Google Cloud Console | >80% of monthly quota |
| **Cloudflare blocked requests** | Cloudflare Analytics | Sudden spike (indicates attack) |
| **429 responses** | Application logs | >100/day (indicates abuse attempt) |
| **Assessment requests** | Custom tracking (Postgres) | >50/day total (indicates multi-account abuse) |
| **Upstash KV operations** | Upstash console | >80% of plan limit |

### Weekly Review Checklist

- [ ] Check Cloudflare Analytics: bot vs. human ratio, blocked threats
- [ ] Check Vercel usage: function invocations, bandwidth, build minutes
- [ ] Check OpenRouter billing: total spend, per-model breakdown
- [ ] Check Google Cloud Console: Places API quota usage
- [ ] Review rate limit logs: any IPs or users consistently hitting limits
- [ ] Scan for new AI crawler user agents (they emerge regularly)

---

## Layer 7: API Key Security

### Server-Side Only

API keys should never appear in client-side code. Pattern:

```
Client → Your API Route → External Service
         (key lives here)
```

Not:

```
Client → External Service (key in JS bundle)
```

### Key Inventory

For any project, maintain an inventory:

| Key | Service | Exposure Risk | Rotation Schedule |
|---|---|---|---|
| `OPENROUTER_API_KEY` | LLM calls | Server-only, high cost if leaked | Quarterly |
| `BROWSERLESS_API_KEY` | Headless browser | Server-only, moderate cost | Quarterly |
| `GOOGLE_PLACES_API_KEY` | Address autocomplete | Server-only via proxy route | Quarterly |
| `KV_REST_API_TOKEN` | Redis storage | Server-only, data access | On compromise |
| `RESEND_API_KEY` | Email delivery | Server-only, reputation risk | On compromise |
| `CRON_SECRET` | Pipeline triggers | Server-only, abuse vector | On compromise |
| `CLERK_SECRET_KEY` | Auth | Server-only, full user access | On compromise |

### Environment Variable Hygiene

- Never commit `.env` files. Use `.env.example` with placeholder values.
- Use Vercel's environment variable UI for production secrets.
- Different keys for development vs. production (Google Places, OpenRouter, etc.).
- Restrict Google API keys by HTTP referrer and API type in the Google Cloud Console.

---

## Quick-Start Checklist

For a new project with paid API dependencies:

```
Day 1: Edge Protection
  □ Add domain to Cloudflare (free tier)
  □ Set SSL to Full (Strict)
  □ Enable Bot Fight Mode
  □ Add WAF rule to block AI crawlers by user agent
  □ Add WAF rule to challenge API routes

Day 2: Application Protection
  □ Identify all expensive operations (LLM, scraping, email, paid APIs)
  □ Gate expensive operations behind authentication
  □ Implement per-user rate limiting on expensive endpoints
  □ Implement per-IP rate limiting on public endpoints
  □ Add robots.txt blocking for AI crawlers

Day 3: Cost Control
  □ Add caching layer for every paid API (in-memory, KV, or both)
  □ Implement cache-first lookup pattern for expensive operations
  □ Set daily/hourly caps on the most expensive endpoints
  □ Protect cron/pipeline endpoints with secrets

Day 4: Monitoring
  □ Set up billing alerts for each paid service
  □ Review Cloudflare analytics for bot traffic patterns
  □ Log rate limit hits for abuse detection
  □ Schedule weekly review of all service dashboards
```

---

## Cost Impact Reference

From Property Insights production data:

| Protection | Monthly Savings Estimate |
|---|---|
| Cloudflare AI crawler blocking | ~$15–30 (prevented Vercel invocations + KV reads) |
| Google Places in-memory cache (60s) | ~$10–40 (70% API call reduction) |
| LLM tier gating (WATCH skips LLM) | ~$20–50 (70–80% of listings skip LLM) |
| Assessment cache-first pattern | ~$5–15 (Puppeteer calls near-zero after cache warm) |
| ISR caching (600s on property pages) | ~$5–10 (reduced function invocations) |
| Rate limiting (15 assess/day cap) | Unbounded → bounded (prevents runaway costs) |
| **Total estimated savings** | **$55–145/month** vs. unprotected deployment |

At scale, these protections are the difference between a $50/month side project and a $500/month bill from a single bad actor.

---

*Built by Orio. Validated on propertyinsights.xyz (Next.js + Vercel + Cloudflare).*

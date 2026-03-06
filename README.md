# Property Insights

Acquisition intelligence for residential real estate. Enter an address or browse a city — Property Insights pulls government assessments, days-on-market data, and listing language to surface motivated sellers and recommend what to offer.

Live at [propertyinsights.xyz](https://propertyinsights.xyz)

---

## What it does

- **Discover** — browse live realtor.ca listings ranked by a 0–100 seller motivation score
- **Search** — enter any preloaded address to get a full property analysis
- **Property page** — recommended offer price, AI-written investor signal, motivation score, and full scoring breakdown

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [Clerk](https://clerk.com) for auth
- [Vercel](https://vercel.com) for deployment
- No database — stateless scoring and offer logic

## Data sources

- **realtor.ca** internal API — live listing search
- **BC Assessment** — government assessment values (cached for 41 properties across Southern Vancouver Island)
- **HouseSigma** — listing history link-out

## Local setup

```bash
npm install
cp .env.example .env.local
# fill in your keys (see .env.example for required vars)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Description |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `OPENAI_API_KEY` | Used for AI signal generation |
| `REALTOR_API_KEY` | realtor.ca internal API access |

See `.env.example` for the full list.

## Project structure

```
src/
  app/                  # Pages and API routes
    api/analyze/        # Property analysis endpoint
    api/discover/       # City listing search endpoint
    dashboard/          # Pre-analyzed listings table
    discover/[city]/    # Live city listing browser
    how-it-works/       # Product explainer page
    property/[slug]/    # Individual property analysis
  components/           # Shared UI components
  lib/
    assessment/         # Province adapter pattern (BC live, ON/AB stubs)
    data/               # Static listings, assessments, city metadata
    analyze.ts          # Core scoring and offer logic
    offer-model.ts      # 4-step offer cascade
    signals.ts          # Motivation signal detection
```

## Coverage

Currently live for **BC — Southern Vancouver Island** (Victoria, Saanich, Oak Bay, Langford, and more). Ontario and Alberta support planned.

---

Built by [Matt Francis](https://github.com/mattfrancis)

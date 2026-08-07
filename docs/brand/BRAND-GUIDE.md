# Property Insights — Brand Guide

Reference for anyone (human or agent) touching visual identity or external copy for Property Insights: logo exports, color tokens, type, and approved messaging. This is the source of truth in-repo — see also the [interactive brand kit](#interactive-version) for a shareable version of the same content.

## Logo

Files live in [`docs/brand/logo/`](./logo/). Source is hand-authored SVG (two `<path>` elements: house outline + inner trend line); PNGs are rasterized from it, not separately maintained.

| File | Use |
|---|---|
| `mark-navy.svg` / `property-insights-logo-300.png` | **Primary.** Navy fill, cream mark. Social avatars (LinkedIn, X, GitHub) — anywhere the logo sits alone on a small circle and needs to hold its own in a feed. |
| `mark-light.svg` / `property-insights-logo-light-300.png` | Paper background, navy mark. Matches the site header/favicon. White backgrounds, printed docs. |
| `mark-transparent.svg` / `property-insights-mark-transparent-300.png` | No background fill, navy stroke. For compositing onto an arbitrary surface (cards, colored sections). |

These are the *extended* kit for off-site use. The production-served assets are unchanged and live where Next.js expects them: `public/logo.png` (header), `src/app/icon.svg` (favicon), `src/app/apple-icon.png`. If the mark ever changes, update both the source in `docs/brand/logo/` and those production files together — they should stay visually identical.

**Regenerating PNGs from SVG** (requires `librsvg`, `brew install librsvg`):
```bash
rsvg-convert -w 300 -h 300 docs/brand/logo/mark-navy.svg -o docs/brand/logo/property-insights-logo-300.png
```
Plain ImageMagick (`convert`/`magick`) without `librsvg` on the system silently drops stroked paths — always render through `rsvg-convert`, or check output isn't a flat single color before trusting it.

**Clearspace:** minimum padding on every side equals the roof height (apex to eave). **Minimum size:** 32px — below that, drop the inner trend line and keep the house outline only (this is what the favicon already does).

**Don't:** recolor outside navy/paper/ink, stretch the square canvas, add shadows/bevels, or place on a busy photo without a solid backing shape.

## Color

Not brand-kit-specific colors — these are the five tokens already defined in [`src/app/globals.css`](../../src/app/globals.css). Pull from there, not from this doc, if the two ever drift.

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#1a1a2e` | Logo fill, primary buttons, links, emphasis |
| `--foreground` | `#171717` | Body text, headings |
| `--muted` | `#6b7280` | Secondary text, labels, captions |
| `--background` | `#fafafa` | Page ground |
| `--border` | `#e5e7eb` | Hairlines, dividers, dot-grid |

## Typography

Product UI: **Geist Sans** / **Geist Mono**, loaded via `next/font` in `src/app/layout.tsx`. Off-site (LinkedIn, decks, PDFs — anywhere webfonts get stripped), fall back to:
- Sans: `-apple-system, "Segoe UI", Inter, system-ui`
- Mono: `ui-monospace, "SF Mono", "Cascadia Mono"`

## Voice

- **Confident, not hypey.** Lead with the number: "assessed at $612,000," not "an amazing deal!"
- **Plain language.** Write for a first-time buyer, not an agent.
- **Data leads the sentence.** Figures and facts first, takeaway after.
- **Free is a feature.** State it once, plainly — no exclamation points.

## Approved copy

**Tagline (site/SEO)** — already live in `src/lib/seo.ts` and page `<title>` tags:
> Canadian Real Estate Offer Intelligence

**Tagline (LinkedIn company-page field, ≤120 char)** — recommended, more benefit-led for a human audience:
> Know what to offer, backed by the assessment.

**One-liner (bio/headline, ~130 char):**
> Free offer intelligence for Canadian home buyers — assessment values, AI pricing, and seller-motivation scoring, in seconds.

**LinkedIn About / long description:**
> Property Insights turns public assessment data into a clear, defensible offer number.
>
> Search any address to see its government-assessed value, comparable sales, days-on-market, and a seller-motivation score — then get an AI-modeled offer recommendation with the reasoning behind it. No agent required to get started.
>
> Prefer to browse? Discover mode ranks a city's active listings by how motivated the seller looks, so you can find opportunity before you have an address in mind.
>
> Live today across Southern Vancouver Island, BC, with Ontario and Alberta coverage underway. Free to use.
>
> Built by Orio.

**Press / elevator sentence:**
> Property Insights is a free tool that turns government assessment records and AI offer modeling into a clear, defensible price recommendation for Canadian home buyers.

## Interactive version

A polished, presentable version of this same content — live logo preview with one-click PNG export, copy-to-clipboard on every text block — was published as a Claude artifact. Ask Claude to regenerate or update it if you need a shareable link; it isn't checked in since it's a rendering of the content above, not a separate source of truth.

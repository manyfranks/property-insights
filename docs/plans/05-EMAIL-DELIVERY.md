# Phase 5: Email Delivery

**Priority:** MEDIUM
**Effort:** 1 day
**Dependencies:** Phase 4 (need picks stored in Postgres to email)
**Status:** NOT STARTED

## Problem

The email endpoint (`/api/email`) is stubbed. Resend SDK is in package.json but no templates or delivery logic exist. Users subscribe to cities but never receive anything.

## Goal

A daily digest email sent after the cron pipeline completes. Each user gets their subscribed cities' top picks in a clean, scannable email.

## Email Design

### Subject Line
```
3 new picks today — Victoria, Saanich
```
or
```
No new picks today — all caught up
```
(Only send if there are picks. Don't spam empty digests.)

### Email Body Structure

```
[Orio logo]

Your daily picks for March 6, 2026

--- VICTORIA (2 picks) ---

1. 838 Princess Ave — $1,049,900
   HOT | 127 DOM | Estate Sale, Price Reduced
   Recommended offer: $918,000 (save $131,900)
   "Long-stale estate listing with significant price reduction..."
   [View full analysis ->]

2. 3883 Douglas St — $924,900
   WARM | 89 DOM | Suite Potential
   Recommended offer: $855,000 (save $69,900)
   [View full analysis ->]

--- SAANICH (1 pick) ---

3. 1941 Mayfair Dr — $1,475,000
   ...

---
[Manage preferences] [Unsubscribe]
```

### Key Design Decisions

- Plain, text-heavy layout (like Morning Brew, not like marketing spam)
- Each pick shows: address, price, tier badge, DOM, top 2-3 signals, offer amount, one-liner narrative
- "View full analysis" links to `/property/[slug]` on the live site
- Mobile-first — single column, large tap targets

## Files to Create

### `src/lib/email/digest-template.tsx`
React Email template (Resend supports React Email natively).

### `src/lib/email/send-digest.ts`
```typescript
export async function sendDigest(
  email: string,
  picks: EnrichedPick[],
  cities: string[]
): Promise<void>
```

## Files to Modify

### `src/app/api/pipeline/cron/route.ts`
After storing picks to Postgres, iterate subscribed users and call `sendDigest()`.

### `.env.local`
Add `RESEND_API_KEY` and configure sending domain (`picks@useorio.com` or similar).

## Resend Setup

1. Add and verify sending domain in Resend dashboard
2. Add DNS records (SPF, DKIM, DMARC)
3. Set `RESEND_API_KEY` in Vercel environment variables
4. Free tier: 100 emails/day, 3,000/month — sufficient for early users

## Verification

1. Send test digest to yourself
2. Check rendering in Gmail, Apple Mail, Outlook (web)
3. Verify links to `/property/[slug]` work
4. Test with 0 picks (should not send)
5. Test unsubscribe flow (Clerk metadata update)

## Definition of Done

- [ ] Digest email sends after each cron run
- [ ] Email renders correctly on major clients
- [ ] Only sends when there are new picks (no empty emails)
- [ ] Links to property pages work
- [ ] Unsubscribe link works
- [ ] Build passes

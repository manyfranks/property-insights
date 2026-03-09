/**
 * intent-score.ts
 *
 * Buyer readiness scoring algorithm. Converts raw behavioral signals
 * into a 0-100 intent score for lead qualification.
 *
 * SIGNAL WEIGHTS:
 *   Assessment requested     25 pts each (cap 50)  — strongest intent
 *   Return visit (same prop) 15 pts each (cap 30)  — serious consideration
 *   Partner click (mortgage)  15 pts (once)         — financing = ready to buy
 *   5+ views in one city     10 pts (once)          — focused search
 *   City subscription        10 pts (once)          — committed to monitoring
 *   Active in last 7 days    10 pts (once)          — recency
 *   Narrow price range        5 pts (once)          — knows budget
 *   Partner click (insurance)  5 pts (once)          — planning ahead
 *
 * Score is capped at 100.
 */

export interface IntentSignals {
  assessmentCount: number;
  returnVisitCount: number;
  mortgageClicks: number;
  insuranceClicks: number;
  maxViewsInOneCity: number;
  hasCitySubscription: boolean;
  lastActiveAt: Date | null;
  priceMin: number | null;
  priceMax: number | null;
}

export function calculateIntentScore(signals: IntentSignals): number {
  let score = 0;

  // Assessments: 25 pts each, cap 50
  score += Math.min(signals.assessmentCount * 25, 50);

  // Return visits: 15 pts each, cap 30
  score += Math.min(signals.returnVisitCount * 15, 30);

  // Mortgage partner click: 15 pts (once)
  if (signals.mortgageClicks > 0) score += 15;

  // Focused city search: 10 pts if 5+ views in any single city
  if (signals.maxViewsInOneCity >= 5) score += 10;

  // City subscription: 10 pts
  if (signals.hasCitySubscription) score += 10;

  // Recency: 10 pts if active in last 7 days
  if (signals.lastActiveAt) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (signals.lastActiveAt.getTime() > sevenDaysAgo) score += 10;
  }

  // Narrow price range: 5 pts if spread < $200K
  if (signals.priceMin != null && signals.priceMax != null) {
    const spread = signals.priceMax - signals.priceMin;
    if (spread > 0 && spread < 200_000) score += 5;
  }

  // Insurance click: 5 pts (planning ahead)
  if (signals.insuranceClicks > 0) score += 5;

  return Math.min(score, 100);
}

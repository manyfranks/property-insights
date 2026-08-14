/**
 * Maps a P4 assessment goal (src/lib/property-intelligence/journey.ts) to a
 * sensible default insurance line for the result-page insurance module
 * (src/components/insurance/insurance-module.tsx). Pure lookup, no
 * side effects — the goal only sets a *default* selection; users can still
 * pick any of the five lines from the chooser.
 */
import type { AssessmentGoal } from "@/lib/property-intelligence/journey";
import type { InsuranceLine } from "@/config/affiliate-vendors";

const GOAL_TO_LINE: Partial<Record<AssessmentGoal, InsuranceLine>> = {
  buy_home: "homeowner",
  rental_investment: "landlord",
  own_manage: "homeowner",
  // "explore" intentionally has no mapping — let the module fall back to
  // its own default (homeowner) rather than assert a goal-driven pick.
};

export function lineForGoal(goal: AssessmentGoal | null | undefined): InsuranceLine | undefined {
  if (!goal) return undefined;
  return GOAL_TO_LINE[goal];
}

/**
 * Private, user-owned P4 assessment state.
 *
 * This is product state, not analytics or a profile. Records contain no
 * address, place ID, provider payload, property classification, occupancy,
 * owner data, or capability evidence. A Canadian result may retain the
 * existing shared-listing reference (which can be derived from its address)
 * solely so the user can reopen that result; no raw address is duplicated.
 */

import { randomUUID } from "node:crypto";
import { dbAvailable, sql } from "@/lib/db";
import {
  parseAssessmentGoal,
  parseSubjectScope,
  type AssessmentGoal,
} from "@/lib/property-intelligence/journey";
import type {
  AssessmentSubject,
  SubjectScope,
  SubjectSelection,
} from "@/lib/property-intelligence/subject";
import { isOwnedByUser } from "@/lib/security/authorization";

export type AssessmentResultVariant = "listed" | "off_market" | "regional_fallback";

export interface UserAssessmentState {
  id: string;
  country: "US" | "CA";
  resultVariant: AssessmentResultVariant;
  resultRef: string | null;
  assessmentGoal: AssessmentGoal | null;
  activeView: AssessmentGoal | null;
  subjectScope: SubjectScope;
  subjectUnit: string | null;
  subjectSelectedBy: SubjectSelection;
  createdAt: string;
  updatedAt: string;
}

interface UserAssessmentRow {
  id: string;
  user_id: string;
  country: string;
  result_variant: string;
  result_ref: string | null;
  assessment_goal: string | null;
  active_view: string | null;
  subject_scope: string;
  subject_unit: string | null;
  subject_selected_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

const SUBJECT_SELECTIONS: SubjectSelection[] = [
  "explicit_input",
  "listing_match",
  "provider_match",
  "user_confirmation",
  "unresolved",
];

const ASSESSMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAssessmentStateId(value: unknown): value is string {
  return typeof value === "string" && ASSESSMENT_ID.test(value);
}

export function normalizePrivateSubjectUnit(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid subject unit");
  const normalized = value
    .trim()
    .replace(/^(?:#|unit|suite|ste|apt|apartment)\s*/i, "")
    .replace(/[^a-z0-9-]/gi, "")
    .toUpperCase()
    .slice(0, 32);
  if (!normalized) throw new Error("Invalid subject unit");
  return normalized;
}

export function normalizePrivateResultRef(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,199}$/i.test(value)) {
    throw new Error("Invalid result reference");
  }
  return value;
}

function toState(row: UserAssessmentRow): UserAssessmentState {
  const subjectScope = parseSubjectScope(row.subject_scope);
  const assessmentGoal = row.assessment_goal == null ? null : parseAssessmentGoal(row.assessment_goal);
  const activeView = row.active_view == null ? null : parseAssessmentGoal(row.active_view);
  if (
    (row.country !== "US" && row.country !== "CA") ||
    !["listed", "off_market", "regional_fallback"].includes(row.result_variant) ||
    !subjectScope ||
    (row.assessment_goal != null && !assessmentGoal) ||
    (row.active_view != null && !activeView) ||
    !SUBJECT_SELECTIONS.includes(row.subject_selected_by as SubjectSelection)
  ) {
    throw new Error("Invalid private assessment row");
  }
  return {
    id: row.id,
    country: row.country,
    resultVariant: row.result_variant as AssessmentResultVariant,
    resultRef: row.result_ref,
    assessmentGoal,
    activeView,
    subjectScope,
    subjectUnit: row.subject_unit,
    subjectSelectedBy: row.subject_selected_by as SubjectSelection,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Defense in depth after the owner-scoped SQL predicate. */
function toOwnedState(row: UserAssessmentRow | undefined, userId: string): UserAssessmentState | null {
  return row && isOwnedByUser(userId, row.user_id) ? toState(row) : null;
}

export async function createUserAssessmentState(input: {
  userId: string;
  country: "US" | "CA";
  resultVariant: AssessmentResultVariant;
  resultRef?: string | null;
  assessmentGoal: AssessmentGoal | null;
  subject: AssessmentSubject;
}): Promise<UserAssessmentState | null> {
  if (!dbAvailable()) return null;
  const id = randomUUID();
  const resultRef = normalizePrivateResultRef(input.resultRef);
  const subjectUnit = normalizePrivateSubjectUnit(input.subject.unit);
  const db = sql();
  const rows = await db`
    INSERT INTO user_assessments (
      id, user_id, country, result_variant, result_ref,
      assessment_goal, active_view, subject_scope, subject_unit, subject_selected_by
    ) VALUES (
      ${id}, ${input.userId}, ${input.country}, ${input.resultVariant}, ${resultRef},
      ${input.assessmentGoal}, ${input.assessmentGoal}, ${input.subject.scope},
      ${subjectUnit}, ${input.subject.selectedBy}
    )
    RETURNING id, user_id, country, result_variant, result_ref, assessment_goal, active_view,
      subject_scope, subject_unit, subject_selected_by, created_at, updated_at
  ` as UserAssessmentRow[];
  return toOwnedState(rows[0], input.userId);
}

export async function getUserAssessmentState(
  userId: string,
  id: string
): Promise<UserAssessmentState | null> {
  if (!isAssessmentStateId(id)) return null;
  if (!dbAvailable()) return null;
  const db = sql();
  const rows = await db`
    SELECT id, user_id, country, result_variant, result_ref, assessment_goal, active_view,
      subject_scope, subject_unit, subject_selected_by, created_at, updated_at
    FROM user_assessments
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  ` as UserAssessmentRow[];
  return toOwnedState(rows[0], userId);
}

export async function updateUserAssessmentView(
  userId: string,
  id: string,
  activeView: AssessmentGoal
): Promise<UserAssessmentState | null> {
  const db = sql();
  const rows = await db`
    UPDATE user_assessments
    SET active_view = ${activeView}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, user_id, country, result_variant, result_ref, assessment_goal, active_view,
      subject_scope, subject_unit, subject_selected_by, created_at, updated_at
  ` as UserAssessmentRow[];
  return toOwnedState(rows[0], userId);
}

export async function updateUserAssessmentSubject(
  userId: string,
  id: string,
  subject: { scope: SubjectScope; unit: string | null; selectedBy: "user_confirmation" }
): Promise<UserAssessmentState | null> {
  const subjectUnit = normalizePrivateSubjectUnit(subject.unit);
  if (subject.scope === "unit" && !subjectUnit) {
    throw new Error("A private unit-scoped assessment requires a unit identifier");
  }
  const db = sql();
  const rows = await db`
    UPDATE user_assessments
    SET subject_scope = ${subject.scope}, subject_unit = ${subjectUnit},
      subject_selected_by = ${subject.selectedBy}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, user_id, country, result_variant, result_ref, assessment_goal, active_view,
      subject_scope, subject_unit, subject_selected_by, created_at, updated_at
  ` as UserAssessmentRow[];
  return toOwnedState(rows[0], userId);
}

export async function deleteUserAssessmentState(userId: string, id: string): Promise<boolean> {
  const db = sql();
  const rows = await db`
    DELETE FROM user_assessments
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, user_id
  ` as Array<{ id: string; user_id: string }>;
  return rows.length === 1 && isOwnedByUser(userId, rows[0].user_id);
}

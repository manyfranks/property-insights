/**
 * Live DB ownership/round-trip check for private assessment state.
 * Uses synthetic users, creates one record, and deletes it in finally.
 * No provider or listing-store calls.
 */

import assert from "node:assert/strict";
import { loadEnvLocal } from "./lib/ingest-shared";
loadEnvLocal();

import {
  createUserAssessmentState,
  deleteUserAssessmentState,
  getUserAssessmentState,
  updateUserAssessmentSubject,
  updateUserAssessmentView,
} from "../src/lib/db/user-assessments";
import type { AssessmentSubject } from "../src/lib/property-intelligence/subject";

const owner = `p4b-fixture-owner-${Date.now()}`;
const otherUser = `p4b-fixture-other-${Date.now()}`;
const subject: AssessmentSubject = {
  schemaVersion: 1,
  scope: "building",
  canonicalAddress: "not persisted",
  unit: null,
  selectedBy: "provider_match",
  resolutionConfidence: "high",
  requiresClarification: false,
  candidates: [],
  conflicts: [],
};

async function main() {
  let id: string | null = null;
  try {
    const created = await createUserAssessmentState({
      userId: owner,
      country: "CA",
      resultVariant: "listed",
      resultRef: "p4b-private-fixture",
      assessmentGoal: "rental_investment",
      subject,
    });
    assert.ok(created);
    id = created.id;
    assert.equal(created.assessmentGoal, "rental_investment");
    assert.equal(created.activeView, "rental_investment");
    assert.equal(created.subjectScope, "building");

    assert.equal(await getUserAssessmentState(otherUser, id), null, "cross-user read leaked state");
    assert.equal(await updateUserAssessmentView(otherUser, id, "explore"), null, "cross-user update changed state");

    const switched = await updateUserAssessmentView(owner, id, "explore");
    assert.equal(switched?.assessmentGoal, "rental_investment", "initial goal was overwritten");
    assert.equal(switched?.activeView, "explore");

    const confirmed = await updateUserAssessmentSubject(owner, id, {
      scope: "unit",
      unit: "Apt 402",
      selectedBy: "user_confirmation",
    });
    assert.equal(confirmed?.subjectScope, "unit");
    assert.equal(confirmed?.subjectUnit, "402");
    assert.equal(confirmed?.subjectSelectedBy, "user_confirmation");

    assert.equal(await deleteUserAssessmentState(otherUser, id), false, "cross-user delete removed state");
    assert.equal(await deleteUserAssessmentState(owner, id), true);
    id = null;
    console.log("P4 Sprint B private persistence: PASS (ownership, restore, switch, confirm, delete)");
  } finally {
    if (id) await deleteUserAssessmentState(owner, id).catch(() => false);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

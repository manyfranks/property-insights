-- A2 delivery-integrity corrections. Forward-only: 0001-0006 are never edited.
-- This migration (a) makes the DB itself enforce the provider-transaction
-- state machine instead of trusting application code alone, (b) relaxes the
-- acknowledged_at CHECK from a biconditional to a one-directional rule so a
-- legal post-ack transition (ACKNOWLEDGED -> RECONCILIATION_REQUIRED) can
-- keep its acknowledgement timestamp as evidence, (c) extends the A2
-- submission state machine with withdrawal edges from in-flight/error states,
-- (d) forbids reopening fact collection while a provider submission is still
-- active, and (e) adds the columns/constraints needed to open an operator
-- exception and reprocess a deferred webhook without a durable case yet.

-- (a) Provider-submission transition enforcement, mirroring
-- canTransitionDelivery() in src/lib/insurance/domain/delivery.ts exactly.
-- Same-state updates (OLD.status = NEW.status) are always allowed -- this is
-- the DB-side twin of the application's idempotent-no-op rule.
CREATE OR REPLACE FUNCTION insurance_provider_submission_transition_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'PENDING_DISPATCH' AND NEW.status IN ('AWAITING_PROVIDER', 'RETRY_SCHEDULED', 'DEAD_LETTER'))
    OR (OLD.status = 'AWAITING_PROVIDER' AND NEW.status IN ('ACKNOWLEDGED', 'RETRY_SCHEDULED', 'DEAD_LETTER', 'RECONCILIATION_REQUIRED'))
    OR (OLD.status = 'ACKNOWLEDGED' AND NEW.status = 'RECONCILIATION_REQUIRED')
    OR (OLD.status = 'RETRY_SCHEDULED' AND NEW.status IN ('AWAITING_PROVIDER', 'DEAD_LETTER'))
    OR (OLD.status = 'DEAD_LETTER' AND NEW.status = 'AWAITING_PROVIDER')
    OR (OLD.status = 'RECONCILIATION_REQUIRED' AND NEW.status IN ('AWAITING_PROVIDER', 'ACKNOWLEDGED', 'DEAD_LETTER'))
  ) THEN
    RAISE EXCEPTION 'forbidden insurance provider submission transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER insurance_provider_submission_transition_enforced
  BEFORE UPDATE ON insurance_provider_submissions
  FOR EACH ROW EXECUTE FUNCTION insurance_provider_submission_transition_guard();

-- (b) One-directional acknowledged_at rule. ACKNOWLEDGED still requires the
-- timestamp; the timestamp itself is allowed to persist through a later,
-- legal, non-ACKNOWLEDGED state (e.g. RECONCILIATION_REQUIRED) as evidence
-- that an acknowledgement did happen at some point.
ALTER TABLE insurance_provider_submissions DROP CONSTRAINT insurance_provider_submissions_check;
ALTER TABLE insurance_provider_submissions ADD CONSTRAINT insurance_provider_submissions_check
  CHECK (status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL);

-- (c)/(d) A2 case/submission transition corrections: withdrawal from
-- SUBMITTING and PROVIDER_ERROR, and a reopen guard that forbids returning a
-- case to COLLECTING_FACTS while any provider submission for it is still
-- active. Cancelling an in-flight provider submission is B2 scope; today the
-- only way to satisfy this guard is for every provider submission on the
-- case to have reached DEAD_LETTER.
CREATE OR REPLACE FUNCTION insurance_case_mode_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.execution_mode IS DISTINCT FROM NEW.execution_mode THEN
    RAISE EXCEPTION 'insurance case execution_mode is immutable';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'COLLECTING_FACTS' AND NEW.status IN ('READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'READY_FOR_SUBMISSION' AND NEW.status IN ('COLLECTING_FACTS', 'SUBMISSION_IN_PROGRESS', 'WITHDRAWN'))
    OR (OLD.status = 'SUBMISSION_IN_PROGRESS' AND NEW.status IN ('COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'WITHDRAWN'))
  ) THEN
    RAISE EXCEPTION 'forbidden insurance case transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'SUBMISSION_IN_PROGRESS' AND NEW.status = 'COLLECTING_FACTS' AND EXISTS (
    SELECT 1 FROM insurance_provider_submissions ps
    WHERE ps.case_id = NEW.id AND ps.status <> 'DEAD_LETTER'
  ) THEN
    RAISE EXCEPTION 'insurance case cannot reopen fact collection while a provider submission is still active; cancellation of an in-flight provider submission is B2 scope';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION insurance_protect_finalized_submission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT' AND (
    OLD.id IS DISTINCT FROM NEW.id OR OLD.case_id IS DISTINCT FROM NEW.case_id
    OR OLD.version IS DISTINCT FROM NEW.version OR OLD.questionnaire_version IS DISTINCT FROM NEW.questionnaire_version
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.consent_artifact_id IS DISTINCT FROM NEW.consent_artifact_id OR OLD.supersedes_submission_id IS DISTINCT FROM NEW.supersedes_submission_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN RAISE EXCEPTION 'submission content cannot change during finalization'; END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status='DRAFT' AND NEW.status IN ('READY','WITHDRAWN'))
    OR (OLD.status='READY' AND NEW.status IN ('SUBMITTING','WITHDRAWN'))
    OR (OLD.status='SUBMITTING' AND NEW.status IN ('AWAITING_PROVIDER','PROVIDER_ERROR','WITHDRAWN'))
    OR (OLD.status='AWAITING_PROVIDER' AND NEW.status IN ('SUBMITTED','PROVIDER_ERROR','WITHDRAWN'))
    OR (OLD.status='PROVIDER_ERROR' AND NEW.status IN ('AWAITING_PROVIDER','WITHDRAWN'))
  ) THEN RAISE EXCEPTION 'forbidden insurance submission transition % -> %', OLD.status, NEW.status; END IF;
  IF OLD.status <> 'DRAFT' AND (
    OLD.id IS DISTINCT FROM NEW.id OR OLD.case_id IS DISTINCT FROM NEW.case_id
    OR OLD.version IS DISTINCT FROM NEW.version OR OLD.questionnaire_version IS DISTINCT FROM NEW.questionnaire_version
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.consent_artifact_id IS DISTINCT FROM NEW.consent_artifact_id OR OLD.finalized_at IS DISTINCT FROM NEW.finalized_at
    OR OLD.supersedes_submission_id IS DISTINCT FROM NEW.supersedes_submission_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN RAISE EXCEPTION 'finalized submission content is immutable'; END IF;
  RETURN NEW;
END;
$$;

-- (e) Webhook-inbox columns needed to reprocess a deferred/received event
-- without re-fetching the raw provider payload, and operator-exception
-- columns needed to open a visible exception for a webhook that never
-- matched a provider submission (so it has no case to attach to yet).
ALTER TABLE insurance_webhook_inbox ADD COLUMN transaction_external_id TEXT;
ALTER TABLE insurance_webhook_inbox ADD COLUMN transaction_id UUID;
ALTER TABLE insurance_webhook_inbox ADD COLUMN provider_status TEXT;
ALTER TABLE insurance_webhook_inbox ADD COLUMN normalized_reason_codes JSONB;

ALTER TABLE insurance_operator_exceptions ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE insurance_operator_exceptions ADD COLUMN webhook_inbox_id UUID REFERENCES insurance_webhook_inbox(id) ON DELETE RESTRICT;
ALTER TABLE insurance_operator_exceptions ADD CONSTRAINT insurance_operator_exceptions_traceable_check
  CHECK (case_id IS NOT NULL OR webhook_inbox_id IS NOT NULL);

-- Cut-list: append-only evidence tables that were missing their guard.
CREATE TRIGGER insurance_provider_delivery_attempts_append_only
  BEFORE UPDATE OR DELETE ON insurance_provider_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION insurance_forbid_append_only_mutation();
CREATE TRIGGER insurance_reconciliation_items_append_only
  BEFORE UPDATE OR DELETE ON insurance_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION insurance_forbid_append_only_mutation();

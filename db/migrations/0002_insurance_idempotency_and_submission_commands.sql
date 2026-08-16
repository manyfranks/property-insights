-- A1 completion: server-authoritative request fingerprints and the internal
-- update/finalize command ledger. This migration is applied immediately after
-- 0001, so a row without a fingerprint is always an invalid partial write.

ALTER TABLE insurance_cases ADD COLUMN request_hash CHAR(64) NOT NULL;
ALTER TABLE insurance_submissions ADD COLUMN request_hash CHAR(64) NOT NULL;

-- `version` names the legal/copy version, not a one-time event. Reaffirmed
-- consent uses the same frozen v1 text and is distinguished by its artifact
-- id, grant time, and supersession chain instead.
ALTER TABLE insurance_consent_artifacts
  DROP CONSTRAINT insurance_consent_artifacts_case_id_version_key;

CREATE TABLE insurance_case_command_receipts (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  command_type TEXT NOT NULL CHECK (command_type IN ('UPDATE', 'FINALIZE')),
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  result_submission_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, command_type, idempotency_key),
  FOREIGN KEY (result_submission_id, case_id)
    REFERENCES insurance_submissions(id, case_id) ON DELETE RESTRICT
);

CREATE INDEX insurance_case_command_receipts_submission_idx
  ON insurance_case_command_receipts(result_submission_id);

-- A new immutable draft version is the only way to edit a finalized case.
-- Returning a case to fact collection is not provider evidence and does not
-- permit any A2 delivery/quote/bind state.
CREATE OR REPLACE FUNCTION insurance_case_mode_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.execution_mode IS DISTINCT FROM NEW.execution_mode THEN
    RAISE EXCEPTION 'insurance case execution_mode is immutable';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'COLLECTING_FACTS' AND NEW.status IN ('READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'READY_FOR_SUBMISSION' AND NEW.status IN ('COLLECTING_FACTS', 'WITHDRAWN'))
  ) THEN
    RAISE EXCEPTION 'forbidden insurance case transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- A2 expand-only hygiene. Classification is release-operator evidence, never
-- inferred from data submitted by a public customer flow.

CREATE TABLE insurance_test_data_runs (
  id UUID PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  selector_hash CHAR(64) NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE insurance_cases
  ADD COLUMN record_classification TEXT NOT NULL DEFAULT 'PRODUCTION'
    CHECK (record_classification IN ('PRODUCTION', 'TEST')),
  ADD COLUMN test_data_run_id UUID REFERENCES insurance_test_data_runs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT insurance_cases_test_classification_check CHECK (
    (record_classification = 'TEST' AND test_data_run_id IS NOT NULL)
    OR (record_classification = 'PRODUCTION' AND test_data_run_id IS NULL)
  );

ALTER TABLE coverage_profiles
  ADD COLUMN record_classification TEXT NOT NULL DEFAULT 'PRODUCTION'
    CHECK (record_classification IN ('PRODUCTION', 'TEST')),
  ADD COLUMN test_data_run_id UUID REFERENCES insurance_test_data_runs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT coverage_profiles_test_classification_check CHECK (
    (record_classification = 'TEST' AND test_data_run_id IS NOT NULL)
    OR (record_classification = 'PRODUCTION' AND test_data_run_id IS NULL)
  );

CREATE INDEX insurance_cases_reporting_classification_idx
  ON insurance_cases(record_classification, created_at DESC);
CREATE INDEX coverage_profiles_reporting_classification_idx
  ON coverage_profiles(record_classification, created_at DESC);

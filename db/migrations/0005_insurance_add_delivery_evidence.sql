-- A2 append-only delivery evidence and rebuildable projection.

CREATE TABLE insurance_outbox_events (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('SIMULATION','SANDBOX','PRODUCTION')),
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload_reference TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (aggregate_type, aggregate_id, event_type, idempotency_key)
);
CREATE INDEX insurance_outbox_claim_idx ON insurance_outbox_events(available_at, created_at)
  WHERE dispatched_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE insurance_webhook_inbox (
  id UUID PRIMARY KEY,
  provider_connection_id UUID NOT NULL REFERENCES insurance_provider_connections(id) ON DELETE RESTRICT,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('SIMULATION','SANDBOX','PRODUCTION')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_key_id TEXT NOT NULL,
  raw_payload_hash CHAR(64) NOT NULL,
  raw_payload_reference TEXT,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','DEFERRED','PROJECTED','CONFLICT')),
  processed_at TIMESTAMPTZ,
  error_code TEXT,
  UNIQUE (provider_connection_id, provider_event_id)
);
CREATE INDEX insurance_webhook_inbox_projection_idx ON insurance_webhook_inbox(provider_connection_id, occurred_at, id);

CREATE TABLE insurance_provider_delivery_attempts (
  id UUID PRIMARY KEY,
  provider_submission_id UUID NOT NULL REFERENCES insurance_provider_submissions(id) ON DELETE RESTRICT,
  outbox_event_id UUID REFERENCES insurance_outbox_events(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('DISPATCHED','ACKNOWLEDGED','TIMEOUT','RETRYABLE_FAILURE','PERMANENT_FAILURE','RECONCILIATION')),
  retryable BOOLEAN NOT NULL,
  error_code TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_submission_id, attempt_number)
);

CREATE TABLE insurance_provider_status_events (
  id UUID PRIMARY KEY,
  provider_submission_id UUID NOT NULL REFERENCES insurance_provider_submissions(id) ON DELETE RESTRICT,
  webhook_inbox_id UUID REFERENCES insurance_webhook_inbox(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  provider_status TEXT,
  event_hash CHAR(64) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_submission_id, event_hash)
);
CREATE TRIGGER insurance_provider_status_events_append_only BEFORE UPDATE OR DELETE ON insurance_provider_status_events
  FOR EACH ROW EXECUTE FUNCTION insurance_forbid_append_only_mutation();

CREATE TABLE insurance_provider_submission_projections (
  provider_submission_id UUID PRIMARY KEY REFERENCES insurance_provider_submissions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL,
  projection_hash CHAR(64) NOT NULL,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  last_event_at TIMESTAMPTZ,
  rebuilt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE outbox_deliveries ADD COLUMN lease_token UUID, ADD COLUMN leased_until TIMESTAMPTZ, ADD COLUMN last_error_code TEXT;
CREATE INDEX outbox_webhook_due ON outbox_deliveries(next_attempt_at) WHERE status='PENDING';
CREATE TABLE webhook_fanout (
  event_id UUID PRIMARY KEY REFERENCES outbox_events(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE webhook_messages (
  delivery_id UUID PRIMARY KEY REFERENCES outbox_deliveries(id) ON DELETE RESTRICT,
  body TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT enforce_append_only_table('webhook_fanout');
SELECT enforce_append_only_table('webhook_messages');
SELECT enforce_append_only_table('webhook_deliveries');
GRANT SELECT,INSERT ON webhook_fanout,webhook_messages TO hub_app;
REVOKE UPDATE,DELETE ON webhook_fanout,webhook_messages,webhook_deliveries FROM hub_app;

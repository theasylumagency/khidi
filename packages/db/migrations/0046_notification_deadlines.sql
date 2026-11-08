CREATE TABLE notification_signals (
 id UUID PRIMARY KEY, signal_key TEXT NOT NULL UNIQUE,
 entity_type TEXT NOT NULL CHECK(entity_type IN ('reservation','fulfillment_request')),
 entity_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT enforce_append_only_table('notification_signals');
GRANT SELECT,INSERT ON notification_signals TO hub_app;
REVOKE UPDATE,DELETE,TRUNCATE ON notification_signals FROM hub_app;
INSERT INTO system_settings(key,value_json,description) VALUES
 ('bank_installment_notice_lead_hours','{"hours":24}','Bank installment expiry reminder lead time') ON CONFLICT DO NOTHING;

-- INSERT position preserves causal producer order under row locks; transaction-start timestamps do not.
ALTER TABLE outbox_events ADD COLUMN notification_position BIGINT GENERATED ALWAYS AS IDENTITY;
GRANT USAGE ON SEQUENCE outbox_events_notification_position_seq TO hub_app;
CREATE TABLE notification_types (
  type TEXT PRIMARY KEY, level TEXT NOT NULL CHECK(level IN ('INFO','ACTION_REQUIRED','CRITICAL')),
  UNIQUE(type,level)
);
INSERT INTO notification_types(type,level) VALUES
 ('SYSTEM_UPDATE','INFO'),('NEW_PRODUCT_SCANNED','INFO'),('INTAKE_RECORDED','INFO'),('PRODUCT_UPDATED','INFO'),('LABEL_STATUS_CHANGED','INFO'),
 ('SCAN_TASK_CREATED','INFO'),('SCAN_TASK_COMPLETED','INFO'),('STOCK_RECOVERED','INFO'),('REPLENISHMENT_UPDATED','INFO'),
 ('DAILY_REPORT_READY','INFO'),('FULFILLMENT_MODE_CHANGED','INFO'),('RESERVATION_EXPIRING','INFO'),
 ('PRODUCT_REVIEW_REQUIRED','ACTION_REQUIRED'),('IDENTIFICATION_FAILED','ACTION_REQUIRED'),('CONTENT_REVIEW_REQUIRED','ACTION_REQUIRED'),
 ('PHOTO_RETAKE_REQUIRED','ACTION_REQUIRED'),('EVIDENCE_REQUESTED','ACTION_REQUIRED'),('MERGE_EVIDENCE_CONFLICT','ACTION_REQUIRED'),
 ('MERGE_UNDETERMINED','ACTION_REQUIRED'),('STOCK_LOW','ACTION_REQUIRED'),('STOCK_OUT','ACTION_REQUIRED'),
 ('REPLENISHMENT_REQUESTED','ACTION_REQUIRED'),('RESERVATION_ACTION_REQUIRED','ACTION_REQUIRED'),('FULFILLMENT_REQUESTED','ACTION_REQUIRED'),
 ('JOB_FAILED','CRITICAL'),('WEBHOOK_DEAD_LETTER','CRITICAL'),('STOCK_REVIEW_REQUIRED','CRITICAL'),('FULFILLMENT_OVERDUE','CRITICAL');
SELECT enforce_append_only_table('notification_types');
CREATE TABLE notifications (
 id UUID PRIMARY KEY, event_id UUID NOT NULL UNIQUE REFERENCES outbox_events(id) ON DELETE RESTRICT,
 type TEXT NOT NULL, level TEXT NOT NULL,
 title_key TEXT NOT NULL, parameters_json JSONB NOT NULL DEFAULT '{}',
 deep_link TEXT NOT NULL CHECK(deep_link ~ '^/[^/]' AND deep_link !~ '[?#]' AND deep_link !~ '\.\.'),
 entity_type TEXT NOT NULL, entity_id UUID NOT NULL,
 legal_entity_id UUID REFERENCES legal_entities(id) ON DELETE RESTRICT,
 task_id UUID REFERENCES scan_tasks(id) ON DELETE RESTRICT,
 audience TEXT NOT NULL CHECK(audience IN ('ADMIN','PRODUCT','STOCK_OWNER','TASK','FULFILLMENT','REPORT')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(type,level) REFERENCES notification_types(type,level) ON DELETE RESTRICT,
 CHECK(audience<>'TASK' OR task_id IS NOT NULL),
 CHECK(audience NOT IN ('STOCK_OWNER','REPORT') OR legal_entity_id IS NOT NULL)
);
SELECT enforce_append_only_table('notifications');
CREATE TABLE notification_receipts (
 notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 read_at TIMESTAMPTZ, muted BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(notification_id,user_id)
);
CREATE INDEX notification_user_unread ON notification_receipts(user_id,notification_id) WHERE read_at IS NULL AND NOT muted;
CREATE TABLE notification_preferences (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, type TEXT NOT NULL,
 level TEXT NOT NULL DEFAULT 'INFO' CHECK(level='INFO'), muted BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,type), FOREIGN KEY(type,level) REFERENCES notification_types(type,level) ON DELETE RESTRICT
);
CREATE FUNCTION guard_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.notification_id<>OLD.notification_id OR NEW.user_id<>OLD.user_id) THEN RAISE EXCEPTION 'Receipt identity is immutable'; END IF;
 IF NEW.muted AND EXISTS(SELECT 1 FROM notifications WHERE id=NEW.notification_id AND level<>'INFO') THEN RAISE EXCEPTION 'Only INFO notifications can be muted'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER notification_receipt_guard BEFORE INSERT OR UPDATE ON notification_receipts FOR EACH ROW EXECUTE FUNCTION guard_notification_receipt();
CREATE TABLE notification_states (
 state_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
 source_event_id UUID NOT NULL REFERENCES outbox_events(id) ON DELETE RESTRICT,
 source_created_at TIMESTAMPTZ NOT NULL, source_position BIGINT NOT NULL
);
GRANT SELECT ON notification_types TO hub_app;
GRANT SELECT,INSERT ON notifications TO hub_app;
GRANT SELECT,INSERT,UPDATE ON notification_receipts,notification_preferences,notification_states TO hub_app;
REVOKE UPDATE,DELETE,TRUNCATE ON notification_types,notifications FROM hub_app;
REVOKE DELETE,TRUNCATE ON notification_receipts,notification_preferences,notification_states FROM hub_app;

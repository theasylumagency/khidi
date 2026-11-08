CREATE TABLE push_subscriptions (
 id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 registered_device_id UUID REFERENCES registered_devices(id) ON DELETE CASCADE,
 browser_device_id UUID NOT NULL,endpoint_hash TEXT NOT NULL UNIQUE CHECK(endpoint_hash ~ '^[0-9a-f]{64}$'),
 subscription_encrypted TEXT NOT NULL,info_opt_in BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),UNIQUE(user_id,browser_device_id)
);
CREATE FUNCTION guard_push_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s sessions;
BEGIN
 SELECT * INTO s FROM sessions WHERE id=NEW.session_id;
 IF s.user_id IS DISTINCT FROM NEW.user_id OR s.device_id IS DISTINCT FROM NEW.registered_device_id THEN RAISE EXCEPTION 'Push subscription must belong to its session and device'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER push_session_guard BEFORE INSERT OR UPDATE ON push_subscriptions FOR EACH ROW EXECUTE FUNCTION guard_push_session();
CREATE FUNCTION remove_revoked_device_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.active OR NEW.revoked_at IS NOT NULL THEN DELETE FROM push_subscriptions WHERE registered_device_id=NEW.id; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER revoked_device_push_cleanup AFTER UPDATE OF active,revoked_at ON registered_devices FOR EACH ROW EXECUTE FUNCTION remove_revoked_device_push();
CREATE FUNCTION remove_other_user_device_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.device_id IS NOT NULL THEN DELETE FROM push_subscriptions WHERE registered_device_id=NEW.device_id AND user_id<>NEW.user_id; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER shared_device_push_cleanup AFTER INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION remove_other_user_device_push();
CREATE TABLE push_deliveries (
 id UUID PRIMARY KEY,notification_id UUID NOT NULL,user_id UUID NOT NULL,
 subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DELIVERED','SKIPPED','DEAD_LETTER')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 lease_token UUID,leased_until TIMESTAMPTZ,last_error_code TEXT,
 FOREIGN KEY(notification_id,user_id) REFERENCES notification_receipts(notification_id,user_id) ON DELETE RESTRICT,
 UNIQUE(notification_id,subscription_id)
);
CREATE INDEX push_delivery_due ON push_deliveries(next_attempt_at) WHERE status='PENDING';
CREATE TABLE push_attempts (
 id UUID PRIMARY KEY,delivery_id UUID NOT NULL REFERENCES push_deliveries(id) ON DELETE RESTRICT,
 succeeded BOOLEAN NOT NULL,response_status INTEGER,error_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
SELECT enforce_append_only_table('push_attempts');
GRANT SELECT,INSERT,UPDATE,DELETE ON push_subscriptions TO hub_app;
GRANT SELECT,INSERT,UPDATE ON push_deliveries TO hub_app;
GRANT SELECT,INSERT ON push_attempts TO hub_app;
REVOKE DELETE,TRUNCATE ON push_deliveries FROM hub_app;
REVOKE UPDATE,DELETE,TRUNCATE ON push_attempts FROM hub_app;

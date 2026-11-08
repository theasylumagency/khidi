CREATE TABLE user_setup_links (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 kind TEXT NOT NULL CHECK (kind IN ('OFFICE','WAREHOUSE')),
 issued_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
 used_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX user_setup_one_unused ON user_setup_links(user_id) WHERE used_at IS NULL AND revoked_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON user_setup_links TO hub_app;
REVOKE DELETE ON user_setup_links,users FROM hub_app;

CREATE FUNCTION enforce_user_setup_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'User setup history cannot be deleted'; END IF;
 IF OLD.used_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
  OR (NEW.id,NEW.user_id,NEW.token_hash,NEW.kind,NEW.issued_by,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.token_hash,OLD.kind,OLD.issued_by,OLD.created_at,OLD.expires_at)
  THEN RAISE EXCEPTION 'User setup history is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER user_setup_history BEFORE UPDATE OR DELETE ON user_setup_links FOR EACH ROW EXECUTE FUNCTION enforce_user_setup_history();

CREATE FUNCTION protect_last_active_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.role='ADMIN' AND OLD.active AND (NEW.role<>'ADMIN' OR NOT NEW.active) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('khidi-user-management',0));
  IF NOT EXISTS(SELECT 1 FROM users WHERE id<>OLD.id AND role='ADMIN' AND active) THEN
   RAISE EXCEPTION 'Last active ADMIN must remain active' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER users_last_active_admin BEFORE UPDATE OF role,active ON users FOR EACH ROW EXECUTE FUNCTION protect_last_active_admin();

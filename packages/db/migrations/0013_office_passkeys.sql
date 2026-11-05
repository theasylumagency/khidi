CREATE TABLE user_passkeys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  credential_id TEXT NOT NULL UNIQUE CHECK (credential_id ~ '^[A-Za-z0-9_-]+$'),
  public_key TEXT NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]+$'),
  sign_counter BIGINT NOT NULL CHECK (sign_counter BETWEEN 0 AND 4294967295),
  transports TEXT[] NOT NULL DEFAULT '{}',
  backup_eligible BOOLEAN NOT NULL,
  backed_up BOOLEAN NOT NULL CHECK (NOT backed_up OR backup_eligible),
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX user_passkeys_owner ON user_passkeys(user_id);
GRANT SELECT, INSERT, UPDATE ON user_passkeys TO hub_app;
REVOKE DELETE ON user_passkeys FROM hub_app;

CREATE FUNCTION enforce_passkey_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.credential_id IS DISTINCT FROM OLD.credential_id OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.backup_eligible IS DISTINCT FROM OLD.backup_eligible OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.sign_counter < OLD.sign_counter OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Passkey identity, counter and revocation invariants are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_passkeys_identity BEFORE UPDATE ON user_passkeys FOR EACH ROW EXECUTE FUNCTION enforce_passkey_identity();

ALTER TABLE sessions ADD COLUMN last_strong_auth_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN passkey_id UUID REFERENCES user_passkeys(id) ON DELETE RESTRICT;
ALTER TABLE sessions DROP CONSTRAINT sessions_auth_method_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_auth_method_check CHECK (
  (auth_method = 'WAREHOUSE_PIN' AND last_strong_auth_at IS NULL AND passkey_id IS NULL)
  OR (auth_method = 'OFFICE_PASSWORD_TOTP' AND passkey_id IS NULL)
  OR (auth_method = 'OFFICE_PASSKEY' AND passkey_id IS NOT NULL AND last_strong_auth_at IS NOT NULL)
);

CREATE TABLE webauthn_challenges (
  id UUID PRIMARY KEY,
  challenge_hash TEXT NOT NULL CHECK (challenge_hash ~ '^[a-f0-9]{64}$'),
  binding_hash TEXT NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
  ceremony TEXT NOT NULL CHECK (ceremony IN ('REGISTER', 'SIGN_IN', 'REAUTH')),
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at),
  CHECK (ceremony = 'SIGN_IN' OR user_id IS NOT NULL)
);
CREATE INDEX webauthn_challenges_expiry ON webauthn_challenges(expires_at);
GRANT SELECT, INSERT, UPDATE ON webauthn_challenges TO hub_app;
REVOKE DELETE ON webauthn_challenges FROM hub_app;

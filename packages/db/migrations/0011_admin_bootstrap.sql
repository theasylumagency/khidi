ALTER TABLE users ADD COLUMN totp_enrollment_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD CONSTRAINT users_pending_totp_enrollment
  CHECK (NOT totp_enrollment_required OR (role = 'ADMIN' AND NOT totp_enabled AND pin_hash IS NULL));

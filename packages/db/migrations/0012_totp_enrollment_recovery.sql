-- Applied migrations are immutable. Expand pending enrollment to office accounts only.
ALTER TABLE users DROP CONSTRAINT users_pending_totp_enrollment;
ALTER TABLE users ADD CONSTRAINT users_pending_totp_enrollment CHECK (
  NOT totp_enrollment_required OR (
    role IN ('ADMIN', 'STOCK_MANAGER', 'OPERATOR', 'ORDER_MANAGER')
    AND email IS NOT NULL AND password_hash IS NOT NULL AND NOT totp_enabled
  )
);

-- Keep the security floor after a recovery clears the current secret.
ALTER TABLE users ADD COLUMN totp_ever_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET totp_ever_enabled = TRUE WHERE totp_enabled OR EXISTS (
  SELECT 1 FROM audit_logs
  WHERE entity_type = 'user' AND entity_id = users.id::text
    AND action = 'TOTP_ENROLLMENT_COMPLETED'
);

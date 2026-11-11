-- Pending office accounts have no password until the employee redeems their setup link.
-- Enrollment remains a hard session boundary, including passkeys.
ALTER TABLE users DROP CONSTRAINT users_pending_totp_enrollment;
ALTER TABLE users ADD CONSTRAINT users_pending_totp_enrollment CHECK (
 NOT totp_enrollment_required OR (
  role IN ('ADMIN','STOCK_MANAGER','OPERATOR','ORDER_MANAGER')
  AND email IS NOT NULL AND NOT totp_enabled AND pin_hash IS NULL
 )
);

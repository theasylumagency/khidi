-- Preserve the existing office+PIN enrollment boundary: pending TOTP blocks every session,
-- including PIN, even if a legacy office account already has a PIN. H9 never creates one.
ALTER TABLE users DROP CONSTRAINT users_pending_totp_enrollment;
ALTER TABLE users ADD CONSTRAINT users_pending_totp_enrollment CHECK (
 NOT totp_enrollment_required OR (
  role IN ('ADMIN','STOCK_MANAGER','OPERATOR','ORDER_MANAGER')
  AND email IS NOT NULL AND NOT totp_enabled
 )
);

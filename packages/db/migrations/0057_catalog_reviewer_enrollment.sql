-- Reviewers use the office invitation flow and cannot carry a warehouse PIN.
ALTER TABLE users DROP CONSTRAINT users_pending_totp_enrollment;
ALTER TABLE users ADD CONSTRAINT users_pending_totp_enrollment CHECK (
  NOT totp_enrollment_required OR (
    role IN ('ADMIN','STOCK_MANAGER','OPERATOR','ORDER_MANAGER','CATALOG_REVIEWER')
    AND email IS NOT NULL AND NOT totp_enabled
  )
);
ALTER TABLE users ADD CONSTRAINT users_catalog_reviewer_no_pin CHECK (
  role <> 'CATALOG_REVIEWER' OR pin_hash IS NULL
);

-- Persist intent before contacting object storage. Failed transfers remain discoverable.
ALTER TABLE image_publications DROP CONSTRAINT image_publications_status_check;
ALTER TABLE image_publications DROP CONSTRAINT image_publications_check;
ALTER TABLE image_publications ADD CONSTRAINT publication_transfer_status
  CHECK (status IN ('PENDING','PUBLISHED','WITHDRAWING','WITHDRAWN'));
ALTER TABLE image_publications ADD CONSTRAINT publication_withdrawal_time
  CHECK ((status='WITHDRAWN')=(withdrawn_at IS NOT NULL));
DROP INDEX image_publications_live_key_uq;
CREATE UNIQUE INDEX image_publications_live_key_uq ON image_publications(object_key) WHERE status<>'WITHDRAWN';

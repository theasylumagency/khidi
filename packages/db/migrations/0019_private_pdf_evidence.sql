ALTER TABLE evidence DROP CONSTRAINT evidence_check5;
ALTER TABLE evidence ADD CONSTRAINT evidence_private_attachment_check CHECK (
  (private_storage_key IS NULL AND private_sha256 IS NULL AND private_mime_type IS NULL)
  OR (private_storage_key IS NOT NULL AND private_sha256 IS NOT NULL AND private_mime_type IS NOT NULL
    AND private_storage_key LIKE 'evidence/%' AND private_sha256 ~ '^[a-f0-9]{64}$' AND sensitivity = 'INTERNAL_ONLY'
    AND (private_mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      OR (private_mime_type = 'application/pdf' AND private_storage_key LIKE 'evidence/%/original.pdf'
        AND image_id IS NULL AND type IN ('PASSPORT_MANUAL', 'FACTORY_SPEC_SHEET', 'SUPPLIER_DOCUMENT',
          'CUSTOMS_DECLARATION', 'SUPPLIER_CORRESPONDENCE', 'SUPPLIER_CATALOG'))))
);

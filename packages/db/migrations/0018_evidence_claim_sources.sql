ALTER TABLE evidence ADD COLUMN claim_sources_json JSONB NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(claim_sources_json) = 'object');

-- Recover origins when a recorded candidate matches the saved claim. Preserve prior
-- review decisions without inventing individual confirmations for historical readings.
UPDATE evidence AS item
SET claim_sources_json = (
  SELECT jsonb_object_agg(claim.key, COALESCE(
    (SELECT jsonb_build_object('origin', 'AI', 'jobId', job.id)
     FROM ai_jobs AS job
     WHERE job.evidence_id = item.id AND job.status = 'SUCCEEDED'
       AND job.result_json -> 'candidates' -> claim.key = claim.value
       AND EXISTS (SELECT 1 FROM audit_logs WHERE entity_type = 'evidence' AND entity_id = item.id::text
         AND action = 'AI_EVIDENCE_CANDIDATES_RECORDED')
     ORDER BY job.updated_at, job.id LIMIT 1),
    jsonb_build_object('origin', 'HUMAN')
  ))
  FROM jsonb_each(item.claims_json) AS claim
)
WHERE item.claims_json <> '{}';

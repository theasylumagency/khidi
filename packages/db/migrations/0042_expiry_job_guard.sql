CREATE FUNCTION guard_reservation_expiry_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD)-'processed_at') IS DISTINCT FROM (to_jsonb(NEW)-'processed_at')
    OR OLD.processed_at IS NOT NULL OR NEW.processed_at IS NULL THEN
    RAISE EXCEPTION 'Expiry job identity and deadline are immutable; processing is final.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reservation_expiry_job_content BEFORE UPDATE ON reservation_expiry_jobs FOR EACH ROW EXECUTE FUNCTION guard_reservation_expiry_job();

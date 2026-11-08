-- The safety invariant always checks real users, even if a connection has temporary tables.
CREATE OR REPLACE FUNCTION public.protect_last_active_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.role='ADMIN' AND OLD.active AND (NEW.role<>'ADMIN' OR NOT NEW.active) THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('khidi-user-management',0));
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id<>OLD.id AND role='ADMIN' AND active) THEN
   RAISE EXCEPTION 'Last active ADMIN must remain active' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

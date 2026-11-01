-- [C7] Separate application role from migration owner role.
-- hub_migrator owns the schema and runs migrations.
-- hub_app is used by the Hub web app and worker processes and is denied UPDATE/DELETE on append-only tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hub_app') THEN
    CREATE ROLE hub_app WITH LOGIN PASSWORD 'hub_app_dev_password';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE agrotrade_hub TO hub_app;
GRANT USAGE ON SCHEMA public TO hub_app;

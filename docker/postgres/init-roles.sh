#!/bin/sh
set -eu

if [ -z "${HUB_APP_DB_PASSWORD:-}" ]; then
  echo "ERROR: HUB_APP_DB_PASSWORD environment variable is required to provision hub_app role." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=hub_app_password="$HUB_APP_DB_PASSWORD" <<-'EOSQL'
  SELECT format('CREATE ROLE hub_app WITH LOGIN PASSWORD %L', :'hub_app_password')
  WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hub_app')\gexec

  SELECT format('ALTER ROLE hub_app WITH LOGIN PASSWORD %L', :'hub_app_password')\gexec

  GRANT CONNECT ON DATABASE agrotrade_hub TO hub_app;
  GRANT USAGE ON SCHEMA public TO hub_app;
EOSQL

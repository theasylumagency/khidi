CREATE TABLE daily_reports (
 id uuid PRIMARY KEY, legal_entity_id uuid NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
 report_day date NOT NULL, snapshot_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(legal_entity_id,report_day), CHECK(jsonb_typeof(snapshot_json)='object')
);
CREATE TABLE daily_report_files (
 id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES daily_reports(id) ON DELETE RESTRICT,
 format text NOT NULL CHECK(format IN ('CSV','XLSX')), storage_key text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes integer NOT NULL CHECK(bytes>0),
 storage_version_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(report_id,format), CHECK(storage_key LIKE 'reports/%')
);
CREATE TABLE daily_report_announcements (
 report_id uuid PRIMARY KEY REFERENCES daily_reports(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT enforce_append_only_table('daily_reports');
SELECT enforce_append_only_table('daily_report_files');
SELECT enforce_append_only_table('daily_report_announcements');
GRANT SELECT,INSERT ON daily_reports,daily_report_files,daily_report_announcements TO hub_app;
REVOKE UPDATE,DELETE,TRUNCATE ON daily_reports,daily_report_files,daily_report_announcements FROM hub_app;

# Khidi — ბექაფი და აღდგენა

საერთო სერვერზე seed-ები და ტესტები **არასოდეს** გაუშვათ. საწყისი გამართვისთვის
გამოიყენეთ [სერვერის მომზადების ინსტრუქცია](server-setup.md). ამ დოკუმენტის სრული
ტესტები და `_test` ასლები სრულდება განცალკევებულ აღდგენის სატესტო მანქანაზე,
არა საერთო ან საწარმოო სერვერზე. წყაროზე სრულდება მხოლოდ ბექაფი და წაკითხვის შემოწმებები.

ინსტრუმენტი: **pgBackRest 2.60.0** — [ADR-004](../adr/ADR-004-pgbackrest-backup-and-restore.md).
სკრიპტები იყენებს Node.js 24-სა და პროექტში დაფიქსირებულ pnpm-ს. Linux-ზე
`pgbackrest` და PostgreSQL 18-ის `pg_ctl` უნდა იყოს `PATH`-ში. აღდგენა ფიზიკურია:
ცალკე კლასტერი იმავე PostgreSQL major ვერსიით და ცარიელი `PGDATA`-თი.

## პირველი საერთო სერვერის მომზადება

1. დააყენეთ PostgreSQL 18 და pgBackRest 2.60.0. ბექაფის ფაილები უნდა წავიდეს
   აპლიკაციის სერვერისგან დამოუკიდებელ S3 საცავში. გამოიყენეთ ნეიტრალური
   სახელები, TLS და ცალკე IAM როლი მხოლოდ ბექაფის პრეფიქსის უფლებებით.
2. მოარგეთ `ops/pgbackrest/pgbackrest.conf.example` რეალურ ბაკეტს, რეგიონსა და
   PostgreSQL-ის გზას; შეინახეთ `/etc/pgbackrest/pgbackrest.conf`-ში.
3. საიდუმლოებების საცავში შექმენით და ცალკე შეინახეთ აღდგენისთვის საჭირო
   `PGBACKREST_REPO1_CIPHER_PASS`. გასაღები Git-ში, ბრძანების არგუმენტში ან
   ბექაფის გვერდით არ უნდა ინახებოდეს. რეპოზიტორიის დაშიფვრის გასაღები მისი
   შექმნის შემდეგ უცვლელია; როტაცია ახალ რეპოზიტორიაში გადასვლას მოითხოვს.
4. PostgreSQL-ისა და ბექაფის პროცესებს მიაწოდეთ გასაღები დაცული გარემოდან.
   PostgreSQL-ის კონფიგურაციაში ჩაწერეთ:

   ```conf
   wal_level = replica
   archive_mode = on
   archive_timeout = 60s
   archive_command = 'pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=khidi archive-push "%p"'
   ```

   `archive_mode`-ის ჩართვას სერვერის გადატვირთვა სჭირდება. შემდეგ PostgreSQL-ის
   სისტემური მომხმარებლით გაუშვით:

   ```sh
   pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=khidi stanza-create
   pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=khidi check
   ```

   `pg1-user=hub_migrator`-ის Unix socket ავტორიზაციაც წინასწარ მოამზადეთ:
   PostgreSQL-ის სისტემური მომხმარებლის peer mapping ან დაცული libpq password
   file უნდა შეესაბამებოდეს სერვერის `pg_hba.conf`-ს. საცდელი Docker-ის ადგილობრივი
   trust ავტორიზაცია საწარმოო სერვერის კონფიგურაციად არ გადაიტანოთ.

5. ბექაფის გარემოში განსაზღვრეთ `PGBACKREST_CONFIG` და გასაღები. მიეცით
   `postgres` მომხმარებელს პროექტის წაკითხვისა და საჭირო ოპერაციული დირექტორიების
   ჩაწერის უფლება. მოარგეთ service-ის სამუშაო გზა, Corepack-ის გზა და PostgreSQL-ის
   რეალური unit-ის სახელი. ჩართეთ `ops/pgbackrest/khidi-backup.service` და `.timer`.
   სრული ბექაფი ყოველ ღამე თბილისის დროით 02:00–02:05-ზე შესრულდება:

   ```sh
   corepack pnpm exec tsx ops/backup.ts
   systemctl enable --now khidi-backup.timer
   ```

`repo1-retention-full-type=time` და `repo1-retention-full=30` ინახავს მინიმუმ
30-დღიან აღდგენის ფანჯარას და საჭირო WAL-ს. ამავე ფაილების დამოუკიდებელი S3
lifecycle წესით წაშლა არ შეიძლება: ვადას pgBackRest მართავს. აკონტროლეთ
ღამის დავალების ჩავარდნა, ბოლო წარმატებული ბექაფის ასაკი, `pg_stat_archiver`-ის
შეცდომები, WAL დისკის სივრცე და `pgbackrest check`-ის შედეგი. განგაშის არხი
პირველ საერთო განთავსებაზე უნდა ჩაირთოს.

## აღდგენა ცარიელ დირექტორიაში

`ops/restore.ts` მონაცემებს აღადგენს, მაგრამ სერვერს ავტომატურად არ რთავს.
საჭიროა `PGBACKREST_CONFIG`, `PGBACKREST_STANZA=khidi`, `SOURCE_PGDATA`,
`RESTORE_ROOT`, `RESTORE_PGDATA` და კონკრეტული `BACKUP_SET`. ბოლო სრული ბექაფის
სახელი ჩანს `pgbackrest --stanza=khidi --output=json info`-ში.

`RESTORE_PGDATA` წინასწარ შექმნილი ცარიელი დირექტორია უნდა იყოს, ცალკე
`RESTORE_ROOT`-ის შიგნით, წყაროსგან განცალკევებული. სკრიპტი უარს ამბობს
არსებული მონაცემების გადაწერაზე, სიმბოლურ ბმულზე და წყაროს დირექტორიაზე.
მხარდაჭერილია ნაგულისხმევი tablespace-ები. სხვა tablespace-ები ჯერ ცალკე,
იზოლირებულ გზებზე უნდა გადაიმისამართოს და შემოწმდეს.

```sh
corepack pnpm exec tsx ops/restore.ts
```

ჩვეულებრივ აღდგენა სრულდება არჩეული ბექაფის პირველ თანმიმდევრულ მდგომარეობამდე.
PITR-ისთვის დაამატეთ UTC დრო, რომელიც ბექაფის შემდეგაა და არქივირებული WAL-ით
იფარება, მაგალითად `RECOVERY_TARGET_TIME=2026-11-02T08:30:00Z`.
საცდელ ასლში `archive_mode=off` იწერება, რომ მან წყაროს WAL არქივში არ გაგზავნოს.
რეალური ჩანაცვლებისას ჯერ შეჩერდეს დაზიანებული წყარო, შემდეგ აღდგენილ ასლზე
გაიაროს შემოწმება, და მხოლოდ ამის შემდეგ განახლდეს აპლიკაციის კავშირი და
ბექაფის არქივირება. საცდელი ასლი ავტომატურად არ ხდება ძირითადი სერვერი.

## Current restore verification (M11)

The owner performs the real backup/recovery exercise before pilot and repeats it after
infrastructure changes. Keep source writers stopped for the consistent source snapshot and
backup. Recover onto a separate isolated environment; never run seeds or the test suite on
a shared server. The local synthetic command below is for a developer/CI machine only.

The low-level ops/verify-restore.ts requires SOURCE_WRITERS_STOPPED=yes, explicit source and
restored URLs, separate app/migrator roles, a clean dedicated RESTORE_ROOT/RESTORE_PGDATA,
RESTORE_PORT, a new RESTORE_REPORT path and separate RESTORE_MEDIA_* storage settings.
RESTORE_TEST_APP_URL and RESTORE_TEST_MIGRATOR_URL identify a new _test database on the
recovered instance, not the recovered original. Use RESTORE_ADMIN_URL only if needed for
CREATEDB on that isolated instance. No existing database or report is overwritten.

The verifier takes an encrypted full backup, restores it with archive_mode=off, checks the
exact migration set/checksums without executing migrations, and compares every public and
khidi_jobs table, not only the old 23-table list. It verifies sampled raw hashes and every
recorded private raw/master/derivative/evidence/report reference. It then runs inventory:verify
read-only on the recovered original, creates a writable clone with CREATE DATABASE ... TEMPLATE,
and runs H6 A–D on that clone with no seeds or migrations. It never starts a recovered worker or
replays arbitrary restored deliveries; only the new synthetic scenarios' own events are consumed.
Finally it checks that the recovered original's table counts are unchanged and stops the recovered
instance. Nonzero exit means failure; retain its private JSON report and resolve the cause.

Object copies can have different S3 version IDs. Reads first request the recorded version;
only a missing version may fall back to the immutable key, and the recorded SHA-256 is always
required. Corruption and permission failures never trigger fallback. Restore all private master
versions and reports, not just the newest image or the public thumbnails. The local copy helper
is deliberately limited to empty loopback MinIO targets; it is not a production backup copier.

## One-command local PostgreSQL + MinIO drill

On a developer/isolated CI machine with Docker and installed locked dependencies, run:

    corepack pnpm ops:restore-drill

No existing database URLs, credentials, env file or arguments are required. The command uses
ops/compose.restore-test.yml with a random project name, new volumes and dynamically allocated
loopback ports. It generates temporary credentials in process memory. It initializes/seeds only
its proven-empty khidi_restore_test source, exercises A–D, and creates a private PDF and daily
report files. It enables private MinIO Object Lock/versioning, copies all source objects into a
second empty MinIO instance and checks SHA-256 for every copy. It performs encrypted pgBackRest
backup/WAL recovery and invokes the verifier above against the recovered data and its clone.

The command removes only containers/volumes bearing its own unique project identity and retains
a private ignored ops/.restore-test-*.json report. It does not reset the ordinary development DB,
other containers, production configuration, real entities or shared data. If a cached image is
unavailable, Compose builds the already pinned repository PostgreSQL/MinIO images. Docker bind
mounts of the workspace are unnecessary; the non-secret test config is copied into the new container.

The local run verifies tooling, not off-server S3 availability, production replication, access
policies, recovery keys or real-device behavior. Those remain owner gates. See e2e-verification.md
and pre-pilot-checklist.md. A local pgBackRest warning about mapping a root-owned fixture group
to the recovery operator does not change content/hash verification; production ownership must
be checked against the real service account during its own recovery exercise.

## მედია — M4

პირველი რეალური ფოტოს მიღებამდე მედიის bucket-ებზე ჩაირთოს versioning და
მეორე ლოკაციაში replication. raw ორიგინალებისა და evidence ფაილების წაშლისგან
დაცვა, აღდგენის ტესტი და უფლებები M4-ში მოწმდება. M3 ამ კონფიგურაციას არ ქმნის.

M4-ის საცავის არჩევანი აღწერილია ADR-006-ში: ცალკე private და public bucket-ები,
უცვლელი raw/evidence ფაილები, master-ის ახალი ვერსია ყოველ ხელახალ დამუშავებაზე.
ბაზაში ინახება raw-ის SHA-256, ზომა და object version id. კერძო ფაილის ყოველი
წაკითხვა ამოწმებს მოსალოდნელ SHA-256-ს. runtime-ს raw/evidence წაშლის უფლება არ აქვს.

აღდგენის თანმიმდევრობა: PostgreSQL აღადგინეთ იზოლირებულ სერვერზე; მედიის ასლი —
ცალკე bucket-ებში ან სატესტო filesystem-ში; writer-ები და public პუბლიკაცია გამორთული
დატოვეთ. ჯერ შეადარეთ მიგრაციების checksum-ები და ცხრილების რაოდენობები, შემდეგ
raw-ის შერჩეული ფაილების ზომები/SHA-256 აღდგენის მანიფესტს. ტესტებისთვის მოამზადეთ
ცალკე `_test` ბაზა (`docs/testing.md`); production სახელით აღდგენილი ბაზა ტესტების
გასაშვებად დაუშვებელია. მხოლოდ შემოწმების შემდეგ ჩართეთ worker და აპლიკაცია.

რეალურ სერვერზე M4-ის განთავსებამდე ოპერატორმა უნდა გადაამოწმოს versioning,
მეორე ლოკაციაზე დაშიფრული რეპლიკაცია, raw/evidence-ის წაშლის დაცვა, მინიმუმ
30-დღიანი აღდგენის ისტორია და პირველი რეალური აღდგენა. P10-ის სკრიპტები ამ
კონფიგურაციას მოამზადებს; საწარმოო ჩართვა მფლობელის მიერ სრულდება.

P10-ის ზუსტი ბრძანებები და ანგარიშების გამიჯვნა მოცემულია
[მედიის საცავის ინსტრუქციაში](media-storage.md). `media:storage` ჯერ მხოლოდ გეგმას
ბეჭდავს; `--apply` ინფრასტრუქტურის ოპერატორის მიერ განიხილება და სრულდება.
`media:restore --capture` ქმნის ახალი ფაილის მანიფესტს 25-მდე raw ფოტოს მონაცემებით;
`media:restore` ცალკე აღდგენილ საცავში ამოწმებს ზომებს, SHA-256-სა და ბაზის მეტამონაცემებს.
სრული verifier იმავე შემოწმებას ავტომატურად მოითხოვს, როცა წყაროში ფოტოები არსებობს.
ამისთვის მიაწოდეთ `RESTORE_MEDIA_STORAGE_DRIVER` და ცალკე `RESTORE_MEDIA_…`
ფოლდერი ან bucket/endpoint/ანგარიში. გამოსაყენებელი კონფიგურაცია წყაროსგან უნდა
განსხვავდებოდეს. ანგარიშში იწერება შემოწმებული ფაილების რაოდენობა და შედეგი.

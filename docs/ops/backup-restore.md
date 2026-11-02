# Khidi — ბექაფი და აღდგენა

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

## სრული შემოწმება

პირველი საერთო განთავსებისას, **პილოტურ მიღებამდე**, ადამიანმა უნდა ჩაატაროს
ეს შემოწმება და შედეგი `AGENTS.md` §3-ში დააფიქსიროს. გაიმეორეთ კვარტალში
ერთხელ და ინფრასტრუქტურის მნიშვნელოვანი ცვლილების შემდეგ.

1. შეაჩერეთ Hub, worker და სხვა ჩამწერი პროცესები წყაროზე. ზუსტი რაოდენობების
   შედარებისთვის წყარო უცვლელი უნდა დარჩეს ბექაფის დასრულებამდე.
2. შექმენით მხოლოდ საცდელი აღდგენისთვის ცარიელი დირექტორია. მოამზადეთ გარემო:
   `SOURCE_WRITERS_STOPPED=yes`, `SOURCE_MIGRATOR_URL`, `RESTORE_MIGRATOR_URL`,
   `RESTORE_APP_URL`, `RESTORE_PORT`, ზემოთ ჩამოთვლილი გზები და `RESTORE_REPORT`.
   URL-ები საიდუმლოებების საცავიდან მიაწოდეთ. აღდგენილი ბაზა უნდა იყოს loopback-ზე,
   სხვა პორტზე; აპლიკაციისა და მიგრაციების როლები განცალკევებულია.
3. პროექტის ძირიდან გაუშვით:

   ```sh
   corepack pnpm exec tsx ops/verify-restore.ts
   ```

სკრიპტი იღებს წყაროს რაოდენობებს ერთ read-only snapshot-ში; აკეთებს ახალ სრულ
ბექაფს; აღადგენს კონკრეტულ ბექაფს; ამოწმებს მიგრაციების ზუსტ სიასა და checksum-ებს
მათი გაშვების გარეშე; ადარებს 16 ძირითად ცხრილს; შემდეგ აღდგენილ ასლზე უშვებს
სრულ ტესტებს. რაოდენობები ტესტებამდე მოწმდება, რადგან ტესტები მონაცემებს ამატებს.
ბოლოს საცდელი კლასტერი ჩერდება და რჩება JSON ანგარიში. ჩავარდნა აბრუნებს
არანულოვან კოდს; წყაროზე ტესტები არ ეშვება. `RESTORE_REPORT` ახალი ფაილის გზა უნდა
იყოს — წინა ანგარიში არ გადაიწერება.

## ლოკალური შემოწმება Docker-ით

`ops/compose.restore-test.yml` ქმნის ცალკე ლოკალურ წყაროს `5436` პორტზე და აღდგენის
ასლისთვის გამოყოფს `5437`-ს. ის პროექტის ჩვეულებრივ `5435` ბაზას არ იყენებს.
სატესტო საცავი ლოკალური და დაშიფრულია; ამით off-server S3-ის გამართულობა არ მოწმდება.

1. შექმენით შემთხვევითი `PGBACKREST_REPO1_CIPHER_PASS` დროებით გარემოში ან
   იგნორირებულ `ops/.restore-test.env` ფაილში. გაუშვით:

   ```sh
   docker compose --env-file ops/.restore-test.env -f ops/compose.restore-test.yml up -d --build --wait
   docker cp docker/postgres/init-roles.sh khidi-m3-restore-source:/tmp/init-roles.sh
   docker exec khidi-m3-restore-source sh /tmp/init-roles.sh
   docker exec --user root khidi-m3-restore-source install -d -o postgres -g postgres -m 700 /var/lib/pgbackrest /var/lib/postgresql/restore-drill/cluster
   docker exec --user postgres khidi-m3-restore-source pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=khidi stanza-create
   ```

2. ამ ცარიელ ლოკალურ წყაროზე როლებს ზემოთ გაშვებული repository init-სკრიპტი ქმნის. შემდეგ
   `DATABASE_URL`/`DATABASE_MIGRATOR_URL`-ის `5436` პორტით გაუშვით ტესტები. უკვე
   შექმნილ volume-ზე PostgreSQL-ის საწყისი ინიციალიზაცია ხელახლა არ მუშაობს; არ გამოიყენოთ სხვა პროექტის volume.
3. verification-ისთვის მიუთითეთ `OPS_DOCKER_CONTAINER=khidi-m3-restore-source`,
   `PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf`,
   `SOURCE_PGDATA=/var/lib/postgresql/18/khidi`,
   `RESTORE_ROOT=/var/lib/postgresql/restore-drill`,
   `RESTORE_PGDATA=/var/lib/postgresql/restore-drill/cluster`, `RESTORE_PORT=5433`.
   წყაროს URL-ები იყენებს host-ის `5436` პორტს, აღდგენილის — `5437`-ს.
   ეს სხვაობა მხოლოდ Docker-ის პორტების შესაბამისობაა.
4. გაუშვით `ops/verify-restore.ts` წინა განყოფილების წესით. არტეფაქტები და
   დროებითი გასაღები Git-ში არ შეიტანოთ. დასრულების შემდეგ გააჩერეთ compose
   გარემო; მონაცემების დირექტორიების წაშლა ამ სკრიპტების ნაწილი არ არის.

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

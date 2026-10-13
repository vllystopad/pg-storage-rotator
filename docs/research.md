# Research: storage rotation for PostgreSQL

Date: 2026-10-13. Working name `pg-storage-rotator`.

Evidence tags: **[V]** verified here on PostgreSQL 18.6 in Docker (macOS, aarch64) · **[S]** from a web
source, mostly third-party, linked at the end · **[M]** from memory, not re-checked.

## 1. What "rotation" can mean

PostgreSQL has no file-level rotation primitive, so the idea has to be built from four real mechanisms.
The owner's decision (section 7) splits "rotation" into two separate features.

| Part | Mechanism | Notes |
| --- | --- | --- |
| Backups | pgBackRest: retention counts, `aes-256-cbc` repo encryption, posix / S3 / GCS / Azure repos | A repo's passphrase cannot be changed in place: re-keying means a new repo or stanza and a fresh full backup, then expire the old one. [S] |
| Server log | `logging_collector`, `log_rotation_age/size`, `pg_rotate_logfile()`, `jsonlog` (PG15+) | `pg_rotate_logfile()` returned `f` with a warning until the collector was on. The Docker image has it off, so logs go to stderr. [V] |
| WAL | `pg_switch_wal()` closes a segment; archiving ships it; checkpoints recycle it | 16 MB segments. `pg_wal` can be a symlink to another volume. [V] |
| Data and WAL location | `ALTER TABLE … SET TABLESPACE` (rewrites the file, takes a full lock) [V]; blue/green: `pg_basebackup` standby on a new volume, promote, retire the old one [M] | Blue/green moves data and WAL together with seconds of downtime, so it is the better default. |

Honest limit: core PostgreSQL has no transparent data encryption. Percona's `pg_tde` and a third-party
`pg_vault_tde` exist as extensions [S]; encryption at rest otherwise sits below the database (LUKS,
BitLocker, FileVault, cloud volume keys). "Rotate the key" therefore means: new encrypted volume, new
key, move onto it, destroy the old one.

## 2. MSSQL to PostgreSQL map

| MSSQL | PostgreSQL |
| --- | --- |
| `.mdf` primary file | `base/` in PGDATA, tablespace `pg_default` |
| `.ndf` secondary file, filegroup | tablespace (`CREATE TABLESPACE … LOCATION`). Objects are placed, not files; no growth or shrink settings |
| `.ldf` transaction log | WAL in `pg_wal` |
| Recovery model | `wal_level` + `archive_mode`. Simple ≈ minimal and no archive; full ≈ replica and archive. No true bulk-logged |
| `sp_helpdb`, `sp_spaceused` | `pg_tablespace_size`, `pg_database_size`, `pg_relation_filepath`, `pg_ls_waldir()` |
| `fn_dblog` | `pg_walinspect` for record metadata; logical decoding for row content |
| One file per disk | One Docker named volume per role: data, WAL, tablespace [V] |

## 3. Cloud storage

- **S3 API** is the one target to support. Versioning, Object Lock (compliance mode cannot be bypassed
  even by root; governance mode can) and lifecycle rules give real rotation. Object Lock needs
  versioning and is set up when the bucket is created. [S]
- **GCS** (retention policy / bucket lock) and **Azure Blob** (immutable storage): equivalent features. [M]
  pgBackRest speaks all three, so the service should drive pgBackRest, not reimplement backups.
- **Local S3 for people who clone the repo:** MinIO Community is a poor default now. Sources report its
  Docker Hub images removed, maintenance mode since 2025-12-03 and the repo archived (dates differ by
  source). Candidates: Garage, SeaweedFS, RustFS (alpha). Whether each supports Object Lock is unchecked. [S]
- **GitHub as storage: no.** 100 MiB hard push limit, 1 GB repo guidance, LFS quotas, Actions artifacts
  default to 90 days and count as billable storage, and a public repo would publish the backup. [S]
- **GitHub where it fits:** Actions CI for tests; GHCR for a multi-arch image so `docker compose up`
  needs no build; Releases for the compose bundle. A GitHub scheduled workflow cannot be the product's
  scheduler: it only reaches a local database through a self-hosted runner, and cron runs only from the
  default branch. [M]
- **Docker features that help:** named volumes, helper containers (`docker run --rm -v`), healthchecks,
  compose profiles, file-based secrets. **Cost:** controlling Docker needs `/var/run/docker.sock`, which is
  root-equivalent. Mitigations: a socket proxy limited to a few verbs, or two pre-declared slots (A and B)
  in compose so the service never creates containers. [M]

## 4. Compatibility

- **PostgreSQL versions.** Supported majors are 14–18; 14 reaches end of life on 2026-11-12 and 19 is
  expected this month. [S] Support 15–18: `pg_walinspect` and `jsonlog` start at 15 [S]. PG18 removed the
  WAL write/sync counters from `pg_stat_wal` and moved them to `pg_stat_io WHERE object='wal'` [S], so the
  dashboard needs a small per-version query layer.
- **Image layout changed in PG18.** `PGDATA` is `/var/lib/postgresql/18/docker` and the volume belongs on
  `/var/lib/postgresql`, not `…/data`. `POSTGRES_INITDB_WALDIR=/wal` produced `pg_wal -> /wal` on its own
  volume. A tablespace volume arrives root-owned and needs `chown postgres` (uid 999 on Debian images). [V]
- **Linux:** native. SELinux hosts need `:Z` on bind mounts; rootless Docker remaps volume owners. [M]
- **macOS:** Docker Desktop, arm64 and amd64 both fine (the official image is multi-arch). [V on arm64]
- **Windows:** Docker Desktop with WSL2. Use named volumes only: bind mounts from NTFS break `chmod` and
  ownership of the data directory. Ship `.gitattributes` with `eol=lf` for shell scripts. The official
  image is Linux-only. [S/M]
- **Without Docker** (a native install) differs per OS in service names, data dirs and symlink rights.
  Make it a later, read-only mode: dashboard and backups, no rotation.
- **CI matrix:** Linux for Docker integration tests across PG 15–18. Whether Windows and macOS hosted
  runners can run Linux containers is not confirmed; assume unit tests only there until checked.
- **Runtime:** Node 22 LTS inside the image, so users need only Docker.

## 5. Dashboard (the `fn_dblog` idea)

Everything below is plain SQL, so it works the same on every OS:

| Need | Source | Status |
| --- | --- | --- |
| Records in WAL: type, length, LSN | `pg_get_wal_records_info(start, end)`, `pg_get_wal_stats()` (`pg_walinspect`, PG15+) | Works in the official image for a superuser. [V] |
| Row content | Logical decoding: `pg_logical_slot_peek_changes` with `test_decoding`; needs `wal_level=logical` and a restart | Showed real values (`INSERT … v:'secret-row'`). [V] |
| WAL files and size | `pg_ls_waldir()`, `pg_current_wal_lsn()` diffs for bytes/s | [V] |
| Data files | `pg_tablespace`, `pg_relation_filepath`, sizes | `pg_tblspc/16384/PG_18_…/5/16393` for a table in a tablespace. [V] |
| Archiver, I/O | `pg_stat_archiver`, `pg_stat_io`, `pg_stat_wal` | [V] |
| Backups | `pgbackrest info --output=json` | [M] |

Constraints:
- **Privacy.** Row content is exactly the data you are protecting. Metadata only by default; row content
  opt-in, masked, and never written to the tool's own logs.
- **Slots.** An abandoned logical slot makes WAL pile up until the disk fills. Peek, drop after use, and set
  `max_slot_wal_keep_size`.
- **Not `fn_dblog`.** WAL holds redo only, and segments are recycled, so history is limited to what is still
  in `pg_wal` or archived (archived segments need `pg_waldump` on the file).
- **No file watchers.** inotify does not cross the Docker Desktop VM. Poll SQL every 1–2 s and push to the
  browser over SSE.
- `pgaudit` and `wal2json` are not in the official image. [V]

## 6. Proposed shape (for discussion, nothing built)

- One NestJS service. Scheduler (cron expression) plus a "Rotate now" endpoint, one run at a time, with a
  dry-run mode. State and run history in a local SQLite file, so there is no Redis to install.
- A rotation is a step machine: prepare → copy → verify (`pg_verifybackup`, a smoke query, a restore test)
  → switch → retire. Nothing old is deleted until verification passes; the last N generations are kept;
  retiring needs an explicit confirmation in the UI.
- A small dashboard served by the same service: sizes per volume, WAL rate, record mix, last records,
  checkpoints, archiver, backup list, rotation history. Each rotation is appended to a hash-chained audit
  log.
- The tool is itself a risk: bind to `127.0.0.1` by default, a local token for the button, secrets from
  files, nothing sensitive in logs.
- Quick start: `git clone && docker compose up` brings up a demo PostgreSQL on three volumes plus the
  service and dashboard. The image is published to GHCR for amd64 and arm64.

## 7. Decisions (2026-10-14)

1. **Rotation is two features, kept apart.**
   - **Data lifecycle rotation (v1, the core).** Time-partitioned tables move between storage tiers by age:
     hot → warm → archive → deleted. It is the PostgreSQL counterpart of MSSQL sliding-window partitioning
     over filegroups. Create future partitions ahead of time; `ALTER TABLE/INDEX … SET TABLESPACE` for warm;
     `DETACH PARTITION CONCURRENTLY`, export to S3, then `DROP` for archive. The "Rotate now" button runs this.
   - **Volume and key rotation (v1.1, behind a feature flag, local and VM profiles only).** New volume and
     key → standby on it → promote → retire and destroy the old volume. Design stays in `roadmap.md`; it gets
     its own button after v1.
2. **Demo PostgreSQL ships in compose under profile `demo`, but the app connects only through
   `DATABASE_URL`.** Attaching to another database means not starting the demo container, with no code change.
3. **S3-compatible storage only** (AWS S3, Cloudflare R2, Backblaze B2, Railway Buckets). SeaweedFS is the
   local S3, Garage the documented alternative. Archive expiry uses S3 lifecycle rules, not deletes from code.
4. **`pg-storage-rotator`, public, MIT.**
5. **One codebase, behaviour chosen by `.env`.** Code works with logical tiers (hot, warm, archive) plus the
   WAL layout. Each tier is bound by env to a driver: `default` (stay in `pg_default`), `tablespace` (a
   directory in the database container), or `s3` (archive only). Profiles: `local`, `vm`, `railway`. A missing
   capability is a validation error before anything runs, never a failure halfway through.
6. **Out of scope for v1:** volume and key rotation, pgBackRest re-keying, TDE, Object Lock, multi-database
   fleets (see `roadmap.md`).

Readings the config follows until told otherwise:
- Ages in `ROTATION_POLICIES` are cumulative thresholds: `hot=3,warm=12,archive=36` means a partition leaves
  hot at age 3, leaves warm at 12 and is deleted at 36 (by the S3 lifecycle rule). Ages must increase.
- Every policy must name an archive tier, because dropping a partition without a copy is irreversible.

## Sources

- [pg_walinspect (PG 18)](https://www.postgresql.org/docs/18/pgwalinspect.html)
- [pgBackRest configuration](https://www.pgbackrest.org/configuration.html), [Pigsty backup repository notes](https://doc.pigsty.io/docs/pgsql/backup/repository/)
- [Percona: encrypt the pgBackRest repository](https://www.percona.com/blog/enhancing-postgresql-security-how-to-encrypt-the-pgbackrest-repository/), [Percona operator encryption limits](https://docs.percona.com/percona-operator-for-postgresql/3.0.0/backup-encryption.html)
- [Percona pg_tde](https://docs.percona.com/pg-tde/architecture/index.html), [pg_vault_tde](https://github.com/labmiriade/pg_vault_tde)
- [PostgreSQL 14 end of life](https://wz-it.com/en/blog/postgresql-14-end-of-life-upgrade-guide/)
- [pg_stat_wal change in PG18](https://commitfest.postgresql.org/patch/5579), [pg_stat_io](https://neon.com/postgresql/postgresql-18/pg-stat-io)
- [GitHub: about large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [Actions artifact retention](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)
- [MinIO status](https://linuxiac.com/minio-ends-active-development/), [alternatives](https://pinggy.io/amp/blog/minio_archived_self_hosted_s3_alternatives/)
- [S3 Object Lock](https://oneuptime.com/blog/post/2026-02-12-configure-s3-object-lock-worm-compliance/view)
- [Postgres bind mounts on Windows](https://forums.docker.com/t/postgres-in-wsl-2-with-docker-operation-not-permitted-when-i-share-volumes-enter-windows-folder/92161)

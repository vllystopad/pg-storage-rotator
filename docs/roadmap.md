# Roadmap

## v1: data lifecycle rotation

Partitioned tables move between tiers by age: hot → warm → archive → deleted.

| Step | What | Status |
| --- | --- | --- |
| 1 | Decisions and roadmap in `docs/` | done |
| 2 | Config schema, env loader, validation | in progress |
| 3 | Generator and the `local` profile end to end | in progress |
| 4 | Rotator: `default`, `tablespace`, `s3` drivers, dry-run, locking, run history | next |
| 5 | Dashboard: read-only, plus "Rotate now" with a dry-run plan and confirmation | next |

The rotator must be idempotent, take `pg_try_advisory_lock`, move indexes explicitly (`SET TABLESPACE` on a
table does not move them), archive as `DETACH CONCURRENTLY` → `COPY TO STDOUT` → gzip → multipart upload →
verify → `DROP`, and run under a least-privilege role. `CREATE TABLESPACE` happens only in init SQL or an
explicit admin command, never in a scheduled run.

## v1.1: volume and key rotation (feature flag, `local` and `vm` profiles only)

Not built. The design:

1. Create a new volume, with a new key where the profile supports one.
2. Build a standby on it with `pg_basebackup`, with the WAL directory on its own volume.
3. Verify (`pg_verifybackup`, a smoke query, replication lag at zero).
4. Promote it and switch connections.
5. Retire the old volume, keep the last N generations, destroy older ones only after explicit confirmation.

It needs control over Docker, which is root-equivalent on the host. Options: a socket proxy that allows a few
verbs, or two pre-declared compose slots (A and B) so the service never creates containers. It gets its own
button and is never part of "Rotate now".

## Out of scope for v1

- Volume and key rotation (above).
- pgBackRest re-keying. A repository passphrase cannot be changed in place, so it means a new repository and a
  fresh full backup.
- Transparent data encryption.
- S3 Object Lock.
- Fleets of databases.

## Known limits

- `POSTGRES_INITDB_WALDIR` only applies when the data volume is empty. An existing cluster keeps its WAL where
  it is.
- Tablespaces in `docker/init/` are created once, at first initialisation. Adding a tablespace to a running
  cluster is an explicit admin command, not part of generation.

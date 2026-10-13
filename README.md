# pg-storage-rotator

Moves partitioned PostgreSQL data between storage tiers by age: hot, then warm, then archive in S3, then
deleted. The PostgreSQL counterpart of MSSQL sliding-window partitioning over filegroups.

**Status: pre-v1.** The configuration, its validation and the file generator work. The rotator itself and the
dashboard are not built yet. See [docs/roadmap.md](docs/roadmap.md).

## Try the local profile

Needs Node 22 and Docker.

```sh
npm install
cp .env.example.local .env.local     # fill in S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, POSTGRES_PASSWORD
npm run storage:generate -- --env .env.local
docker compose --env-file .env.local -f docker-compose.storage.yml --profile demo up -d --build
docker compose --env-file .env.local -f docker-compose.storage.yml exec postgres psql -U postgres -c '\db+'
```

You get PostgreSQL with a `warm` tablespace on its own volume, the WAL on another, and SeaweedFS as local S3.
To use your own database instead, leave out `--profile demo` and point `DATABASE_URL` at it.

## How it is configured

One codebase, one `.env`. The code works with logical tiers, each bound to a driver:

| Tier | Drivers | Meaning |
| --- | --- | --- |
| hot, warm | `default` | stay in `pg_default` |
| hot, warm | `tablespace` | a directory inside the database container, on a named volume or a host folder |
| archive | `s3` | any S3-compatible bucket |

| Profile | For | Tablespaces and WAL volume |
| --- | --- | --- |
| `local` | Docker Desktop on macOS, Windows, Linux | yes |
| `vm` | a VM with attached disks | yes |
| `railway` | one volume per service | no: refused with a message |

Every setting is documented in [`.env.example.local`](.env.example.local),
[`.env.example.vm`](.env.example.vm) and [`.env.example.railway`](.env.example.railway). A combination that
cannot work is reported, all problems at once, before anything is generated. What each profile generates is in
[`examples/`](examples).

On Windows use named volumes only: a bind mount cannot hold the permissions PostgreSQL needs.

## Development

```sh
npm test               # unit tests
npm run test:docker    # starts the generated local profile with Docker and checks it
npm run typecheck
```

[docs/research.md](docs/research.md) holds the research and the decisions behind this.

## Licence

MIT

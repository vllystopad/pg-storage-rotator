# Progress

Read this first in a new session. Decisions are in `docs/research.md` section 7; the plan is `docs/roadmap.md`.

## State (2026-10-14)

- **Step 1, docs:** done.
- **Step 2, config:** `src/config/`. Env settings are read one by one with zod, then cross-setting rules run, so every
  problem is reported at once. Railway refuses tablespace drivers and a WAL path; bind mounts are refused on
  Windows or with `STORAGE_FORBID_BIND_MOUNTS`.
- **Step 3, generator:** `src/generator/`, command `npm run storage:generate`. `local` and `vm` produce a Dockerfile,
  init SQL and a compose file; `railway` produces only its env template and prints what is unsupported.
  `examples/<profile>/` are the committed outputs, checked by a test. The local profile was started with Docker
  (`npm run test:docker`): tablespace, WAL volume and SeaweedFS S3 all verified.
- **Step 4 (rotator) and 5 (dashboard):** not started. Waiting for review of step 3.

## Decisions taken without being asked

- Policy ages are cumulative thresholds, and every policy must have an archive tier.
- Hot and warm may be `default` or `tablespace`; archive is `s3` only.
- The generated compose file is standalone; the rotator service will join it in step 4.
- `STORAGE_PROFILE=railway` still writes `.env.example.railway`, because it is an env template and not a Docker file.

## Not done

- `npm run typecheck` has never been run.
- Bucket creation on the bundled SeaweedFS (the rotator will do it).
- Least-privilege rotator role and its `GRANT CREATE ON TABLESPACE`.

import type { PgMajor } from './types.js';

// PostgreSQL 18 images moved PGDATA to /var/lib/postgresql/<major>/docker and declared the parent as the
// volume, so mounting the old /data path there would leave the cluster outside any volume.
export const postgresVolumeMount = (major: PgMajor): string =>
  major >= 18 ? '/var/lib/postgresql' : '/var/lib/postgresql/data';

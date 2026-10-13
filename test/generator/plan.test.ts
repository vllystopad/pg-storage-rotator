import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/load-config.js';
import { planStorage } from '../../src/generator/plan.js';
import { localEnv } from '../config/fixtures.js';

const plan = (overrides: Record<string, string | undefined> = {}) => planStorage(loadConfig({ ...localEnv, ...overrides }));
const mounts = (overrides: Record<string, string | undefined> = {}) =>
  plan(overrides).mounts.map((mount) => [mount.volume, mount.target, mount.hostPath]);

describe('what the generated files have to provide', () => {
  it('gives the data directory, the warm tablespace and the WAL their own named volume', () => {
    expect(mounts()).toEqual([
      ['pg_data', '/var/lib/postgresql', undefined],
      ['pg_warm', '/mnt/pg/warm', undefined],
      ['pg_wal', '/mnt/pg/wal', undefined],
    ]);
    expect(plan().tablespaces).toEqual([{ name: 'warm', path: '/mnt/pg/warm' }]);
    expect(plan().walDir).toBe('/mnt/pg/wal');
  });

  it('mounts the data directory where the chosen PostgreSQL major keeps it', () => {
    expect(mounts({ PG_MAJOR: '17' })[0]).toEqual(['pg_data', '/var/lib/postgresql/data', undefined]);
    expect(plan({ PG_MAJOR: '16' }).image).toBe('postgres:16');
  });

  it('adds a hot tablespace before the warm one when the hot tier has its own disk', () => {
    const planned = plan({ TIER_HOT_DRIVER: 'tablespace', TIER_HOT_NAME: 'hot', TIER_HOT_PATH: '/mnt/pg/hot' });

    expect(planned.tablespaces.map((tablespace) => tablespace.name)).toEqual(['hot', 'warm']);
    expect(planned.mounts.map((mount) => mount.volume)).toEqual(['pg_data', 'pg_hot', 'pg_warm', 'pg_wal']);
  });

  it('uses a host folder instead of a named volume when one is given', () => {
    const planned = plan({ STORAGE_PROFILE: 'vm', TIER_WARM_HOST_PATH: '/srv/pg/warm' });

    expect(planned.mounts.find((mount) => mount.target === '/mnt/pg/warm')?.hostPath).toBe('/srv/pg/warm');
  });

  it('provides nothing extra when every tier stays in pg_default and there is no WAL volume', () => {
    const planned = plan({ TIER_WARM_DRIVER: 'default', TIER_WARM_NAME: '', TIER_WARM_PATH: '', PG_WAL_PATH: '' });

    expect(planned.tablespaces).toEqual([]);
    expect(planned.walDir).toBeUndefined();
    expect(planned.mounts.map((mount) => mount.volume)).toEqual(['pg_data']);
  });

  it('starts SeaweedFS only when the S3 endpoint points at it', () => {
    expect(plan().seaweedfs).toEqual({ port: 8333 });
    expect(plan({ S3_ENDPOINT: 'http://seaweedfs:9000' }).seaweedfs).toEqual({ port: 9000 });
    expect(plan({ S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com' }).seaweedfs).toBeUndefined();
    expect(plan({ S3_ENDPOINT: undefined }).seaweedfs).toBeUndefined();
  });
});

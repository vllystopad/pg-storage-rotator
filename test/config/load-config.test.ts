import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../src/config/errors.js';
import { loadConfig, parseConfig } from '../../src/config/load-config.js';
import { localEnv, railwayEnv, SECRETS, type Env } from './fixtures.js';

const issuesOf = (env: Env, platform: NodeJS.Platform = 'linux') => {
  const result = parseConfig(env, { platform });
  return result.ok ? [] : result.issues;
};

const messageFor = (env: Env, key: string, platform: NodeJS.Platform = 'linux') =>
  issuesOf(env, platform).find((issue) => issue.key === key)?.message;

describe('a valid configuration', () => {
  it('loads the local profile with a warm tablespace and a separate WAL volume', () => {
    const config = loadConfig(localEnv);

    expect(config).toMatchObject({
      profile: 'local',
      pgMajor: 18,
      tiers: {
        hot: { driver: 'default' },
        warm: { driver: 'tablespace', name: 'warm', path: '/mnt/pg/warm', hostPath: undefined },
        archive: { driver: 's3', bucket: 'pg-archive', prefix: '' },
      },
      wal: { path: '/mnt/pg/wal', hostPath: undefined },
      s3: { endpoint: 'http://seaweedfs:8333', region: 'auto' },
      dryRun: false,
    });
    expect(config.policies).toHaveLength(1);
  });

  it('loads the railway profile with every table tier left in pg_default and no WAL volume', () => {
    const config = loadConfig(railwayEnv);

    expect(config.tiers.warm).toEqual({ driver: 'default' });
    expect(config.wal).toBeUndefined();
  });

  it('treats a blank value as not set, so a commented template line changes nothing', () => {
    expect(loadConfig({ ...localEnv, TIER_WARM_HOST_PATH: '   ', S3_REGION: '' }).s3.region).toBe('auto');
  });

  it('needs only the profile, the database, the archive and the policies, and defaults the rest', () => {
    const config = loadConfig({
      STORAGE_PROFILE: 'vm',
      DATABASE_URL: 'postgresql://u:p@db:5432/app',
      TIER_ARCHIVE_BUCKET: 'b-archive',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      ROTATION_POLICIES: 'events:month:hot=1,archive=2',
    });

    expect(config).toMatchObject({
      pgMajor: 18,
      tiers: { hot: { driver: 'default' }, warm: { driver: 'default' }, archive: { driver: 's3' } },
      dryRun: false,
      s3: { endpoint: undefined, region: 'auto' },
    });
  });

  it('accepts a host folder for a tablespace on the vm profile', () => {
    const config = loadConfig({ ...localEnv, STORAGE_PROFILE: 'vm', TIER_WARM_HOST_PATH: '/srv/pg/warm' });

    expect(config.tiers.warm).toMatchObject({ hostPath: '/srv/pg/warm' });
  });

  it('accepts PostgreSQL 15 to 18', () => {
    for (const major of ['15', '16', '17', '18']) {
      expect(loadConfig({ ...localEnv, PG_MAJOR: major }).pgMajor).toBe(Number(major));
    }
  });
});

describe('a single setting that is wrong', () => {
  it.each([
    ['STORAGE_PROFILE', undefined, /one of: local, vm, railway/],
    ['STORAGE_PROFILE', 'cloud', /one of: local, vm, railway/],
    ['DATABASE_URL', undefined, /is required/],
    ['DATABASE_URL', 'mysql://u:p@h/db', /postgres:\/\/ or postgresql:\/\/ URL/],
    ['DATABASE_URL', 'not a url', /postgres:\/\/ or postgresql:\/\/ URL/],
    ['PG_MAJOR', '14', /15, 16, 17 or 18/],
    ['PG_MAJOR', '19', /15, 16, 17 or 18/],
    ['PG_MAJOR', 'latest', /15, 16, 17 or 18/],
    ['TIER_WARM_DRIVER', 's3', /one of: default, tablespace/],
    ['TIER_HOT_DRIVER', 'cloud', /one of: default, tablespace/],
    ['TIER_ARCHIVE_DRIVER', 'tablespace', /must be s3/],
    ['TIER_ARCHIVE_BUCKET', 'PG_Archive', /bucket name/],
    ['TIER_ARCHIVE_BUCKET', 'ab', /bucket name/],
    ['TIER_ARCHIVE_PREFIX', '/leading', /without a leading slash/],
    ['TIER_ARCHIVE_PREFIX', 'a/../b', /without a leading slash/],
    ['S3_ENDPOINT', 'ftp://host', /http:\/\/ or https:\/\/ URL/],
    ['S3_ENDPOINT', 'http://user:pw@host:8333', /must not contain credentials/],
    ['ROTATION_DRY_RUN', 'yes', /true or false/],
    ['STORAGE_FORBID_BIND_MOUNTS', '1', /true or false/],
  ])('%s=%s is reported against that setting', (key, value, message) => {
    const env = { ...localEnv, [key]: value };

    expect(messageFor(env, key)).toMatch(message);
  });
});

describe('profile railway', () => {
  it.each(['TIER_HOT_DRIVER', 'TIER_WARM_DRIVER'])('refuses the tablespace driver in %s and says what to use', (key) => {
    const message = messageFor({ ...railwayEnv, [key]: 'tablespace' }, key);

    expect(message).toMatch(/'tablespace' is not available on profile railway/);
    expect(message).toMatch(new RegExp(`Use ${key}=default`));
  });

  it('refuses a separate WAL volume', () => {
    const message = messageFor({ ...railwayEnv, PG_WAL_PATH: '/mnt/pg/wal' }, 'PG_WAL_PATH');

    expect(message).toMatch(/separate WAL volume is not available on profile railway/);
    expect(message).toMatch(/Remove PG_WAL_PATH/);
  });
});

describe('tablespace tiers', () => {
  it('need a name and a path', () => {
    const env = { ...localEnv, TIER_WARM_NAME: '', TIER_WARM_PATH: '' };

    expect(messageFor(env, 'TIER_WARM_NAME')).toMatch(/required when TIER_WARM_DRIVER=tablespace/);
    expect(messageFor(env, 'TIER_WARM_PATH')).toMatch(/required when TIER_WARM_DRIVER=tablespace/);
  });

  it('refuse a name, a path or a host folder when the driver is default, so nothing is silently ignored', () => {
    const env = { ...localEnv, TIER_WARM_DRIVER: 'default', TIER_WARM_HOST_PATH: '/srv/pg/warm' };

    for (const key of ['TIER_WARM_NAME', 'TIER_WARM_PATH', 'TIER_WARM_HOST_PATH']) {
      expect(messageFor(env, key)).toMatch(/TIER_WARM_DRIVER is default/);
    }
  });

  it.each(['Warm', 'pg_warm', 'warm-tier', 'warm tier', "warm'; DROP", '1warm'])(
    'refuse the tablespace name %j, which PostgreSQL reserves or which would not be safe in SQL',
    (name) => {
      expect(messageFor({ ...localEnv, TIER_WARM_NAME: name }, 'TIER_WARM_NAME')).toMatch(/tablespace name/);
    },
  );

  it('refuse two tiers with the same tablespace name', () => {
    const env = {
      ...localEnv,
      TIER_HOT_DRIVER: 'tablespace',
      TIER_HOT_NAME: 'warm',
      TIER_HOT_PATH: '/mnt/pg/hot',
    };

    expect(messageFor(env, 'TIER_WARM_NAME')).toMatch(/already used by TIER_HOT_NAME/);
  });
});

describe('paths inside the database container', () => {
  it.each([
    ['mnt/pg/warm', /absolute path/],
    ['/mnt/pg/../warm', /\.\./],
    ['/mnt/pg/warm/', /repeated slashes/],
    ['/mnt//warm', /repeated slashes/],
    ['/', /absolute path with at least one directory/],
    ['/mnt/pg/my warm', /letters, digits/],
    ["/mnt/pg/wa'rm", /letters, digits/],
    ['/var/lib/postgresql/warm', /outside the PostgreSQL data volume/],
    ['/var/lib/postgresql', /outside the PostgreSQL data volume/],
  ])('%s is refused', (path, message) => {
    expect(messageFor({ ...localEnv, TIER_WARM_PATH: path }, 'TIER_WARM_PATH')).toMatch(message);
  });

  it('refuses a path inside the data volume on PostgreSQL 17 as well', () => {
    expect(messageFor({ ...localEnv, PG_MAJOR: '17', TIER_WARM_PATH: '/var/lib/postgresql/data/warm' }, 'TIER_WARM_PATH')).toMatch(
      /outside the PostgreSQL data volume/,
    );
  });

  it('refuses the WAL volume sharing a path with a tier, or sitting inside one', () => {
    expect(messageFor({ ...localEnv, PG_WAL_PATH: '/mnt/pg/warm' }, 'PG_WAL_PATH')).toMatch(/already used by TIER_WARM_PATH/);
    expect(messageFor({ ...localEnv, PG_WAL_PATH: '/mnt/pg/warm/wal' }, 'PG_WAL_PATH')).toMatch(/inside TIER_WARM_PATH/);
  });
});

describe('host folders', () => {
  it('are refused on Windows, where NTFS cannot hold the permissions PostgreSQL needs', () => {
    const env = { ...localEnv, TIER_WARM_HOST_PATH: '/srv/pg/warm', PG_WAL_HOST_PATH: '/srv/pg/wal' };

    for (const key of ['TIER_WARM_HOST_PATH', 'PG_WAL_HOST_PATH']) {
      expect(messageFor(env, key, 'win32')).toMatch(/not available on Windows: NTFS/);
      expect(messageFor(env, key, 'win32')).toMatch(new RegExp(`Leave ${key} empty to use a named volume`));
    }
  });

  it('are refused on any host when STORAGE_FORBID_BIND_MOUNTS is true', () => {
    const env = { ...localEnv, STORAGE_FORBID_BIND_MOUNTS: 'true', TIER_WARM_HOST_PATH: '/srv/pg/warm' };

    expect(messageFor(env, 'TIER_WARM_HOST_PATH')).toMatch(/switched off by STORAGE_FORBID_BIND_MOUNTS/);
  });

  it('must be absolute and free of ..', () => {
    expect(messageFor({ ...localEnv, TIER_WARM_HOST_PATH: 'data/warm' }, 'TIER_WARM_HOST_PATH')).toMatch(/absolute path on the host/);
    expect(messageFor({ ...localEnv, TIER_WARM_HOST_PATH: '/srv/../warm' }, 'TIER_WARM_HOST_PATH')).toMatch(/\.\./);
  });

  it('cannot be given for the WAL volume without a WAL path', () => {
    const env = { ...localEnv, PG_WAL_PATH: '', PG_WAL_HOST_PATH: '/srv/pg/wal' };

    expect(messageFor(env, 'PG_WAL_HOST_PATH')).toMatch(/needs PG_WAL_PATH/);
  });

  it('cannot be shared by two volumes', () => {
    const env = { ...localEnv, TIER_WARM_HOST_PATH: '/srv/pg/x', PG_WAL_HOST_PATH: '/srv/pg/x' };

    expect(messageFor(env, 'PG_WAL_HOST_PATH')).toMatch(/already used by TIER_WARM_HOST_PATH/);
  });
});

describe('the archive tier', () => {
  it('needs a bucket and both access keys', () => {
    const env = { ...localEnv, TIER_ARCHIVE_BUCKET: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' };

    for (const key of ['TIER_ARCHIVE_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      expect(messageFor(env, key)).toMatch(/required when TIER_ARCHIVE_DRIVER=s3/);
    }
  });
});

describe('rotation policies', () => {
  it('report every problem against ROTATION_POLICIES, one issue each', () => {
    const issues = issuesOf({ ...localEnv, ROTATION_POLICIES: 'events:fortnight:hot=3;logs:day:hot=2,warm=1,archive=9' });

    expect(issues.filter((issue) => issue.key === 'ROTATION_POLICIES').map((issue) => issue.message)).toEqual([
      'events: interval "fortnight" must be one of day, week, month, year',
      'events: the archive tier is required, because a partition would otherwise be dropped without a copy',
      'logs: ages must increase from hot to archive, but warm=1 is not above hot=2',
    ]);
  });

  it('are required', () => {
    expect(messageFor({ ...localEnv, ROTATION_POLICIES: undefined }, 'ROTATION_POLICIES')).toMatch(/at least one policy/);
  });
});

describe('settings nobody reads', () => {
  it('are reported with the closest real name, so a typo is not silently ignored', () => {
    const issues = issuesOf({ ...localEnv, TIER_WARM_DRVER: 'tablespace' });

    expect(issues).toContainEqual({ key: 'TIER_WARM_DRVER', message: 'unknown setting, did you mean TIER_WARM_DRIVER?' });
  });

  it('are left alone when they belong to someone else', () => {
    expect(issuesOf({ ...localEnv, PATH: '/usr/bin', PGPASSWORD: 'x', S3_BUCKET: 'other' })).toEqual([]);
  });
});

describe('many problems at once', () => {
  it('are all reported in one go, not one per run', () => {
    const issues = issuesOf({
      ...railwayEnv,
      PG_MAJOR: '14',
      TIER_WARM_DRIVER: 'tablespace',
      PG_WAL_PATH: '/mnt/pg/wal',
      ROTATION_POLICIES: 'events:month:hot=3',
    });

    expect(issues.map((issue) => issue.key)).toEqual(['PG_MAJOR', 'TIER_WARM_DRIVER', 'PG_WAL_PATH', 'ROTATION_POLICIES']);
  });
});

describe('secrets', () => {
  it('never appear in an error, however the configuration is wrong', () => {
    const wrong = {
      ...localEnv,
      DATABASE_URL: 'mysql://rotator:hunter2-db@localhost/app',
      S3_ENDPOINT: 'ftp://hunter2-s3@host',
      PG_MAJOR: '14',
      TIER_ARCHIVE_BUCKET: 'Bad_Bucket',
    };

    const text = JSON.stringify(issuesOf(wrong));
    const thrown = (() => {
      try {
        loadConfig(wrong);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();

    for (const secret of SECRETS) {
      expect(text).not.toContain(secret);
      expect(thrown).not.toContain(secret);
    }
  });
});

describe('the error', () => {
  it('lists one problem per line with the setting that caused it', () => {
    let error: unknown;
    try {
      loadConfig({ ...railwayEnv, PG_MAJOR: '14', PG_WAL_PATH: '/mnt/pg/wal' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toBe(
      [
        'Invalid configuration (2 problems):',
        '  PG_MAJOR     must be 15, 16, 17 or 18',
        '  PG_WAL_PATH  a separate WAL volume is not available on profile railway: Railway gives each service one volume. Remove PG_WAL_PATH.',
      ].join('\n'),
    );
  });
});

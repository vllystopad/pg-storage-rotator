import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/load-config.js';
import { planStorage } from '../../src/generator/plan.js';
import { renderCompose } from '../../src/generator/render-compose.js';
import { renderDockerfile } from '../../src/generator/render-dockerfile.js';
import { renderTablespacesSql } from '../../src/generator/render-tablespaces-sql.js';
import { localEnv, SECRETS } from '../config/fixtures.js';

const plan = (overrides: Record<string, string | undefined> = {}, profile = 'local') =>
  planStorage(loadConfig({ ...localEnv, STORAGE_PROFILE: profile, ...overrides }));

describe('Dockerfile.postgres', () => {
  const dockerfile = renderDockerfile(plan());

  it('starts from the PostgreSQL major in the configuration', () => {
    expect(dockerfile).toMatch(/^FROM postgres:18$/m);
    expect(renderDockerfile(plan({ PG_MAJOR: '16' }))).toMatch(/^FROM postgres:16$/m);
  });

  it('creates every tablespace and WAL directory owned by postgres, so a new named volume inherits that owner', () => {
    expect(dockerfile).toMatch(/^RUN install -d -o postgres -g postgres -m 700 \/mnt\/pg\/warm \/mnt\/pg\/wal$/m);
  });

  it('copies the init SQL into the image, so nothing has to be bind mounted from the host', () => {
    expect(dockerfile).toMatch(/^COPY --chown=postgres:postgres docker\/init\/ \/docker-entrypoint-initdb\.d\/$/m);
  });

  it('skips the directory step when no tier or WAL needs a directory', () => {
    const bare = renderDockerfile(plan({ TIER_WARM_DRIVER: 'default', TIER_WARM_NAME: '', TIER_WARM_PATH: '', PG_WAL_PATH: '' }));

    expect(bare).not.toMatch(/install -d/);
  });
});

describe('10-tablespaces.sql', () => {
  it('creates one tablespace per tablespace tier, in tier order', () => {
    const sql = renderTablespacesSql(
      plan({ TIER_HOT_DRIVER: 'tablespace', TIER_HOT_NAME: 'hot', TIER_HOT_PATH: '/mnt/pg/hot' }),
    );

    expect(sql).toMatch(/^CREATE TABLESPACE hot LOCATION '\/mnt\/pg\/hot';\nCREATE TABLESPACE warm LOCATION '\/mnt\/pg\/warm';$/m);
  });

  it('says so, instead of being empty, when there is nothing to create', () => {
    const sql = renderTablespacesSql(plan({ TIER_WARM_DRIVER: 'default', TIER_WARM_NAME: '', TIER_WARM_PATH: '' }));

    expect(sql).not.toMatch(/CREATE TABLESPACE/);
    expect(sql).toMatch(/no tablespace tiers/);
  });
});

describe('docker-compose.storage.yml', () => {
  const compose = (overrides: Record<string, string | undefined> = {}) => parse(renderCompose(plan(overrides)));

  it('puts the bundled PostgreSQL under the demo profile, built from the generated Dockerfile', () => {
    const postgres = compose().services.postgres;

    expect(postgres.profiles).toEqual(['demo']);
    expect(postgres.build).toEqual({ context: '.', dockerfile: 'docker/Dockerfile.postgres' });
  });

  it('mounts a named volume per tier and for the WAL, and tells initdb where the WAL goes', () => {
    const doc = compose();

    expect(doc.services.postgres.volumes).toEqual([
      'pg_data:/var/lib/postgresql',
      'pg_warm:/mnt/pg/warm',
      'pg_wal:/mnt/pg/wal',
    ]);
    expect(doc.services.postgres.environment.POSTGRES_INITDB_WALDIR).toBe('/mnt/pg/wal');
    expect(Object.keys(doc.volumes)).toEqual(['pg_data', 'pg_warm', 'pg_wal', 'seaweedfs_data']);
  });

  it('writes a host folder as a bind mount and declares no named volume for it', () => {
    const doc = compose({ STORAGE_PROFILE: 'vm', TIER_WARM_HOST_PATH: '/srv/pg/warm' });

    expect(doc.services.postgres.volumes).toContainEqual({ type: 'bind', source: '/srv/pg/warm', target: '/mnt/pg/warm' });
    expect(Object.keys(doc.volumes)).not.toContain('pg_warm');
  });

  it('publishes the database only on the loopback interface', () => {
    expect(compose().services.postgres.ports).toEqual(['127.0.0.1:${POSTGRES_PORT:-5432}:5432']);
  });

  it('takes the password from the environment and refuses to start without it', () => {
    expect(compose().services.postgres.environment.POSTGRES_PASSWORD).toBe('${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in the env file}');
  });

  it('adds SeaweedFS with its S3 keys taken from the environment, pinned to a version', () => {
    const seaweed = compose().services.seaweedfs;

    expect(seaweed.image).toMatch(/^chrislusf\/seaweedfs:\d+\.\d+$/);
    expect(seaweed.command).toBe('server -s3 -dir=/data -ip.bind=0.0.0.0');
    expect(seaweed.environment).toEqual({
      AWS_ACCESS_KEY_ID: '${S3_ACCESS_KEY_ID:?set S3_ACCESS_KEY_ID in the env file}',
      AWS_SECRET_ACCESS_KEY: '${S3_SECRET_ACCESS_KEY:?set S3_SECRET_ACCESS_KEY in the env file}',
    });
    expect(seaweed.ports).toEqual(['127.0.0.1:8333:8333']);
  });

  it('listens on the port the endpoint names when it is not 8333', () => {
    const seaweed = compose({ S3_ENDPOINT: 'http://seaweedfs:9000' }).services.seaweedfs;

    expect(seaweed.command).toBe('server -s3 -s3.port=9000 -dir=/data -ip.bind=0.0.0.0');
    expect(seaweed.ports).toEqual(['127.0.0.1:9000:9000']);
  });

  it('leaves SeaweedFS out when the archive lives elsewhere', () => {
    const doc = compose({ S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com' });

    expect(doc.services.seaweedfs).toBeUndefined();
    expect(Object.keys(doc.volumes)).not.toContain('seaweedfs_data');
  });

  it('never contains a secret from the configuration', () => {
    const text = renderCompose(plan());

    for (const secret of SECRETS) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('every generated file', () => {
  it('says it is generated and not to edit it, and is the same text on every run', () => {
    const planned = plan();

    for (const render of [renderDockerfile, renderCompose, renderTablespacesSql]) {
      const text = render(planned);

      expect(text.split('\n')[0]).toMatch(/generated.*do not edit/i);
      expect(render(planned)).toBe(text);
    }
  });
});

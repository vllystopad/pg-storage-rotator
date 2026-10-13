import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/load-config.js';
import { generateFiles } from '../../src/generator/generate.js';
import { renderEnvExample } from '../../src/generator/render-env-example.js';

const POSTGRES_PORT = '55432';
const S3_KEY = 'e2e-access-key';
const S3_SECRET = 'e2e-secret-key';

// Starts the generated local profile for real. Needs Docker; run it with `npm run test:docker`.
describe.skipIf(!process.env.DOCKER_E2E)('the generated local profile, started with docker compose', () => {
  const project = `pgsr-e2e-${process.pid}`;
  let directory: string;

  const compose = (...args: string[]) =>
    execFileSync('docker', ['compose', '-p', project, '--env-file', '.env.local', '-f', 'docker-compose.storage.yml', ...args], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const psql = (sql: string) => compose('exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-tA', '-c', sql).trim();
  const inContainer = (...command: string[]) => compose('exec', '-T', 'postgres', ...command).trim();

  beforeAll(() => {
    const env = {
      ...parseEnv(renderEnvExample('local')),
      S3_ACCESS_KEY_ID: S3_KEY,
      S3_SECRET_ACCESS_KEY: S3_SECRET,
    };
    directory = mkdtempSync(join(tmpdir(), 'pgsr-e2e-'));
    for (const file of generateFiles(loadConfig(env, { platform: process.platform })).files) {
      mkdirSync(dirname(join(directory, file.path)), { recursive: true });
      writeFileSync(join(directory, file.path), file.content);
    }
    const envFile = Object.entries({ ...env, POSTGRES_PORT, POSTGRES_PASSWORD: 'e2e-password' })
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    writeFileSync(join(directory, '.env.local'), envFile);

    compose('--profile', 'demo', 'up', '-d', '--build', '--wait', '--wait-timeout', '240');
  }, 360_000);

  afterAll(() => {
    try {
      compose('--profile', 'demo', 'down', '-v', '--remove-orphans', '--timeout', '5');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('creates the warm tablespace at the configured path during first initialisation', () => {
    expect(psql("SELECT spcname || '|' || pg_tablespace_location(oid) FROM pg_tablespace WHERE spcname = 'warm'")).toBe('warm|/mnt/pg/warm');
  });

  it('puts a table created in the warm tablespace on the warm volume', () => {
    psql('CREATE TABLE e2e_warm (id int) TABLESPACE warm');

    expect(psql("SELECT pg_relation_filepath('e2e_warm')")).toMatch(/^pg_tblspc\//);
    expect(inContainer('ls', '/mnt/pg/warm')).toMatch(/PG_\d+_/);
  });

  it('keeps pg_wal on its own volume', () => {
    const dataDirectory = psql('SHOW data_directory');

    expect(inContainer('readlink', `${dataDirectory}/pg_wal`)).toBe('/mnt/pg/wal');
    expect(inContainer('ls', '/mnt/pg/wal')).toMatch(/^0000000100000000/m);
    expect(inContainer('stat', '-c', '%U %a', '/mnt/pg/warm', '/mnt/pg/wal').split('\n')).toEqual(['postgres 700', 'postgres 700']);
  });

  it('serves S3 from SeaweedFS to the configured keys and refuses anything else', () => {
    const request = (user: string) =>
      execFileSync(
        'curl',
        ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--aws-sigv4', 'aws:amz:us-east-1:s3', '--user', user, '-X', 'PUT', 'http://127.0.0.1:8333/e2e-bucket'],
        { encoding: 'utf8' },
      );

    expect(request(`${S3_KEY}:${S3_SECRET}`)).toBe('200');
    expect(request('someone:else')).toBe('403');
  });
});

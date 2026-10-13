import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runStorageGenerate } from '../../src/cli/run-storage-generate.js';
import { localEnv, railwayEnv, SECRETS, type Env } from '../config/fixtures.js';

const envText = (env: Env) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('\n');

describe('storage:generate', () => {
  let directory: string;
  let stdout: string[];
  let stderr: string[];

  const run = (args: string[]) =>
    runStorageGenerate(args, { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text), env: {}, platform: 'linux' });
  const envFile = (env: Env) => {
    const path = join(directory, '.env.test');
    writeFileSync(path, envText(env));
    return path;
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pgsr-cli-'));
    stdout = [];
    stderr = [];
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('writes the files for the profile in the env file and lists them', () => {
    const out = join(directory, 'out');

    expect(run(['--env', envFile(localEnv), '--out', out])).toBe(0);

    for (const path of ['docker/Dockerfile.postgres', 'docker/init/10-tablespaces.sql', 'docker-compose.storage.yml', '.env.example.local']) {
      expect(existsSync(join(out, path)), path).toBe(true);
    }
    expect(stdout.join('')).toContain('wrote docker-compose.storage.yml');
    expect(readFileSync(join(out, 'docker/init/10-tablespaces.sql'), 'utf8')).toContain("CREATE TABLESPACE warm LOCATION '/mnt/pg/warm';");
  });

  it('writes nothing, prints every problem and exits 1 when the configuration is invalid', () => {
    const out = join(directory, 'out');

    const code = run(['--env', envFile({ ...railwayEnv, PG_MAJOR: '14', TIER_WARM_DRIVER: 'tablespace', PG_WAL_PATH: '/mnt/pg/wal' }), '--out', out]);

    expect(code).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(stderr.join('')).toContain('Invalid configuration (3 problems):');
    expect(stdout).toEqual([]);
  });

  it('never prints a secret, even when the configuration is invalid', () => {
    run(['--env', envFile({ ...localEnv, DATABASE_URL: 'mysql://u:hunter2-db@h/db', PG_MAJOR: '14' })]);

    for (const secret of SECRETS) {
      expect(stderr.join('') + stdout.join('')).not.toContain(secret);
    }
  });

  it('on railway writes only the template, prints what is unsupported and exits 0', () => {
    const out = join(directory, 'out');

    expect(run(['--env', envFile(railwayEnv), '--out', out])).toBe(0);

    expect(existsSync(join(out, '.env.example.railway'))).toBe(true);
    expect(existsSync(join(out, 'docker-compose.storage.yml'))).toBe(false);
    expect(stdout.join('')).toContain('Not available on this profile:');
  });

  it('writes just one template with --template, without needing any configuration', () => {
    const out = join(directory, 'out');

    expect(run(['--template', 'vm', '--out', out])).toBe(0);

    expect(existsSync(join(out, '.env.example.vm'))).toBe(true);
    expect(existsSync(join(out, 'docker-compose.storage.yml'))).toBe(false);
  });

  it('exits 1 and names the file when the env file cannot be read', () => {
    expect(run(['--env', join(directory, 'missing')])).toBe(1);
    expect(stderr.join('')).toMatch(/cannot read the env file .*missing/);
  });

  it('exits 2 with usage for an unknown option or an unknown profile', () => {
    expect(run(['--nope'])).toBe(2);
    expect(run(['--template', 'cloud'])).toBe(2);
    expect(stderr.join('')).toMatch(/Usage:/);
  });
});

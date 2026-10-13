import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readEnvFile } from '../../src/config/env-file.js';

describe('reading an env file', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pgsr-env-'));
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('reads values, drops comments and keeps a setting that is only a comment as empty', () => {
    const file = join(directory, '.env.local');
    writeFileSync(file, 'STORAGE_PROFILE=local   # where it runs\nTIER_WARM_HOST_PATH=     # empty means a named volume\n# nothing\nPG_MAJOR=18\n');

    expect(readEnvFile(file)).toEqual({ STORAGE_PROFILE: 'local', TIER_WARM_HOST_PATH: '', PG_MAJOR: '18' });
  });

  it('says which file is missing without printing anything from the environment', () => {
    expect(() => readEnvFile(join(directory, 'nope'))).toThrowError(/cannot read the env file .*nope/);
  });
});

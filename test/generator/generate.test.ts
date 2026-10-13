import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/load-config.js';
import { generateFiles } from '../../src/generator/generate.js';
import { localEnv, railwayEnv } from '../config/fixtures.js';

describe('what a profile generates', () => {
  it('local: the Dockerfile, the init SQL, the compose file and the env template', () => {
    const { files, notes } = generateFiles(loadConfig(localEnv));

    expect(files.map((file) => file.path)).toEqual([
      'docker/Dockerfile.postgres',
      'docker/init/10-tablespaces.sql',
      'docker-compose.storage.yml',
      '.env.example.local',
    ]);
    expect(notes).toEqual([]);
  });

  it('vm: the same files, with its own template', () => {
    const { files } = generateFiles(loadConfig({ ...localEnv, STORAGE_PROFILE: 'vm' }));

    expect(files.at(-1)?.path).toBe('.env.example.vm');
    expect(files).toHaveLength(4);
  });

  it('railway: no Docker files, only the template, and a list of what this profile cannot do', () => {
    const { files, notes } = generateFiles(loadConfig(railwayEnv));

    expect(files.map((file) => file.path)).toEqual(['.env.example.railway']);
    expect(notes).toEqual([
      'Profile railway: no Docker files are generated.',
      'Not available on this profile:',
      '  - tablespace tiers (TIER_HOT_DRIVER, TIER_WARM_DRIVER=tablespace): Railway gives each service one volume',
      '  - a separate WAL volume (PG_WAL_PATH): Railway gives each service one volume',
      '  - the bundled PostgreSQL and SeaweedFS: use Railway PostgreSQL and a Railway Bucket',
      'Hot and warm partitions stay in pg_default; the archive tier is the only one that leaves the database volume.',
    ]);
  });
});

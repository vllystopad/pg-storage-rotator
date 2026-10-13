import { describe, expect, it } from 'vitest';

import { postgresVolumeMount } from '../../src/config/pg-paths.js';

describe('where the official image keeps its data', () => {
  it('mounts the parent of the versioned directory from PostgreSQL 18 on, which is where PGDATA moved', () => {
    expect(postgresVolumeMount(18)).toBe('/var/lib/postgresql');
  });

  it('mounts the data directory itself up to PostgreSQL 17', () => {
    for (const major of [15, 16, 17] as const) {
      expect(postgresVolumeMount(major)).toBe('/var/lib/postgresql/data');
    }
  });
});

import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';

import { ENV_KEYS } from '../../src/config/env-keys.js';
import { parseConfig } from '../../src/config/load-config.js';
import { PROFILES } from '../../src/config/types.js';
import { renderEnvExample } from '../../src/generator/render-env-example.js';

describe.each(PROFILES)('the %s env template', (profile) => {
  const text = renderEnvExample(profile);
  const env = parseEnv(text);

  it('says it is generated and where it goes', () => {
    expect(text.split('\n')[0]).toMatch(/generated.*do not edit/i);
    expect(text).toMatch(/\.env\.local/);
  });

  it('mentions every setting, so a new one cannot be forgotten', () => {
    for (const key of ENV_KEYS) {
      expect(text, key).toContain(key);
    }
  });

  it('is for its own profile', () => {
    expect(env.STORAGE_PROFILE).toBe(profile);
  });

  it('is rejected as shipped for exactly the two keys that must come from the user', () => {
    const result = parseConfig(env);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.key)).toEqual(['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
  });

  it('is a valid configuration once those two keys are filled in', () => {
    expect(parseConfig({ ...env, S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' }, { platform: 'linux' }).ok).toBe(true);
  });

  it('is the same text on every run', () => {
    expect(renderEnvExample(profile)).toBe(text);
  });
});

describe('the railway template', () => {
  it('leaves the tablespace and WAL settings commented out and says why', () => {
    const text = renderEnvExample('railway');
    const env = parseEnv(text);

    expect(env.TIER_WARM_DRIVER).toBe('default');
    expect(env.PG_WAL_PATH).toBeUndefined();
    expect(text).toMatch(/not available on railway/i);
  });
});

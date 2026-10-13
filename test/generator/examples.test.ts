import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/load-config.js';
import { PROFILES } from '../../src/config/types.js';
import { generateFiles } from '../../src/generator/generate.js';
import { renderEnvExample } from '../../src/generator/render-env-example.js';

// examples/<profile>/ is what the generator produces for that profile's template with throwaway keys.
// Review a change to the generator by reading the diff of those files; update them with `vitest -u`.
describe.each(PROFILES)('examples/%s', (profile) => {
  const env = { ...parseEnv(renderEnvExample(profile)), S3_ACCESS_KEY_ID: 'example-access-key', S3_SECRET_ACCESS_KEY: 'example-secret-key' };
  const { files } = generateFiles(loadConfig(env, { platform: 'linux' }));

  it.each(files.map((file) => [file.path, file.content] as const))('%s matches the committed example', async (path, content) => {
    await expect(content).toMatchFileSnapshot(`../../examples/${profile}/${path}`);
  });
});

describe('the env templates at the repository root', () => {
  it.each(PROFILES)('.env.example.%s is what the generator writes today', (profile) => {
    expect(readFileSync(new URL(`../../.env.example.${profile}`, import.meta.url), 'utf8')).toBe(renderEnvExample(profile));
  });
});

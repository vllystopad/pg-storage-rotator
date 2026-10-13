import { ENV_KEYS, keyOrder, POLICED_PREFIXES } from './env-keys.js';
import { ConfigError, type ConfigIssue } from './errors.js';
import { readFields, type EnvSource, type Fields, type TierFields } from './fields.js';
import { checkFields } from './rules.js';
import type { Config, TableTier } from './types.js';

export type ParseResult = { ok: true; config: Config } | { ok: false; issues: ConfigIssue[] };

export interface ParseOptions {
  platform?: NodeJS.Platform;
}

const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row.push(Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
};

const unknownSettings = (env: EnvSource): ConfigIssue[] =>
  Object.keys(env)
    .filter((key) => env[key] !== undefined)
    .filter((key) => POLICED_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .filter((key) => !(ENV_KEYS as readonly string[]).includes(key))
    .map((key) => {
      const closest = [...ENV_KEYS].sort((a, b) => editDistance(key, a) - editDistance(key, b))[0];
      const near = closest !== undefined && editDistance(key, closest) <= 2;
      return { key, message: near ? `unknown setting, did you mean ${closest}?` : 'unknown setting' };
    });

const must = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error('a setting that passed validation is missing');
  }
  return value;
};

const buildTier = (tier: TierFields): TableTier =>
  tier.driver === 'tablespace'
    ? { driver: 'tablespace', name: must(tier.name), path: must(tier.path), hostPath: tier.hostPath }
    : { driver: 'default' };

const buildConfig = (fields: Fields): Config => ({
  profile: must(fields.profile),
  databaseUrl: must(fields.databaseUrl),
  pgMajor: fields.pgMajor,
  tiers: {
    hot: buildTier(fields.hot),
    warm: buildTier(fields.warm),
    archive: { driver: 's3', bucket: must(fields.archiveBucket), prefix: fields.archivePrefix },
  },
  wal: fields.walPath === undefined ? undefined : { path: fields.walPath, hostPath: fields.walHostPath },
  s3: {
    endpoint: fields.s3Endpoint,
    region: fields.s3Region,
    accessKeyId: must(fields.s3AccessKeyId),
    secretAccessKey: must(fields.s3SecretAccessKey),
  },
  policies: must(fields.policies),
  dryRun: fields.dryRun,
});

export const parseConfig = (env: EnvSource, options: ParseOptions = {}): ParseResult => {
  const issues: ConfigIssue[] = [];
  const report = (key: string, message: string) => issues.push({ key, message });

  const fields = readFields(env, issues);
  checkFields(fields, { platform: options.platform ?? process.platform }, report);
  issues.push(...unknownSettings(env));

  if (issues.length > 0) {
    return { ok: false, issues: issues.sort((a, b) => keyOrder(a.key) - keyOrder(b.key)) };
  }
  return { ok: true, config: buildConfig(fields) };
};

export const loadConfig = (env: EnvSource, options: ParseOptions = {}): Config => {
  const result = parseConfig(env, options);
  if (!result.ok) {
    throw new ConfigError(result.issues);
  }
  return result.config;
};

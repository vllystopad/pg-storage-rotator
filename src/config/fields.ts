import { z } from 'zod';

import type { EnvKey } from './env-keys.js';
import type { ConfigIssue } from './errors.js';
import { parseRotationPolicies } from './rotation-policy.js';
import { PG_MAJORS, PROFILES, type PgMajor, type Profile, type RotationPolicy } from './types.js';

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface TierFields {
  driver: 'default' | 'tablespace' | undefined;
  name: string | undefined;
  path: string | undefined;
  hostPath: string | undefined;
}

// Every value that could be read on its own. A setting that failed to parse is undefined here and has
// already produced an issue, so the cross-setting rules can skip it instead of reporting it twice.
export interface Fields {
  profile: Profile | undefined;
  forbidBindMounts: boolean;
  databaseUrl: string | undefined;
  pgMajor: PgMajor;
  hot: TierFields;
  warm: TierFields;
  walPath: string | undefined;
  walHostPath: string | undefined;
  archiveBucket: string | undefined;
  archivePrefix: string;
  s3Endpoint: string | undefined;
  s3Region: string;
  s3AccessKeyId: string | undefined;
  s3SecretAccessKey: string | undefined;
  policies: RotationPolicy[] | undefined;
  dryRun: boolean;
}

const parsedUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

const profile = z.enum(PROFILES, { error: `must be one of: ${PROFILES.join(', ')}` });
const boolean = z.enum(['true', 'false'], { error: 'must be true or false' }).transform((value) => value === 'true');
const pgMajor = z
  .enum(
    PG_MAJORS.map(String),
    { error: `must be ${PG_MAJORS.slice(0, -1).join(', ')} or ${PG_MAJORS[PG_MAJORS.length - 1]}` },
  )
  .transform((value) => Number(value) as PgMajor);
const tierDriver = z.enum(['default', 'tablespace'], { error: 'must be one of: default, tablespace' });
const archiveDriver = z.enum(['s3'], { error: 'must be s3' });
const databaseUrl = z.string().refine(
  (value) => {
    const url = parsedUrl(value);
    return url !== undefined && ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname !== '';
  },
  { error: 'must be a postgres:// or postgresql:// URL' },
);
const bucket = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { error: 'must be an S3 bucket name: 3 to 63 lowercase letters, digits, dots or dashes' });
const prefix = z
  .string()
  .refine((value) => /^[A-Za-z0-9._/-]*$/.test(value) && !value.startsWith('/') && !value.split('/').includes('..'), {
    error: 'must be a key prefix such as archive/ without a leading slash or ..',
  })
  .transform((value) => value.replace(/\/+$/, ''));
const endpoint = z
  .string()
  .refine((value) => ['http:', 'https:'].includes(parsedUrl(value)?.protocol ?? ''), { error: 'must be an http:// or https:// URL' })
  .refine((value) => {
    const url = parsedUrl(value);
    return url === undefined || (url.username === '' && url.password === '');
  }, { error: 'must not contain credentials: put them in S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY' });

const blank = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

export const readFields = (env: EnvSource, issues: ConfigIssue[]): Fields => {
  const read = <T>(key: EnvKey, schema: z.ZodType<T>, fallback?: T, hint?: string): T | undefined => {
    const value = blank(env[key]);
    if (value === undefined) {
      if (fallback === undefined) {
        issues.push({ key, message: hint === undefined ? 'is required' : `is required (${hint})` });
      }
      return fallback;
    }
    const result = schema.safeParse(value);
    if (!result.success) {
      issues.push({ key, message: result.error.issues[0]?.message ?? 'is not valid' });
      return undefined;
    }
    return result.data;
  };
  const optional = <T>(key: EnvKey, schema: z.ZodType<T>): T | undefined =>
    blank(env[key]) === undefined ? undefined : read(key, schema);
  const text = (key: EnvKey): string | undefined => blank(env[key]);

  const tier = (label: 'HOT' | 'WARM'): TierFields => ({
    driver: read(`TIER_${label}_DRIVER`, tierDriver, 'default'),
    name: text(`TIER_${label}_NAME`),
    path: text(`TIER_${label}_PATH`),
    hostPath: text(`TIER_${label}_HOST_PATH`),
  });

  const rawPolicies = blank(env.ROTATION_POLICIES);
  const parsedPolicies = parseRotationPolicies(rawPolicies ?? '');
  for (const problem of parsedPolicies.problems) {
    issues.push({ key: 'ROTATION_POLICIES', message: problem });
  }

  read('TIER_ARCHIVE_DRIVER', archiveDriver, 's3');

  return {
    profile: read('STORAGE_PROFILE', profile, undefined, `one of: ${PROFILES.join(', ')}`),
    forbidBindMounts: read('STORAGE_FORBID_BIND_MOUNTS', boolean, false) ?? false,
    databaseUrl: read('DATABASE_URL', databaseUrl, undefined, 'a postgres:// or postgresql:// URL'),
    pgMajor: read('PG_MAJOR', pgMajor, 18 as PgMajor) ?? 18,
    hot: tier('HOT'),
    warm: tier('WARM'),
    walPath: text('PG_WAL_PATH'),
    walHostPath: text('PG_WAL_HOST_PATH'),
    archiveBucket: optional('TIER_ARCHIVE_BUCKET', bucket),
    archivePrefix: optional('TIER_ARCHIVE_PREFIX', prefix) ?? '',
    s3Endpoint: optional('S3_ENDPOINT', endpoint),
    s3Region: text('S3_REGION') ?? 'auto',
    s3AccessKeyId: text('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: text('S3_SECRET_ACCESS_KEY'),
    policies: parsedPolicies.problems.length === 0 ? parsedPolicies.policies : undefined,
    dryRun: read('ROTATION_DRY_RUN', boolean, false) ?? false,
  };
};

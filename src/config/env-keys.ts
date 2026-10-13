// The order is the order problems are reported in, so a long list reads top to bottom like the template.
export const ENV_KEYS = [
  'STORAGE_PROFILE',
  'STORAGE_FORBID_BIND_MOUNTS',
  'DATABASE_URL',
  'PG_MAJOR',
  'TIER_HOT_DRIVER',
  'TIER_HOT_NAME',
  'TIER_HOT_PATH',
  'TIER_HOT_HOST_PATH',
  'TIER_WARM_DRIVER',
  'TIER_WARM_NAME',
  'TIER_WARM_PATH',
  'TIER_WARM_HOST_PATH',
  'PG_WAL_PATH',
  'PG_WAL_HOST_PATH',
  'TIER_ARCHIVE_DRIVER',
  'TIER_ARCHIVE_BUCKET',
  'TIER_ARCHIVE_PREFIX',
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'ROTATION_POLICIES',
  'ROTATION_DRY_RUN',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

// Only these prefixes are policed: PG_ and S3_ are names other tools use too, so an unknown one is not ours to judge.
export const POLICED_PREFIXES = ['TIER_', 'ROTATION_', 'STORAGE_'] as const;

export const keyOrder = (key: string): number => {
  const index = (ENV_KEYS as readonly string[]).indexOf(key);
  return index === -1 ? ENV_KEYS.length : index;
};

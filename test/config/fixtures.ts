export type Env = Record<string, string | undefined>;

export const localEnv: Env = {
  STORAGE_PROFILE: 'local',
  DATABASE_URL: 'postgres://rotator:hunter2-db@localhost:5432/app',
  PG_MAJOR: '18',
  TIER_HOT_DRIVER: 'default',
  TIER_WARM_DRIVER: 'tablespace',
  TIER_WARM_NAME: 'warm',
  TIER_WARM_PATH: '/mnt/pg/warm',
  TIER_WARM_HOST_PATH: '',
  PG_WAL_PATH: '/mnt/pg/wal',
  PG_WAL_HOST_PATH: '',
  TIER_ARCHIVE_DRIVER: 's3',
  TIER_ARCHIVE_BUCKET: 'pg-archive',
  TIER_ARCHIVE_PREFIX: '',
  S3_ENDPOINT: 'http://seaweedfs:8333',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'AKIAFAKEKEY',
  S3_SECRET_ACCESS_KEY: 'hunter2-s3',
  ROTATION_POLICIES: 'events:month:hot=3,warm=12,archive=36',
  ROTATION_DRY_RUN: 'false',
};

export const railwayEnv: Env = {
  STORAGE_PROFILE: 'railway',
  DATABASE_URL: 'postgres://postgres:hunter2-db@postgres.railway.internal:5432/railway',
  PG_MAJOR: '18',
  TIER_HOT_DRIVER: 'default',
  TIER_WARM_DRIVER: 'default',
  TIER_ARCHIVE_DRIVER: 's3',
  TIER_ARCHIVE_BUCKET: 'pg-archive',
  S3_ENDPOINT: 'https://storage.railway.app',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'AKIAFAKEKEY',
  S3_SECRET_ACCESS_KEY: 'hunter2-s3',
  ROTATION_POLICIES: 'events:month:hot=3,warm=12,archive=36',
};

export const SECRETS = ['hunter2-db', 'hunter2-s3'];

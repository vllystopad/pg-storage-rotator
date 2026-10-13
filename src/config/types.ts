export const PROFILES = ['local', 'vm', 'railway'] as const;
export type Profile = (typeof PROFILES)[number];

export const PG_MAJORS = [15, 16, 17, 18] as const;
export type PgMajor = (typeof PG_MAJORS)[number];

export const TIERS = ['hot', 'warm', 'archive'] as const;
export type TierName = (typeof TIERS)[number];

export const INTERVALS = ['day', 'week', 'month', 'year'] as const;
export type Interval = (typeof INTERVALS)[number];

export interface PolicyStage {
  tier: TierName;
  age: number;
}

export interface RotationPolicy {
  table: string;
  interval: Interval;
  stages: PolicyStage[];
}

export interface DefaultTier {
  driver: 'default';
}

export interface TablespaceTier {
  driver: 'tablespace';
  name: string;
  path: string;
  hostPath: string | undefined;
}

export type TableTier = DefaultTier | TablespaceTier;

export interface ArchiveTier {
  driver: 's3';
  bucket: string;
  prefix: string;
}

export interface WalLayout {
  path: string;
  hostPath: string | undefined;
}

export interface S3Settings {
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Config {
  profile: Profile;
  databaseUrl: string;
  pgMajor: PgMajor;
  tiers: {
    hot: TableTier;
    warm: TableTier;
    archive: ArchiveTier;
  };
  wal: WalLayout | undefined;
  s3: S3Settings;
  policies: RotationPolicy[];
  dryRun: boolean;
}

import { BUNDLED_S3_HOST } from '../config/bundled-s3.js';
import { postgresVolumeMount } from '../config/pg-paths.js';
import type { Config, Profile } from '../config/types.js';

export interface PlannedMount {
  volume: string;
  target: string;
  hostPath: string | undefined;
}

export interface StoragePlan {
  profile: Profile;
  image: string;
  mounts: PlannedMount[];
  tablespaces: { name: string; path: string }[];
  walDir: string | undefined;
  seaweedfs: { port: number } | undefined;
}

const seaweedfsPort = (endpoint: string | undefined): number | undefined => {
  if (endpoint === undefined) {
    return undefined;
  }
  const url = new URL(endpoint);
  if (url.hostname !== BUNDLED_S3_HOST) {
    return undefined;
  }
  return url.port === '' ? 80 : Number(url.port);
};

export const planStorage = (config: Config): StoragePlan => {
  const tablespaces: StoragePlan['tablespaces'] = [];
  const mounts: PlannedMount[] = [
    { volume: 'pg_data', target: postgresVolumeMount(config.pgMajor), hostPath: undefined },
  ];

  for (const [label, tier] of [['hot', config.tiers.hot], ['warm', config.tiers.warm]] as const) {
    if (tier.driver === 'tablespace') {
      tablespaces.push({ name: tier.name, path: tier.path });
      mounts.push({ volume: `pg_${label}`, target: tier.path, hostPath: tier.hostPath });
    }
  }
  if (config.wal) {
    mounts.push({ volume: 'pg_wal', target: config.wal.path, hostPath: config.wal.hostPath });
  }

  const port = seaweedfsPort(config.s3.endpoint);
  return {
    profile: config.profile,
    image: `postgres:${config.pgMajor}`,
    mounts,
    tablespaces,
    walDir: config.wal?.path,
    seaweedfs: port === undefined ? undefined : { port },
  };
};

import type { EnvKey } from './env-keys.js';
import type { Fields, TierFields } from './fields.js';

export type Report = (key: string, message: string) => void;

export interface RuleContext {
  platform: NodeJS.Platform;
}

const POSTGRES_DATA_ROOT = '/var/lib/postgresql';
const TABLESPACE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const RAILWAY_ONE_VOLUME = 'Railway gives each service one volume';

const containerPathProblem = (path: string): string | undefined => {
  if (!path.startsWith('/')) {
    return 'must be an absolute path inside the database container, starting with /';
  }
  if (path === '/') {
    return 'must be an absolute path with at least one directory';
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) {
    return 'may only contain letters, digits, dots, dashes, underscores and slashes';
  }
  if (path.slice(1).split('/').some((segment) => ['', '.', '..'].includes(segment))) {
    return 'must be a normalised path: no .., ., trailing slash or repeated slashes';
  }
  if (path === POSTGRES_DATA_ROOT || path.startsWith(`${POSTGRES_DATA_ROOT}/`)) {
    return `must be outside the PostgreSQL data volume (${POSTGRES_DATA_ROOT})`;
  }
  return undefined;
};

const hostPathProblem = (path: string): string | undefined => {
  if (!path.startsWith('/')) {
    return 'must be an absolute path on the host, starting with /';
  }
  if (path.split('/').includes('..')) {
    return 'must not contain ..';
  }
  return undefined;
};

interface Placed {
  key: string;
  value: string;
}

const overlap = (placed: Placed[], key: string, path: string, report: Report): void => {
  const clash = placed.find((other) => other.value === path);
  const parent = placed.find((other) => path.startsWith(`${other.value}/`));
  const child = placed.find((other) => other.value.startsWith(`${path}/`));
  if (clash) {
    report(key, `is already used by ${clash.key}`);
  } else if (parent) {
    report(key, `is inside ${parent.key}, so two volumes would be nested`);
  } else if (child) {
    report(key, `contains ${child.key}, so two volumes would be nested`);
  }
  placed.push({ key, value: path });
};

const checkTier = (
  label: 'HOT' | 'WARM',
  tier: TierFields,
  fields: Fields,
  context: RuleContext,
  placed: { containers: Placed[]; hosts: Placed[]; names: Placed[] },
  report: Report,
): void => {
  const key = (part: string) => `TIER_${label}_${part}` as EnvKey;
  const driverKey = key('DRIVER');

  if (fields.profile === 'railway' && tier.driver === 'tablespace') {
    report(driverKey, `'tablespace' is not available on profile railway: ${RAILWAY_ONE_VOLUME}. Use ${driverKey}=default.`);
    return;
  }

  if (tier.driver === 'default') {
    for (const part of ['NAME', 'PATH', 'HOST_PATH'] as const) {
      const value = { NAME: tier.name, PATH: tier.path, HOST_PATH: tier.hostPath }[part];
      if (value !== undefined) {
        report(key(part), `is set, but ${driverKey} is default, so it would be ignored. Set ${driverKey}=tablespace or remove it.`);
      }
    }
    return;
  }
  if (tier.driver !== 'tablespace') {
    return;
  }

  if (tier.name === undefined) {
    report(key('NAME'), `is required when ${driverKey}=tablespace`);
  } else if (!TABLESPACE_NAME.test(tier.name) || tier.name.startsWith('pg_')) {
    report(key('NAME'), 'must be a tablespace name: lowercase letters, digits and underscores, not starting with a digit or pg_');
  } else {
    const clash = placed.names.find((other) => other.value === tier.name);
    if (clash) {
      report(key('NAME'), `is already used by ${clash.key}`);
    }
    placed.names.push({ key: key('NAME'), value: tier.name });
  }

  if (tier.path === undefined) {
    report(key('PATH'), `is required when ${driverKey}=tablespace`);
  } else {
    const problem = containerPathProblem(tier.path);
    if (problem) {
      report(key('PATH'), problem);
    } else {
      overlap(placed.containers, key('PATH'), tier.path, report);
    }
  }

  if (tier.hostPath !== undefined) {
    checkHostPath(key('HOST_PATH'), tier.hostPath, fields, context, placed.hosts, report);
  }
};

const checkHostPath = (
  key: EnvKey,
  hostPath: string,
  fields: Fields,
  context: RuleContext,
  hosts: Placed[],
  report: Report,
): void => {
  if (context.platform === 'win32') {
    report(key, `bind mounts are not available on Windows: NTFS cannot hold the file permissions PostgreSQL needs. Leave ${key} empty to use a named volume.`);
    return;
  }
  if (fields.forbidBindMounts) {
    report(key, `bind mounts are switched off by STORAGE_FORBID_BIND_MOUNTS. Leave ${key} empty to use a named volume.`);
    return;
  }
  const problem = hostPathProblem(hostPath);
  if (problem) {
    report(key, problem);
    return;
  }
  const clash = hosts.find((other) => other.value === hostPath);
  if (clash) {
    report(key, `is already used by ${clash.key}`);
  }
  hosts.push({ key, value: hostPath });
};

const checkWal = (
  fields: Fields,
  context: RuleContext,
  placed: { containers: Placed[]; hosts: Placed[] },
  report: Report,
): void => {
  if (fields.profile === 'railway' && fields.walPath !== undefined) {
    report('PG_WAL_PATH', `a separate WAL volume is not available on profile railway: ${RAILWAY_ONE_VOLUME}. Remove PG_WAL_PATH.`);
    return;
  }
  if (fields.walPath === undefined) {
    if (fields.walHostPath !== undefined) {
      report('PG_WAL_HOST_PATH', 'needs PG_WAL_PATH: it is the folder inside the container the host folder is mounted on');
    }
    return;
  }
  const problem = containerPathProblem(fields.walPath);
  if (problem) {
    report('PG_WAL_PATH', problem);
  } else {
    overlap(placed.containers, 'PG_WAL_PATH', fields.walPath, report);
  }
  if (fields.walHostPath !== undefined) {
    checkHostPath('PG_WAL_HOST_PATH', fields.walHostPath, fields, context, placed.hosts, report);
  }
};

const checkArchive = (fields: Fields, report: Report): void => {
  const required = 'is required when TIER_ARCHIVE_DRIVER=s3';
  if (fields.archiveBucket === undefined) {
    report('TIER_ARCHIVE_BUCKET', required);
  }
  if (fields.s3AccessKeyId === undefined) {
    report('S3_ACCESS_KEY_ID', required);
  }
  if (fields.s3SecretAccessKey === undefined) {
    report('S3_SECRET_ACCESS_KEY', required);
  }
};

export const checkFields = (fields: Fields, context: RuleContext, report: Report): void => {
  const placed = { containers: [] as Placed[], hosts: [] as Placed[], names: [] as Placed[] };
  checkTier('HOT', fields.hot, fields, context, placed, report);
  checkTier('WARM', fields.warm, fields, context, placed, report);
  checkWal(fields, context, placed, report);
  checkArchive(fields, report);
};

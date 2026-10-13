import { stringify } from 'yaml';

import { generatedHeader } from './header.js';
import type { PlannedMount, StoragePlan } from './plan.js';

// Pinned, not "latest": the S3 behaviour the rotator is tested against must not change under a clone.
const SEAWEEDFS_IMAGE = 'chrislusf/seaweedfs:4.48';

const mountEntry = (mount: PlannedMount) =>
  mount.hostPath === undefined
    ? `${mount.volume}:${mount.target}`
    : { type: 'bind', source: mount.hostPath, target: mount.target };

const required = (name: string) => `\${${name}:?set ${name} in the env file}`;

const postgresService = (plan: StoragePlan) => ({
  profiles: ['demo'],
  build: { context: '.', dockerfile: 'docker/Dockerfile.postgres' },
  image: `pg-storage-rotator-${plan.image.replace(':', '-')}`,
  environment: {
    POSTGRES_USER: '${POSTGRES_USER:-postgres}',
    POSTGRES_PASSWORD: required('POSTGRES_PASSWORD'),
    POSTGRES_DB: '${POSTGRES_DB:-postgres}',
    ...(plan.walDir === undefined ? {} : { POSTGRES_INITDB_WALDIR: plan.walDir }),
  },
  ports: ['127.0.0.1:${POSTGRES_PORT:-5432}:5432'],
  volumes: plan.mounts.map(mountEntry),
  healthcheck: {
    test: ['CMD-SHELL', 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'],
    interval: '5s',
    timeout: '3s',
    retries: 12,
    start_period: '10s',
  },
});

const seaweedfsService = (port: number) => ({
  image: SEAWEEDFS_IMAGE,
  command: `server -s3 ${port === 8333 ? '' : `-s3.port=${port} `}-dir=/data -ip.bind=0.0.0.0`,
  environment: {
    AWS_ACCESS_KEY_ID: required('S3_ACCESS_KEY_ID'),
    AWS_SECRET_ACCESS_KEY: required('S3_SECRET_ACCESS_KEY'),
  },
  ports: [`127.0.0.1:${port}:${port}`],
  volumes: ['seaweedfs_data:/data'],
  healthcheck: {
    test: ['CMD-SHELL', `wget -q --spider http://127.0.0.1:${port}/status`],
    interval: '5s',
    timeout: '3s',
    retries: 12,
    start_period: '10s',
  },
});

export const renderCompose = (plan: StoragePlan): string => {
  const namedVolumes = [
    ...plan.mounts.filter((mount) => mount.hostPath === undefined).map((mount) => mount.volume),
    ...(plan.seaweedfs ? ['seaweedfs_data'] : []),
  ];
  const document = {
    services: {
      postgres: postgresService(plan),
      ...(plan.seaweedfs ? { seaweedfs: seaweedfsService(plan.seaweedfs.port) } : {}),
    },
    volumes: Object.fromEntries(namedVolumes.map((name) => [name, {}])),
  };

  return [
    generatedHeader('#', plan.profile),
    '# Bundled PostgreSQL: docker compose --env-file .env.local -f docker-compose.storage.yml --profile demo up -d --build',
    '# To use your own database, leave out --profile demo and point DATABASE_URL at it.',
    '',
    stringify(document, { lineWidth: 0 }),
  ].join('\n');
};

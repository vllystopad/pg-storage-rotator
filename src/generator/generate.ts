import type { Config } from '../config/types.js';
import { planStorage } from './plan.js';
import { renderCompose } from './render-compose.js';
import { renderDockerfile } from './render-dockerfile.js';
import { renderEnvExample } from './render-env-example.js';
import { renderTablespacesSql } from './render-tablespaces-sql.js';

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface Generation {
  files: GeneratedFile[];
  notes: string[];
}

const RAILWAY_ONE_VOLUME = 'Railway gives each service one volume';

export const generateFiles = (config: Config): Generation => {
  const envExample: GeneratedFile = { path: `.env.example.${config.profile}`, content: renderEnvExample(config.profile) };

  if (config.profile === 'railway') {
    return {
      files: [envExample],
      notes: [
        'Profile railway: no Docker files are generated.',
        'Not available on this profile:',
        `  - tablespace tiers (TIER_HOT_DRIVER, TIER_WARM_DRIVER=tablespace): ${RAILWAY_ONE_VOLUME}`,
        `  - a separate WAL volume (PG_WAL_PATH): ${RAILWAY_ONE_VOLUME}`,
        '  - the bundled PostgreSQL and SeaweedFS: use Railway PostgreSQL and a Railway Bucket',
        'Hot and warm partitions stay in pg_default; the archive tier is the only one that leaves the database volume.',
      ],
    };
  }

  const plan = planStorage(config);
  return {
    files: [
      { path: 'docker/Dockerfile.postgres', content: renderDockerfile(plan) },
      { path: 'docker/init/10-tablespaces.sql', content: renderTablespacesSql(plan) },
      { path: 'docker-compose.storage.yml', content: renderCompose(plan) },
      envExample,
    ],
    notes: [],
  };
};

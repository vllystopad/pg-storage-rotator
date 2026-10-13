import { generatedHeader } from './header.js';
import type { StoragePlan } from './plan.js';

export const renderDockerfile = (plan: StoragePlan): string => {
  const directories = [...plan.tablespaces.map((tablespace) => tablespace.path), ...(plan.walDir ? [plan.walDir] : [])];
  const lines = [generatedHeader('#', plan.profile), '', `FROM ${plan.image}`, ''];

  if (directories.length > 0) {
    lines.push(
      '# These directories exist and belong to postgres before any volume is mounted on them, so a new',
      '# named volume inherits that owner on first use.',
      `RUN install -d -o postgres -g postgres -m 700 ${directories.join(' ')}`,
      '',
    );
  }
  lines.push('COPY --chown=postgres:postgres docker/init/ /docker-entrypoint-initdb.d/', '');
  return lines.join('\n');
};

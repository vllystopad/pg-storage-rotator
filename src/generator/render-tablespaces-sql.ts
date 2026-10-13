import { generatedHeader } from './header.js';
import type { StoragePlan } from './plan.js';

export const renderTablespacesSql = (plan: StoragePlan): string =>
  [
    generatedHeader('--', plan.profile),
    '-- Runs once, when the data volume is first initialised. Adding a tablespace to a running cluster is an',
    '-- explicit admin step, not part of generation.',
    '',
    ...(plan.tablespaces.length === 0
      ? ['-- no tablespace tiers are configured.']
      : plan.tablespaces.map((tablespace) => `CREATE TABLESPACE ${tablespace.name} LOCATION '${tablespace.path}';`)),
    '',
  ].join('\n');

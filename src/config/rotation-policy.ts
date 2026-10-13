import { INTERVALS, TIERS, type Interval, type PolicyStage, type RotationPolicy, type TierName } from './types.js';

const TABLE_NAME = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
const WHOLE_NUMBER = /^[1-9][0-9]*$/;
const SHAPE = 'table:interval:hot=3,warm=12,archive=36';

export interface ParsedPolicies {
  policies: RotationPolicy[];
  problems: string[];
}

const isInterval = (value: string): value is Interval => (INTERVALS as readonly string[]).includes(value);
const isTier = (value: string): value is TierName => (TIERS as readonly string[]).includes(value);

const parseStages = (table: string, text: string, problems: string[]): PolicyStage[] => {
  const seen = new Map<TierName, number | undefined>();
  for (const part of text.split(',')) {
    const [tier = '', age = ''] = part.trim().split('=');
    if (!isTier(tier)) {
      problems.push(`${table}: tier "${tier}" must be one of ${TIERS.join(', ')}`);
    } else if (seen.has(tier)) {
      problems.push(`${table}: tier "${tier}" is given more than once`);
    } else if (!WHOLE_NUMBER.test(age.trim())) {
      problems.push(`${table}: the age of ${tier} must be a whole number above zero`);
      seen.set(tier, undefined);
    } else {
      seen.set(tier, Number(age));
    }
  }

  const stages = TIERS.flatMap((tier) => {
    const age = seen.get(tier);
    return age === undefined ? [] : [{ tier, age }];
  });

  if (!seen.has('hot')) {
    problems.push(`${table}: the hot tier is required`);
  }
  if (!seen.has('archive')) {
    problems.push(`${table}: the archive tier is required, because a partition would otherwise be dropped without a copy`);
  }
  // Skipped when an age was malformed: the ordering of the remaining ages would only add noise.
  if (stages.length === seen.size) {
    stages.forEach((stage, index) => {
      const before = stages[index - 1];
      if (before && stage.age <= before.age) {
        problems.push(
          `${table}: ages must increase from hot to archive, but ${stage.tier}=${stage.age} is not above ${before.tier}=${before.age}`,
        );
      }
    });
  }
  return stages;
};

export const parseRotationPolicies = (value: string): ParsedPolicies => {
  const segments = value
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  const problems: string[] = [];
  const policies: RotationPolicy[] = [];

  if (segments.length === 0) {
    return {
      policies,
      problems: ['at least one policy is required, for example events:month:hot=3,warm=12,archive=36'],
    };
  }

  for (const segment of segments) {
    const [table = '', interval = '', ...rest] = segment.split(':');
    if (rest.length !== 1) {
      problems.push(`"${segment}" must look like ${SHAPE}`);
      continue;
    }
    if (!TABLE_NAME.test(table)) {
      problems.push(`"${table}" must be a lowercase table name, optionally schema.table`);
      continue;
    }
    if (policies.some((policy) => policy.table === table)) {
      problems.push(`${table}: has more than one policy`);
      continue;
    }
    if (!isInterval(interval)) {
      problems.push(`${table}: interval "${interval}" must be one of ${INTERVALS.join(', ')}`);
    }
    const before = problems.length;
    const stages = parseStages(table, rest[0] ?? '', problems);
    if (isInterval(interval) && problems.length === before) {
      policies.push({ table, interval, stages });
    }
  }
  return { policies, problems };
};

import { describe, expect, it } from 'vitest';

import { parseRotationPolicies } from '../../src/config/rotation-policy.js';

const ok = (value: string) => {
  const result = parseRotationPolicies(value);
  expect(result.problems).toEqual([]);
  return result.policies;
};

const problems = (value: string) => parseRotationPolicies(value).problems;

describe('ROTATION_POLICIES', () => {
  it('reads a table, its partition interval and the age at which a partition leaves each tier', () => {
    expect(ok('events:month:hot=3,warm=12,archive=36')).toEqual([
      {
        table: 'events',
        interval: 'month',
        stages: [
          { tier: 'hot', age: 3 },
          { tier: 'warm', age: 12 },
          { tier: 'archive', age: 36 },
        ],
      },
    ]);
  });

  it('reads several policies separated by semicolons, ignoring spaces and a trailing semicolon', () => {
    const policies = ok(' events:month:hot=3,archive=12 ; app.audit_log:day:hot=7,warm=30,archive=90; ');

    expect(policies.map((policy) => [policy.table, policy.interval])).toEqual([
      ['events', 'month'],
      ['app.audit_log', 'day'],
    ]);
  });

  it('allows a policy without a warm tier', () => {
    expect(ok('events:year:hot=1,archive=7')[0]?.stages.map((stage) => stage.tier)).toEqual(['hot', 'archive']);
  });

  it('puts the tiers in order whatever order they were written in', () => {
    expect(ok('events:month:archive=36,hot=3,warm=12')[0]?.stages.map((stage) => stage.tier)).toEqual([
      'hot',
      'warm',
      'archive',
    ]);
  });

  it('accepts day, week, month and year', () => {
    for (const interval of ['day', 'week', 'month', 'year']) {
      expect(ok(`events:${interval}:hot=1,archive=2`)[0]?.interval).toBe(interval);
    }
  });

  describe('is rejected, with what to change, when', () => {
    it('it is empty', () => {
      expect(problems('')).toEqual(['at least one policy is required, for example events:month:hot=3,warm=12,archive=36']);
    });

    it('a policy is not table:interval:tiers', () => {
      expect(problems('events:month')).toEqual(['"events:month" must look like table:interval:hot=3,warm=12,archive=36']);
    });

    it('the interval is unknown', () => {
      expect(problems('events:fortnight:hot=1,archive=2')).toEqual([
        'events: interval "fortnight" must be one of day, week, month, year',
      ]);
    });

    it('a tier is unknown', () => {
      expect(problems('events:month:hot=1,cold=2,archive=3')).toEqual([
        'events: tier "cold" must be one of hot, warm, archive',
      ]);
    });

    it('an age is not a whole number above zero', () => {
      for (const age of ['0', '-1', '1.5', 'abc', '']) {
        expect(problems(`events:month:hot=${age},archive=12`)).toEqual([
          `events: the age of hot must be a whole number above zero`,
        ]);
      }
    });

    it('ages do not increase from hot to archive', () => {
      expect(problems('events:month:hot=12,warm=3,archive=36')).toEqual([
        'events: ages must increase from hot to archive, but warm=3 is not above hot=12',
      ]);
      expect(problems('events:month:hot=3,archive=3')).toEqual([
        'events: ages must increase from hot to archive, but archive=3 is not above hot=3',
      ]);
    });

    it('hot is missing', () => {
      expect(problems('events:month:warm=3,archive=12')).toEqual(['events: the hot tier is required']);
    });

    it('archive is missing, because dropping a partition without a copy cannot be undone', () => {
      expect(problems('events:month:hot=3,warm=12')).toEqual([
        'events: the archive tier is required, because a partition would otherwise be dropped without a copy',
      ]);
    });

    it('a tier is written twice', () => {
      expect(problems('events:month:hot=1,hot=2,archive=3')).toEqual(['events: tier "hot" is given more than once']);
    });

    it('a table has two policies', () => {
      expect(problems('events:month:hot=1,archive=2;events:day:hot=1,archive=2')).toEqual([
        'events: has more than one policy',
      ]);
    });

    it('a table name is not a plain lowercase identifier, which also keeps it out of generated SQL', () => {
      for (const table of ['Events', 'events$x', 'ev"ents', "ev'ents", 'a.b.c', '1events', 'events-2026']) {
        expect(problems(`${table}:month:hot=1,archive=2`)).toEqual([
          `"${table}" must be a lowercase table name, optionally schema.table`,
        ]);
      }
    });

    it('several things are wrong, all are reported at once', () => {
      expect(problems('events:fortnight:hot=0;Logs:day:hot=1,archive=2')).toHaveLength(4);
    });
  });
});

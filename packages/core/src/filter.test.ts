import { describe, expect, it } from 'vitest';
import { filterAccepts, type Filter } from './filter.js';
import { renderVerdict } from './triage.js';

const severeBugs: Filter = { types: ['bug'], minimumSeverity: 'major' };
const allOpinions: Filter = { types: ['opinion'], minimumSeverity: null };

describe('A Destination’s Filter', () => {
  it('turned off, accepts no Feedback', () => {
    expect(filterAccepts(null, { resolvedType: 'bug', severity: 'blocking' })).toBe(false);
  });

  it('accepts a Feedback of an accepted Type whose Severity reaches the minimum Severity', () => {
    expect(filterAccepts(severeBugs, { resolvedType: 'bug', severity: 'major' })).toBe(true);
    expect(filterAccepts(severeBugs, { resolvedType: 'bug', severity: 'blocking' })).toBe(true);
  });

  it('accepts neither a Feedback less severe than the minimum Severity, nor one of another Type', () => {
    expect(filterAccepts(severeBugs, { resolvedType: 'bug', severity: 'minor' })).toBe(false);
    expect(filterAccepts(severeBugs, { resolvedType: 'opinion', severity: 'blocking' })).toBe(
      false,
    );
  });

  it('degraded mode: a Filter with a minimum Severity does not accept a Feedback without a Severity', () => {
    const withoutJudge = renderVerdict(null, 'bug');
    expect(filterAccepts(severeBugs, withoutJudge)).toBe(false);
    expect(filterAccepts({ types: ['bug'], minimumSeverity: null }, withoutJudge)).toBe(true);
  });

  it('without a minimum Severity, only the Type counts', () => {
    expect(filterAccepts(allOpinions, { resolvedType: 'opinion', severity: null })).toBe(true);
    expect(filterAccepts(allOpinions, { resolvedType: 'bug', severity: 'blocking' })).toBe(false);
  });
});

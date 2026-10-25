import { describe, expect, it } from 'vitest';
import { buildTriageState, renderVerdict, type TriageAnswers } from './triage.js';

/** Judge answers: a major bug, with the given confidence for the Type and the Severity. */
function judgeAnswers(confidence: { type: number; severity: number }): TriageAnswers {
  return {
    type: {
      kind: 'choice',
      choice: 'bug',
      distribution: { bug: 0.7, suggestion: 0.1, opinion: 0.1, question: 0.1 },
      confidence: confidence.type,
    },
    junk: { kind: 'noul', probability: 0.05 },
    manipulation: { kind: 'noul', probability: 0.05 },
    severity: {
      kind: 'score',
      level: 'major',
      value: 0.66,
      distribution: { cosmetic: 0.1, minor: 0.2, major: 0.4, blocking: 0.3 },
      confidence: confidence.severity,
    },
  };
}

describe('Uncertain Verdict', () => {
  it('an uncertain Type yields to the Type declared by the Author', () => {
    const verdict = renderVerdict(judgeAnswers({ type: 0.3, severity: 0.9 }), 'question');

    expect(verdict).toMatchObject({ resolvedType: 'question', severity: 'major', uncertain: true });
  });

  it('an uncertain Severity flags the Verdict without overriding a confident Type', () => {
    const verdict = renderVerdict(judgeAnswers({ type: 0.9, severity: 0.3 }), 'question');

    expect(verdict).toMatchObject({ resolvedType: 'bug', severity: 'major', uncertain: true });
  });
});

describe('State sent to the Judge', () => {
  it('passes on only the origin and path of the page URL', () => {
    const state = buildTriageState({
      text: 'The transfer fails',
      declaredType: null,
      context: {
        url: 'https://alice:secret@bank.example/transfers/new?iban=FR76123&token=abc#step-2',
      },
      projectDescription: null,
    });

    expect(state).toEqual({
      text: 'The transfer fails',
      url: 'https://bank.example/transfers/new',
    });
  });
});

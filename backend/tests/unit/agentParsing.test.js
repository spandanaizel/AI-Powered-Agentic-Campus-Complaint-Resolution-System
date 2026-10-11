import { describe, it, expect } from 'vitest';
import { parseModelJson, priorityOutput, summaryOutput } from '../../src/agents/schemas.js';
import { priorityFallback, summaryFallback, assignmentFallback } from '../../src/agents/fallbacks.js';

describe('model output parsing', () => {
  it('extracts and validates JSON surrounded by prose', () => {
    const out = parseModelJson('Sure!\n{"priority":"High","rationale":"Exposed wiring","confidence":0.8}\nthanks', priorityOutput);
    expect(out.priority).toBe('High');
  });
  it('rejects invalid enum values and non-JSON', () => {
    expect(() => parseModelJson('{"priority":"Urgent","rationale":"x"}', priorityOutput)).toThrow(/schema/);
    expect(() => parseModelJson('no json here', summaryOutput)).toThrow(/no JSON/);
    expect(() => parseModelJson('{bad json}', summaryOutput)).toThrow(/not valid JSON/);
  });
});

describe('fallbacks are deterministic and labelled as non-AI', () => {
  it('priority keyword rules', () => {
    expect(priorityFallback({ title: 'Sparking socket', description: 'Exposed wire near the desk' })).toMatchObject({ priority: 'High' });
    expect(priorityFallback({ title: 'Printer', description: 'Toner is low' }).rationale).toMatch(/not AI/);
  });
  it('summary fallback is an excerpt and says so', () => {
    const s = summaryFallback({ description: 'a'.repeat(500) });
    expect(s.summary.length).toBeLessThanOrEqual(240);
    expect(s.limitations).toMatch(/not an AI summary/);
  });
  it('assignment fallback picks least loaded, ties by name', () => {
    const pick = assignmentFallback([{ _id: 1, name: 'Zed', openAssignments: 1 }, { _id: 2, name: 'Amy', openAssignments: 1 }, { _id: 3, name: 'Bob', openAssignments: 3 }]);
    expect(pick.staffId).toBe('2');
  });
});

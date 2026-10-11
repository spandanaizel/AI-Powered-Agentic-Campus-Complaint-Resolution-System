import { describe, it, expect } from 'vitest';
import { parseModelJson, priorityOutput, summaryOutput } from '../../src/agents/schemas.js';
import { createAnthropicProvider } from '../../src/agents/providers/anthropic.js';
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

describe('Anthropic provider error mapping (fake fetch)', () => {
  const mk = (fetchImpl, timeoutMs = 50) => createAnthropicProvider({ apiKey: 'k', model: 'm', timeoutMs, fetchImpl });
  const reject = async (p) => { try { await p; return null; } catch (e) { return e.category; } };
  it('maps 429, 5xx, empty content and timeouts', async () => {
    expect(await reject(mk(async () => ({ status: 429, ok: false })).complete({ prompt: 'x' }))).toBe('rate_limited');
    expect(await reject(mk(async () => ({ status: 503, ok: false })).complete({ prompt: 'x' }))).toBe('provider_error');
    expect(await reject(mk(async () => ({ status: 200, ok: true, json: async () => ({ content: [] }) })).complete({ prompt: 'x' }))).toBe('malformed_output');
    const hang = (_u, { signal }) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    expect(await reject(mk(hang, 20).complete({ prompt: 'x' }))).toBe('timeout');
  });
  it('maps rejected credentials and output cut off by the token limit', async () => {
    expect(await reject(mk(async () => ({ status: 401, ok: false })).complete({ prompt: 'x' }))).toBe('provider_error');
    const cut = mk(async () => ({ status: 200, ok: true, json: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '{"summary":' }] }) }));
    expect(await reject(cut.complete({ prompt: 'x' }))).toBe('truncated');
  });
  it('ignores thinking blocks and returns only the text answer', async () => {
    const p = mk(async () => ({ status: 200, ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'secret reasoning' }, { type: 'text', text: '{"ok":1}' }] }) }));
    expect(await p.complete({ prompt: 'x' })).toBe('{"ok":1}');
  });
  it('sends the key only as a server-side header and returns text', async () => {
    let seen;
    const p = mk(async (url, init) => { seen = { url, init }; return { status: 200, ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }] }) }; });
    expect(await p.complete({ system: 's', prompt: 'p' })).toBe('hi');
    expect(seen.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen.init.headers['x-api-key']).toBe('k');
    expect(JSON.parse(seen.init.body)).toMatchObject({ model: 'm', system: 's', max_tokens: 4000 });
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

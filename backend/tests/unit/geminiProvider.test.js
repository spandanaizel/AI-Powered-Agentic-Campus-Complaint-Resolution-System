import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createGeminiProvider } from '../../src/agents/providers/gemini.js';
import { startMockGemini, completed, apiError } from '../mockGemini.js';

// The real @google/genai SDK talks to a local mock over HTTP. This checks our request shape and
// error handling; it does not prove Google's live API behaves identically.
const KEY = 'test-gemini-key-NOT-REAL-123';
const MODEL = 'gemini-3.5-flash-lite';
let mock; let clock;
const make = (over = {}) => createGeminiProvider({ apiKey: KEY, model: MODEL, baseUrl: mock.baseUrl, timeoutMs: 400, now: () => clock, ...over });
const fail = async (p) => p.complete({ system: 's', prompt: 'p' }).then(() => null, (e) => e);

beforeAll(async () => { mock = await startMockGemini(); });
afterAll(() => mock.close());
beforeEach(() => { mock.reset(); clock = 1_700_000_000_000; });

describe('Gemini adapter: request', () => {
  it('sends ONE Interactions API request with the key in a header, store:false, system instruction and JSON schema', async () => {
    mock.state.handler = () => completed({ summary: 'ok' });
    const text = await make().complete({ system: 'SYS', prompt: 'PROMPT', maxTokens: 777, jsonSchema: { type: 'object', properties: { summary: { type: 'string' } } } });
    expect(text).toBe('{"summary":"ok"}');
    const calls = mock.interactionCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/^\/v1beta\/interactions/);
    expect(calls[0].key).toBe(KEY);
    expect(calls[0].query).not.toContain(KEY); // never in the URL
    expect(calls[0].body).toMatchObject({
      model: MODEL, input: 'PROMPT', system_instruction: 'SYS', store: false,
      generation_config: { max_output_tokens: 777, temperature: 0.2 },
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object' } },
    });
    expect(calls[0].body.generation_config.thinking_level).toBeUndefined();
  });

  it('passes an optional thinking level and can turn structured output off', async () => {
    await make({ thinkingLevel: 'low', structuredOutput: false }).complete({ system: 's', prompt: 'p', jsonSchema: { type: 'object' } });
    const { body } = mock.interactionCalls()[0];
    expect(body.generation_config.thinking_level).toBe('low');
    expect(body.response_format).toBeUndefined();
  });

  it('returns only the final answer text, not thought steps', async () => {
    expect(await make().complete({ system: 's', prompt: 'p' })).toBe('{"ok":true}');
  });
});

describe('Gemini adapter: API errors map to categories, one request each, key never leaked', () => {
  const cases = [
    ['401 invalid key', apiError(401, 'authentication', `API key ${KEY} not valid`), 'auth_error'],
    ['403 permission', apiError(403, 'permission_denied'), 'auth_error'],
    ['400 safety block', apiError(400, 'safety'), 'blocked'],
    ['400 spii block', apiError(400, 'spii'), 'blocked'],
    ['404 model', apiError(404, 'model_not_found'), 'provider_error'],
    ['500 server', apiError(500, 'api_error'), 'provider_error'],
    ['503 unavailable', apiError(503, 'service_unavailable'), 'provider_error'],
    ['504 deadline', apiError(504, 'deadline_exceeded'), 'provider_error'],
    ['400 invalid request', apiError(400, 'invalid_request', `bad field near ${KEY}`), 'provider_error'],
  ];
  for (const [label, response, category] of cases) {
    it(label, async () => {
      mock.state.handler = () => response;
      const err = await fail(make());
      expect(err.category).toBe(category);
      expect(err.message).not.toContain(KEY);
      expect(mock.interactionCalls()).toHaveLength(1); // no SDK retries
    });
  }

  it('incomplete interaction -> truncated; failed -> provider_error; empty text -> malformed_output', async () => {
    mock.state.handler = () => ({ status: 200, body: { id: 'x', status: 'incomplete', steps: [] } });
    expect((await fail(make())).category).toBe('truncated');
    mock.state.handler = () => ({ status: 200, body: { id: 'x', status: 'failed', steps: [] } });
    expect((await fail(make())).category).toBe('provider_error');
    mock.state.handler = () => ({ status: 200, body: { id: 'x', status: 'completed', steps: [{ type: 'thought', signature: 's' }] } });
    expect((await fail(make())).category).toBe('malformed_output');
  });

  it('a hung request times out', async () => {
    mock.state.handler = () => 'hang';
    const started = Date.now();
    const err = await fail(make({ timeoutMs: 250 }));
    expect(err.category).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('Gemini adapter: free-tier rate limits', () => {
  it('per-minute 429: falls back, honours Retry-After, makes no calls while cooling down', async () => {
    const p = make();
    mock.state.handler = () => apiError(429, 'rate_limit_exceeded', 'slow down', { 'retry-after': '7' });
    expect((await fail(p)).category).toBe('rate_limited');
    mock.state.handler = () => completed({ ok: true });
    const paused = await fail(p);
    expect(paused.category).toBe('rate_limited');
    expect(mock.interactionCalls()).toHaveLength(1); // the paused call never reached Google
    expect(p.state().coolingDownUntil).not.toBeNull();
    clock += 8000;
    expect(await p.complete({ system: 's', prompt: 'p' })).toBe('{"ok":true}');
  });

  it('per-minute 429 without Retry-After pauses for 30 s', async () => {
    const p = make();
    mock.state.handler = () => apiError(429, 'too_many_requests');
    await fail(p);
    mock.state.handler = () => completed({ ok: true });
    clock += 29_000; expect((await fail(p)).category).toBe('rate_limited');
    clock += 2_000; expect(await p.complete({ system: 's', prompt: 'p' })).toBe('{"ok":true}');
  });

  it('daily quota 429 is its own category and pauses for the configured cool-down', async () => {
    const p = make({ quotaCooldownMs: 60 * 60_000 });
    mock.state.handler = () => apiError(429, 'quota_exceeded', 'daily quota');
    const err = await fail(p);
    expect(err.category).toBe('quota_exceeded');
    expect(err.message).toMatch(/midnight Pacific/);
    mock.state.handler = () => completed({ ok: true });
    clock += 30 * 60_000; expect((await fail(p)).category).toBe('quota_exceeded');
    clock += 31 * 60_000; expect(await p.complete({ system: 's', prompt: 'p' })).toBe('{"ok":true}');
    expect(mock.interactionCalls()).toHaveLength(2);
  });

  it('app-side requests-per-minute cap falls back without calling Google; 0 disables it', async () => {
    const p = make({ maxRequestsPerMinute: 2 });
    await p.complete({ system: 's', prompt: 'p' });
    await p.complete({ system: 's', prompt: 'p' });
    const err = await fail(p);
    expect(err.category).toBe('rate_limited');
    expect(err.message).toMatch(/GEMINI_MAX_REQUESTS_PER_MINUTE/);
    expect(mock.interactionCalls()).toHaveLength(2);
    clock += 61_000;
    await p.complete({ system: 's', prompt: 'p' });
    const unlimited = make({ maxRequestsPerMinute: 0 });
    for (let i = 0; i < 12; i += 1) await unlimited.complete({ system: 's', prompt: 'p' });
    expect(mock.interactionCalls()).toHaveLength(15);
  });
});

describe('Gemini adapter: model check', () => {
  it('reports the model when available and a clean error when not', async () => {
    expect(await make().checkModel()).toMatchObject({ ok: true, id: MODEL });
    mock.state.modelStatus = 404;
    const r = await make().checkModel();
    expect(r).toMatchObject({ ok: false, status: 404, category: 'provider_error' });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

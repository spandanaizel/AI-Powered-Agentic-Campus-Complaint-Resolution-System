import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { startMockGemini, completed, apiError, agentReply } from '../mockGemini.js';

// Runs scripts/verify-gemini.js as a real process, over real HTTP, against a LOCAL MOCK of the Gemini
// API. This proves the script and adapter work end to end; it does not prove Google's API accepts
// these requests. That needs `npm run verify:gemini` with a real key.
const KEY = 'test-gemini-key-NOT-REAL-789';
let mock;

const runScript = (args = [], env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['scripts/verify-gemini.js', ...args], {
    env: {
      ...process.env, NODE_ENV: 'test', GEMINI_API_KEY: KEY, GEMINI_BASE_URL: mock.baseUrl, GEMINI_MODEL: 'gemini-3.5-flash-lite',
      MONGODB_URI: `${process.env.MONGODB_TEST_URI}/placeholder`, ...env,
    },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

beforeAll(async () => { mock = await startMockGemini(); });
afterAll(() => mock.close());
beforeEach(() => { mock.reset(); mock.state.handler = (body) => completed(agentReply(body.input)); });

describe('verify:gemini script (against a local mock API)', () => {
  it('default mode: model check + one real call, 2/2, key never printed', async () => {
    const { code, out } = await runScript();
    expect(out).toContain('2/2 checks passed');
    expect(code).toBe(0);
    expect(out).not.toContain(KEY);
    expect(out).toMatch(/key: configured, \d+ characters, not shown/);
    expect(mock.interactionCalls()).toHaveLength(1);
  }, 60000);

  it('--all-agents: one call per agent task, 8/8', async () => {
    const { code, out } = await runScript(['--all-agents']);
    expect(out).toContain('8/8 checks passed');
    expect(code).toBe(0);
    expect(out).not.toContain(KEY);
    expect(mock.interactionCalls()).toHaveLength(7); // 1 smoke call + 6 agent tasks
    expect(mock.interactionCalls().every((c) => c.key === KEY && c.body.store === false)).toBe(true);
  }, 60000);

  it('exits 1 and stops when the model is not available', async () => {
    mock.state.modelStatus = 404;
    const { code, out } = await runScript();
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL API key accepted and model available/);
    expect(mock.interactionCalls()).toHaveLength(0);
  }, 60000);

  it('exits 1 with the error category when Gemini rate-limits the call', async () => {
    mock.state.handler = () => apiError(429, 'rate_limit_exceeded');
    const { code, out } = await runScript();
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL real Interactions API call.*rate_limited/);
  }, 60000);

  it('exits 2 and says UNVERIFIED when no key is set', async () => {
    const { code, out } = await runScript([], { GEMINI_API_KEY: '' });
    expect(code).toBe(2);
    expect(out).toMatch(/UNVERIFIED/);
  });
});

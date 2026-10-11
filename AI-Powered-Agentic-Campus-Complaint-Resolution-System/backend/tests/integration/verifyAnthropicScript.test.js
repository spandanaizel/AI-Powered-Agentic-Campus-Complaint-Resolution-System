import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';

// Exercises scripts/verify-anthropic.js end to end over real HTTP against a LOCAL MOCK of the
// Anthropic API. This proves the script and the HTTP adapter work; it does not prove that the real
// Anthropic API accepts these requests.
const KEY = 'test-key-NOT-REAL-0123456789';
let server; let port; let modelStatus = 200; const seen = [];

const reply = (prompt) => {
  if (prompt.includes('Summarise')) return { summary: 'Library Wi-Fi drops on floor 2.', keyFacts: ['floor 2'], categoryHint: null, limitations: null };
  if (prompt.includes('urgency')) return { priority: 'High', rationale: 'Many students affected in exam week.', confidence: 0.7 };
  if (prompt.includes('Eligible staff')) return { staffId: prompt.match(/id=([a-f0-9]{24})/)[1], reason: 'Lowest workload.' };
  if (prompt.includes('troubleshooting')) return { likelyCauses: ['AP overload'], troubleshootingSteps: [{ step: 'Check AP-7', who: 'staff' }], possibleResolutions: ['Replace AP'], safetyNotes: [], informationNeeded: [], limitations: null };
  if (prompt.includes('Draft a clear')) return { draft: 'Hello, the access point has been replaced.', warnings: [] };
  return { assessment: 'likely_sufficient', checks: [{ item: 'Fix described', status: 'present', note: null }], followUpQuestions: [], limitations: null };
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'] });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url.startsWith('/v1/models/')) {
        res.statusCode = modelStatus;
        return res.end(JSON.stringify(modelStatus === 200 ? { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' } : { error: { message: 'model not found' } }));
      }
      const { messages, model } = JSON.parse(body);
      return res.end(JSON.stringify({ model, stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'reasoning...' }, { type: 'text', text: JSON.stringify(reply(messages[0].content)) }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
afterAll(() => new Promise((r) => server.close(r)));

const runScript = (env) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['scripts/verify-anthropic.js'], {
    env: { ...process.env, NODE_ENV: 'test', ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'claude-haiku-5-5', MONGODB_URI: `${process.env.MONGODB_TEST_URI}/placeholder`, ...env },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

describe('verify-anthropic script (against a local mock API)', () => {
  it('checks the model, makes one call per agent task, passes 7/7 and never prints the key', async () => {
    const { code, out } = await runScript({});
    expect(out).toContain('7/7 checks passed');
    expect(code).toBe(0);
    expect(out).not.toContain(KEY);
    const messages = seen.filter((s) => s.method === 'POST');
    expect(messages).toHaveLength(6);
    expect(seen.every((s) => s.key === KEY && s.version === '2023-06-01')).toBe(true);
  }, 60000);
  it('stops with exit 1 when the model ID is not available', async () => {
    modelStatus = 404;
    const { code, out } = await runScript({});
    modelStatus = 200;
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL model ID is available/);
  }, 60000);
  it('exits 2 and says UNVERIFIED when no key is set', async () => {
    const { code, out } = await runScript({ ANTHROPIC_API_KEY: '' });
    expect(code).toBe(2);
    expect(out).toMatch(/UNVERIFIED/);
  });
});

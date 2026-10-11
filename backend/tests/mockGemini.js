import http from 'node:http';

/**
 * Local HTTP server imitating the Gemini Developer API endpoints the adapter uses:
 *   POST /v1beta/interactions          (ai.interactions.create)
 *   GET  /v1beta/models/{model}        (ai.models.get)
 * Response and error shapes follow Google's documentation (Interactions API reference and API
 * errors page, fetched October 2026). This tests our code and the real SDK over real HTTP; it does
 * NOT prove that Google's live API behaves the same way.
 *
 * `handler(body, req)` returns { status, body, headers } or the special value 'hang'.
 */
export async function startMockGemini() {
  const state = {
    requests: [],
    handler: null,
    modelStatus: 200,
  };
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      state.requests.push({ method: req.method, url: req.url, key: req.headers['x-goog-api-key'], query: req.url.split('?')[1] ?? '', body });
      if (req.method === 'GET' && req.url.startsWith('/v1beta/models/')) {
        return state.modelStatus === 200
          ? send(res, 200, { name: `models/${decodeURIComponent(req.url.split('/').pop())}`, displayName: 'Gemini 3.5 Flash-Lite' })
          : send(res, state.modelStatus, { error: { code: state.modelStatus, message: 'Model not found', status: 'NOT_FOUND' } });
      }
      if (req.method === 'POST' && req.url.startsWith('/v1beta/interactions')) {
        const out = state.handler ? state.handler(body, req) : completed({ ok: true });
        if (out === 'hang') return undefined;
        return send(res, out.status, out.body, out.headers);
      }
      return send(res, 404, { error: { code: 'not_found', message: `no mock for ${req.method} ${req.url}` } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl, state,
    interactionCalls: () => state.requests.filter((r) => r.method === 'POST'),
    reset() { state.requests.length = 0; state.handler = null; state.modelStatus = 200; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/** A completed interaction whose final text is `obj` as JSON, preceded by a thought step. */
export const completed = (obj) => ({
  status: 200,
  body: {
    id: 'v1_mock', object: 'interaction', status: 'completed', model: 'gemini-3.5-flash-lite',
    steps: [{ type: 'thought', signature: 'sig' }, { type: 'model_output', content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }],
  },
});
export const apiError = (status, code, message = code, headers = {}) => ({ status, body: { error: { code, message } }, headers });

/** Pick a canned answer per agent from the prompt text (prompts are stable phrases in the agents). */
export function agentReply(prompt, { staffId } = {}) {
  if (prompt.includes('Summarise')) return { summary: 'Library Wi-Fi drops on floor 2.', keyFacts: ['floor 2'], categoryHint: null, limitations: null };
  if (prompt.includes('urgency')) return { priority: 'High', rationale: 'Many students affected in exam week.', confidence: 0.7 };
  if (prompt.includes('Eligible staff')) return { staffId: staffId ?? prompt.match(/id=([a-f0-9]{24})/)[1], reason: 'Lowest workload.' };
  if (prompt.includes('troubleshooting')) return { likelyCauses: ['AP overload'], troubleshootingSteps: [{ step: 'Check AP-7', who: 'staff' }], possibleResolutions: ['Replace AP'], safetyNotes: [], informationNeeded: [], limitations: null };
  if (prompt.includes('Draft a clear')) return { draft: 'Hello, the access point has been replaced.', warnings: [] };
  return { assessment: 'likely_sufficient', checks: [{ item: 'Fix described', status: 'present', note: null }], followUpQuestions: [], limitations: null };
}

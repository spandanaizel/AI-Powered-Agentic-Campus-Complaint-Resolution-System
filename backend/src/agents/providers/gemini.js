// Server-side Google Gemini adapter built on the official @google/genai SDK, using the Interactions
// API (ai.interactions.create), which is what Google's current quickstart and text-generation guides
// document. The API key stays on the server: the SDK sends it in the x-goog-api-key header, it is
// never returned to the browser, and it is scrubbed from any error text before that text is used.
//
// Free-tier protections (Google publishes free-tier limits per project in AI Studio, not in the docs):
//  - SDK retries are disabled (maxRetries: 0). The SDK default retries a 429 four times.
//  - An app-side requests-per-minute cap fails fast to the labelled fallback instead of calling Google.
//  - After a 429 the adapter cools down: per-minute limits briefly (Retry-After or 30 s), the daily
//    quota (code quota_exceeded) for GEMINI_QUOTA_COOLDOWN_MINUTES. Calls during a cool-down fall back
//    immediately without contacting Google.
import { GoogleGenAI } from '@google/genai';
import { ProviderError } from './errors.js';

// Interactions API "generation blocked" codes (policy, safety or content restrictions).
const BLOCKED_CODES = new Set(['safety', 'recitation', 'language', 'prohibited_content', 'spii', 'blocklist', 'content_blocked']);

const errorCode = (err) => err?.error?.error?.code ?? err?.error?.code ?? null;
const retryAfterMs = (err) => {
  const h = err?.headers;
  const raw = typeof h?.get === 'function' ? h.get('retry-after') : h?.['retry-after'];
  const s = Number.parseInt(raw, 10);
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
};

export function createGeminiProvider({
  apiKey, model, timeoutMs = 30000, maxTokens: defaultMaxTokens = 4000, thinkingLevel = null,
  baseUrl = null, structuredOutput = true, maxRequestsPerMinute = 10,
  rateLimitCooldownMs = 30_000, quotaCooldownMs = 60 * 60_000, now = () => Date.now(),
}) {
  if (!apiKey) throw new Error('createGeminiProvider requires an API key');
  const scrub = (text) => String(text ?? '').split(apiKey).join('[REDACTED]');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs, ...(baseUrl ? { baseUrl } : {}) } });

  let sent = []; // timestamps of requests sent in the last minute (app-side cap)
  let coolDown = { until: 0, category: null, reason: null };

  function startCoolDown(category, ms, reason) {
    const until = now() + ms;
    if (until > coolDown.until) coolDown = { until, category, reason };
  }

  function mapError(err) {
    if (err instanceof ProviderError) return err;
    const name = err?.constructor?.name ?? err?.name;
    if (/Timeout/i.test(name ?? '') || err?.name === 'AbortError' || /timed? ?out|aborted/i.test(err?.message ?? '')) {
      return new ProviderError('timeout', `Gemini did not answer within ${timeoutMs}ms`);
    }
    const { status } = err ?? {};
    const code = errorCode(err);
    if (typeof status === 'number') {
      if (status === 429) {
        if (code === 'quota_exceeded') {
          startCoolDown('quota_exceeded', quotaCooldownMs, 'daily quota error');
          return new ProviderError('quota_exceeded', 'Gemini daily quota exceeded (429 quota_exceeded); quotas reset at midnight Pacific time');
        }
        startCoolDown('rate_limited', retryAfterMs(err) ?? rateLimitCooldownMs, 'rate limit error');
        return new ProviderError('rate_limited', `Gemini rate limit reached (429 ${code ?? 'RESOURCE_EXHAUSTED'})`);
      }
      if (status === 401 || status === 403) return new ProviderError('auth_error', `Gemini rejected the API key or its permissions (HTTP ${status} ${code ?? ''})`.trim());
      if (code && BLOCKED_CODES.has(code)) return new ProviderError('blocked', `Gemini blocked the request (${code})`);
      if (status === 404) return new ProviderError('provider_error', `Gemini model "${model}" was not found (HTTP 404)`);
      if (status >= 500) return new ProviderError('provider_error', `Gemini is unavailable (HTTP ${status} ${code ?? ''})`.trim());
      return new ProviderError('provider_error', `Gemini returned HTTP ${status} ${code ?? ''}: ${scrub(err.message).slice(0, 200)}`);
    }
    return new ProviderError('provider_error', `Gemini request failed: ${scrub(err?.message).slice(0, 200)}`);
  }

  function admit() {
    const t = now();
    if (t < coolDown.until) {
      throw new ProviderError(coolDown.category, `Gemini paused after a ${coolDown.reason}; retrying after ${new Date(coolDown.until).toISOString()}`);
    }
    if (maxRequestsPerMinute > 0) {
      sent = sent.filter((s) => t - s < 60_000);
      if (sent.length >= maxRequestsPerMinute) {
        throw new ProviderError('rate_limited', `App-side cap of ${maxRequestsPerMinute} Gemini requests per minute reached (GEMINI_MAX_REQUESTS_PER_MINUTE)`);
      }
      sent.push(t);
    }
  }

  return {
    name: 'gemini',
    model,

    /**
     * One request, no retries. `jsonSchema` (optional) asks Gemini for structured JSON; every answer is
     * still validated with zod by the calling agent.
     */
    async complete({ system, prompt, maxTokens = defaultMaxTokens, jsonSchema = null }) {
      admit();
      const request = {
        model,
        input: prompt,
        system_instruction: system,
        // Do not keep complaint text on Google's side beyond the call.
        store: false,
        generation_config: { max_output_tokens: maxTokens, temperature: 0.2, ...(thinkingLevel ? { thinking_level: thinkingLevel } : {}) },
        ...(structuredOutput ? { response_format: { type: 'text', mime_type: 'application/json', ...(jsonSchema ? { schema: jsonSchema } : {}) } } : {}),
      };
      // Own deadline with a ref'd timer, raced against the call: the timeout holds even if the request
      // or body read ignores cancellation, and a short-lived process cannot exit with a call pending.
      const deadline = new AbortController();
      let timer;
      const expired = new Promise((_r, reject) => {
        timer = setTimeout(() => { deadline.abort(); reject(new ProviderError('timeout', `Gemini did not answer within ${timeoutMs}ms`)); }, timeoutMs);
      });
      let res;
      try {
        const call = ai.interactions.create(request, { maxRetries: 0, timeout: timeoutMs, signal: deadline.signal });
        call.catch(() => {}); // a late rejection after the deadline must not surface as unhandled
        res = await Promise.race([call, expired]);
      } catch (err) {
        throw deadline.signal.aborted ? new ProviderError('timeout', `Gemini did not answer within ${timeoutMs}ms`) : mapError(err);
      } finally {
        clearTimeout(timer);
      }
      const resultCode = res?.error?.code;
      if (resultCode && BLOCKED_CODES.has(resultCode)) throw new ProviderError('blocked', `Gemini blocked the output (${resultCode})`);
      if (res?.status && res.status !== 'completed') {
        if (res.status === 'incomplete') throw new ProviderError('truncated', 'Gemini stopped before finishing (output token limit)');
        throw new ProviderError('provider_error', `Gemini interaction ended with status "${res.status}"${resultCode ? ` (${resultCode})` : ''}`);
      }
      // output_text is the final answer only; thought steps are excluded by the SDK.
      const text = res?.output_text;
      if (!text) throw new ProviderError('malformed_output', 'Gemini returned no text');
      return text;
    },

    /** Ask the API whether this model exists for this key. Never throws; never includes the key. */
    async checkModel() {
      try {
        const m = await ai.models.get({ model });
        return { ok: true, status: 200, id: (m?.name ?? '').replace(/^models\//, ''), displayName: m?.displayName ?? null, error: null };
      } catch (err) {
        const mapped = mapError(err);
        return { ok: false, status: err?.status ?? 0, id: null, displayName: null, error: mapped.message, category: mapped.category };
      }
    },

    /** For Settings and diagnostics: whether calls are currently paused. */
    state() {
      return { coolingDownUntil: coolDown.until > now() ? new Date(coolDown.until).toISOString() : null, coolDownReason: coolDown.until > now() ? coolDown.reason : null };
    },
  };
}

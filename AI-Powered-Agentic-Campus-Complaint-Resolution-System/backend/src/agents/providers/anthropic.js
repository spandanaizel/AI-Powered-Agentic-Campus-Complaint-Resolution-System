// Server-side Anthropic Messages API adapter. The API key never leaves the server.
export class ProviderError extends Error {
  constructor(category, message) { super(message); this.category = category; }
}

export function createAnthropicProvider({ apiKey, model, timeoutMs = 30000, maxTokens: defaultMaxTokens = 4000, baseUrl = 'https://api.anthropic.com', fetchImpl = globalThis.fetch }) {
  const base = baseUrl.replace(/\/$/, '');
  return {
    name: 'anthropic',
    model,
    /** Ask the Models API whether this model ID is available to this key. Returns { ok, status, id, displayName }. */
    async checkModel() {
      const res = await fetchImpl(`${base}/v1/models/${encodeURIComponent(model)}`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, id: data?.id ?? null, displayName: data?.display_name ?? null, error: res.ok ? null : data?.error?.message ?? null };
    },
    async complete({ system, prompt, maxTokens = defaultMaxTokens }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${base}/v1/messages`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
        });
      } catch (err) {
        if (err?.name === 'AbortError') throw new ProviderError('timeout', `AI provider timed out after ${timeoutMs}ms`);
        throw new ProviderError('provider_error', 'AI provider request failed');
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429) throw new ProviderError('rate_limited', 'AI provider rate limit reached');
      if (res.status === 401 || res.status === 403) throw new ProviderError('provider_error', `AI provider rejected the credentials (HTTP ${res.status})`);
      if (!res.ok) throw new ProviderError('provider_error', `AI provider returned HTTP ${res.status}`);
      const data = await res.json().catch(() => null);
      // Thinking blocks (adaptive thinking) are ignored; only the final text answer is used.
      const text = data?.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (data?.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'AI output hit the token limit before finishing');
      if (!text) throw new ProviderError('malformed_output', 'AI provider returned no text');
      return text;
    },
  };
}

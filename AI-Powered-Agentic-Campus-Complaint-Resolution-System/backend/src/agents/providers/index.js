import { config } from '../../config/env.js';
import { createAnthropicProvider } from './anthropic.js';

// null => no provider configured; agents use their clearly labelled fallbacks.
let provider = config.agents.anthropicApiKey
  ? createAnthropicProvider({ apiKey: config.agents.anthropicApiKey, model: config.agents.anthropicModel, timeoutMs: config.agents.timeoutMs, maxTokens: config.agents.maxTokens, baseUrl: config.agents.anthropicBaseUrl })
  : null;

export const getProvider = () => provider;
/** Test hook: inject a stub provider (or null). */
export const setProvider = (p) => { provider = p; };
export const providerStatus = () => (provider ? { configured: true, name: provider.name, model: provider.model } : { configured: false, name: null, model: null });

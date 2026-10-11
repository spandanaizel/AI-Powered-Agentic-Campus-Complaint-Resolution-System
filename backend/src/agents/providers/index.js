import { config } from '../../config/env.js';
import { createGeminiProvider } from './gemini.js';
import { logger } from '../../utils/logger.js';

const a = config.agents;
// null => no provider configured (demo mode); agents use their clearly labelled fallbacks.
let provider = a.geminiApiKey
  ? createGeminiProvider({
    apiKey: a.geminiApiKey,
    model: a.geminiModel,
    timeoutMs: a.timeoutMs,
    maxTokens: a.maxTokens,
    thinkingLevel: a.thinkingLevel,
    baseUrl: a.geminiBaseUrl || null,
    structuredOutput: a.structuredOutput,
    maxRequestsPerMinute: a.maxRequestsPerMinute,
    quotaCooldownMs: a.quotaCooldownMinutes * 60_000,
  })
  : null;

if (!provider && process.env.ANTHROPIC_API_KEY && !config.isTest) {
  logger.warn('ANTHROPIC_API_KEY is set but no longer used; set GEMINI_API_KEY to enable the AI agents');
}

export const getProvider = () => provider;
/** Test hook: inject a stub provider (or null). */
export const setProvider = (p) => { provider = p; };
// Status for the admin Settings page. Never includes the key.
export const providerStatus = () => (provider
  ? { configured: true, name: provider.name, model: provider.model, ...(provider.state ? provider.state() : {}) }
  : { configured: false, name: null, model: null });

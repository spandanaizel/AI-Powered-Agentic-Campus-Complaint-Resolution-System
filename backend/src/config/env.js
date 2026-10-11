import 'dotenv/config';

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}
function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadConfig() {
  const env = process.env.NODE_ENV || 'development';
  return {
    env,
    isProd: env === 'production',
    isTest: env === 'test',
    port: int('PORT', 5000),
    mongoUri: process.env.MONGODB_URI || '',
    jwtSecret: process.env.JWT_SECRET || '',
    jwtTtl: process.env.JWT_TTL || '8h',
    cookieSecure: bool('COOKIE_SECURE', env === 'production'),
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
      .split(',').map((s) => s.trim()).filter(Boolean),
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    maxUploadBytes: int('MAX_UPLOAD_BYTES', 5 * 1024 * 1024),
    escalation: {
      // Mandatory rule: MORE THAN this many distinct reporters escalates the issue.
      threshold: int('ESCALATION_THRESHOLD', 5),
      // Rolling window (days) for counting reporters on a not-yet-escalated issue. 0 = no window.
      windowDays: int('ESCALATION_WINDOW_DAYS', 30),
    },
    agents: {
      autoAssign: bool('AUTO_ASSIGN_ENABLED', true),
      // Google Gemini (Developer API). Read from backend/.env; never sent to the browser or logged.
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      // Stable Flash-Lite model, "Free of charge" on the free tier per Google's pricing page (Oct 2026).
      geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      // Only for a proxy, gateway or local test server; empty uses Google's endpoint.
      geminiBaseUrl: process.env.GEMINI_BASE_URL || '',
      // Optional thinking level (e.g. "low"); empty uses the model's default.
      thinkingLevel: process.env.GEMINI_THINKING_LEVEL || null,
      // Ask Gemini for schema-constrained JSON. Answers are validated with zod either way.
      structuredOutput: bool('GEMINI_STRUCTURED_OUTPUT', true),
      // App-side cap so the free-tier quota is not exhausted; 0 disables. Set to your project's limit.
      maxRequestsPerMinute: int('GEMINI_MAX_REQUESTS_PER_MINUTE', 10),
      // Pause after a daily-quota (429 quota_exceeded) error; per-minute 429s pause for Retry-After or 30 s.
      quotaCooldownMinutes: int('GEMINI_QUOTA_COOLDOWN_MINUTES', 60),
      timeoutMs: int('AI_TIMEOUT_MS', 30000),
      // Output budget per call. Gemini bills and caps thinking tokens as output, so this is set well
      // above the size of the JSON answers.
      maxTokens: int('AI_MAX_TOKENS', 4000),
    },
    loginRateLimit: { windowMs: 15 * 60 * 1000, max: int('LOGIN_RATE_LIMIT_MAX', 10) },
  };
}

export function assertConfig(cfg) {
  const problems = [];
  if (!cfg.mongoUri) problems.push('MONGODB_URI is required');
  if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) problems.push('JWT_SECRET must be set and at least 32 characters');
  if (/^replace-with/i.test(cfg.jwtSecret)) problems.push('JWT_SECRET is still the placeholder from .env.example; generate a random value');
  if (cfg.escalation.threshold < 1) problems.push('ESCALATION_THRESHOLD must be >= 1');
  if (cfg.escalation.windowDays < 0) problems.push('ESCALATION_WINDOW_DAYS must be >= 0');
  if (cfg.agents.maxRequestsPerMinute < 0) problems.push('GEMINI_MAX_REQUESTS_PER_MINUTE must be >= 0');
  if (problems.length) {
    const err = new Error(`Invalid configuration:\n - ${problems.join('\n - ')}\nSee backend/.env.example`);
    err.code = 'CONFIG_INVALID';
    throw err;
  }
}

// Mutable singleton so tests can adjust values (e.g. escalation window) without reloading modules.
export const config = loadConfig();

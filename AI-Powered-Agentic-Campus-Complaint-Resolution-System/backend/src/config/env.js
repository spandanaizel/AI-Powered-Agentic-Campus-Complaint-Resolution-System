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
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
      anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      // Override only for a proxy or gateway; defaults to the public API.
      anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      timeoutMs: int('AI_TIMEOUT_MS', 30000),
      // Output budget per call. Current models think adaptively by default and thinking tokens count
      // against this budget, so it is set well above the size of the JSON answers.
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
  if (problems.length) {
    const err = new Error(`Invalid configuration:\n - ${problems.join('\n - ')}\nSee backend/.env.example`);
    err.code = 'CONFIG_INVALID';
    throw err;
  }
}

// Mutable singleton so tests can adjust values (e.g. escalation window) without reloading modules.
export const config = loadConfig();

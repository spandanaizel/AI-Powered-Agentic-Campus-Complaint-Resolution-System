// Minimal structured logger with key-based redaction. Never logs passwords, tokens, cookies or keys.
const REDACT = /pass(word)?|token|secret|authorization|cookie|api[-_]?key/i;

export function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  return out;
}

function write(level, msg, meta) {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS) return;
  const line = { time: new Date().toISOString(), level, msg, ...redact(meta || {}) };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

export const logger = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};

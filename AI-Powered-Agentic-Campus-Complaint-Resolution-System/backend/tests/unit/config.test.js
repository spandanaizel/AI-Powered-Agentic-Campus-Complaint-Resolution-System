import { describe, it, expect } from 'vitest';
import { assertConfig, loadConfig } from '../../src/config/env.js';

const base = () => ({ ...loadConfig(), mongoUri: 'mongodb://x/db', jwtSecret: 'a'.repeat(40) });

describe('startup configuration checks', () => {
  it('accepts a valid configuration', () => { expect(() => assertConfig(base())).not.toThrow(); });
  it('rejects a missing database URI, short secret, or the .env.example placeholder secret', () => {
    expect(() => assertConfig({ ...base(), mongoUri: '' })).toThrow(/MONGODB_URI/);
    expect(() => assertConfig({ ...base(), jwtSecret: 'short' })).toThrow(/at least 32/);
    expect(() => assertConfig({ ...base(), jwtSecret: 'replace-with-a-long-random-string-of-at-least-32-chars' })).toThrow(/placeholder/);
  });
  it('rejects an invalid escalation threshold', () => {
    expect(() => assertConfig({ ...base(), escalation: { threshold: 0, windowDays: 30 } })).toThrow(/THRESHOLD/);
  });
});

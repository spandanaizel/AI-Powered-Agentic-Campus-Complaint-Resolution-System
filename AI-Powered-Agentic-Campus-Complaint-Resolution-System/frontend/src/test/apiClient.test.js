import { describe, it, expect, vi } from 'vitest';
import { api, ApiError, onUnauthorized } from '../api/client';
import { mockApi } from './utils';

describe('api client', () => {
  it('sends the CSRF header and cookies, and serialises JSON', async () => {
    const calls = mockApi({ 'POST /api/things': [201, { ok: true }] });
    await api('/things', { method: 'POST', body: { a: 1 } });
    expect(calls[0].init.headers['X-Requested-With']).toBe('XMLHttpRequest');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[0].init.body).toBe('{"a":1}');
  });
  it('drops empty query values', async () => {
    const calls = mockApi({ 'GET /api/complaints': [200, {}] });
    await api('/complaints', { query: { status: 'Resolved', search: '', page: undefined } });
    expect(calls[0].url).toMatch(/\?status=Resolved$/);
  });
  it('normalises API errors including field details', async () => {
    mockApi({ 'POST /api/x': [400, { error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: [{ field: 'title', message: 'Too short' }] } }] });
    const err = await api('/x', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.fieldErrors()).toEqual({ title: 'Too short' });
  });
  it('reports network failures in plain language', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await api('/x').catch((e) => e);
    expect(err.code).toBe('NETWORK');
    expect(err.message).toMatch(/Could not reach the server/);
  });
  it('notifies listeners on 401 (session expiry) but not on failed login', async () => {
    const fn = vi.fn();
    const off = onUnauthorized(fn);
    mockApi({ 'GET /api/complaints': [401, { error: { message: 'expired' } }], 'POST /api/auth/login': [401, { error: { message: 'Invalid email or password' } }] });
    await api('/complaints').catch(() => {});
    await api('/auth/login', { method: 'POST', body: {} }).catch(() => {});
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });
});

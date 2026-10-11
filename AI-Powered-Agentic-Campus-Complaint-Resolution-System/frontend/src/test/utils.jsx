import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../App';

/** Mock fetch with a route table: { 'GET /api/auth/me': [status, body] | fn }. */
export function mockApi(routes) {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    calls.push({ method, path, url: String(url), init });
    let r = routes[`${method} ${path}`];
    if (typeof r === 'function') r = r(init);
    const [status, body] = r || [404, { error: { code: 'NOT_FOUND', message: 'Not found' } }];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  return calls;
}

export function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><ToastProvider><AppRoutes /></ToastProvider></AuthProvider>
    </MemoryRouter>,
  );
}

export const me = (role) => [200, { user: { id: 'u1', name: `Pat ${role}`, email: `${role}@uni.test`, role } }];
export const anon = [401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }];
export const empty = [200, { items: [], page: 1, limit: 20, total: 0, totalPages: 1 }];
export const stats = [200, { total: 0, byStatus: {}, byPriority: {} }];

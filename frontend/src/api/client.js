// Central API client. Cookies carry the session; the custom header satisfies the backend's CSRF check.
const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') + '/api';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Map of field -> message, for inline form errors. */
  fieldErrors() {
    const out = {};
    for (const d of this.details || []) if (d.field && !out[d.field]) out[d.field] = d.message;
    return out;
  }
}

const listeners = new Set();
/** Subscribe to "session expired" (401 on an authenticated call). */
export const onUnauthorized = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function api(path, { method = 'GET', body, query, signal, form } = {}) {
  let url = BASE + path;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'include', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    const err = new ApiError(res.status, e?.code || 'HTTP_ERROR', e?.message || `Request failed (${res.status})`, e?.details);
    if (res.status === 401 && !path.startsWith('/auth/login')) listeners.forEach((fn) => fn(err));
    throw err;
  }
  return data;
}

export const attachmentUrl = (complaintId, attachmentId) => `${BASE}/complaints/${complaintId}/attachments/${attachmentId}`;

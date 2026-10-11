import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/auth/me')
      .then((d) => { if (!cancelled) setUser(d.user); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setStatus('ready'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => onUnauthorized(() => {
    setUser((u) => { if (u) setExpired(true); return null; });
  }), []);

  const login = useCallback(async (email, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { email, password } });
    setExpired(false);
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (input) => {
    const d = await api('/auth/register', { method: 'POST', body: input });
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, status, expired, login, register, logout }), [user, status, expired, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

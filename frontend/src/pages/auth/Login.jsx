import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../auth/AuthContext';
import { homeFor } from '../../auth/roles';
import { useDocumentTitle } from '../../hooks/useApi';

export default function Login() {
  useDocumentTitle('Sign in');
  const { user, login, expired, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'ready' && user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Enter your email address.';
    if (!form.password) next.password = 'Enter your password.';
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const u = await login(form.email.trim(), form.password);
      const from = location.state?.from;
      navigate(from && from.startsWith(homeFor(u.role)) ? from : homeFor(u.role), { replace: true });
    } catch (err) {
      setFormError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <h2 id="page-title">Sign in</h2>
      {expired && <div className="banner banner-info" role="status"><p>Your session ended. Sign in again to continue.</p></div>}
      {formError && <div className="banner banner-error" role="alert"><p>{formError}</p></div>}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-err' : undefined} />
          {errors.email && <span id="email-err" className="error">{errors.email}</span>}
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'password-err' : undefined} />
          {errors.password && <span id="password-err" className="error">{errors.password}</span>}
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="small muted" style={{ marginTop: '1.25rem' }}>Students without an account can <Link to="/register">create one</Link>. Staff and administrator accounts are set up by an administrator.</p>
    </AuthLayout>
  );
}

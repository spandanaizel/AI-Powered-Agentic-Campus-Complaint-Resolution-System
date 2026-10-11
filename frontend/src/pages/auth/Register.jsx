import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { useAuth } from '../../auth/AuthContext';
import { homeFor } from '../../auth/roles';
import { useDocumentTitle } from '../../hooks/useApi';
import { validateRegistration } from '../../validation';


export default function Register() {
  useDocumentTitle('Create a student account');
  const { user, register, status } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  if (status === 'ready' && user) return <Navigate to={homeFor(user.role)} replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const next = validateRegistration(form);
    setErrors(next); setFormError('');
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/student', { replace: true });
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setFormError(err.message);
    } finally { setBusy(false); }
  };

  const f = (id, label, type, auto, hint) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
      <input id={id} type={type} autoComplete={auto} value={form[id]} onChange={set(id)} aria-invalid={Boolean(errors[id])}
        aria-describedby={[hint && `${id}-hint`, errors[id] && `${id}-err`].filter(Boolean).join(' ') || undefined} />
      {errors[id] && <span id={`${id}-err`} className="error">{errors[id]}</span>}
    </div>
  );

  return (
    <AuthLayout>
      <h2 id="page-title">Create a student account</h2>
      {formError && <div className="banner banner-error" role="alert"><p>{formError}</p></div>}
      <form onSubmit={submit} noValidate>
        {f('name', 'Full name', 'text', 'name')}
        {f('email', 'Email', 'email', 'email')}
        {f('password', 'Password', 'password', 'new-password', 'At least 8 characters, with a letter and a number.')}
        {f('confirm', 'Confirm password', 'password', 'new-password')}
        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className="small muted" style={{ marginTop: '1.25rem' }}>Already registered? <Link to="/login">Sign in</Link>.</p>
    </AuthLayout>
  );
}

import { useState } from 'react';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import { ErrorState, PageLoading, EmptyState } from '../../components/States';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api/client';
import { formatDate } from '../../constants';

function CreateUser({ onCreated }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'staff' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (f.name.trim().length < 2) next.name = 'Enter a name.';
    if (!/^\S+@\S+\.\S+$/.test(f.email)) next.email = 'Enter a valid email.';
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) next.password = 'At least 8 characters with a letter and a number.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await api('/users', { method: 'POST', body: { ...f, name: f.name.trim(), email: f.email.trim() } });
      toast.success(`${f.role === 'staff' ? 'Staff' : 'Admin'} account created. Share the password securely; set categories under Staff coverage.`);
      setF({ name: '', email: '', password: '', role: 'staff' }); onCreated();
    } catch (err) { setErrors({ ...err.fieldErrors(), form: err.message }); } finally { setBusy(false); }
  };
  const fld = (k, label, type = 'text', auto) => (
    <div className="field">
      <label htmlFor={`nu-${k}`}>{label}</label>
      <input id={`nu-${k}`} type={type} autoComplete={auto} value={f[k]} onChange={set(k)} aria-invalid={Boolean(errors[k])} aria-describedby={errors[k] ? `nu-${k}-e` : undefined} />
      {errors[k] && <span id={`nu-${k}-e`} className="error">{errors[k]}</span>}
    </div>
  );
  return (
    <form className="panel" onSubmit={submit} noValidate aria-labelledby="nu-h">
      <h2 id="nu-h" style={{ fontSize: 'var(--step-1)' }}>Add staff or admin</h2>
      {errors.form && <div className="banner banner-error" role="alert"><p>{errors.form}</p></div>}
      <div className="form-grid">
        {fld('name', 'Name')}
        {fld('email', 'Email', 'email', 'off')}
        {fld('password', 'Temporary password', 'password', 'new-password')}
        <div className="field">
          <label htmlFor="nu-role">Account type</label>
          <select id="nu-role" value={f.role} onChange={set('role')}><option value="staff">Staff</option><option value="admin">Administrator</option></select>
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
    </form>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const users = useApi('/users', { query: { role: role || undefined, page } });
  const [change, setChange] = useState(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    try {
      await api(`/users/${change.user._id}`, { method: 'PATCH', body: change.body });
      toast.success('Account updated. The person’s current sessions were signed out.');
      setChange(null); users.reload();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Users" description="Students register themselves. Create staff and administrator accounts here." />
      <div className="stack">
        <CreateUser onCreated={users.reload} />
        <section className="panel panel-tight" aria-labelledby="ul-h">
          <div className="row" style={{ padding: '1rem 1rem .5rem' }}>
            <h2 id="ul-h" style={{ fontSize: 'var(--step-1)', margin: 0 }}>All accounts</h2>
            <span className="spacer" />
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="role-f" className="visually-hidden">Filter by account type</label>
              <select id="role-f" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
                <option value="">All account types</option><option value="student">Students</option><option value="staff">Staff</option><option value="admin">Administrators</option>
              </select>
            </div>
          </div>
          {users.loading && <div style={{ padding: '1rem' }}><PageLoading /></div>}
          {users.error && <div style={{ padding: '1rem' }}><ErrorState error={users.error} onRetry={users.reload} /></div>}
          {users.data && (users.data.items.length === 0 ? <EmptyState title="No accounts match" /> : (
            <>
              <div className="table-wrap">
                <table className="data stacked">
                  <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                  <tbody>
                    {users.data.items.map((u) => {
                      const self = u._id === me.id;
                      return (
                        <tr key={u._id}>
                          <td data-label="Name">{u.name}{self && <span className="muted small"> (you)</span>}</td>
                          <td data-label="Email" style={{ overflowWrap: 'anywhere' }}>{u.email}</td>
                          <td data-label="Type" style={{ textTransform: 'capitalize' }}>{u.role}</td>
                          <td data-label="Status">{u.active ? 'Active' : <span className="badge st">Deactivated</span>}</td>
                          <td data-label="Joined">{formatDate(u.createdAt)}</td>
                          <td data-label="Actions">
                            {!self && (
                              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setChange({ user: u, body: { active: !u.active }, label: u.active ? 'Deactivate' : 'Reactivate' })}>
                                {u.active ? 'Deactivate' : 'Reactivate'}<span className="visually-hidden"> {u.name}</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={users.data.page} totalPages={users.data.totalPages} total={users.data.total} onPage={setPage} />
            </>
          ))}
        </section>
      </div>
      <ConfirmDialog open={Boolean(change)} title={change ? `${change.label} ${change.user.name}?` : ''} confirmLabel={change?.label} danger={change?.label === 'Deactivate'} busy={busy}
        onCancel={() => setChange(null)} onConfirm={apply}>
        <p>{change?.label === 'Deactivate' ? 'They will be signed out and unable to sign in. Their complaints and history are kept. Automatic assignment will skip them.' : 'They will be able to sign in again.'}</p>
      </ConfirmDialog>
    </>
  );
}

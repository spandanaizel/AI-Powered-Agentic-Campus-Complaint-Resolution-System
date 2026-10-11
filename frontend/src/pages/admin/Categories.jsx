import { useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { ErrorState, PageLoading } from '../../components/States';
import { useToast } from '../../components/Toast';
import { useApi } from '../../hooks/useApi';
import { api } from '../../api/client';

function NamedList({ kind, path, help }) {
  const list = useApi(path, { query: { includeInactive: 'true' } });
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `new-${path.slice(1)}`;

  const add = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) { setError(`Enter a ${kind.toLowerCase()} name of at least 2 characters.`); return; }
    setBusy(true); setError('');
    try { await api(path, { method: 'POST', body: { name: name.trim() } }); setName(''); toast.success(`${kind} added.`); list.reload(); }
    catch (err) { setError(err.status === 409 ? `A ${kind.toLowerCase()} with that name already exists.` : err.message); }
    finally { setBusy(false); }
  };
  const setActive = async (item, active) => {
    try { await api(`${path}/${item._id}`, { method: 'PATCH', body: { active } }); toast.success(`${item.name} ${active ? 'restored' : 'hidden from new complaints'}.`); list.reload(); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <section className="panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} style={{ fontSize: 'var(--step-1)' }}>{kind === 'Category' ? 'Categories' : 'Locations'}</h2>
      <p className="small muted">{help}</p>
      <form className="row" onSubmit={add} noValidate style={{ alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: '12rem' }}>
          <label htmlFor={id}>New {kind.toLowerCase()}</label>
          <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-err` : undefined} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>Add {kind.toLowerCase()}</button>
        {error && <span id={`${id}-err`} className="error" style={{ width: '100%' }}>{error}</span>}
      </form>
      {list.loading && <PageLoading />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && (
        <ul className="tickets">
          {list.data.items.map((it) => (
            <li key={it._id} className="row" style={{ padding: '.5rem 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontWeight: 600 }}>{it.name}</span>
              {!it.active && <span className="badge st">Hidden</span>}
              <span className="spacer" />
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setActive(it, !it.active)} aria-label={`${it.active ? 'Hide' : 'Restore'} ${it.name}`}>{it.active ? 'Hide' : 'Restore'}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Categories() {
  return (
    <>
      <PageHeader title="Categories & locations" description="These lists define what students can choose. Together, a category and a location identify the same issue for the repeated-issue rule." />
      <div className="grid-even">
        <NamedList kind="Category" path="/categories" help="Hiding a category stops new complaints using it. Existing complaints keep it." />
        <NamedList kind="Location" path="/locations" help="Keep locations specific enough that one entry means one place." />
      </div>
    </>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ErrorState, PageLoading, EmptyState } from '../../components/States';
import { useToast } from '../../components/Toast';
import { useApi } from '../../hooks/useApi';
import { api } from '../../api/client';

/** Which staff handle which categories. Automatic assignment only picks staff covering the category. */
export default function AssignStaff() {
  const staff = useApi('/staff');
  const cats = useApi('/categories');
  const toast = useToast();
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState('');

  const current = (s) => edits[s._id] ?? { categories: s.categories.map((c) => c._id), maxOpenAssignments: s.maxOpenAssignments };
  const toggle = (s, catId) => {
    const cur = current(s);
    const categories = cur.categories.includes(catId) ? cur.categories.filter((c) => c !== catId) : [...cur.categories, catId];
    setEdits({ ...edits, [s._id]: { ...cur, categories } });
  };
  const save = async (s) => {
    const cur = current(s);
    const max = Number(cur.maxOpenAssignments);
    if (!Number.isInteger(max) || max < 1 || max > 500) { toast.error('Capacity must be a whole number from 1 to 500.'); return; }
    setSaving(s._id);
    try {
      await api(`/users/${s._id}`, { method: 'PATCH', body: { categories: cur.categories, maxOpenAssignments: max } });
      toast.success(`Saved coverage for ${s.name}.`);
      const { [s._id]: _done, ...rest } = edits; setEdits(rest); staff.reload();
    } catch (err) { toast.error(err.message); } finally { setSaving(''); }
  };

  const uncovered = cats.data && staff.data ? cats.data.items.filter((c) => !staff.data.items.some((s) => s.active && s.categories.some((x) => x._id === c._id))) : [];

  return (
    <>
      <PageHeader title="Staff coverage" description="Choose which categories each staff member handles and how many open complaints they can hold. Automatic assignment only uses staff who cover the category and have capacity." />
      {(staff.loading || cats.loading) && <PageLoading />}
      {(staff.error || cats.error) && <ErrorState error={staff.error || cats.error} onRetry={() => { staff.reload(); cats.reload(); }} />}
      {uncovered.length > 0 && (
        <div className="banner banner-error" role="status"><p><strong>No active staff cover:</strong> {uncovered.map((c) => c.name).join(', ')}. New complaints in {uncovered.length > 1 ? 'these categories' : 'this category'} will wait for manual assignment.</p></div>
      )}
      {staff.data && cats.data && (staff.data.items.length === 0
        ? <EmptyState title="No staff accounts yet" action={<Link to="/admin/users" className="btn btn-primary">Add a staff member</Link>} />
        : (
          <div className="stack">
            {staff.data.items.map((s) => {
              const cur = current(s);
              const dirty = Boolean(edits[s._id]);
              return (
                <fieldset key={s._id} className="panel" style={{ margin: 0 }}>
                  <legend className="visually-hidden">Coverage for {s.name}</legend>
                  <div className="row" style={{ marginBottom: '.75rem' }}>
                    <strong>{s.name}</strong>
                    <span className="muted small">{s.email}</span>
                    {!s.active && <span className="badge st">Inactive</span>}
                    <span className="spacer" />
                    <span className="small muted">{s.openAssignments} open now</span>
                  </div>
                  <div className="row" style={{ gap: '.5rem 1.25rem' }}>
                    {cats.data.items.map((c) => (
                      <label key={c._id} className="small"><input type="checkbox" checked={cur.categories.includes(c._id)} onChange={() => toggle(s, c._id)} /> {c.name}</label>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: '.75rem', alignItems: 'flex-end' }}>
                    <div className="field" style={{ margin: 0, maxWidth: '10rem' }}>
                      <label htmlFor={`cap-${s._id}`}>Capacity</label>
                      <input id={`cap-${s._id}`} type="number" min="1" max="500" value={cur.maxOpenAssignments} onChange={(e) => setEdits({ ...edits, [s._id]: { ...cur, maxOpenAssignments: e.target.value } })} />
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving === s._id} onClick={() => save(s)}>{saving === s._id ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </fieldset>
              );
            })}
          </div>
        ))}
    </>
  );
}

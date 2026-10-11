import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ErrorState, PageLoading } from '../../components/States';
import { api } from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/Toast';
import { validateComplaint, IMAGE_TYPES } from '../../validation';



export default function NewComplaint() {
  const navigate = useNavigate();
  const toast = useToast();
  const cats = useApi('/categories');
  const locs = useApi('/locations');
  const [f, setF] = useState({ title: '', categoryId: '', locationId: '', description: '', file: null });
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const onFile = (e) => {
    const file = e.target.files?.[0] || null;
    setF({ ...f, file });
    setPreview(file && IMAGE_TYPES.includes(file.type) ? URL.createObjectURL(file) : null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = validateComplaint(f);
    setErrors(next); setFormError('');
    if (Object.keys(next).length) {
      document.getElementById(Object.keys(next)[0])?.focus();
      return;
    }
    const form = new FormData();
    form.append('title', f.title.trim());
    form.append('description', f.description.trim());
    form.append('categoryId', f.categoryId);
    form.append('locationId', f.locationId);
    if (f.file) form.append('attachment', f.file);
    setBusy(true);
    try {
      const d = await api('/complaints', { method: 'POST', form });
      toast.success(d.issue.escalated ? 'Complaint submitted. Several students have reported this, so it is now top priority.' : 'Complaint submitted. You can follow its progress here.');
      navigate(`/student/complaints/${d.complaint._id}`, { state: { justCreated: true } });
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setFormError(err.message);
    } finally { setBusy(false); }
  };

  if (cats.loading || locs.loading) return <><PageHeader title="Report a problem" /><PageLoading /></>;
  if (cats.error || locs.error) return <><PageHeader title="Report a problem" /><ErrorState error={cats.error || locs.error} onRetry={() => { cats.reload(); locs.reload(); }} /></>;

  const err = (k) => errors[k] && <span id={`${k}-err`} className="error">{errors[k]}</span>;
  const aria = (k, hint) => ({ 'aria-invalid': Boolean(errors[k]), 'aria-describedby': [hint, errors[k] && `${k}-err`].filter(Boolean).join(' ') || undefined });

  return (
    <>
      <PageHeader title="Report a problem" description="Tell us what is wrong and where. It goes to the staff team that handles that kind of problem." crumbs={[{ to: '/student/complaints', label: 'My complaints' }]} />
      <form className="panel" style={{ maxWidth: '46rem' }} onSubmit={submit} noValidate>
        {formError && <div className="banner banner-error" role="alert"><p>{formError}</p></div>}
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" value={f.title} onChange={set('title')} maxLength={150} placeholder="For example: Wi-Fi not working on the second floor" {...aria('title')} />
          {err('title')}
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="categoryId">Kind of problem</label>
            <select id="categoryId" value={f.categoryId} onChange={set('categoryId')} {...aria('categoryId')}>
              <option value="">Choose…</option>
              {cats.data.items.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
            {err('categoryId')}
          </div>
          <div className="field">
            <label htmlFor="locationId">Where</label>
            <select id="locationId" value={f.locationId} onChange={set('locationId')} {...aria('locationId')}>
              <option value="">Choose…</option>
              {locs.data.items.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
            {err('locationId')}
          </div>
        </div>
        <div className="field">
          <label htmlFor="description">What’s happening</label>
          <span id="description-hint" className="hint">When it started, what you’ve tried, who is affected. Don’t include passwords or other people’s personal details.</span>
          <textarea id="description" value={f.description} onChange={set('description')} maxLength={5000} {...aria('description', 'description-hint')} />
          {err('description')}
        </div>
        <div className="field">
          <label htmlFor="attachment">Photo (optional)</label>
          <span id="attachment-hint" className="hint">JPEG, PNG or WebP, up to 5 MB.</span>
          <input id="attachment" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} {...aria('attachment', 'attachment-hint')} />
          {err('attachment')}
          {preview && <img src={preview} alt="Preview of the photo you selected" style={{ maxHeight: '12rem', marginTop: '.5rem', borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }} />}
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit complaint'}</button>
          <Link to="/student/complaints" className="btn btn-secondary">Cancel</Link>
        </div>
      </form>
    </>
  );
}

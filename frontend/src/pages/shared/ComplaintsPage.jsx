import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ComplaintList from '../../components/ComplaintList';
import Pagination from '../../components/Pagination';
import { ErrorState, ListSkeleton, EmptyState } from '../../components/States';
import { useApi } from '../../hooks/useApi';
import { STATUSES, PRIORITIES } from '../../constants';

const COPY = {
  student: { title: 'My complaints', description: 'Everything you have reported.', base: '/student/complaints' },
  staff: { title: 'My queue', description: 'Complaints assigned to you. Highest priority first.', base: '/staff/complaints' },
  admin: { title: 'All complaints', description: 'Every complaint across campus.', base: '/admin/complaints' },
};

export default function ComplaintsPage({ role }) {
  const copy = COPY[role];
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const query = {
    page: params.get('page') || 1, limit: 20,
    status: params.get('status') || undefined, priority: params.get('priority') || undefined,
    categoryId: params.get('categoryId') || undefined,
    assigneeId: role === 'admin' ? params.get('assigneeId') || undefined : undefined,
    search: params.get('search') || undefined,
    sort: params.get('sort') || (role === 'staff' ? 'priority' : 'newest'),
  };
  const list = useApi('/complaints', { query });
  const cats = useApi('/categories');

  // Debounce the search box into the URL so results are shareable and the back button works.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') || '') !== search) update({ search });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }
  const sel = (id, label, value, options, key) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value || ''} onChange={(e) => update({ [key]: e.target.value })}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
  const hasFilters = ['status', 'priority', 'categoryId', 'search', 'assigneeId'].some((k) => params.get(k));

  return (
    <>
      <PageHeader title={copy.title} description={copy.description}
        actions={role === 'student' && <Link to="/student/complaints/new" className="btn btn-primary">Report a problem</Link>} />
      <div className="filters" role="search" aria-label="Filter complaints">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or description" />
        </div>
        {sel('f-status', 'Status', query.status, [['', 'Any status'], ...STATUSES.map((s) => [s, s])], 'status')}
        {sel('f-priority', 'Priority', query.priority, [['', 'Any priority'], ...PRIORITIES.map((p) => [p, p])], 'priority')}
        {sel('f-cat', 'Category', query.categoryId, [['', 'Any category'], ...(cats.data?.items || []).map((c) => [c._id, c.name])], 'categoryId')}
        {role === 'admin' && sel('f-assignee', 'Assignment', query.assigneeId, [['', 'Assigned or not'], ['unassigned', 'Unassigned only']], 'assigneeId')}
        {sel('f-sort', 'Sort', query.sort, [['newest', 'Newest first'], ['priority', 'Highest priority'], ['updated', 'Recently updated'], ['oldest', 'Oldest first']], 'sort')}
      </div>

      <div aria-live="polite" className="visually-hidden">{list.data ? `${list.data.total} complaints found` : ''}</div>
      {list.loading && <ListSkeleton />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && (list.data.items.length === 0 ? (
        hasFilters
          ? <EmptyState title="No complaints match these filters" action={<button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</button>} />
          : <EmptyState title={role === 'staff' ? 'Nothing is assigned to you' : 'No complaints yet'}
              action={role === 'student' && <Link to="/student/complaints/new" className="btn btn-primary">Report a problem</Link>}>
              {role === 'staff' ? 'New complaints in your categories will appear here when they are assigned.' : role === 'student' ? 'When you report a problem it will appear here.' : 'Complaints appear here as students report them.'}
            </EmptyState>
      ) : (
        <div className="panel panel-tight">
          <ComplaintList items={list.data.items} basePath={copy.base} showReporter={role !== 'student'} showAssignee={role === 'admin'} showSummary={role !== 'student'} />
          <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => update({ page: String(p) })} />
        </div>
      ))}
    </>
  );
}

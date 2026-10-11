import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { ErrorState, PageLoading, EmptyState } from '../../components/States';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { useApi } from '../../hooks/useApi';
import { api } from '../../api/client';
import { formatDate } from '../../constants';

export default function Issues() {
  const issues = useApi('/issues');
  const settings = useApi('/settings');
  const toast = useToast();
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const threshold = settings.data?.escalation.threshold;
  const windowDays = settings.data?.escalation.windowDays;

  const resolve = async (reason) => {
    setBusy(true);
    try {
      await api(`/issues/${target._id}/resolve`, { method: 'POST', body: { reason } });
      toast.success('Issue closed. New reports will start a fresh count.');
      setTarget(null); issues.reload();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Repeated issues" description="Complaints are grouped by category and location. Each row counts the different people who reported that problem." />
      {settings.data && (
        <div className="banner banner-info"><p>
          Rule: when <strong>more than {threshold}</strong> different people report the same category and location, every open complaint about it becomes <strong>Critical</strong>.
          {' '}{windowDays ? `Reports are counted within ${windowDays} days of the first one until the issue escalates.` : 'Reports are counted across all time.'}
          {' '}Complaints whose priority an administrator set manually keep that priority.
        </p></div>
      )}
      {issues.loading && <PageLoading />}
      {issues.error && <ErrorState error={issues.error} onRetry={issues.reload} />}
      {issues.data && (issues.data.items.length === 0 ? <EmptyState title="No reports yet">Issues appear here once students submit complaints.</EmptyState> : (
        <div className="panel panel-tight table-wrap">
          <table className="data stacked">
            <thead><tr><th scope="col">Issue</th><th scope="col">Different reporters</th><th scope="col">State</th><th scope="col">Counting since</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {issues.data.items.map((g) => (
                <tr key={g._id}>
                  <td data-label="Issue"><strong>{g.category?.name}</strong><br /><span className="muted small">{g.location?.name}</span></td>
                  <td data-label="Different reporters"><strong>{g.reporterCount}</strong> <span className="muted small">of more than {g.threshold}</span></td>
                  <td data-label="State">{g.escalated ? <span className="badge pr-Critical">Escalated {formatDate(g.escalatedAt)}</span> : <span className="badge st">Below threshold</span>}
                    {g.resolvedGenerations?.length > 0 && <div className="small muted">Closed {g.resolvedGenerations.length} time{g.resolvedGenerations.length > 1 ? 's' : ''} before</div>}</td>
                  <td data-label="Counting since">{formatDate(g.windowStartedAt)}</td>
                  <td data-label="Actions">
                    <div className="row">
                      <Link className="btn btn-quiet btn-sm" to={`/admin/complaints?categoryId=${g.category?._id}&search=`}>View complaints</Link>
                      {g.reporterCount > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTarget(g)}>Close issue</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <ConfirmDialog open={Boolean(target)} title="Close this issue?" confirmLabel="Close issue" busy={busy} reasonLabel="What was done" reasonRequired onCancel={() => setTarget(null)} onConfirm={resolve}>
        <p>The current count ({target?.reporterCount}) is kept in history. New reports of {target?.category?.name} at {target?.location?.name} will start counting from zero. Existing complaints are not changed.</p>
      </ConfirmDialog>
    </>
  );
}

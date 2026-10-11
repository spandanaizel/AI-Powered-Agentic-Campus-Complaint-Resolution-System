import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ComplaintList from '../../components/ComplaintList';
import { ErrorState, ListSkeleton, PageLoading, EmptyState } from '../../components/States';
import { useApi } from '../../hooks/useApi';
import { CountChart } from './Charts';
import { STATUSES, PRIORITIES } from '../../constants';

export default function AdminDashboard() {
  const report = useApi('/reports/summary');
  const unassigned = useApi('/complaints', { query: { assigneeId: 'unassigned', sort: 'priority', limit: 5 } });
  const r = report.data;
  const open = r ? ['Submitted', 'Reviewed', 'Assigned', 'In Progress'].reduce((n, k) => n + (r.byStatus[k] || 0), 0) : 0;

  return (
    <>
      <PageHeader title="Overview" description="All-time figures from stored complaints."
        actions={<><Link to="/admin/complaints" className="btn btn-secondary">All complaints</Link><Link to="/admin/reports" className="btn btn-secondary">Reports</Link></>} />
      {report.loading && <PageLoading />}
      {report.error && <ErrorState error={report.error} onRetry={report.reload} />}
      {r && (
        <>
          <section className="figures" aria-label="Complaint totals">
            <div className="figure"><span className="n">{r.total}</span><span className="l">Complaints</span></div>
            <div className="figure"><span className="n">{open}</span><span className="l">Open</span></div>
            <div className="figure"><span className="n">{r.unassignedOpen}</span><span className="l">Waiting for assignment</span></div>
            <div className="figure critical"><span className="n">{r.byPriority.Critical || 0}</span><span className="l">Critical priority</span></div>
            <div className="figure"><span className="n">{r.escalatedIssues}</span><span className="l"><Link to="/admin/issues">Escalated issues</Link></span></div>
          </section>
          <div className="grid-even" style={{ marginBottom: '1.5rem' }}>
            <div className="panel"><CountChart title="Complaints by status" data={r.byStatus} order={STATUSES} /></div>
            <div className="panel"><CountChart title="Complaints by category" data={r.byCategory} /></div>
          </div>
        </>
      )}
      <h2>Waiting for assignment</h2>
      {unassigned.loading && <ListSkeleton rows={3} />}
      {unassigned.error && <ErrorState error={unassigned.error} onRetry={unassigned.reload} />}
      {unassigned.data && (unassigned.data.items.length === 0
        ? <EmptyState title="Nothing is waiting for assignment">New complaints are assigned automatically when an eligible staff member has capacity.</EmptyState>
        : (
          <div className="panel panel-tight">
            <ComplaintList items={unassigned.data.items} basePath="/admin/complaints" showReporter showSummary />
            {unassigned.data.total > 5 && <div className="pagination"><Link to="/admin/complaints?assigneeId=unassigned&sort=priority">See all {unassigned.data.total}</Link></div>}
          </div>
        ))}
    </>
  );
}

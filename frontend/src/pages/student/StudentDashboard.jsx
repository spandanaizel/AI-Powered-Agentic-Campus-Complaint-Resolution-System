import { Link } from 'react-router-dom';
import { FiPlusSquare } from 'react-icons/fi';
import PageHeader from '../../components/PageHeader';
import ComplaintList from '../../components/ComplaintList';
import { ErrorState, ListSkeleton, EmptyState } from '../../components/States';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../auth/AuthContext';

export default function StudentDashboard() {
  const { user } = useAuth();
  const stats = useApi('/complaints/stats');
  const recent = useApi('/complaints', { query: { limit: 5, sort: 'updated' } });
  const s = stats.data;
  const open = s ? ['Submitted', 'Reviewed', 'Assigned', 'In Progress'].reduce((n, k) => n + (s.byStatus[k] || 0), 0) : 0;

  return (
    <>
      <PageHeader
        title={`Hello, ${user.name.split(' ')[0]}`}
        description="Your complaints and where each one stands."
        actions={<Link to="/student/complaints/new" className="btn btn-primary"><FiPlusSquare aria-hidden="true" /> Report a problem</Link>}
      />
      {stats.error ? <ErrorState error={stats.error} onRetry={stats.reload} /> : (
        <section className="figures" aria-label="Your complaint totals" aria-busy={stats.loading}>
          <div className="figure"><span className="n">{s ? s.total : '–'}</span><span className="l">Reported</span></div>
          <div className="figure"><span className="n">{s ? open : '–'}</span><span className="l">Open</span></div>
          <div className="figure"><span className="n">{s ? s.byStatus.Resolved || 0 : '–'}</span><span className="l">Waiting for your confirmation</span></div>
          <div className="figure"><span className="n">{s ? s.byStatus.Closed || 0 : '–'}</span><span className="l">Closed</span></div>
        </section>
      )}
      <h2>Recently updated</h2>
      {recent.loading && <ListSkeleton rows={3} />}
      {recent.error && <ErrorState error={recent.error} onRetry={recent.reload} />}
      {recent.data && (recent.data.items.length === 0 ? (
        <EmptyState title="You haven’t reported anything yet" action={<Link to="/student/complaints/new" className="btn btn-primary">Report a problem</Link>}>
          Broken Wi-Fi, a leaking tap, a faulty projector: report it here and follow it until it’s fixed.
        </EmptyState>
      ) : (
        <div className="panel panel-tight">
          <ComplaintList items={recent.data.items} basePath="/student/complaints" />
          {recent.data.total > 5 && <div className="pagination"><Link to="/student/complaints">See all {recent.data.total} complaints</Link></div>}
        </div>
      ))}
    </>
  );
}

import { Link } from 'react-router-dom';
import { StatusBadge, PriorityBadge } from './Badges';
import { formatDate } from '../constants';

/** Ticket list with the priority edge band; escalated issues get the striped band. */
export default function ComplaintList({ items, basePath, showReporter, showAssignee, showSummary }) {
  return (
    <ul className="tickets">
      {items.map((c) => (
        <li key={c._id} className="ticket" data-priority={c.priority} data-escalated={c.escalated ? 'true' : 'false'}>
          <div style={{ minWidth: 0 }}>
            <Link className="ticket-title" to={`${basePath}/${c._id}`}>{c.title}</Link>
            <div className="ticket-meta">
              <span>{c.category?.name}</span>
              <span>{c.location?.name}</span>
              <span>Reported {formatDate(c.createdAt)}</span>
              {showReporter && c.reporter && <span>By {c.reporter.name}</span>}
              {showAssignee && <span>{c.assignee ? `Assigned to ${c.assignee.name}` : 'Unassigned'}</span>}
            </div>
          </div>
          <div className="ticket-badges">
            {c.escalated && <span className="badge pr-Critical">Escalated</span>}
            <PriorityBadge priority={c.priority} />
            <StatusBadge status={c.status} />
          </div>
          {showSummary && c.aiSummary?.text && <p className="ticket-summary">{c.aiSummary.source === 'anthropic' ? 'AI summary: ' : 'Excerpt: '}{c.aiSummary.text}</p>}
        </li>
      ))}
    </ul>
  );
}

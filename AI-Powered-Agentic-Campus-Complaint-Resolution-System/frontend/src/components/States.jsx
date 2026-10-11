import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';

export function PageLoading({ label = 'Loading' }) {
  return (
    <div role="status" aria-live="polite" className="stack" style={{ padding: '1rem 0' }}>
      <span className="visually-hidden">{label}…</span>
      <div className="skeleton" style={{ width: '40%', height: '1.6rem' }} />
      <div className="skeleton" style={{ width: '90%' }} />
      <div className="skeleton" style={{ width: '75%' }} />
    </div>
  );
}

export function ListSkeleton({ rows = 4, label = 'Loading list' }) {
  return (
    <div role="status" aria-live="polite" className="panel">
      <span className="visually-hidden">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="stack" style={{ padding: '.6rem 0' }}>
          <div className="skeleton" style={{ width: `${60 - i * 7}%` }} />
          <div className="skeleton" style={{ width: '35%', height: '.75rem' }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="panel empty">
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'This could not be loaded' }) {
  return (
    <div className="banner banner-error" role="alert">
      <FiAlertTriangle aria-hidden="true" />
      <div className="stack" style={{ flex: 1 }}>
        <p><strong>{title}.</strong> {error?.message}</p>
        {onRetry && (
          <div><button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}><FiRefreshCw aria-hidden="true" /> Try again</button></div>
        )}
      </div>
    </div>
  );
}

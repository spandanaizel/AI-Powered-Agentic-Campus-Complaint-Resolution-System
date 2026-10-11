export default function Pagination({ page, totalPages, total, onPage }) {
  if (!total) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted small">Page {page} of {totalPages}, {total} {total === 1 ? 'complaint' : 'complaints'}</span>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </nav>
  );
}

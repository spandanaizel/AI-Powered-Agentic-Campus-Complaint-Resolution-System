import { useState } from 'react';
import PageHeader from '../../components/PageHeader';
import { ErrorState, PageLoading } from '../../components/States';
import { useApi } from '../../hooks/useApi';
import { formatDate } from '../../constants';
import { CountChart } from './Charts';
import { STATUSES, PRIORITIES } from '../../constants';

const toCsv = (rows) => rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');

export default function Reports() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [applied, setApplied] = useState({});
  const [rangeError, setRangeError] = useState('');
  const report = useApi('/reports/summary', { query: applied });
  const r = report.data;

  const apply = (e) => {
    e.preventDefault();
    if (range.from && range.to && range.from > range.to) { setRangeError('The start date must be before the end date.'); return; }
    setRangeError('');
    setApplied({ from: range.from || undefined, to: range.to ? `${range.to}T23:59:59.999Z` : undefined });
  };
  const download = () => {
    const rows = [['Section', 'Group', 'Complaints'],
      ...Object.entries(r.byStatus).map(([k, v]) => ['Status', k, v]),
      ...Object.entries(r.byPriority).map(([k, v]) => ['Priority', k, v]),
      ...Object.entries(r.byCategory).map(([k, v]) => ['Category', k, v]),
      ...r.createdPerDay.map((d) => ['Created per day', d.date, d.count])];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `complaints-report-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); URL.revokeObjectURL(url);
  };
  const rangeLabel = applied.from || applied.to
    ? `Complaints created ${applied.from ? `from ${formatDate(applied.from)}` : ''} ${applied.to ? `to ${formatDate(applied.to)}` : ''}`.trim()
    : 'All complaints, all time';

  return (
    <>
      <PageHeader title="Reports" description="Counts from stored complaints, filtered by the date each complaint was created." />
      <form className="panel row" onSubmit={apply} style={{ marginBottom: '1.25rem', alignItems: 'flex-end' }} noValidate>
        <div className="field" style={{ margin: 0 }}><label htmlFor="from">From</label><input id="from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-invalid={Boolean(rangeError)} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="to">To</label><input id="to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-invalid={Boolean(rangeError)} /></div>
        <button type="submit" className="btn btn-primary">Apply dates</button>
        {(applied.from || applied.to) && <button type="button" className="btn btn-quiet" onClick={() => { setRange({ from: '', to: '' }); setApplied({}); }}>Clear</button>}
        {rangeError && <span className="error" role="alert" style={{ width: '100%' }}>{rangeError}</span>}
      </form>
      {report.loading && <PageLoading />}
      {report.error && <ErrorState error={report.error} onRetry={report.reload} />}
      {r && (
        <>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <p className="muted" style={{ margin: 0 }}>{rangeLabel}</p>
            <span className="spacer" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={download} disabled={!r.total}>Download CSV</button>
          </div>
          <section className="figures" aria-label="Report totals">
            <div className="figure"><span className="n">{r.total}</span><span className="l">Complaints</span></div>
            <div className="figure"><span className="n">{(r.byStatus.Resolved || 0) + (r.byStatus.Closed || 0)}</span><span className="l">Resolved or closed</span></div>
            <div className="figure"><span className="n">{r.averageResolutionHours ?? '–'}</span><span className="l">Average hours to resolve{r.averageResolutionHours == null ? ' (none resolved yet)' : ''}</span></div>
            <div className="figure"><span className="n">{r.unassignedOpen}</span><span className="l">Waiting for assignment</span></div>
          </section>
          <div className="grid-even">
            <div className="panel"><CountChart title="By status" data={r.byStatus} order={STATUSES} /></div>
            <div className="panel"><CountChart title="By priority" data={r.byPriority} colorBy order={PRIORITIES} /></div>
            <div className="panel"><CountChart title="By category" data={r.byCategory} /></div>
            <div className="panel">
              <h2 style={{ fontSize: 'var(--step-0)' }}>Created per day</h2>
              {r.createdPerDay.length === 0 ? <p className="muted small">No complaints in this range.</p> : (
                <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  <table className="data"><thead><tr><th scope="col">Date</th><th scope="col">Complaints</th></tr></thead>
                    <tbody>{r.createdPerDay.slice().reverse().map((d) => <tr key={d.date}><td>{formatDate(d.date)}</td><td>{d.count}</td></tr>)}</tbody></table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

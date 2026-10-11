import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList, Cell } from 'recharts';

const COLORS = { Low: '#5f6b7a', Medium: '#1f5fbf', High: '#b54708', Critical: '#b42318' };

/**
 * Bar chart with a visually hidden data table for screen readers. Charts render only when there is
 * data; the caller shows an empty state otherwise.
 */
export function CountChart({ title, data, colorBy, order }) {
  const rows = Object.entries(data).map(([name, value]) => ({ name, value }))
    .sort((a, b) => (order ? order.indexOf(a.name) - order.indexOf(b.name) : b.value - a.value));
  return (
    <figure style={{ margin: 0 }}>
      <figcaption><h2 style={{ fontSize: 'var(--step-0)' }}>{title}</h2></figcaption>
      {rows.length === 0 ? <p className="muted small">No complaints in this range.</p> : (
        <>
          <div className="chart-box" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 20, right: 8, left: -16, bottom: 0 }} accessibilityLayer={false} tabIndex={-1}>
                <CartesianGrid vertical={false} stroke="#e4e8ee" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: '#eef2f7' }} />
                <Bar dataKey="value" name="Complaints" radius={[3, 3, 0, 0]} fill="#1f5fbf" isAnimationActive={false}>
                  {rows.map((r) => <Cell key={r.name} fill={colorBy ? COLORS[r.name] || '#1f5fbf' : '#1f5fbf'} />)}
                  <LabelList dataKey="value" position="top" style={{ fontSize: 12, fill: '#1b2430' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="visually-hidden">
            <caption>{title}</caption>
            <thead><tr><th scope="col">Group</th><th scope="col">Complaints</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.value}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </figure>
  );
}

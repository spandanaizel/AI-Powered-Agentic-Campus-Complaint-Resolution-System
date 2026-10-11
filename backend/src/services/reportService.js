import { Complaint, Category, IssueGroup } from '../models/index.js';

/** Admin report over stored data only. Date filter applies to complaint creation time. */
export async function summaryReport({ from, to }) {
  const match = {};
  if (from || to) match.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = await Complaint.find(match).select('status priority category createdAt resolvedAt assignee').lean();
  const categories = new Map((await Category.find().select('name').lean()).map((c) => [String(c._id), c.name]));

  const count = (key) => rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
  const byCategory = {};
  const perDay = {};
  let resolvedHours = 0; let resolvedN = 0; let unassignedOpen = 0;
  for (const r of rows) {
    const cat = categories.get(String(r.category)) || 'Unknown';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const day = r.createdAt.toISOString().slice(0, 10);
    perDay[day] = (perDay[day] || 0) + 1;
    if (r.resolvedAt) { resolvedHours += (r.resolvedAt - r.createdAt) / 3_600_000; resolvedN += 1; }
    if (!r.assignee && ['Submitted', 'Reviewed'].includes(r.status)) unassignedOpen += 1;
  }
  return {
    range: { from: from ?? null, to: to ?? null },
    total: rows.length,
    byStatus: count('status'),
    byPriority: count('priority'),
    byCategory,
    createdPerDay: Object.entries(perDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, n]) => ({ date, count: n })),
    averageResolutionHours: resolvedN ? Math.round((resolvedHours / resolvedN) * 10) / 10 : null,
    unassignedOpen,
    escalatedIssues: await IssueGroup.countDocuments({ escalated: true }),
  };
}

import mongoose from 'mongoose';
import { Complaint, Category, Location, Comment, AuditEvent } from '../models/index.js';
import { HIGHEST_PRIORITY } from '../config/constants.js';
import { audit } from './auditService.js';
import { registerReport, groupState } from './escalationService.js';
import { checkTransition, allowedNextStatuses } from './lifecycle.js';
import { badRequest, conflict, notFound, forbidden } from '../utils/errors.js';

const POPULATE = [
  { path: 'category', select: 'name' },
  { path: 'location', select: 'name' },
  { path: 'reporter', select: 'name email' },
  { path: 'assignee', select: 'name email' },
  { path: 'ai.assignment.recommendedStaff', select: 'name' },
];

/** Query filter restricting complaints to what the user may see. */
export function scopeFilter(user) {
  if (user.role === 'student') return { reporter: user._id };
  if (user.role === 'staff') return { assignee: user._id };
  return {}; // admin
}

/** Load a complaint the user is allowed to see; otherwise 404 (never reveals existence). */
export async function getAuthorizedComplaint(user, id, { populate = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Complaint not found');
  let q = Complaint.findOne({ _id: id, ...scopeFilter(user) });
  if (populate) q = q.populate(POPULATE);
  const c = await q;
  if (!c) throw notFound('Complaint not found');
  return c;
}

/** Role-specific serialization. Students never see AI internals, assignment reasons or reporter lists. */
export async function serializeForRole(complaint, user) {
  const obj = complaint.toJSON();
  let group = null;
  if (complaint.issueGroup) {
    const st = await groupState(complaint.issueGroup, complaint.groupGeneration);
    group = { id: complaint.issueGroup, generation: complaint.groupGeneration, ...st };
  }
  obj.issue = group;
  obj.allowedTransitions = allowedNextStatuses(complaint.status, user.role);
  if (user.role === 'student') {
    delete obj.ai;
    delete obj.prioritySource;
    if (obj.assignee) obj.assignee = { name: obj.assignee.name };
    if (group) obj.issue = { escalated: group.escalated };
  }
  return obj;
}

export async function createComplaint({ user, input, attachment }) {
  const [category, location] = await Promise.all([
    Category.findOne({ _id: input.categoryId, active: true }).lean(),
    Location.findOne({ _id: input.locationId, active: true }).lean(),
  ]);
  if (!category) throw badRequest('Unknown or inactive category', { field: 'categoryId' });
  if (!location) throw badRequest('Unknown or inactive location', { field: 'locationId' });

  const complaint = await Complaint.create({
    reporter: user._id, title: input.title, description: input.description,
    category: category._id, location: location._id,
    attachments: attachment ? [attachment] : [],
  });
  await audit({ actor: user, action: 'complaint.created', resourceId: complaint._id, to: 'Submitted', studentVisible: true });
  const issue = await registerReport(complaint);
  return { complaint: await Complaint.findById(complaint._id), issue };
}

const SORTS = {
  newest: { createdAt: -1 }, oldest: { createdAt: 1 },
  priority: { priorityRank: -1, createdAt: -1 }, updated: { updatedAt: -1 },
};

export async function listComplaints(user, q) {
  const filter = { ...scopeFilter(user) };
  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  if (q.categoryId) filter.category = q.categoryId;
  if (q.locationId) filter.location = q.locationId;
  if (q.assigneeId && user.role === 'admin') filter.assignee = q.assigneeId === 'unassigned' ? null : q.assigneeId;
  if (q.issueGroupId && user.role === 'admin') filter.issueGroup = q.issueGroupId;
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { description: rx }];
  }
  const skip = (q.page - 1) * q.limit;
  let items;
  if (q.sort === 'priority') {
    // Sort by priority rank in the application to avoid aggregation features that differ by server.
    const all = await Complaint.find(filter).populate(POPULATE).lean();
    const rank = { Low: 0, Medium: 1, High: 2, Critical: 3 };
    all.sort((a, b) => rank[b.priority] - rank[a.priority] || b.createdAt - a.createdAt);
    items = all.slice(skip, skip + q.limit);
  } else {
    items = await Complaint.find(filter).sort(SORTS[q.sort] || SORTS.newest).skip(skip).limit(q.limit).populate(POPULATE).lean();
  }
  const total = await Complaint.countDocuments(filter);
  items = items.map((c) => {
    const { attachments, ai, ...rest } = c;
    const row = { ...rest, attachmentCount: attachments?.length || 0, escalated: rest.prioritySource === 'escalation' };
    if (user.role === 'student') { delete row.prioritySource; if (row.assignee) row.assignee = { name: row.assignee.name }; }
    else row.aiSummary = ai?.summary?.text ? { text: ai.summary.text, source: ai.summary.source } : null;
    return row;
  });
  return { items, page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) };
}

export async function complaintStats(user) {
  const rows = await Complaint.aggregate([
    { $match: scopeFilter(user) },
    { $group: { _id: { status: '$status', priority: '$priority' }, n: { $sum: 1 } } },
  ]);
  const byStatus = {}; const byPriority = {}; let total = 0;
  for (const r of rows) {
    byStatus[r._id.status] = (byStatus[r._id.status] || 0) + r.n;
    byPriority[r._id.priority] = (byPriority[r._id.priority] || 0) + r.n;
    total += r.n;
  }
  return { total, byStatus, byPriority };
}

export async function changeStatus({ user, complaintId, to, reason }) {
  const complaint = await getAuthorizedComplaint(user, complaintId);
  const check = checkTransition({ from: complaint.status, to, role: user.role, reason });
  if (!check.ok) {
    if (check.code === 'FORBIDDEN_TRANSITION') throw forbidden(check.message);
    throw badRequest(check.message, { code: check.code });
  }
  if (to === 'In Progress' && complaint.status === 'Assigned' && !complaint.assignee) throw conflict('Complaint has no assignee');
  const set = { status: to };
  if (to === 'Resolved') set.resolvedAt = new Date();
  if (to === 'Closed') set.closedAt = new Date();
  const updated = await Complaint.findOneAndUpdate({ _id: complaint._id, status: complaint.status }, { $set: set }, { new: true });
  if (!updated) throw conflict('Complaint status changed in the meantime; reload and try again');
  await audit({ actor: user, action: 'complaint.status_changed', resourceId: complaint._id, from: complaint.status, to, reason, studentVisible: true });
  return updated;
}

export async function overridePriority({ user, complaintId, priority, reason }) {
  const complaint = await getAuthorizedComplaint(user, complaintId);
  if (complaint.priority === priority && complaint.prioritySource === 'override') throw conflict('Priority already set to this value');
  const updated = await Complaint.findByIdAndUpdate(complaint._id, { $set: { priority, prioritySource: 'override' } }, { new: true });
  await audit({ actor: user, action: 'complaint.priority_overridden', resourceId: complaint._id, from: complaint.priority, to: priority, reason, studentVisible: priority === HIGHEST_PRIORITY });
  return updated;
}

export async function addComment({ user, complaintId, body, visibility, fromAiDraft }) {
  const complaint = await getAuthorizedComplaint(user, complaintId);
  if (user.role === 'student' && visibility !== 'public') throw forbidden('Students can only post public updates');
  if (['Closed', 'Rejected'].includes(complaint.status) && user.role === 'student') throw conflict(`Complaint is ${complaint.status}`);
  const comment = await Comment.create({
    complaint: complaint._id, author: user._id, body, visibility,
    fromAiDraft: user.role === 'student' ? false : Boolean(fromAiDraft),
  });
  return comment.populate({ path: 'author', select: 'name role' });
}

const STUDENT_ACTION_LABELS = {
  'complaint.created': 'Complaint submitted',
  'complaint.status_changed': 'Status changed',
  'complaint.priority_escalated': 'Priority escalated',
  'complaint.priority_overridden': 'Priority changed',
};

/** Merged chronological timeline of audit events + comments, filtered for the caller's role. */
export async function timeline(user, complaintId) {
  const complaint = await getAuthorizedComplaint(user, complaintId);
  const isStudent = user.role === 'student';
  const [events, comments] = await Promise.all([
    AuditEvent.find({ resourceType: 'Complaint', resourceId: complaint._id, ...(isStudent ? { studentVisible: true } : {}) })
      .sort({ createdAt: 1 }).populate({ path: 'actor', select: 'name role' }).lean(),
    Comment.find({ complaint: complaint._id, ...(isStudent ? { visibility: 'public' } : {}) })
      .sort({ createdAt: 1 }).populate({ path: 'author', select: 'name role' }).lean(),
  ]);
  const items = [
    ...events.map((e) => ({
      kind: 'event', id: e._id, at: e.createdAt, action: e.action,
      label: STUDENT_ACTION_LABELS[e.action] || e.action,
      from: isStudent && e.action.includes('assign') ? undefined : e.from,
      to: isStudent && e.action.includes('assign') ? undefined : e.to,
      reason: e.reason,
      actor: e.actor ? { name: e.actor.name, role: e.actor.role } : { name: e.actorType === 'agent' ? 'AI agent' : 'System', role: e.actorType },
    })),
    ...comments.map((c) => ({
      kind: 'comment', id: c._id, at: c.createdAt, visibility: c.visibility, body: c.body,
      fromAiDraft: isStudent ? undefined : c.fromAiDraft,
      actor: c.author ? { name: c.author.name, role: c.author.role } : null,
    })),
  ];
  items.sort((a, b) => new Date(a.at) - new Date(b.at));
  return items;
}

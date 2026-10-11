import mongoose from 'mongoose';
import { User, Category, Location, IssueGroup, Complaint } from '../models/index.js';
import { OPEN_STATUSES } from '../config/constants.js';
import { config } from '../config/env.js';
import { hashPassword } from './authController.js';
import { audit } from '../services/auditService.js';
import { resolveIssueGroup, groupState } from '../services/escalationService.js';
import { summaryReport } from '../services/reportService.js';
import { providerStatus } from '../agents/providers/index.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function assertCategories(ids = []) {
  if (!ids.length) return;
  const n = await Category.countDocuments({ _id: { $in: ids } });
  if (n !== new Set(ids).size) throw badRequest('One or more categories do not exist', [{ field: 'categories' }]);
}

// ---------- Users ----------
export async function listUsers(req, res) {
  const { role, search, page, limit } = req.validQuery;
  const filter = {};
  if (role) filter.role = role;
  if (search) filter.$or = [{ name: new RegExp(escapeRx(search), 'i') }, { email: new RegExp(escapeRx(search), 'i') }];
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('categories', 'name'),
    User.countDocuments(filter),
  ]);
  res.json({ items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

export async function createUser(req, res) {
  const { password, ...rest } = req.body;
  if (await User.exists({ email: rest.email })) throw conflict('An account with this email already exists');
  if (rest.role !== 'staff') delete rest.categories;
  await assertCategories(rest.categories);
  const user = await User.create({ ...rest, passwordHash: await hashPassword(password) });
  await audit({ actor: req.user, action: 'user.created', resourceType: 'User', resourceId: user._id, to: { role: user.role } });
  res.status(201).json({ user: await user.populate('categories', 'name') });
}

export async function updateUser(req, res) {
  const target = await User.findById(req.params.id);
  if (!target) throw notFound('User not found');
  const changes = req.body;
  const isSelf = String(target._id) === String(req.user._id);
  if (isSelf && (changes.active === false || (changes.role && changes.role !== 'admin'))) {
    throw badRequest('You cannot deactivate or demote your own account');
  }
  if (target.role === 'admin' && (changes.active === false || (changes.role && changes.role !== 'admin'))) {
    const otherAdmins = await User.countDocuments({ role: 'admin', active: true, _id: { $ne: target._id } });
    if (!otherAdmins) throw badRequest('At least one active admin account must remain');
  }
  await assertCategories(changes.categories);
  const before = { role: target.role, active: target.active, categories: target.categories.map(String), maxOpenAssignments: target.maxOpenAssignments, name: target.name };
  Object.assign(target, changes);
  // Role or access changes invalidate existing sessions so they take effect immediately.
  if ((changes.role && changes.role !== before.role) || (changes.active !== undefined && changes.active !== before.active)) target.tokenVersion += 1;
  await target.save();
  await audit({ actor: req.user, action: 'user.updated', resourceType: 'User', resourceId: target._id, from: before, to: changes });
  res.json({ user: await target.populate('categories', 'name') });
}

export async function listStaff(req, res) {
  const filter = { role: 'staff' };
  if (req.query.categoryId && mongoose.isValidObjectId(req.query.categoryId)) filter.categories = req.query.categoryId;
  const staff = await User.find(filter).sort({ name: 1 }).populate('categories', 'name').lean();
  const counts = await Complaint.aggregate([
    { $match: { assignee: { $in: staff.map((s) => s._id) }, status: { $in: OPEN_STATUSES } } },
    { $group: { _id: '$assignee', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ items: staff.map(({ passwordHash, tokenVersion, __v, ...s }) => ({ ...s, openAssignments: byId.get(String(s._id)) || 0 })) });
}

// ---------- Categories & locations ----------
const namedResource = (Model, label) => ({
  async list(req, res) {
    const filter = req.user.role === 'admin' && req.query.includeInactive === 'true' ? {} : { active: true };
    res.json({ items: await Model.find(filter).sort({ name: 1 }) });
  },
  async create(req, res) {
    const doc = await Model.create(req.body);
    await audit({ actor: req.user, action: `${label}.created`, resourceType: label, resourceId: doc._id, to: req.body });
    res.status(201).json({ item: doc });
  },
  async update(req, res) {
    const doc = await Model.findById(req.params.id);
    if (!doc) throw notFound(`${label} not found`);
    const before = doc.toObject();
    Object.assign(doc, req.body);
    await doc.save();
    await audit({ actor: req.user, action: `${label}.updated`, resourceType: label, resourceId: doc._id, from: { name: before.name, active: before.active }, to: req.body });
    res.json({ item: doc });
  },
});
export const categories = namedResource(Category, 'Category');
export const locations = namedResource(Location, 'Location');

// ---------- Issue groups ----------
export async function listIssues(req, res) {
  const groups = await IssueGroup.find().sort({ escalated: -1, updatedAt: -1 }).limit(200).populate('category', 'name').populate('location', 'name');
  const items = await Promise.all(groups.map(async (g) => ({ ...g.toJSON(), ...(await groupState(g._id, g.generation)), threshold: config.escalation.threshold })));
  res.json({ items });
}

export async function resolveIssue(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Issue not found');
  const group = await resolveIssueGroup(req.params.id, req.user, req.body.reason);
  if (!group) throw notFound('Issue not found');
  res.json({ item: group });
}

// ---------- Reports & settings ----------
export async function report(req, res) {
  res.json(await summaryReport(req.validQuery));
}

export function settings(_req, res) {
  // Read-only view of effective configuration. Never includes secrets.
  res.json({
    escalation: { threshold: config.escalation.threshold, windowDays: config.escalation.windowDays, rule: `More than ${config.escalation.threshold} distinct reporters of the same category + location escalates to Critical` },
    agents: { autoAssign: config.agents.autoAssign, provider: providerStatus() },
    uploads: { maxBytes: config.maxUploadBytes, types: ['image/jpeg', 'image/png', 'image/webp'] },
  });
}

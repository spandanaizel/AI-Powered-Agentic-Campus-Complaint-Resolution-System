import mongoose from 'mongoose';
import { Complaint, User } from '../models/index.js';
import { OPEN_STATUSES } from '../config/constants.js';
import { audit } from './auditService.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

/** Active staff covering a category, each with their current open workload. */
export async function eligibleStaff(categoryId) {
  const staff = await User.find({ role: 'staff', active: true, categories: categoryId }).select('name email maxOpenAssignments').lean();
  if (!staff.length) return [];
  const counts = await Complaint.aggregate([
    { $match: { assignee: { $in: staff.map((s) => s._id) }, status: { $in: OPEN_STATUSES } } },
    { $group: { _id: '$assignee', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  return staff.map((s) => ({ ...s, openAssignments: byId.get(String(s._id)) || 0 }));
}

export async function assertAssignable(staffId, categoryId) {
  if (!mongoose.isValidObjectId(staffId)) throw badRequest('Invalid staff id');
  const staff = await User.findById(staffId).lean();
  if (!staff || staff.role !== 'staff') throw badRequest('Assignee must be a staff account');
  if (!staff.active) throw badRequest('Cannot assign to an inactive staff account');
  if (!staff.categories.some((c) => String(c) === String(categoryId))) {
    throw badRequest('This staff member does not handle the complaint\'s category');
  }
  return staff;
}

/**
 * Assign or reassign. Submitted/Reviewed complaints move to Assigned; Assigned/In Progress keep
 * their status. Uses a conditional update so a concurrent status change is not overwritten.
 */
export async function assignComplaint({ complaintId, staffId, actor, actorType = 'user', reason, source = 'manual' }) {
  const complaint = await Complaint.findById(complaintId);
  if (!complaint) throw notFound('Complaint not found');
  if (!['Submitted', 'Reviewed', 'Assigned', 'In Progress'].includes(complaint.status)) {
    throw conflict(`Cannot assign a complaint that is ${complaint.status}`);
  }
  const staff = await assertAssignable(staffId, complaint.category);
  if (complaint.assignee && String(complaint.assignee) === String(staff._id)) {
    throw conflict('Complaint is already assigned to this staff member');
  }
  const nextStatus = ['Submitted', 'Reviewed'].includes(complaint.status) ? 'Assigned' : complaint.status;
  const updated = await Complaint.findOneAndUpdate(
    { _id: complaint._id, status: complaint.status, assignee: complaint.assignee },
    { $set: { assignee: staff._id, status: nextStatus } },
    { new: true },
  );
  if (!updated) throw conflict('Complaint changed while assigning; reload and try again');

  await audit({
    actor, actorType, action: complaint.assignee ? 'complaint.reassigned' : 'complaint.assigned',
    resourceId: complaint._id, from: complaint.assignee, to: staff._id,
    reason: reason || (source === 'agent' ? 'Automatic assignment' : undefined),
  });
  if (nextStatus !== complaint.status) {
    await audit({ actor, actorType, action: 'complaint.status_changed', resourceId: complaint._id, from: complaint.status, to: nextStatus, studentVisible: true });
  }
  return updated;
}

import { Complaint, IssueGroup, IssueReporter, IssueEscalation } from '../models/index.js';
import { HIGHEST_PRIORITY, TERMINAL_STATUSES } from '../config/constants.js';
import { config } from '../config/env.js';
import { audit } from './auditService.js';
import { logger } from '../utils/logger.js';

/**
 * Repeated-issue grouping and the mandatory escalation rule.
 *
 * SAME ISSUE: complaints with the same (category, location) pair. Both come from admin-managed
 * controlled lists, so grouping is deterministic and never based on free-text similarity.
 *
 * COUNT: distinct reporters of the group's current generation = rows in IssueReporter, which has a
 * UNIQUE (group, generation, reporter) index. Repeat or racing submissions by one student fail the
 * insert, so they can never inflate the count.
 *
 * RULE: when distinct reporters > threshold (default 5 → the 6th distinct person), the caller that
 * observes it inserts an IssueEscalation row (UNIQUE per group generation). Exactly one insert can
 * succeed, so the transition is logged once; every caller then (idempotently) forces the highest
 * priority onto the generation's open, non-overridden complaints, so concurrent callers converge.
 *
 * Why every complaint ends up covered: each caller links its complaint to the generation BEFORE
 * inserting its reporter row and checking the count. The last reporter insert to commit is followed
 * by a count that sees every row, so a > threshold state is always observed by at least one caller;
 * complaints linked before the escalator's update are caught by it, later ones check for themselves.
 *
 * WINDOW: a not-yet-escalated group counts reporters within ESCALATION_WINDOW_DAYS of the first
 * report of its current generation (default 30; 0 = all time). After the window lapses, the next
 * report starts a new generation. An escalated generation stays escalated until an admin resolves it.
 */

export const groupKeyFor = (categoryId, locationId) => `${String(categoryId)}:${String(locationId)}`;
export const isOverThreshold = (count, threshold = config.escalation.threshold) => count > threshold;
export const countReporters = (groupId, generation) => IssueReporter.countDocuments({ issueGroup: groupId, generation });

async function getOrCreateGroup({ groupKey, categoryId, locationId, now }) {
  const existing = await IssueGroup.findOne({ groupKey });
  if (existing) return existing;
  try {
    return await IssueGroup.create({ groupKey, category: categoryId, location: locationId, generation: 1, windowStartedAt: now });
  } catch (err) {
    if (err?.code === 11000) return IssueGroup.findOne({ groupKey }); // lost a creation race; use the winner's
    throw err;
  }
}

async function rollWindowIfLapsed(group, now) {
  const days = config.escalation.windowDays;
  if (!days || group.escalated) return group;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  if (group.windowStartedAt >= cutoff) return group;
  // Conditional on the generation we saw, so concurrent callers roll the window at most once.
  await IssueGroup.updateOne(
    { _id: group._id, generation: group.generation, escalated: false },
    { $set: { windowStartedAt: now }, $inc: { generation: 1 } },
  );
  return IssueGroup.findById(group._id);
}

/** Force the highest priority onto open, non-overridden complaints of an escalated generation. */
async function applyEscalationToComplaints(groupId, generation, threshold) {
  const affected = await Complaint.find({
    issueGroup: groupId, groupGeneration: generation,
    priority: { $ne: HIGHEST_PRIORITY }, prioritySource: { $ne: 'override' }, status: { $nin: TERMINAL_STATUSES },
  }).select('_id priority').lean();
  if (!affected.length) return 0;
  await Complaint.updateMany(
    { _id: { $in: affected.map((c) => c._id) }, prioritySource: { $ne: 'override' } },
    { $set: { priority: HIGHEST_PRIORITY, prioritySource: 'escalation' } },
  );
  await Promise.all(affected.map((c) => audit({
    actorType: 'system', action: 'complaint.priority_escalated', resourceId: c._id,
    from: c.priority, to: HIGHEST_PRIORITY, studentVisible: true,
    reason: `More than ${threshold} different people reported this issue`,
  })));
  return affected.length;
}

/**
 * Called after a complaint is inserted: links it to its issue group generation, counts its reporter
 * and applies the threshold rule. Returns the group state for the API response.
 */
export async function registerReport(complaint, { now = new Date() } = {}) {
  const threshold = config.escalation.threshold;
  const groupKey = groupKeyFor(complaint.category, complaint.location);

  let group = await getOrCreateGroup({ groupKey, categoryId: complaint.category, locationId: complaint.location, now });
  group = await rollWindowIfLapsed(group, now);
  const { generation } = group;

  // 1. Link first (see the coverage argument above).
  await Complaint.updateOne({ _id: complaint._id }, { $set: { issueGroup: group._id, groupGeneration: generation } });

  // 2. Count this reporter at most once.
  try {
    await IssueReporter.create({ issueGroup: group._id, generation, reporter: complaint.reporter, firstComplaint: complaint._id });
  } catch (err) {
    if (err?.code !== 11000) throw err; // duplicate = already counted
  }
  const reporterCount = await countReporters(group._id, generation);

  // 3. Exactly-once transition.
  if (isOverThreshold(reporterCount, threshold)) {
    try {
      await IssueEscalation.create({ issueGroup: group._id, generation, reporterCount, threshold, triggeredBy: complaint._id });
      await IssueGroup.updateOne({ _id: group._id, generation }, { $set: { escalated: true, escalatedAt: now, escalationThreshold: threshold } });
      await audit({
        actorType: 'system', action: 'issue.escalated', resourceType: 'IssueGroup', resourceId: group._id,
        from: { escalated: false }, to: { escalated: true, reporterCount, threshold, generation },
        reason: `Distinct reporters (${reporterCount}) exceeded threshold (${threshold})`,
      });
      logger.info('issue group escalated', { groupId: String(group._id), generation, reporterCount });
    } catch (err) {
      if (err?.code !== 11000) throw err; // someone else escalated this generation
    }
  }

  // 4. Converge: if this generation is escalated, make sure its open complaints are Critical.
  const escalation = await IssueEscalation.findOne({ issueGroup: group._id, generation }).lean();
  if (escalation) await applyEscalationToComplaints(group._id, generation, escalation.threshold);

  return { groupId: group._id, generation, reporterCount, escalated: Boolean(escalation) };
}

/** Group state for one generation, used by API serializers. */
export async function groupState(groupId, generation) {
  const [reporterCount, escalation] = await Promise.all([
    countReporters(groupId, generation),
    IssueEscalation.findOne({ issueGroup: groupId, generation }).lean(),
  ]);
  return { reporterCount, escalated: Boolean(escalation), escalatedAt: escalation?.createdAt ?? null };
}

/** Admin closes the current generation of an issue: history is kept, counting restarts. */
export async function resolveIssueGroup(groupId, actor, reason) {
  const current = await IssueGroup.findById(groupId);
  if (!current) return null;
  const state = await groupState(current._id, current.generation);
  const updated = await IssueGroup.findOneAndUpdate(
    { _id: groupId, generation: current.generation },
    {
      $push: { resolvedGenerations: { generation: current.generation, reporterCount: state.reporterCount, escalated: state.escalated, closedAt: new Date(), closedBy: actor._id, reason } },
      $set: { escalated: false, escalatedAt: null, escalationThreshold: null, windowStartedAt: new Date() },
      $inc: { generation: 1 },
    },
    { new: true },
  );
  if (updated) {
    await audit({ actor, action: 'issue.generation_resolved', resourceType: 'IssueGroup', resourceId: groupId, from: { generation: current.generation }, to: { generation: updated.generation }, reason });
  }
  return updated;
}
